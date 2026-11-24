// Newsletter (supabase/migrations/20261124173700_newsletter.sql) y su vuelta atrás, encima del núcleo, la web editable,
// el IVA de los presupuestos, Tráfico web y Logs web, contra un Postgres en memoria (PGlite). Nunca toca Supabase. Va
// dentro de `npm run test:nucleo:db`.
//
// Cubre: se aplica entera y dos veces; RLS en todas sus tablas (barrera de sesión en las que lee el panel; los tokens y
// el límite por IP sin políticas); la auditoría (fuera los datos derivados y los tokens, también al reinstalarla);
// lectura: la web (anon) no lee nada, el panel solo con «Ver» en Newsletter y el super admin siempre; nadie escribe a
// mano en los suscriptores; la máquina de estados del doble opt-in (todo nace pendiente, solo se activa con el token
// del correo, que caduca y se renueva con límites; email normalizado e inmutable); la baja con el token del enlace
// (también one-click), inmutable, que invalida la confirmación pendiente y que solo se reabre con un consentimiento
// nuevo y otra confirmación; el límite de altas por huella de IP; las bajas automáticas de Resend y las direcciones
// suprimidas; las funciones del panel («Editar»: alta con el consentimiento apuntado, importación, baja y supresión
// RGPD que limpia la auditoría y los eventos); las confirmaciones pendientes; ajustes, plantillas, el tope diario de
// la IA, un solo envío a la vez, las estadísticas por envío, la purga, las tareas programadas, y la vuelta atrás y su
// reaplicación.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { BASE, adaptar } from "./pglite-supabase.mjs";

const leer = (r) => readFile(r, "utf8");
const NUCLEO = await leer("supabase/migrations/20261118120000_nucleo_panel.sql");
const WEB = await leer("supabase/migrations/20261123100000_web_y_presupuestos.sql");
const IVA = await leer("supabase/migrations/20261124100000_presupuestos_iva_incluido.sql");
const TRAFICO = await leer("supabase/migrations/20261124110000_trafico_web.sql");
const LOGS = await leer("supabase/migrations/20261124120000_logs_web.sql");
const MIGRACION = await leer("supabase/migrations/20261124173700_newsletter.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261124173700_newsletter_ROLLBACK.sql");
const sinAuditoria = (sql) => [...sql.matchAll(/^drop trigger if exists trg_auditoria on public\.\w+;$/gm)].map((m) => m[0]).join("\n");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const db = await PGlite.create({ extensions: { pg_trgm, unaccent } });
const q = (sql, params) => db.query(sql, params);
const uno = async (sql, params) => (await q(sql, params)).rows[0];
const cuenta = async (sql, params) => (await uno(sql, params)).n;
const hash = (t) => createHash("sha256").update(t, "utf8").digest("hex");

const SA = "11111111-1111-4111-8111-111111111111";
const NL_VER = "22222222-2222-4222-8222-222222222222";
const NL_EDITA = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";
const sesion = (id) => id.replace(/^./, "a");

const comoUsuario = async (id) => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: "authenticated", session_id: sesion(id) })]);
  await q("select set_config('request.headers', '{}', false)");
  await db.exec("set role authenticated");
};
const comoWeb = async () => {
  await db.exec("reset role");
  await q(`select set_config('request.jwt.claims', '{"role":"anon"}', false)`);
  await q("select set_config('request.headers', '{}', false)");
  await db.exec("set role anon");
};
// Edge Functions: service role con su origen (lo exige la auditoría del núcleo).
const comoFuncion = async (origen = "newsletter-alta") => {
  await db.exec("reset role");
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await q("select set_config('request.headers', $1, false)", [JSON.stringify({ "x-audit-source": origen })]);
  await db.exec("set role service_role");
};
const comoServidor = async () => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', '', false)");
  await q("select set_config('request.headers', '', false)");
};
async function aplicar(sql) {
  await comoServidor();
  await db.exec(adaptar(sql));
  await q("select public.instalar_auditoria_panel()");
  await db.exec(sinAuditoria(sql));
}
const auditada = async (t) => (await cuenta(`select count(*)::int n from pg_trigger where tgname = 'trg_auditoria' and tgrelid = 'public.${t}'::regclass`)) === 1;

const TEXTO = "Acepto recibir por correo las novedades y ofertas de Cristalería Baix Vinalopó (política de privacidad).";
const IP = "a".repeat(64);
const alta = async (email, { ip = IP, nombre = null, origen = "web_formulario", max = 5 } = {}) => {
  await comoFuncion("newsletter-alta");
  return (await uno("select public.newsletter_alta_web($1, $2, $3, $4, $5, $6) r", [ip, email, nombre, origen, TEXTO, max])).r;
};
const confirmar = async (token) => {
  await comoFuncion("newsletter-alta");
  return (await uno("select public.newsletter_confirmar($1) r", [token])).r;
};
const tokenBaja = async (id) => {
  await comoServidor();
  return (await uno("select baja_token t from public.newsletter_claves where suscriptor_id = $1", [id])).t;
};
const baja = async (token, origen = "enlace_email") => {
  await comoFuncion("newsletter-baja");
  return (await uno("select public.newsletter_baja_por_token($1, $2) r", [token, origen])).r;
};
const sus = async (email) => {
  await comoServidor();
  return uno("select * from public.newsletter_suscriptores where email = $1", [email]);
};

// ─── 1. Se aplica entera (y dos veces) ──────────────────────────────────────
await db.exec(BASE);
await db.exec("grant select, insert, update, delete on storage.objects to anon, authenticated");
await db.exec(adaptar(NUCLEO));
for (const m of [WEB, IVA, TRAFICO, LOGS]) await aplicar(m);
await aplicar(MIGRACION);
await aplicar(MIGRACION);

const TABLAS = ["newsletter_config", "newsletter_suscriptores", "newsletter_claves", "newsletter_altas_limite", "newsletter_envios",
  "newsletter_plantillas", "newsletter_ia_peticiones", "newsletter_sincronizaciones_resend", "email_eventos", "direcciones_email_suprimidas"];
const TABLAS_PANEL = TABLAS.filter((t) => !["newsletter_claves", "newsletter_altas_limite"].includes(t));
const tablas = (await q("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
for (const t of TABLAS) ok(tablas.includes(t), `falta la tabla ${t}`);
igual((await q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) and not relrowsecurity",
  [TABLAS])).rows, [], "todas con RLS");
igual(await cuenta("select count(*)::int n from pg_policies where policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE' and tablename = any($1)",
  [TABLAS_PANEL]), TABLAS_PANEL.length, "las que lee el panel, con la barrera de sesión bloqueada");
igual(await cuenta("select count(*)::int n from pg_policies where tablename in ('newsletter_claves', 'newsletter_altas_limite')"), 0,
  "los tokens y el límite por IP, sin políticas");
igual((await uno("select remitente_email, remitente_nombre, canal, limite_transaccional, web_url from public.newsletter_config")),
  { remitente_email: null, remitente_nombre: "Cristalería Baix Vinalopó", canal: "transaccional", limite_transaccional: 80, web_url: "https://cristaleriabv.vercel.app" },
  "ajustes de partida: sin remitente (no se envía nada hasta configurarlo)");
igual((await q("select jobname, schedule from cron.job where jobname like 'newsletter%' order by 1")).rows,
  [{ jobname: "newsletter-purgar", schedule: "10 4 * * *" }, { jobname: "newsletter-sync-resend", schedule: "20 5 * * *" }], "tareas programadas");
igual((await uno("select funcion, activo from public.ia_funciones where funcion = 'newsletter-ia'")), { funcion: "newsletter-ia", activo: true },
  "«Crear con IA» registrada en las funciones de IA");

// ─── 2. Auditoría ───────────────────────────────────────────────────────────
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await uno(`select pg_get_functiondef('public.${fn}'::regproc) d`)).d;
  igual(def.split("'newsletter_claves'").length - 1, 1, `${fn} excluye newsletter_claves una sola vez (aunque se aplique dos veces)`);
  ok(def.includes("'web_eventos'") && def.includes("'email_eventos'"), `${fn} conserva la lista de Logs web y añade la del newsletter`);
}
await q("select public.instalar_auditoria_panel()");
for (const t of ["newsletter_claves", "newsletter_altas_limite", "newsletter_ia_peticiones", "newsletter_sincronizaciones_resend", "email_eventos"]) {
  igual(await auditada(t), false, `${t} sin auditoría, también tras reinstalarla`);
}
for (const t of ["newsletter_suscriptores", "newsletter_config", "newsletter_envios", "newsletter_plantillas"]) ok(await auditada(t), `${t} auditada`);

// ─── 3. Usuarios ────────────────────────────────────────────────────────────
const usuarios = [[SA, "sa@example.com"], [NL_VER, "ver@example.com"], [NL_EDITA, "edita@example.com"], [STAFF, "staff@example.com"]];
await db.exec(`
  insert into auth.users (id, email) values ${usuarios.map(([id, e]) => `('${id}', '${e}')`).join(", ")};
  insert into auth.sessions (id, user_id) values ${usuarios.map(([id]) => `('${sesion(id)}', '${id}')`).join(", ")};
  insert into public.super_admins (user_id, email) values ('${SA}', 'sa@example.com');
  insert into public.user_roles (user_id, role) values ${usuarios.slice(1).map(([id]) => `('${id}', 'staff')`).join(", ")};
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${NL_VER}', 'newsletter', true, false), ('${NL_EDITA}', 'newsletter', true, true), ('${STAFF}', 'dashboard', true, false);
`);

// ─── 4. Doble opt-in: alta desde la web ─────────────────────────────────────
const a1 = await alta("  Ana@Example.COM ", { nombre: "Ana" });
igual([a1.ok, a1.accion, a1.enviar, a1.email], [true, "pendiente", true, "ana@example.com"], "alta nueva: pendiente y hay que enviar la confirmación");
ok(/^[0-9a-f]{64}$/.test(a1.token), "token de confirmación aleatorio de 64 hex");
let ana = await sus("ana@example.com");
igual([ana.estado, ana.activo, ana.origen_alta, ana.nombre, ana.consentimiento_texto, ana.confirmaciones_enviadas, ana.fecha_verificacion_email],
  ["pendiente", false, "web_formulario", "Ana", TEXTO, 1, null], "nace pendiente, con el consentimiento guardado (email normalizado)");
const claves = await uno("select * from public.newsletter_claves where suscriptor_id = $1", [ana.id]);
ok(claves.confirmacion_hash === hash(a1.token) && claves.confirmacion_hash !== a1.token, "solo se guarda el hash del token de confirmación");
ok(/^[0-9a-f]{64}$/.test(claves.baja_token) && claves.baja_token !== a1.token, "y un token de baja propio");
ok(new Date(claves.confirmacion_caduca_at) > new Date(Date.now() + 6.9 * 86400000), "que caduca a los 7 días");

// Nadie activa a mano: ni la service role, ni insertando ya activo.
await comoFuncion("enviar-newsletter");
await falla(q("update public.newsletter_suscriptores set estado = 'activo', fecha_verificacion_email = now() where id = $1", [ana.id]),
  /doble opt-in/, "la service role tampoco puede activar sin el enlace");
await q("insert into public.newsletter_suscriptores (email, origen_alta, consentimiento_texto, estado, fecha_verificacion_email) values ('trampa@example.com', 'importacion', $1, 'activo', now())", [TEXTO]);
igual((await sus("trampa@example.com")).estado, "pendiente", "insertar «activo» deja pendiente");
await comoFuncion("enviar-newsletter");
await falla(q("update public.newsletter_suscriptores set email = 'otra@example.com' where id = $1", [ana.id]), /no se puede cambiar/, "el email no cambia");

igual((await confirmar("0".repeat(64))).estado, "invalido", "token desconocido: inválido");
igual((await confirmar("no-es-un-token")).estado, "invalido", "token mal formado: inválido");
igual((await confirmar(a1.token.toUpperCase())).estado, "invalido", "el token es exacto");
const c1 = await confirmar(a1.token);
igual([c1.ok, c1.estado, c1.email], [true, "confirmada", "ana@example.com"], "el enlace del correo confirma");
ana = await sus("ana@example.com");
ok(ana.estado === "activo" && ana.activo && ana.fecha_verificacion_email !== null, "activo, con la fecha de verificación");
igual((await confirmar(a1.token)).estado, "ya_confirmada", "pulsarlo otra vez: ya estaba confirmada");
igual((await alta("ana@example.com")).accion, "ya_activo", "volver a apuntarse estando activo: nada que enviar");
igual((await alta("ana@example.com")).enviar, false, "sin confirmación nueva");

// Pendiente: otra confirmación como mucho cada 10 minutos y 5 en total; el token anterior deja de valer.
const b1 = await alta("beto@example.com", { ip: "b".repeat(64) });
const b2 = await alta("beto@example.com", { ip: "b".repeat(64) });
igual([b2.accion, b2.enviar, b2.token], ["espera", false, undefined], "otra alta enseguida: no se reenvía");
await comoServidor();
await q("update public.newsletter_suscriptores set confirmacion_enviada_at = now() - interval '11 minutes' where email = 'beto@example.com'");
const b3 = await alta("beto@example.com", { ip: "b".repeat(64), nombre: "Beto" });
igual([b3.accion, b3.enviar], ["pendiente", true], "pasados 10 minutos, otra confirmación");
igual((await confirmar(b1.token)).estado, "invalido", "el token anterior ya no vale");
igual([(await sus("beto@example.com")).confirmaciones_enviadas, (await sus("beto@example.com")).nombre], [2, "Beto"], "cuenta las confirmaciones y completa el nombre");
await comoServidor();
await q("update public.newsletter_suscriptores set confirmaciones_enviadas = 5, confirmacion_enviada_at = now() - interval '2 hours' where email = 'beto@example.com'");
igual((await alta("beto@example.com", { ip: "b".repeat(64) })).accion, "espera", "con 5 confirmaciones ya no se envían más");
await comoServidor();
await q("update public.newsletter_claves set confirmacion_caduca_at = now() - interval '1 minute' where confirmacion_hash = $1", [hash(b3.token)]);
igual((await confirmar(b3.token)).estado, "caducado", "a los 7 días el enlace caduca");
igual((await sus("beto@example.com")).estado, "pendiente", "y sigue pendiente");

// ─── 5. Lectura: la web nada, el panel con «Ver», el super admin siempre ────
await comoWeb();
for (const t of ["newsletter_suscriptores", "newsletter_claves", "newsletter_config", "email_eventos", "newsletter_envios"]) {
  await falla(q(`select * from public.${t}`), /permission denied/, `la web (anon) no lee ${t}`);
}
await falla(q("select public.newsletter_alta_web($1, 'x@example.com', null, 'web_formulario', $2, 5)", [IP, TEXTO]), /permission denied/,
  "ni llama a las funciones de las Edge Functions");
await falla(q("select public.newsletter_confirmar($1)", ["0".repeat(64)]), /permission denied/, "ni confirma sin pasar por la función");
await comoUsuario(STAFF);
igual(await cuenta("select count(*)::int n from public.newsletter_suscriptores"), 0, "sin la sección no ve suscriptores");
igual(await cuenta("select count(*)::int n from public.newsletter_config"), 0, "ni los ajustes");
await comoUsuario(NL_VER);
igual(await cuenta("select count(*)::int n from public.newsletter_suscriptores"), 3, "con «Ver» en Newsletter, sí");
await falla(q("select * from public.newsletter_claves"), /permission denied/, "pero nunca los tokens");
await falla(q("insert into public.newsletter_suscriptores (email, origen_alta, consentimiento_texto) values ('mano@example.com', 'panel_manual', $1)", [TEXTO]),
  /permission denied/, "ni escribe a mano");
await falla(q("delete from public.newsletter_suscriptores"), /permission denied/, "ni borra a mano");
await comoUsuario(NL_EDITA);
await falla(q("update public.newsletter_suscriptores set nombre = 'x'"), /permission denied/, "ni con «Editar» (solo por las funciones del panel)");
await comoUsuario(SA);
igual(await cuenta("select count(*)::int n from public.newsletter_suscriptores"), 3, "el super admin ve todo sin permisos guardados");

// ─── 6. Baja con el token del enlace ────────────────────────────────────────
const tAna = await tokenBaja(ana.id);
await comoFuncion("newsletter-baja");
igual((await uno("select public.newsletter_estado_baja($1) r", [tAna])).r, { ok: true, estado: "confirmar", email: "ana@example.com" },
  "la página de baja pregunta antes (el GET no cambia nada)");
igual((await baja("f".repeat(64))).estado, "invalido", "token desconocido: inválido");
igual((await baja("123")).estado, "invalido", "token mal formado: inválido");
await falla(baja(tAna, "panel_manual"), /origen no válido/, "solo los orígenes del enlace");
const r1 = await baja(tAna);
igual([r1.ok, r1.estado, r1.email], [true, "baja_hecha", "ana@example.com"], "baja hecha");
ana = await sus("ana@example.com");
igual([ana.estado, ana.activo, ana.origen_baja, ana.fecha_baja !== null], ["baja", false, "enlace_email", true], "de baja, con fecha y origen");
igual((await baja(tAna, "cabecera_one_click")).estado, "ya_estaba", "repetirla (también one-click): ya estaba");
await comoFuncion("resend-webhook");
await q("update public.newsletter_suscriptores set origen_baja = 'queja_spam', fecha_baja = now() - interval '1 year' where id = $1", [ana.id]);
igual([(await sus("ana@example.com")).origen_baja, (await sus("ana@example.com")).fecha_baja], [ana.origen_baja, ana.fecha_baja], "la constancia de la baja no cambia");
await comoFuncion("resend-webhook");
await falla(q("update public.newsletter_suscriptores set estado = 'activo', fecha_verificacion_email = now() where id = $1", [ana.id]),
  /no permitido|doble opt-in/, "de baja a activo, nunca directo");
await falla(q("update public.newsletter_suscriptores set estado = 'pendiente' where id = $1", [ana.id]), /consentimiento nuevo/,
  "ni a pendiente sin un consentimiento nuevo");
igual((await confirmar(a1.token)).estado, "invalido", "el enlace de confirmación anterior a la baja ya no vale");
igual((await uno("select confirmacion_hash h from public.newsletter_claves where suscriptor_id = $1", [ana.id])).h, null, "se borró su hash");

// Vuelve a apuntarse ella misma: consentimiento nuevo y otra confirmación.
const a2 = await alta("ana@example.com", { ip: "c".repeat(64) });
igual([a2.accion, a2.enviar], ["vuelve", true], "volver a apuntarse tras la baja: otra confirmación");
ana = await sus("ana@example.com");
igual([ana.estado, ana.fecha_baja, ana.origen_baja, ana.fecha_verificacion_email], ["pendiente", null, null, null], "pendiente otra vez");
igual((await confirmar(a2.token)).estado, "confirmada", "y con el enlace nuevo, activa");
igual(await tokenBaja(ana.id), tAna, "el token de baja no cambia (los correos ya enviados siguen valiendo)");

// ─── 7. Límite de altas por huella de IP ────────────────────────────────────
const IP_L = "d".repeat(64);
for (let i = 0; i < 5; i++) igual((await alta(`lim${i}@example.com`, { ip: IP_L })).ok, true, `alta ${i + 1} de 5 en la hora`);
igual(await alta("lim5@example.com", { ip: IP_L }), { ok: false, motivo: "limite" }, "la sexta en la hora: límite");
ok(!(await sus("lim5@example.com")), "y no se guarda nada");
igual((await alta("lim5@example.com", { ip: "e".repeat(64) })).ok, true, "otra huella sí puede");
await comoServidor();
await q("update public.newsletter_altas_limite set creado_en = now() - interval '2 hours' where ip_hash = $1", [IP_L]);
igual((await alta("lim6@example.com", { ip: IP_L })).ok, true, "pasada la hora, vuelve a poder");
await comoFuncion("newsletter-alta");
await falla(q("select public.newsletter_alta_web('corta', 'x@example.com', null, 'web_formulario', $1, 5)", [TEXTO]), /huella/, "sin huella de IP, nada");
await falla(q("select public.newsletter_alta_web($1, 'no-es-email', null, 'web_formulario', $2, 5)", [IP, TEXTO]), /Email no válido/, "email no válido");
await falla(q("select public.newsletter_alta_web($1, 'x@example.com', null, 'panel_manual', $2, 5)", [IP, TEXTO]), /Origen no válido/, "solo orígenes de la web");
await falla(q("select public.newsletter_alta_web($1, 'x@example.com', null, 'web_formulario', 'corto', 5)", [IP]), /consentimiento/, "sin el texto del consentimiento, nada");

// ─── 8. Bajas automáticas (Resend) y direcciones suprimidas ─────────────────
await comoFuncion("resend-webhook");
igual((await uno("select public.newsletter_registrar_baja('LIM0@example.com', 'rebote_permanente') n")).n, 1, "un rebote da de baja (pendientes también)");
igual([(await sus("lim0@example.com")).estado, (await sus("lim0@example.com")).origen_baja], ["baja", "rebote_permanente"], "con su origen");
await falla(q("select public.newsletter_registrar_baja('a@example.com', 'enlace_email')"), /origen no válido/, "solo orígenes de Resend");
await q("insert into public.direcciones_email_suprimidas (email, motivo) values ('lim0@example.com', 'bounced')");
igual((await alta("lim0@example.com", { ip: "f".repeat(64) })), { ok: true, accion: "suprimida", enviar: false }, "a una dirección suprimida no se le escribe");
igual((await sus("lim0@example.com")).estado, "baja", "y sigue de baja");

// ─── 9. Funciones del panel ─────────────────────────────────────────────────
await comoUsuario(NL_VER);
await falla(q("select public.newsletter_alta_panel('panel@example.com', null, 'Firmó la hoja de pedido')"), /Editar/, "con solo «Ver» no da de alta");
await comoUsuario(STAFF);
await falla(q("select public.newsletter_baja_panel($1)", [ana.id]), /Editar/, "ni da de baja sin la sección");
await comoUsuario(NL_EDITA);
await falla(q("select public.newsletter_alta_panel('panel@example.com', null, 'no')"), /consentimiento/, "hay que apuntar cómo dio el consentimiento");
const p1 = (await uno("select public.newsletter_alta_panel(' Panel@Example.com ', 'Pepa', 'Lo pidió en la tienda y firmó la hoja de pedido') r")).r;
igual([p1.ok, p1.accion], [true, "creado"], "alta del panel");
const pepa = await sus("panel@example.com");
igual([pepa.estado, pepa.origen_alta, pepa.registrado_por, pepa.consentimiento_detalle],
  ["pendiente", "panel_manual", NL_EDITA, "Lo pidió en la tienda y firmó la hoja de pedido"], "pendiente de confirmar, con quién y cómo");
ok(pepa.consentimiento_texto.includes("solo se activa cuando confirma"), "con el texto del consentimiento del panel");
await comoUsuario(NL_EDITA);
igual((await uno("select public.newsletter_alta_panel('ana@example.com', null, 'Lo pidió en la tienda') r")).r.accion, "ya_activo", "ya activa: nada");
igual((await uno("select public.newsletter_alta_panel('lim0@example.com', null, 'Lo pidió en la tienda') r")).r.accion, "baja_previa",
  "una baja no se reabre desde el panel");
const imp = (await uno("select public.newsletter_importar($1::jsonb, 'Clientes que firmaron la casilla en el pedido') r", [JSON.stringify([
  { email: "imp1@example.com", nombre: "Uno" }, { email: "IMP2@example.com" }, { email: "panel@example.com" }, { email: "ana@example.com" },
  { email: "lim0@example.com" }, { email: "mal" }, "no-es-un-objeto",
])])).r;
igual(imp, { ok: true, creados: 2, ya_pendientes: 1, ya_activos: 1, bajas_previas: 1, invalidos: 2, total: 7 }, "importación con el recuento");
igual([(await sus("imp2@example.com")).estado, (await sus("imp2@example.com")).origen_alta], ["pendiente", "importacion"], "las importadas, pendientes");
await comoUsuario(NL_EDITA);
await falla(q("select public.newsletter_importar($1::jsonb, 'Clientes de la tienda')", [JSON.stringify(Array.from({ length: 2001 }, (_, i) => ({ email: `x${i}@example.com` })))]),
  /2000/, "como mucho 2000 filas");
igual((await uno("select public.newsletter_baja_panel($1) r", [pepa.id])).r.estado, "baja_hecha", "baja desde el panel");
igual((await sus("panel@example.com")).origen_baja, "panel_manual", "con origen panel_manual");

// Confirmaciones pendientes (enviar-newsletter, service role): no a quien se le mandó hace menos de un día.
await comoUsuario(NL_EDITA);
await falla(q("select public.newsletter_preparar_confirmaciones(null, 50)"), /permission denied/, "el panel no saca tokens");
await comoFuncion("enviar-newsletter");
const conf = (await uno("select public.newsletter_preparar_confirmaciones(null, 50) r")).r;
igual(conf.map((c) => c.email).sort(), ["imp1@example.com", "imp2@example.com", "trampa@example.com"], "las pendientes sin confirmación reciente");
ok(conf.every((c) => /^[0-9a-f]{64}$/.test(c.token)), "cada una con su token");
igual((await uno("select public.newsletter_preparar_confirmaciones(null, 50) r")).r, [], "y no se repiten el mismo día");
igual((await confirmar(conf.find((c) => c.email === "imp1@example.com").token)).estado, "confirmada", "la importada confirma con su enlace");

// Supresión RGPD: fuera el suscriptor, sus tokens, sus eventos y su email del rastro de auditoría.
const imp2 = await sus("imp2@example.com");
await comoFuncion("resend-webhook");
await q(`insert into public.email_eventos (email_id, tipo_evento, email_destinatario, metadata) values
  ('em-1', 'delivered', 'imp2@example.com', '{"categoria":"newsletter_confirmacion"}'), ('em-2', 'delivered', 'otra@example.com', '{}')`);
await comoServidor();
ok(await cuenta("select count(*)::int n from public.audit_log where tabla = 'newsletter_suscriptores' and registro_id = $1 and detalles::text like '%imp2@example.com%'", [imp2.id]) > 0,
  "el alta quedó en la auditoría con su email");
await comoUsuario(NL_VER);
await falla(q("select public.newsletter_suprimir($1)", [imp2.id]), /Editar/, "suprimir pide «Editar»");
await comoUsuario(NL_EDITA);
igual((await uno("select public.newsletter_suprimir($1) r", [imp2.id])).r, { ok: true, eventos_borrados: 1 }, "supresión RGPD");
await comoServidor();
ok(!(await sus("imp2@example.com")), "el suscriptor ya no está");
igual(await cuenta("select count(*)::int n from public.newsletter_claves where suscriptor_id = $1", [imp2.id]), 0, "ni sus tokens");
igual(await cuenta("select count(*)::int n from public.email_eventos where email_destinatario = 'imp2@example.com'"), 0, "ni sus eventos");
igual(await cuenta("select count(*)::int n from public.email_eventos"), 1, "los de otros siguen");
igual(await cuenta("select count(*)::int n from public.audit_log where tabla = 'newsletter_suscriptores' and registro_id = $1 and detalles::text like '%imp2@example.com%'", [imp2.id]), 0,
  "ni su email en la auditoría");
ok(await cuenta("select count(*)::int n from public.audit_log where tabla = 'newsletter_suscriptores' and registro_id = $1 and accion = 'eliminar'", [imp2.id]) === 1,
  "aunque la supresión sí consta");

// ─── 10. Ajustes, plantillas e IA ───────────────────────────────────────────
await comoUsuario(NL_VER);
await q("update public.newsletter_config set remitente_email = 'novedades@example.com'");
igual((await uno("select remitente_email r from public.newsletter_config")).r, null, "con «Ver» los ajustes no cambian");
await comoUsuario(NL_EDITA);
await q("update public.newsletter_config set remitente_email = ' Novedades@Example.com ', remitente_nombre = 'Cristalería BV', canal = 'broadcast'");
igual((await uno("select remitente_email, remitente_nombre, canal, actualizado_por from public.newsletter_config")),
  { remitente_email: "novedades@example.com", remitente_nombre: "Cristalería BV", canal: "broadcast", actualizado_por: NL_EDITA }, "con «Editar», sí (normalizados y con autor)");
await falla(q("update public.newsletter_config set remitente_email = 'no-es-un-email'"), /check/, "un remitente que no es un email no vale");
await falla(q("update public.newsletter_config set remitente_nombre = 'Malo <x@example.com>'"), /check/, "ni un nombre con <>");
await falla(q("update public.newsletter_config set web_url = 'http://inseguro.example.com'"), /check/, "la web, solo https");
await falla(q("insert into public.newsletter_config (id) values (2)"), /permission denied/, "no se crean más filas");
await falla(q("delete from public.newsletter_config"), /permission denied/, "ni se borra");

const BLOQUES = JSON.stringify([{ tipo: "texto", texto: "Hola" }]);
await comoUsuario(NL_VER);
await falla(q("insert into public.newsletter_plantillas (nombre, tipo, bloques) values ('Oferta', 'oferta', $1::jsonb)", [BLOQUES]), /row-level security/,
  "con «Ver» no se guardan plantillas");
await comoUsuario(NL_EDITA);
const pl = await uno("insert into public.newsletter_plantillas (nombre, tipo, bloques, creado_por) values ('Oferta mamparas', 'oferta', $1::jsonb, $2) returning creado_por", [BLOQUES, SA]);
igual(pl.creado_por, NL_EDITA, "con «Editar», sí, y el autor lo pone el servidor");
await falla(q("insert into public.newsletter_plantillas (nombre, tipo, bloques) values ('Carta', 'nuevo_menu', $1::jsonb)", [BLOQUES]), /check/, "tipos de cristalería, nada de menús");

for (let i = 0; i < 40; i++) await q("insert into public.newsletter_ia_peticiones (modelo) values ('m')");
await falla(q("insert into public.newsletter_ia_peticiones (modelo) values ('m')"), /newsletter_cupo_ia/, "tope de 40 propuestas de la IA al día");

// ─── 11. Envíos y estadísticas ──────────────────────────────────────────────
await comoUsuario(NL_EDITA);
await falla(q("insert into public.newsletter_envios (asunto) values ('x')"), /permission denied/, "los envíos solo los escribe la función");
await comoFuncion("enviar-newsletter");
const envio = (await uno("insert into public.newsletter_envios (asunto, enviado_por, clave_idempotencia) values ('Ofertas de invierno', $1, $2) returning id", [NL_EDITA, randomUUID()])).id;
await falla(q("insert into public.newsletter_envios (asunto) values ('Otro a la vez')"), /unique|duplicate/, "un solo envío «enviando» a la vez");
await q("update public.newsletter_envios set estado = 'completado', total_destinatarios = 2, exitosos = 2 where id = $1", [envio]);
await comoFuncion("resend-webhook");
await q(`insert into public.email_eventos (email_id, tipo_evento, email_destinatario, metadata, svix_id) values
  ('e1', 'delivered', 'ana@example.com', jsonb_build_object('envio_id', $1::text), 'msg_1'),
  ('e1', 'opened', 'ana@example.com', jsonb_build_object('envio_id', $1::text), 'msg_2'),
  ('e1', 'opened', 'ana@example.com', jsonb_build_object('envio_id', $1::text), 'msg_3'),
  ('e2', 'delivered', 'imp1@example.com', jsonb_build_object('envio_id', $1::text), 'msg_4'),
  ('e2', 'bounced', 'imp1@example.com', jsonb_build_object('envio_id', $1::text), 'msg_5')`, [envio]);
await falla(q("insert into public.email_eventos (email_id, tipo_evento, svix_id) values ('e1', 'clicked', 'msg_1')"), /unique|duplicate/,
  "el mismo evento de Resend (svix-id) no se guarda dos veces");
await comoUsuario(NL_VER);
igual((await q("select tipo_evento, eventos::int, destinatarios::int from public.newsletter_estadisticas_envios($1) order by 1", [[envio]])).rows,
  [{ tipo_evento: "bounced", eventos: 1, destinatarios: 1 }, { tipo_evento: "delivered", eventos: 2, destinatarios: 2 }, { tipo_evento: "opened", eventos: 2, destinatarios: 1 }],
  "estadísticas por envío (destinatarios distintos)");
await comoUsuario(STAFF);
igual((await q("select * from public.newsletter_estadisticas_envios($1)", [[envio]])).rows, [], "sin la sección, nada");

// ─── 12. Purga y tareas ─────────────────────────────────────────────────────
await comoServidor();
await q("update public.newsletter_suscriptores set confirmacion_enviada_at = now() - interval '31 days', consentimiento_at = now() - interval '31 days' where email = 'trampa@example.com'");
igual((await uno("select public.newsletter_purgar() r")).r.pendientes, 1, "la purga borra las altas sin confirmar de más de 30 días");
ok(!(await sus("trampa@example.com")) && !!(await sus("beto@example.com")), "solo esas");
igual((await uno("select public.newsletter_disparar_sync() r")).r, "sin_vault", "sin Vault, la sincronización no llama a nadie");
await q("insert into vault.secrets (name, secret) values ('project_url', 'https://demo.supabase.co'), ('ocr_trabajos_secret', 'secreto')");
igual((await uno("select public.newsletter_disparar_sync() r")).r, "llamada", "con Vault, llama a la función");
await comoUsuario(SA);
await falla(q("select public.newsletter_disparar_sync()"), /permission denied/, "y nadie del panel la lanza a mano");

// ─── 13. Vuelta atrás y nueva aplicación ────────────────────────────────────
await comoServidor();
await q("insert into public.admin_feature_toggles (section_key, label, enabled) values ('newsletter', 'Newsletter', false)");
await q("update public.user_roles set seccion_inicio = 'newsletter' where user_id = $1", [NL_EDITA]);
await q(`insert into public.user_role_presets (name, base_role, permissions) values ('Marketing', 'staff',
  '[{"section_key":"newsletter","can_view":true,"can_edit":true},{"section_key":"dashboard","can_view":true,"can_edit":false}]')`);
await db.exec(adaptar(ROLLBACK));
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows, [], "la vuelta atrás quita todas sus tablas");
igual(await cuenta("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'newsletter%'"), 0,
  "y sus funciones");
igual(await cuenta("select count(*)::int n from cron.job where jobname like 'newsletter%'"), 0, "y sus tareas");
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await uno(`select pg_get_functiondef('public.${fn}'::regproc) d`)).d;
  ok(!def.includes("'newsletter_claves'") && def.includes("'web_eventos'"), `${fn} vuelve a la lista de antes (la de Logs web sigue)`);
}
igual(await cuenta("select count(*)::int n from public.user_permissions where section_key = 'newsletter'"), 0, "ni los permisos de la sección");
igual((await uno("select permissions from public.user_role_presets where name = 'Marketing'")).permissions, [{ section_key: "dashboard", can_view: true, can_edit: false }],
  "ni en los roles preconfigurados");
igual((await uno("select seccion_inicio s from public.user_roles where user_id = $1", [NL_EDITA])).s, null, "ni como sección de inicio");
igual(await cuenta("select count(*)::int n from public.admin_feature_toggles where section_key = 'newsletter'"), 0, "ni su interruptor");
ok(await cuenta("select count(*)::int n from public.web_eventos") >= 0 && await cuenta("select count(*)::int n from public.web_contenido") === 4, "Logs web y la web siguen");
await aplicar(MIGRACION);
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows.length, TABLAS.length, "se vuelve a aplicar");
igual((await alta("nueva@example.com", { ip: "9".repeat(64) })).accion, "pendiente", "y funciona");

console.log(`test-newsletter: ${comprobaciones} comprobaciones correctas.`);
