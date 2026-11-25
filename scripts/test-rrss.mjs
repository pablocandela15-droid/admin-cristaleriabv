// RRSS (supabase/migrations/20261125100000_rrss.sql) y su vuelta atrás, encima del núcleo, la web editable, el IVA de
// los presupuestos, Tráfico web, Logs web y Newsletter, contra un Postgres en memoria (PGlite). Nunca toca Supabase. Va
// dentro de `npm run test:nucleo:db`.
//
// Cubre: se aplica entera y dos veces; RLS en todas sus tablas (barrera de sesión en las que lee el panel); los tokens
// cifrados y los states del OAuth no los lee nadie del panel ni la web (ni el super admin); la auditoría (fuera los
// tokens, los states, el tope de la IA y las métricas, también al reinstalarla); lectura con «Ver» en RRSS y escritura
// con «Editar»; las reglas de las piezas (el panel solo escribe borrador/lista/error y nunca lo que escriben las
// funciones; ficheros solo existentes y solo en piezas editables); el cubo privado (cada uno sube a su carpeta, nadie
// sobrescribe, solo se borran ficheros sin pieza); las fotos de Web › Fotos; la máquina de estados del programador
// (programar, conflictos, mover, cancelar, reclamar con bloqueo, publicada/reintentar/aplazar/error, bloqueos
// caducados sin publicar dos veces); la reserva y el cierre de una publicación (cerrojo, avance, procesando, error,
// Facebook cortado); los problemas de una pieza; el state del OAuth (un solo uso, caduca); campañas (aceptar crea
// borradores en Instagram y Facebook); el tope diario de la IA; las fechas señaladas; «qué funciona»; los avisos de la
// campana; la purga; las tareas programadas; y la vuelta atrás y su reaplicación.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { BASE, adaptar } from "./pglite-supabase.mjs";

const leer = (r) => readFile(r, "utf8");
const NUCLEO = await leer("supabase/migrations/20261118120000_nucleo_panel.sql");
const PREVIAS = await Promise.all([
  "supabase/migrations/20261123100000_web_y_presupuestos.sql",
  "supabase/migrations/20261124100000_presupuestos_iva_incluido.sql",
  "supabase/migrations/20261124110000_trafico_web.sql",
  "supabase/migrations/20261124120000_logs_web.sql",
  "supabase/migrations/20261124173700_newsletter.sql",
].map(leer));
const MIGRACION = await leer("supabase/migrations/20261125100000_rrss.sql");
const ROLLBACK = await leer("supabase/rollbacks/20261125100000_rrss_ROLLBACK.sql");
const sinAuditoria = (sql) => [...sql.matchAll(/^drop trigger if exists trg_auditoria on public\.\w+;$/gm)].map((m) => m[0]).join("\n");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const db = await PGlite.create({ extensions: { pg_trgm, unaccent } });
const q = (sql, params) => db.query(sql, params);
const uno = async (sql, params) => (await q(sql, params)).rows[0];
const cuenta = async (sql, params) => (await uno(sql, params)).n;

const SA = "11111111-1111-4111-8111-111111111111";
const VER = "22222222-2222-4222-8222-222222222222";
const EDITA = "33333333-3333-4333-8333-333333333333";
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
const comoFuncion = async (origen = "rrss-publicar") => {
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

// ─── 1. Se aplica entera (y dos veces) ──────────────────────────────────────
await db.exec(BASE);
await db.exec("grant select, insert, update, delete on storage.objects to anon, authenticated");
await db.exec(adaptar(NUCLEO));
for (const m of PREVIAS) await aplicar(m);
await aplicar(MIGRACION);
await aplicar(MIGRACION);

const TABLAS = ["rrss_ajustes", "rrss_meta_cuenta", "rrss_meta_tokens", "rrss_oauth_estados", "rrss_campanas", "rrss_piezas", "rrss_medios",
  "rrss_programaciones", "rrss_ia_peticiones", "rrss_fechas", "rrss_metricas_cuenta", "rrss_metricas_publicacion", "rrss_metricas_capturas"];
const SECRETAS = ["rrss_meta_tokens", "rrss_oauth_estados"];
const TABLAS_PANEL = TABLAS.filter((t) => !SECRETAS.includes(t));
const tablas = (await q("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
for (const t of TABLAS) ok(tablas.includes(t), `falta la tabla ${t}`);
igual((await q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) and not relrowsecurity",
  [TABLAS])).rows, [], "todas con RLS");
igual(await cuenta("select count(*)::int n from pg_policies where policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE' and tablename = any($1)",
  [TABLAS_PANEL]), TABLAS_PANEL.length, "las que lee el panel, con la barrera de sesión");
igual(await cuenta("select count(*)::int n from pg_policies where tablename = any($1)", [SECRETAS]), 0, "tokens y states, sin ninguna política");
igual((await uno("select id, public, file_size_limit from storage.buckets where id = 'rrss'")), { id: "rrss", public: false, file_size_limit: 52428800 },
  "cubo privado de 50 MB");
igual((await q("select jobname, schedule from cron.job where jobname like 'rrss%' order by 1")).rows, [
  { jobname: "rrss-mantenimiento", schedule: "50 3 * * *" }, { jobname: "rrss-metricas", schedule: "10 5 * * *" },
  { jobname: "rrss-programador", schedule: "*/5 * * * *" }], "tareas programadas");
ok((await uno("select command from cron.job where jobname = 'rrss-programador'")).command.includes("rrss_hay_trabajo()"), "el programador solo llama si hay trabajo");
igual((await uno("select funcion, activo from public.ia_funciones where funcion = 'rrss-ia'")), { funcion: "rrss-ia", activo: true }, "IA registrada");
const ajustes = await uno("select zona, tono, hashtags_base, facebook_por_defecto, version, guia from public.rrss_ajustes");
igual([ajustes.zona, ajustes.tono, ajustes.facebook_por_defecto, ajustes.version], ["Elche y el Baix Vinalopó", "cercano", false, 1], "ajustes de partida");
ok(ajustes.hashtags_base.includes("#elche") && /Cristalería/.test(ajustes.guia), "guía y hashtags de cristalería");
ok(!/restaurante|carta|tapas|plato|vino|reserva/i.test(ajustes.guia), "sin nada de restaurante en la guía");
igual((await uno("select estado, origen from public.rrss_meta_cuenta")), { estado: "sin_conectar", origen: null }, "sin conectar");
igual(await cuenta("select count(*)::int n from public.rrss_fechas"), 12, "fechas señaladas sembradas");
ok(!(await q("select titulo || ' ' || coalesce(idea, '') t from public.rrss_fechas")).rows.some((r) => /restaurante|tapas|menú|\bvinos?\b|carta de/i.test(r.t)),
  "fechas de cristalería, nada de restaurante");

// ─── 2. Auditoría ───────────────────────────────────────────────────────────
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await uno(`select pg_get_functiondef('public.${fn}'::regproc) d`)).d;
  igual(def.split("'rrss_meta_tokens'").length - 1, 1, `${fn} excluye rrss_meta_tokens una sola vez (aunque se aplique dos veces)`);
  ok(def.includes("'email_eventos'") && def.includes("'web_eventos'"), `${fn} conserva las listas de Logs web y Newsletter`);
}
await q("select public.instalar_auditoria_panel()");
for (const t of ["rrss_meta_tokens", "rrss_oauth_estados", "rrss_ia_peticiones", "rrss_metricas_cuenta", "rrss_metricas_publicacion", "rrss_metricas_capturas"]) {
  igual(await auditada(t), false, `${t} sin auditoría, también tras reinstalarla`);
}
for (const t of ["rrss_ajustes", "rrss_meta_cuenta", "rrss_piezas", "rrss_medios", "rrss_programaciones", "rrss_campanas", "rrss_fechas"]) ok(await auditada(t), `${t} auditada`);

// ─── 3. Usuarios ────────────────────────────────────────────────────────────
const usuarios = [[SA, "sa@example.com"], [VER, "ver@example.com"], [EDITA, "edita@example.com"], [STAFF, "staff@example.com"]];
await db.exec(`
  insert into auth.users (id, email) values ${usuarios.map(([id, e]) => `('${id}', '${e}')`).join(", ")};
  insert into auth.sessions (id, user_id) values ${usuarios.map(([id]) => `('${sesion(id)}', '${id}')`).join(", ")};
  insert into public.super_admins (user_id, email) values ('${SA}', 'sa@example.com');
  insert into public.user_roles (user_id, role) values ${usuarios.slice(1).map(([id]) => `('${id}', 'staff')`).join(", ")};
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${VER}', 'rrss', true, false), ('${EDITA}', 'rrss', true, true), ('${STAFF}', 'dashboard', true, false);
`);

// ─── 4. Tokens: solo las funciones ──────────────────────────────────────────
await comoFuncion("rrss-oauth");
await q("update public.rrss_meta_tokens set token_pagina = 'v1.aaaa.bbbb', token_usuario = 'v1.cccc.dddd' where id = 1");
await q(`update public.rrss_meta_cuenta set estado = 'conectada', origen = 'conexion', ig_user_id = '17841400000000000', ig_usuario = 'cristaleria_demo',
         fb_pagina_id = '100000000000001', fb_pagina_nombre = 'Cristalería demo', permisos = '{instagram_basic,instagram_content_publish}' where id = 1`);
await falla(q("update public.rrss_meta_tokens set token_pagina = 'EAAB-en-claro' where id = 1"), /check constraint/, "un token sin cifrar no se guarda");
for (const [quien, como] of [["la web (anon)", comoWeb], ["quien edita RRSS", () => comoUsuario(EDITA)], ["el super admin", () => comoUsuario(SA)]]) {
  await como();
  for (const t of SECRETAS) await falla(q(`select * from public.${t}`), /permission denied/, `${quien} no lee ${t}`);
  await falla(q("update public.rrss_meta_tokens set token_pagina = null"), /permission denied/, `${quien} no cambia los tokens`);
}
await comoUsuario(EDITA);
await falla(q("update public.rrss_meta_cuenta set estado = 'sin_conectar'"), /permission denied/, "la conexión solo la cambian las funciones");
igual((await uno("select estado, ig_usuario from public.rrss_meta_cuenta")), { estado: "conectada", ig_usuario: "cristaleria_demo" }, "pero el panel la ve (sin tokens)");
ok(!Object.keys(await uno("select * from public.rrss_meta_cuenta")).some((c) => /token/.test(c) && !/caduca/.test(c)), "y no tiene ninguna columna de token");
await falla(q("select public.rrss_oauth_usar_estado($1)", ["0".repeat(64)]), /permission denied/, "el state solo lo gasta rrss-oauth");

// ─── 5. State del OAuth: un solo uso y caduca ───────────────────────────────
const state = createHash("sha256").update("state-de-prueba").digest("hex");
await comoFuncion("rrss-conexion");
await q("insert into public.rrss_oauth_estados (hash, usuario_id, volver_a) values ($1, $2, 'https://admin-cristaleriabv.vercel.app')", [state, EDITA]);
await falla(q("insert into public.rrss_oauth_estados (hash, usuario_id, volver_a) values ($1, $2, 'javascript:alert(1)')", ["a".repeat(64), EDITA]),
  /check constraint/, "volver_a solo es un origen http(s)");
await comoFuncion("rrss-oauth");
igual((await q("select * from public.rrss_oauth_usar_estado($1)", [state])).rows, [{ usuario_id: EDITA, volver_a: "https://admin-cristaleriabv.vercel.app" }],
  "el state válido dice quién lo pidió y adónde volver");
igual((await q("select * from public.rrss_oauth_usar_estado($1)", [state])).rows, [], "solo una vez");
const caducado = createHash("sha256").update("otro").digest("hex");
await q("insert into public.rrss_oauth_estados (hash, usuario_id, volver_a, caduca_en) values ($1, $2, 'http://localhost:8080', now() - interval '1 second')", [caducado, EDITA]);
igual((await q("select * from public.rrss_oauth_usar_estado($1)", [caducado])).rows, [], "caducado no vale");

// ─── 6. Lectura y escritura del panel ───────────────────────────────────────
await comoWeb();
for (const t of ["rrss_piezas", "rrss_ajustes", "rrss_meta_cuenta", "rrss_programaciones", "rrss_metricas_cuenta"]) {
  await falla(q(`select * from public.${t}`), /permission denied/, `la web no lee ${t}`);
}
await falla(q("select * from public.rrss_fotos_web()"), /permission denied/, "ni las fotos de la web por RRSS");
await comoUsuario(STAFF);
igual(await cuenta("select count(*)::int n from public.rrss_ajustes"), 0, "sin la sección no ve los ajustes");
await falla(q("select * from public.rrss_fotos_web()"), /Ver.*RRSS/, "ni las fotos");
await comoUsuario(VER);
igual(await cuenta("select count(*)::int n from public.rrss_ajustes"), 1, "con «Ver», sí");
await falla(q("insert into public.rrss_piezas (red, formato) values ('instagram', 'foto')"), /row-level security|permission denied/, "con solo «Ver» no crea");
await q("update public.rrss_ajustes set tono = 'tecnico'");
igual((await uno("select tono from public.rrss_ajustes")).tono, "cercano", "ni cambia el estilo (la RLS no deja)");
await comoUsuario(EDITA);
await q("update public.rrss_ajustes set tono = 'profesional', hashtags_base = '{#cristaleria,#elche,#mamparas}'");
const aj = await uno("select tono, version, actualizado_por from public.rrss_ajustes");
igual([aj.tono, aj.version, aj.actualizado_por], ["profesional", 2, EDITA], "«Editar» cambia el estilo; sube la versión y anota quién");
await falla(q("update public.rrss_ajustes set hashtags_base = '{sin almohadilla}'"), /check constraint/, "hashtags con su #");
await falla(q("update public.rrss_ajustes set version = 99"), /permission denied/, "la versión no se toca a mano");

// Fotos de Web › Fotos (también sin «Ver» en Web › Fotos).
await comoServidor();
const album = (await uno("insert into public.web_albumes (slug, titulo, servicio, publicado) values ('trabajos-mamparas', 'Mamparas', 'mamparas', true) returning id")).id;
await q(`insert into public.web_fotos (album_id, ruta, alt, ancho, alto, orden, publicado) values
  ($1, 'albumes/${album}/a.webp', 'Mampara de ducha fija en Elche', 1600, 1200, 0, true),
  ($1, 'albumes/${album}/b.webp', 'Mampara corredera', 1200, 1600, 1, false)`, [album]);
await comoUsuario(VER);
const fotosWeb = (await q("select ruta, servicio, visible_en_web from public.rrss_fotos_web()")).rows;
igual(fotosWeb.map((f) => [f.servicio, f.visible_en_web]), [["mamparas", true], ["mamparas", false]], "RRSS ve las fotos por tipo de trabajo, también las ocultas en la web");

// ─── 7. Cubo «rrss» ─────────────────────────────────────────────────────────
const ruta = (uid, ext = "jpg") => `subidas/${uid}/${randomUUID()}.${ext}`;
const subir = async (uid, r) => {
  await comoUsuario(uid);
  await q("insert into storage.objects (bucket_id, name, owner) values ('rrss', $1, $2)", [r, uid]);
  return r;
};
const f1 = await subir(EDITA, ruta(EDITA));
const f2 = await subir(EDITA, ruta(EDITA));
const f3 = await subir(EDITA, ruta(EDITA));
const v1 = await subir(EDITA, ruta(EDITA, "mp4"));
await falla(subir(EDITA, ruta(SA)), /row-level security/, "cada uno sube solo a su carpeta");
await falla(subir(EDITA, `subidas/${EDITA}/../x.jpg`), /row-level security/, "y con un nombre válido");
await falla(subir(EDITA, ruta(EDITA, "png")), /row-level security/, "solo JPEG y vídeo");
await falla(subir(VER, ruta(VER)), /row-level security/, "con solo «Ver» no se sube");
await comoUsuario(VER);
igual(await cuenta("select count(*)::int n from storage.objects where bucket_id = 'rrss'"), 4, "con «Ver» se ven (para la vista previa)");
await comoUsuario(STAFF);
igual(await cuenta("select count(*)::int n from storage.objects where bucket_id = 'rrss'"), 0, "sin la sección, no");
await comoUsuario(EDITA);
await q("update storage.objects set name = name || '.x' where bucket_id = 'rrss'");
igual(await cuenta("select count(*)::int n from storage.objects where bucket_id = 'rrss' and name like '%.x'"), 0, "nada se sobrescribe ni se renombra");

// ─── 8. Piezas: reglas del panel ────────────────────────────────────────────
await comoUsuario(EDITA);
const crear = async (datos = {}) => {
  const d = { red: "instagram", formato: "foto", proporcion: "4:5", caption: "Mampara a medida en Elche #mamparas", estado: "borrador", ...datos };
  return (await uno(`insert into public.rrss_piezas (grupo_id, red, formato, proporcion, caption, servicio, estado)
                     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, 'mamparas', $6) returning *`,
    [d.grupo_id ?? null, d.red, d.formato, d.proporcion, d.caption, d.estado])).id;
};
const p1 = await crear();
const fila = await uno("select * from public.rrss_piezas where id = $1", [p1]);
igual([fila.estado, fila.origen, fila.creado_por, fila.media_id], ["borrador", "panel", EDITA, null], "nace en borrador, del panel y con su autor");
await falla(crear({ estado: "publicada" }), /borrador o lista/, "el panel no crea piezas publicadas");
await falla(crear({ red: "facebook", formato: "story", proporcion: "9:16" }), /check constraint/, "Facebook no tiene historias por la API");
await falla(q("update public.rrss_piezas set media_id = '123' where id = $1", [p1]), /permission denied/, "el panel no escribe lo de Meta");
await falla(q("update public.rrss_piezas set estado = 'publicando' where id = $1", [p1]), /borrador o lista/, "ni el estado de publicación");
await falla(q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta) values ($1, 0, 'imagen', $2)", [p1, `subidas/${EDITA}/${randomUUID()}.jpg`]),
  /no está subido/, "solo ficheros que existen en el cubo");
await falla(q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta) values ($1, 0, 'video', $2)", [p1, f1]), /check constraint/, "tipo y fichero cuadran");
await q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta, alt_text) values ($1, 0, 'imagen', $2, 'Mampara de ducha')", [p1, f1]);
igual((await uno("select public.rrss_pieza_problemas($1) p", [p1])).p, [], "una foto con su imagen: nada que corregir");
const p2 = await crear({ formato: "carrusel" });
await q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta) values ($1, 0, 'imagen', $2)", [p2, f2]);
igual((await uno("select public.rrss_pieza_problemas($1) p", [p2])).p, ["Un carrusel lleva de 2 a 10 fotos o vídeos"], "un carrusel de una sola foto no vale");
await q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta) values ($1, 1, 'video', $2)", [p2, v1]);
igual((await uno("select public.rrss_pieza_problemas($1) p", [p2])).p, [], "con foto y vídeo, sí");
await q("update public.rrss_piezas set caption = $2 where id = $1", [p1, "Mampara " + Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ")]);
igual((await uno("select public.rrss_pieza_problemas($1) p", [p1])).p, ["Instagram admite como mucho 30 hashtags"], "más de 30 hashtags en Instagram no");
await q("update public.rrss_piezas set caption = 'Mampara a medida en Elche #mamparas #elche', estado = 'lista' where id = $1", [p1]);
await comoUsuario(STAFF);
await falla(q("delete from public.rrss_medios where pieza_id = $1", [p1]).then((r) => { if (r.affectedRows) throw new Error("borró"); return Promise.reject(new Error("permission denied")); }), /permission denied/,
  "sin la sección no toca los ficheros");
await comoUsuario(EDITA);
await q("delete from storage.objects where bucket_id = 'rrss' and name = $1", [f1]);
igual(await cuenta("select count(*)::int n from storage.objects where name = $1", [f1]), 1, "un fichero que usa una pieza no se borra");
await q("delete from storage.objects where bucket_id = 'rrss' and name = $1", [f3]);
igual(await cuenta("select count(*)::int n from storage.objects where name = $1", [f3]), 0, "uno suelto, sí");

// ─── 9. Programación ────────────────────────────────────────────────────────
await comoUsuario(VER);
await falla(q("select public.rrss_programar($1, now() + interval '1 day')", [p1]), /Editar/, "programar exige «Editar»");
await comoUsuario(EDITA);
await falla(q("insert into public.rrss_programaciones (pieza_id, red, programada_para, siguiente_intento_at) values ($1, 'instagram', now(), now())", [p1]),
  /permission denied/, "las programaciones solo por las RPC");
await falla(q("select public.rrss_programar($1, now() + interval '5 minutes')", [p1]), /10 minutos/, "con 10 minutos de margen");
await falla(q("select public.rrss_programar($1, now() + interval '80 days')", [p1]), /75 días/, "y a 75 días como mucho");
const pVacia = await crear({ formato: "reel", proporcion: "9:16" });
await falla(q("select public.rrss_programar($1, now() + interval '1 day')", [pVacia]), /exactamente un vídeo/, "una pieza incompleta no se programa");
const prog1 = (await uno("select public.rrss_programar($1, now() + interval '1 day') r", [p1])).r;
igual([prog1.ok, prog1.accion, prog1.programacion.estado], [true, "programada", "programada"], "programada");
const conflicto = (await uno("select public.rrss_programar($1, now() + interval '1 day 10 minutes') r", [p2])).r;
igual([conflicto.ok, conflicto.requiereConfirmacion, conflicto.conflictos.length], [false, true, 1], "otra en la misma red a ±30 min pide confirmación");
igual(await cuenta("select count(*)::int n from public.rrss_programaciones where pieza_id = $1", [p2]), 0, "sin cambiar nada");
const prog2 = (await uno("select public.rrss_programar($1, now() + interval '1 day 10 minutes', true) r", [p2])).r;
igual(prog2.ok, true, "confirmándolo, se programa");
igual((await uno("select estado from public.rrss_piezas where id = $1", [p2])).estado, "lista", "programar deja la pieza «lista»");
const mov = (await uno("select public.rrss_programar($1, now() + interval '2 days', true) r", [p1])).r;
igual([mov.accion, mov.programacion.id], ["reprogramada", prog1.programacion.id], "programar otra vez la misma la mueve");
await comoFuncion("rrss-publicar");
igual((await uno("select public.rrss_pieza_reservar($1) r", [p1])).r, { ok: false, motivo: "programada" }, "publicar a mano una programada: hay que cancelarla antes");
await comoUsuario(EDITA);
const canc = (await uno("select public.rrss_cancelar_programacion($1) r", [prog2.programacion.id])).r;
igual(canc.programacion.estado, "cancelada", "cancelar");
await falla(q("select public.rrss_cancelar_programacion($1)", [prog2.programacion.id]), /ninguna programación pendiente/, "no se cancela dos veces");

// El programador: reclama con bloqueo y cierra.
await comoServidor();
await q("update public.rrss_programaciones set programada_para = now() - interval '1 minute', siguiente_intento_at = now() - interval '1 minute' where id = $1", [prog1.programacion.id]);
igual((await uno("select public.rrss_hay_trabajo() r")).r, true, "hay trabajo vencido");
await comoUsuario(SA);
await falla(q("select * from public.rrss_programador_reclamar(600)"), /permission denied/, "el programador solo con service role");
await comoFuncion("rrss-programador");
let rec = await uno("select * from public.rrss_programador_reclamar(600)");
igual([rec.id, rec.estado], [prog1.programacion.id, "publicando"], "reclama la vencida y la bloquea");
igual((await q("select * from public.rrss_programador_reclamar(600)")).rows, [], "otra pasada no la coge");
await comoUsuario(EDITA);
await falla(q("select public.rrss_cancelar_programacion($1)", [rec.id]), /publicando/, "publicándose ya no se cancela");
await falla(q("update public.rrss_piezas set caption = 'otro' where id = $1", [p1]), /publicando/, "ni se cambia la pieza");
await comoFuncion("rrss-programador");
await falla(q("select public.rrss_programador_cerrar($1, $2, 'publicada', null, '1')", [rec.id, randomUUID()]), /ya no está bloqueada/, "cerrar exige su bloqueo");
let cerr = await uno("select * from public.rrss_programador_cerrar($1, $2, 'reintentar', 'Meta caído', null, null, 300)", [rec.id, rec.bloqueo_id]);
igual([cerr.estado, cerr.intentos, cerr.ultimo_error], ["programada", 1, "Meta caído"], "reintentar cuenta un intento y vuelve a la cola");
ok(new Date(cerr.siguiente_intento_at) > new Date(Date.now() + 4 * 60_000), "dentro de 5 minutos");
await comoServidor();
await q("update public.rrss_programaciones set siguiente_intento_at = now() - interval '1 second' where id = $1", [rec.id]);
await comoFuncion("rrss-programador");
rec = await uno("select * from public.rrss_programador_reclamar(600)");
cerr = await uno("select * from public.rrss_programador_cerrar($1, $2, 'aplazar', 'Cuota agotada', null, null, 300)", [rec.id, rec.bloqueo_id]);
igual([cerr.estado, cerr.intentos], ["programada", 1], "aplazar (cuota) no cuenta intento");
await comoServidor();
await q("update public.rrss_programaciones set siguiente_intento_at = now() - interval '1 second' where id = $1", [rec.id]);
await comoFuncion("rrss-programador");
rec = await uno("select * from public.rrss_programador_reclamar(600)");
cerr = await uno("select * from public.rrss_programador_cerrar($1, $2, 'reintentar', 'otra vez')", [rec.id, rec.bloqueo_id]);
await comoServidor();
await q("update public.rrss_programaciones set siguiente_intento_at = now() - interval '1 second' where id = $1", [rec.id]);
await comoFuncion("rrss-programador");
rec = await uno("select * from public.rrss_programador_reclamar(600)");
cerr = await uno("select * from public.rrss_programador_cerrar($1, $2, 'reintentar', 'y otra')", [rec.id, rec.bloqueo_id]);
igual([cerr.estado, cerr.intentos], ["error", 3], "al tercer intento, error");
await comoUsuario(EDITA);
const reprog = (await uno("select public.rrss_reprogramar($1, now() + interval '1 hour', true) r", [rec.id])).r;
igual([reprog.ok, reprog.programacion.estado, reprog.programacion.intentos, reprog.programacion.ultimo_error], [true, "programada", 0, null],
  "una con error se vuelve a programar desde cero");

// Publicación con la reserva de la pieza (lo que hace el núcleo de rrss-publicar y del programador).
await comoServidor();
await q("update public.rrss_programaciones set siguiente_intento_at = now() - interval '1 second' where id = $1", [rec.id]);
await comoFuncion("rrss-programador");
rec = await uno("select * from public.rrss_programador_reclamar(600)");
const res = (await uno("select public.rrss_pieza_reservar($1, 180, true) r", [p1])).r;
igual([res.ok, res.pieza.estado], [true, "publicando"], "el programador reserva la pieza");
igual((await uno("select public.rrss_pieza_reservar($1, 180, true) r", [p1])).r.motivo, "en_curso", "una segunda reserva a la vez: en curso");
igual((await uno("select public.rrss_pieza_progreso($1, $2, '17900000000000001') r", [p1, randomUUID()])).r, false, "el avance exige la reserva");
igual((await uno("select public.rrss_pieza_progreso($1, $2, '17900000000000001') r", [p1, res.reserva])).r, true, "guarda el contenedor");
await uno("select public.rrss_pieza_progreso($1, $2, null, null, '17900000000000099') r", [p1, res.reserva]);
// La pasada se corta aquí: la reserva y el bloqueo caducan con el media_id ya guardado.
await comoServidor();
await q("update public.rrss_piezas set reservada_hasta = now() - interval '1 second' where id = $1", [p1]);
await q("update public.rrss_programaciones set bloqueada_hasta = now() - interval '1 second' where id = $1", [rec.id]);
await comoFuncion("rrss-programador");
igual((await q("select * from public.rrss_programador_reclamar(600)")).rows, [], "no hay otra vencida");
const tras = await uno("select estado, media_id, ultimo_error from public.rrss_programaciones where id = $1", [rec.id]);
igual([tras.estado, tras.media_id, tras.ultimo_error], ["publicada", "17900000000000099", null], "bloqueo caducado con media_id: publicada sin repetir");
igual((await uno("select public.rrss_pieza_reservar($1) r", [p1])).r.motivo, "publicada", "y la pieza no se vuelve a publicar");
igual((await uno("select estado, reserva_id from public.rrss_piezas where id = $1", [p1])), { estado: "publicada", reserva_id: null },
  "la pieza que se quedó «publicando» con su media_id pasa a publicada");

// Bloqueo caducado sin publicación confirmada: Instagram con contenedor vuelve a la cola (se comprueba antes); sin
// contenedor, error para que alguien lo mire.
await comoUsuario(EDITA);
const p3 = await crear({ estado: "lista" });
const f4 = await subir(EDITA, ruta(EDITA));
await comoUsuario(EDITA);
await q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta) values ($1, 0, 'imagen', $2)", [p3, f4]);
const prog3 = (await uno("select public.rrss_programar($1, now() + interval '3 days', true) r", [p3])).r.programacion;
await comoServidor();
await q("update public.rrss_programaciones set siguiente_intento_at = now() - interval '1 second' where id = $1", [prog3.id]);
await comoFuncion("rrss-programador");
let r3 = await uno("select * from public.rrss_programador_reclamar(600)");
const res3 = (await uno("select public.rrss_pieza_reservar($1, 180, true) r", [p3])).r;
await uno("select public.rrss_pieza_progreso($1, $2, '17900000000000003')", [p3, res3.reserva]);
await comoServidor();
await q("update public.rrss_programaciones set bloqueada_hasta = now() - interval '1 second' where id = $1", [r3.id]);
await comoFuncion("rrss-programador");
r3 = await uno("select * from public.rrss_programador_reclamar(600)");
igual([r3?.id, r3?.estado, r3?.intentos], [prog3.id, "publicando", 1], "Instagram con su contenedor guardado vuelve a la cola (y se retoma)");
const res3b = (await uno("select public.rrss_pieza_reservar($1, 180, true) r", [p3])).r;
igual(res3b.ok, false, "su reserva anterior aún no ha caducado");
await comoServidor();
await q("update public.rrss_piezas set reservada_hasta = now() - interval '1 second' where id = $1", [p3]);
await comoFuncion("rrss-programador");
const res3c = (await uno("select public.rrss_pieza_reservar($1, 180, true) r", [p3])).r;
igual([res3c.ok, res3c.pieza.contenedor_id], [true, "17900000000000003"], "al caducar se retoma con el MISMO contenedor (nunca otro a ciegas)");
const procesando = await uno("select * from public.rrss_pieza_cerrar($1, $2, 'procesando')", [p3, res3c.reserva]);
igual([procesando.estado, procesando.reserva_id], ["procesando", null], "Meta aún procesa: queda «procesando» y suelta la reserva");
ok(procesando.procesando_desde !== null, "con la hora a la que empezó");
cerr = await uno("select * from public.rrss_programador_cerrar($1, $2, 'aplazar', 'Meta aún procesa', null, null, 60)", [r3.id, r3.bloqueo_id]);
igual(cerr.estado, "programada", "la programación se aplaza sin contar intento");
igual((await uno("select public.rrss_hay_trabajo() r")).r, true, "y el programador vuelve a pasar (hay una pieza procesando)");
const res3d = (await uno("select public.rrss_pieza_reservar($1) r", [p3])).r;
igual(res3d.motivo, "programada", "el repaso de «procesando» no toca la que tiene programación (la retoma el programador)");

// Facebook: una publicación cortada no se repite.
await comoUsuario(EDITA);
const pf = await crear({ red: "facebook", estado: "lista" });
const f5 = await subir(EDITA, ruta(EDITA));
await comoUsuario(EDITA);
await q("insert into public.rrss_medios (pieza_id, orden, tipo, ruta) values ($1, 0, 'imagen', $2)", [pf, f5]);
await comoFuncion("rrss-publicar");
const rf = (await uno("select public.rrss_pieza_reservar($1) r", [pf])).r;
igual(rf.ok, true, "publicar ahora en Facebook reserva la pieza");
await comoServidor();
await q("update public.rrss_piezas set reservada_hasta = now() - interval '1 second' where id = $1", [pf]);
await comoFuncion("rrss-publicar");
igual((await uno("select public.rrss_pieza_reservar($1) r", [pf])).r.motivo, "cortada", "si se corta a mitad, no se repite a ciegas");
const pfFila = await uno("select estado, error_tipo, como_arreglarlo from public.rrss_piezas where id = $1", [pf]);
igual([pfFila.estado, pfFila.error_tipo], ["error", "cortada"], "queda en error");
ok(/Mira en la página de Facebook/.test(pfFila.como_arreglarlo), "pidiendo comprobarlo en la página");
await comoUsuario(EDITA);
await q("update public.rrss_piezas set estado = 'lista' where id = $1", [pf]);
igual((await uno("select estado, error from public.rrss_piezas where id = $1", [pf])), { estado: "lista", error: null }, "corregida desde el panel, se puede volver a intentar");
await comoFuncion("rrss-publicar");
const rf2 = (await uno("select public.rrss_pieza_reservar($1) r", [pf])).r;
const errorFila = await uno("select * from public.rrss_pieza_cerrar($1, $2, 'error', $3::jsonb)", [pf, rf2.reserva,
  JSON.stringify({ error: "Al token le faltan permisos", tipo: "permisos", comoArreglarlo: "Vuelve a conectar marcando pages_manage_posts." })]);
igual([errorFila.estado, errorFila.error_tipo, errorFila.reserva_id], ["error", "permisos", null], "un error queda guardado, explicado y sin reserva");
const rf3 = (await uno("select public.rrss_pieza_reservar($1) r", [pf])).r;
const pub = await uno("select * from public.rrss_pieza_cerrar($1, $2, 'publicada', $3::jsonb)", [pf, rf3.reserva,
  JSON.stringify({ mediaId: "100000000000001_200000000000002", permalink: "https://www.facebook.com/100000000000001/posts/200000000000002" })]);
igual([pub.estado, pub.media_id, pub.error], ["publicada", "100000000000001_200000000000002", null], "publicada en Facebook");
ok(pub.publicada_at !== null, "con su hora");
await comoUsuario(EDITA);
await falla(q("delete from public.rrss_piezas where id = $1", [pf]), /no se borra/, "una publicada no se borra desde el panel");
await falla(q("update public.rrss_piezas set caption = 'x' where id = $1", [pf]), /ya está publicada/, "ni se cambia");
await falla(q("delete from public.rrss_medios where pieza_id = $1", [pf]), /no se cambian/, "ni sus ficheros");
await q("delete from public.rrss_piezas where id = $1", [pVacia]);
igual(await cuenta("select count(*)::int n from public.rrss_piezas where id = $1", [pVacia]), 0, "un borrador sí se borra");

// ─── 10. Campañas ───────────────────────────────────────────────────────────
await comoUsuario(EDITA);
const camp = (await uno(`insert into public.rrss_campanas (titulo, objetivo, desde, hasta, propuesta) values
  ('Primavera de baños', 'Mamparas a medida', current_date + 1, current_date + 21, $1::jsonb) returning id, estado, creado_por`,
  [JSON.stringify({ piezas: [
    { fecha: "2026-12-02", formato: "foto", servicio: "mamparas", titulo: "Antes y después", caption: "De bañera a ducha.", hashtags: ["#mamparas", "#elche"], idea: "Foto del baño terminado", porQue: "Primavera" },
    { fecha: "2026-12-05", formato: "reel", servicio: "mamparas", titulo: "Montaje", caption: "Así montamos una mampara.", hashtags: [], idea: "Vídeo del montaje" },
    { fecha: "2026-12-09", formato: "story", servicio: "espejos", titulo: "Encuesta", caption: "¿Espejo con luz?", hashtags: [] },
  ] })]));
igual([camp.estado, camp.creado_por], ["propuesta", EDITA], "la IA guarda la campaña como propuesta");
await comoUsuario(VER);
await falla(q("select public.rrss_aceptar_campana($1)", [camp.id]), /Editar/, "aceptar exige «Editar»");
await comoUsuario(EDITA);
const acep = (await uno("select public.rrss_aceptar_campana($1, array[0, 2], true) r", [camp.id])).r;
igual(acep.piezas.length, 3, "aceptar dos piezas con Facebook: la foto en las dos redes y la historia solo en Instagram");
const borradores = (await q("select red, formato, estado, origen, fecha_prevista::text f, caption from public.rrss_piezas where campana_id = $1 order by red, formato", [camp.id])).rows;
igual(borradores.map((b) => [b.red, b.formato, b.estado, b.origen, b.f]), [
  ["facebook", "foto", "borrador", "campana", "2026-12-02"], ["instagram", "foto", "borrador", "campana", "2026-12-02"],
  ["instagram", "story", "borrador", "campana", "2026-12-09"]], "borradores con su fecha prevista; nada programado");
ok(borradores[1].caption.includes("#mamparas #elche"), "con el texto y los hashtags");
igual(await cuenta("select count(*)::int n from public.rrss_programaciones p join public.rrss_piezas z on z.id = p.pieza_id where z.campana_id = $1", [camp.id]), 0,
  "ninguna programación");
await falla(q("select public.rrss_aceptar_campana($1)", [camp.id]), /ya está aceptada/, "no se acepta dos veces");
await falla(q("update public.rrss_campanas set estado = 'aceptada'"), /permission denied/, "el estado de la campaña solo por RPC");

// ─── 11. IA: tope diario ────────────────────────────────────────────────────
await comoUsuario(VER);
await falla(q("insert into public.rrss_ia_peticiones (accion, modelo) values ('textos', 'x')"), /row-level security/, "con solo «Ver» no usa la IA");
await comoUsuario(EDITA);
const pid = (await uno("insert into public.rrss_ia_peticiones (accion, modelo) values ('textos', 'gpt-4.1-mini') returning id, creado_por")).id;
await q("update public.rrss_ia_peticiones set ok = true where id = $1", [pid]);
await comoServidor();
await q("insert into public.rrss_ia_peticiones (creado_por, accion) select $1, 'textos' from generate_series(1, 79)", [EDITA]);
await comoUsuario(EDITA);
await falla(q("insert into public.rrss_ia_peticiones (accion) values ('ideas')"), /rrss_cupo_ia/, "80 peticiones por usuario y día");
await comoUsuario(SA);
await q("insert into public.rrss_ia_peticiones (accion) values ('campana')");
igual(await cuenta("select count(*)::int n from public.rrss_ia_peticiones where creado_por = $1", [SA]), 1, "el tope es de cada uno");

// ─── 12. Fechas señaladas y «qué funciona» ──────────────────────────────────
await comoUsuario(VER);
const agosto = (await q("select clave from public.rrss_fechas_entre('2027-08-10', '2027-08-16') order by 1")).rows.map((r) => r.clave);
ok(agosto.includes("misteri-elx") && agosto.includes("verano-terrazas"), "las fiestas de agosto de Elche y el verano caen en agosto");
const enero = (await q("select clave, desde::text d, hasta::text h from public.rrss_fechas_entre('2027-01-10', '2027-01-12')")).rows;
ok(enero.some((f) => f.clave === "invierno-aislamiento" && f.d === "2026-11-15" && f.h === "2027-02-15"), "las que cruzan el año, también");
await comoServidor();
const pubs = [];
for (let i = 0; i < 8; i++) {
  pubs.push(`('1790000000000${i}', 'instagram', '17841400000000000', current_date, now() - interval '${i + 1} days', '${i < 4 ? "REELS" : "FEED"}',
    ${i < 4 ? 1000 : 1000}, ${i < 4 ? 120 : 30}, '{#mamparas}', 'Gancho ${i}')`);
}
await q(`insert into public.rrss_metricas_publicacion (media_id, red, cuenta_id, fecha_captura, publicado_at, producto, alcance, interacciones, hashtags, caption)
         values ${pubs.join(", ")}`);
await comoUsuario(STAFF);
await falla(q("select public.rrss_que_funciona()"), /Ver.*RRSS/, "«qué funciona» exige «Ver»");
await comoUsuario(VER);
const qf = (await uno("select public.rrss_que_funciona(90, 3) r")).r;
igual([qf.publicaciones, qf.suficiente, qf.tasa_media], [8, true, 7.5], "ocho publicaciones: ya hay conclusiones");
const formato = qf.conclusiones.find((c) => c.eje === "formato");
igual([formato.estado, formato.clave], ["mejor", "reel"], "los reels funcionan mejor");
ok(/Los reels funcionan mejor: 12 % de interacción en 4 publicaciones, frente al 7,5 % de media\./.test(formato.texto), "con una frase en llano y datos reales");
igual(qf.mejores.length, 5, "las cinco mejores");
await comoServidor();
await q("delete from public.rrss_metricas_publicacion");
await comoUsuario(VER);
const qf0 = (await uno("select public.rrss_que_funciona() r")).r;
igual([qf0.suficiente, qf0.mejores], [false, []], "sin datos, sin conclusiones");
ok(/Todavía no hay publicaciones/.test(qf0.aviso), "y lo dice");
await comoUsuario(EDITA);
await falla(q("insert into public.rrss_metricas_cuenta (fecha, cuenta_id) values (current_date, '1')"), /permission denied/, "las métricas solo las escribe la función");

// ─── 13. Avisos de la campana ───────────────────────────────────────────────
await comoServidor();
igual((await uno("select public.seccion_aviso('rrss_conexion') s")).s, "rrss", "los avisos rrss_* son de la sección RRSS");
igual((await uno("select public.seccion_aviso('presupuesto_solicitud') s")).s, "presupuestos", "los de Presupuestos siguen igual");
await q("insert into public.notificaciones_dashboard (tipo, titulo, mensaje) values ('rrss_conexion', 'La conexión con Instagram caduca pronto', 'Renueva la conexión')");
await comoUsuario(STAFF);
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'rrss_conexion'"), 0, "sin RRSS no se ve el aviso");
await comoUsuario(VER);
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'rrss_conexion'"), 1, "con «Ver» en RRSS, sí");

// ─── 14. Limpieza del cubo, purga y tareas ──────────────────────────────────
await comoServidor();
const huerfano = `subidas/${EDITA}/${randomUUID()}.jpg`;
const reciente = `subidas/${EDITA}/${randomUUID()}.jpg`;
await q("insert into storage.objects (bucket_id, name, created_at) values ('rrss', $1, now() - interval '2 days'), ('rrss', $2, now())", [huerfano, reciente]);
await q("update public.rrss_piezas set publicada_at = now() - interval '31 days' where id = $1", [pf]);
const paraBorrar = (await q("select ruta, motivo from public.rrss_ficheros_para_borrar(24, 30) order by motivo, ruta")).rows;
igual(paraBorrar, [{ ruta: huerfano, motivo: "huerfano" }, { ruta: f5, motivo: "publicada" }],
  "se borran las subidas sin pieza de más de 24 h y los ficheros de lo publicado hace más de 30 días (no borradores, ni listas, ni errores)");
igual((await uno("select public.rrss_marcar_medios_borrados($1) n", [[f5]])).n, 1, "y se marca la pieza");
ok((await uno("select public.rrss_pieza_problemas($1) p", [pf])).p.includes("Sus ficheros ya se borraron del panel"), "que ya no se puede volver a publicar");
await comoUsuario(SA);
await falla(q("select * from public.rrss_ficheros_para_borrar()"), /permission denied/, "la limpieza solo la hace la función");
await comoServidor();
await q("update public.rrss_oauth_estados set creado_en = now() - interval '2 days'");
await q("update public.rrss_piezas set procesando_desde = now() - interval '25 hours' where id = $1", [p3]);
const purga = (await uno("select public.rrss_purgar() r")).r;
igual(purga.estados, 2, "la purga borra los states de más de un día");
const p3f = await uno("select estado, error_tipo, contenedor_id from public.rrss_piezas where id = $1", [p3]);
igual([p3f.estado, p3f.error_tipo, p3f.contenedor_id], ["error", "contenedor_caducado", null], "y lo que lleva 24 h procesando pasa a error");
igual((await uno("select public.rrss_disparar('programar') r")).r, "sin_vault", "sin Vault, el programador no llama a nadie");
await falla(q("select public.rrss_disparar('otra')"), /acción no válida/, "solo acciones conocidas");
await q("insert into vault.secrets (name, secret) values ('project_url', 'https://demo.supabase.co'), ('ocr_trabajos_secret', 'secreto') on conflict (name) do nothing");
igual((await uno("select public.rrss_disparar('metricas') r")).r, "llamada", "con Vault, llama a la función");
await comoUsuario(SA);
await falla(q("select public.rrss_disparar('programar')"), /permission denied/, "y nadie del panel la lanza a mano");
await falla(q("select public.rrss_purgar()"), /permission denied/, "ni la purga");

// ─── 15. Vuelta atrás y nueva aplicación ────────────────────────────────────
await comoServidor();
await q("insert into public.admin_feature_toggles (section_key, label, enabled) values ('rrss', 'RRSS', false)");
await q("update public.user_roles set seccion_inicio = 'rrss' where user_id = $1", [EDITA]);
await q(`insert into public.user_role_presets (name, base_role, permissions) values ('Redes', 'staff',
  '[{"section_key":"rrss","can_view":true,"can_edit":true},{"section_key":"dashboard","can_view":true,"can_edit":false}]')`);
await db.exec(adaptar(ROLLBACK));
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows, [], "la vuelta atrás quita todas sus tablas");
igual(await cuenta("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'rrss%'"), 0,
  "y sus funciones");
igual(await cuenta("select count(*)::int n from cron.job where jobname like 'rrss%'"), 0, "y sus tareas");
igual(await cuenta("select count(*)::int n from pg_policies where tablename = 'objects' and policyname like 'rrss%'"), 0, "y las políticas del cubo");
igual((await uno("select public.seccion_aviso('rrss_conexion') s")).s, "dashboard", "los avisos vuelven a la función de antes");
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await uno(`select pg_get_functiondef('public.${fn}'::regproc) d`)).d;
  ok(!def.includes("'rrss_meta_tokens'") && def.includes("'email_eventos'"), `${fn} vuelve a la lista de antes (la de Newsletter sigue)`);
}
igual(await cuenta("select count(*)::int n from public.user_permissions where section_key = 'rrss'"), 0, "ni los permisos de la sección");
igual((await uno("select permissions from public.user_role_presets where name = 'Redes'")).permissions, [{ section_key: "dashboard", can_view: true, can_edit: false }],
  "ni en los roles preconfigurados");
igual((await uno("select seccion_inicio s from public.user_roles where user_id = $1", [EDITA])).s, null, "ni como sección de inicio");
igual(await cuenta("select count(*)::int n from public.admin_feature_toggles where section_key = 'rrss'"), 0, "ni su interruptor");
ok(await cuenta("select count(*)::int n from public.newsletter_config") === 1, "Newsletter sigue");
await aplicar(MIGRACION);
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows.length, TABLAS.length, "se vuelve a aplicar");
await q("insert into public.user_permissions (user_id, section_key, can_view, can_edit) values ($1, 'rrss', true, true)", [EDITA]);
await comoUsuario(EDITA);
const nueva = (await uno("insert into public.rrss_piezas (red, formato) values ('instagram', 'foto') returning estado")).estado;
igual(nueva, "borrador", "y funciona");

console.log(`test-rrss: ${comprobaciones} comprobaciones correctas.`);
