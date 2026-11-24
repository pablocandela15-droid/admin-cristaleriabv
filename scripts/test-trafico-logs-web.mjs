// Tráfico web (supabase/migrations/20261124110000_trafico_web.sql) y Logs web (20261124120000_logs_web.sql), con sus
// vueltas atrás, encima del núcleo, la web editable y el IVA de los presupuestos, contra un Postgres en memoria
// (PGlite). Nunca toca Supabase. Va dentro de `npm run test:nucleo:db`.
//
// Cubre: se aplican enteras y dos veces (idempotentes); la auditoría (los datos derivados fuera, también en una
// reinstalación; los pesos y la configuración dentro); Tráfico web: RLS por la sección «trafico_web» («Ver» lee,
// «Editar» cambia los pesos), las RPC de serie, tendencia, transferencia, páginas y desgloses, y la tarea nocturna que
// solo llama con Vault; Logs: RLS solo super admin (y las estadísticas agregadas para «Ver» en Tráfico web), la
// configuración que ya traía el núcleo completada sin perder Linear, ingesta sin duplicados con el resumen exacto de la
// sesión y las conversiones de la web (presupuesto, contacto), sin visitante, entornos, límites (sesión, IP, día) y
// rutas excluidas; agrupación por huella sin duplicados, umbrales, críticos, 404, patrones ignorados, bots, origen
// (mismos casos que origen.ts) y versión antigua tras publicar (que no cuentan), reapertura y «Pedir ticket»;
// estadísticas con los embudos de la web; el disparador de presupuestos de origen web (que nunca rompe la solicitud);
// la tarea procesar-logs-web; la purga; y las vueltas atrás (Linear y Tickets siguen como en el núcleo) y su reaplicación.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { BASE, adaptar } from "./pglite-supabase.mjs";

const leer = (r) => readFile(r, "utf8");
const NUCLEO = await leer("supabase/migrations/20261118120000_nucleo_panel.sql");
const WEB = await leer("supabase/migrations/20261123100000_web_y_presupuestos.sql");
const IVA = await leer("supabase/migrations/20261124100000_presupuestos_iva_incluido.sql");
const TRAFICO = await leer("supabase/migrations/20261124110000_trafico_web.sql");
const TRAFICO_RB = await leer("supabase/rollbacks/20261124110000_trafico_web_ROLLBACK.sql");
const LOGS = await leer("supabase/migrations/20261124120000_logs_web.sql");
const LOGS_RB = await leer("supabase/rollbacks/20261124120000_logs_web_ROLLBACK.sql");
// Los mismos casos que el vitest de origen.ts: el SQL tiene que clasificar igual.
const CASOS_ORIGEN = JSON.parse(await leer("supabase/functions/_shared/__tests__/logs-web-origen-casos.json"));
// El patrón de «versión antigua» del SQL tiene que ser el de huella.ts.
const HUELLA_TS = await leer("supabase/functions/_shared/logs-web/huella.ts");
// En Supabase el disparador de eventos pone la auditoría al crear cada tabla y la migración se la quita a las de datos
// derivados; aquí se repite eso tras instalar la auditoría a mano.
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
const TRAFICO_VER = "22222222-2222-4222-8222-222222222222";
const TRAFICO_EDITA = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";
const sesion = (id) => id.replace(/^./, "a");

const comoUsuario = async (id) => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: "authenticated", session_id: sesion(id) })]);
  await q("select set_config('request.headers', '{}', false)");
  await db.exec("set role authenticated");
};
const comoAnon = async () => {
  await db.exec("reset role");
  await q(`select set_config('request.jwt.claims', '{"role":"anon"}', false)`);
  await db.exec("set role anon");
};
const comoFuncion = async (origen = "registrar-actividad-web") => {
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

// ─── 1. Se aplican enteras (y dos veces) ────────────────────────────────────
await db.exec(BASE);
await db.exec("grant select, insert, update, delete on storage.objects to anon, authenticated");
await db.exec(adaptar(NUCLEO));
await aplicar(WEB);
await aplicar(IVA);
// Lo que ya tenía el núcleo para Tickets (Linear) tiene que sobrevivir a Logs.
await q("update public.web_logs_config set linear_modo = 'real', linear_equipo_id = 'equipo-cbv', linear_etiquetas = array['web']");
await q("insert into public.web_linear_prueba (incidencia_id, operacion, titulo) values (null, 'crear', 'Ticket de una petición')");
await aplicar(TRAFICO);
await aplicar(TRAFICO);
await aplicar(LOGS);
await aplicar(LOGS);

const TABLAS_TRAFICO = ["trafico_web_diario", "trafico_web_desglose", "peso_paginas", "trafico_web_sync_estado"];
const TABLAS_LOGS = ["web_eventos_catalogo", "web_incidencias", "web_eventos", "web_sesiones", "web_logs_estado", "web_logs_ingesta_diaria",
  "web_logs_limite_ip", "web_resumenes_ia"];
const tablas = (await q("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
for (const t of [...TABLAS_TRAFICO, ...TABLAS_LOGS]) ok(tablas.includes(t), `falta la tabla ${t}`);
igual((await q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) and not relrowsecurity",
  [[...TABLAS_TRAFICO, ...TABLAS_LOGS]])).rows, [], "todas con RLS");
igual(await cuenta("select count(*)::int n from pg_policies where policyname = 'acceso_panel_no_bloqueado' and tablename = any($1)",
  [[...TABLAS_TRAFICO, "web_eventos", "web_sesiones", "web_incidencias", "web_logs_config", "web_linear_prueba"]]), 9, "con la barrera de sesión bloqueada");
igual((await q("select jobname, schedule from cron.job where jobname in ('sync-trafico-web', 'procesar-logs-web') order by 1")).rows,
  [{ jobname: "procesar-logs-web", schedule: "*/5 * * * *" }, { jobname: "sync-trafico-web", schedule: "30 3 * * *" }], "tareas programadas");

// ─── 2. Auditoría ───────────────────────────────────────────────────────────
for (const fn of ["instalar_auditoria_panel", "fn_audit_nueva_tabla"]) {
  const def = (await uno(`select pg_get_functiondef('public.${fn}'::regproc) d`)).d;
  igual(def.split("'web_eventos'").length - 1, 1, `${fn} excluye web_eventos una sola vez (aunque se aplique dos veces)`);
  ok(def.includes("'trafico_web_diario'") && def.includes("'web_incidencias'"), `${fn} excluye los datos derivados`);
}
for (const t of ["web_eventos", "web_sesiones", "web_incidencias", "web_logs_ingesta_diaria", "web_linear_prueba", "trafico_web_diario", "trafico_web_desglose", "trafico_web_sync_estado"]) {
  igual(await auditada(t), false, `${t} sin auditoría (dato derivado), también tras reinstalarla`);
}
ok(await auditada("peso_paginas") && await auditada("web_logs_config"), "los pesos y la configuración sí se auditan");

// ─── 3. Usuarios ────────────────────────────────────────────────────────────
const usuarios = [[SA, "sa@cristaleria.test"], [TRAFICO_VER, "trafico@staff.local"], [TRAFICO_EDITA, "traficoedita@staff.local"], [STAFF, "staff@staff.local"]];
await db.exec(`
  insert into auth.users (id, email) values ${usuarios.map(([id, e]) => `('${id}', '${e}')`).join(", ")};
  insert into auth.sessions (id, user_id) values ${usuarios.map(([id]) => `('${sesion(id)}', '${id}')`).join(", ")};
  insert into public.super_admins (user_id, email) values ('${SA}', 'sa@cristaleria.test');
  insert into public.user_roles (user_id, role) values ${usuarios.slice(1).map(([id]) => `('${id}', 'staff')`).join(", ")};
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${TRAFICO_VER}', 'trafico_web', true, false), ('${TRAFICO_EDITA}', 'trafico_web', true, true), ('${STAFF}', 'dashboard', true, false);
`);

// ─── 4. Tráfico web ─────────────────────────────────────────────────────────
igual((await uno("select bytes_por_visita::int b from public.peso_paginas where proyecto = 'cristaleriabv' and ruta = '*'")).b, 1200000, "peso provisional de partida");
await comoFuncion("sync-trafico-web");
// 60 días: unas 100 visitas de lunes a viernes y 40 en fin de semana (con algo de variación); ayer, un pico.
await q(`insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas, visitantes)
  select d::date, 'cristaleriabv', '*', case when extract(isodow from d) >= 6 then 40 else 100 end + (extract(day from d)::int % 5) * 3, 30
    from generate_series(current_date - 60, current_date - 2, interval '1 day') d`);
await q(`insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas, visitantes) values
  (current_date - 1, 'cristaleriabv', '*', 900, 300), (current_date - 1, 'cristaleriabv', '/', 500, null),
  (current_date - 1, 'cristaleriabv', '/presupuesto', 300, null), (current_date - 2, 'cristaleriabv', '/trabajos', 50, null)`);
await q(`insert into public.trafico_web_desglose (fecha, proyecto, dimension, valor, visitas, visitantes) values
  (current_date - 1, 'cristaleriabv', 'device', 'mobile', 700, 250), (current_date - 1, 'cristaleriabv', 'device', 'desktop', 200, 50)`);
await q(`insert into public.trafico_web_sync_estado (proyecto, ultimo_ok_en, ultimo_intento_en, fallos_consecutivos) values ('cristaleriabv', now(), now(), 0)`);
await falla(q(`insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas) values (current_date, 'casa-tomas-story', '*', 1)`),
  /check constraint|violates/i, "solo el proyecto de la web de la cristalería");

await comoUsuario(STAFF);
igual(await cuenta("select count(*)::int n from public.trafico_web_diario"), 0, "sin la sección no ve las visitas");
igual((await q("select * from public.trafico_web_serie(null, current_date - 7, current_date - 1) where visitas is not null")).rows.length, 0, "ni por las RPC");
await comoAnon();
await falla(q("select count(*) from public.trafico_web_diario"), /permission denied/i, "la web (anon) no ve nada");

await comoUsuario(TRAFICO_VER);
const serie = (await q("select * from public.trafico_web_serie('cristaleriabv', current_date - 14, current_date - 1)")).rows;
igual(serie.length, 14, "una fila por día");
const ayer = serie[serie.length - 1];
igual([Number(ayer.visitas), ayer.es_anomalia], [900, true], "el pico de ayer es una anomalía");
const tend = await uno("select n, fiable, jsonb_array_length(proyeccion) p from public.trafico_web_tendencia('cristaleriabv', 30)");
igual([tend.n, tend.fiable, tend.p], [30, true, 30], "tendencia con proyección de 30 días");
const fdt = (await q("select proyecto, visitas_mes::int v, limite_bytes::float l from public.trafico_web_fdt_mes(current_date - 1)")).rows;
igual(fdt.map((f) => f.proyecto), ["*", "cristaleriabv"], "transferencia del mes: total y la web");
ok(fdt[0].v > 0 && fdt[0].l === 100e9, "con visitas y el límite de referencia");
const top = (await q("select ruta, visitas::int v from public.trafico_web_top_paginas(null, current_date - 7, current_date - 1, 5, 'visitas')")).rows;
igual(top.map((f) => [f.ruta, f.v]), [["/", 500], ["/presupuesto", 300], ["/trabajos", 50]], "páginas más vistas");
igual((await q("select valor, pct::float p from public.trafico_web_desglose_resumen(null, 'device', current_date - 7, current_date - 1)")).rows,
  [{ valor: "mobile", p: 77.78 }, { valor: "desktop", p: 22.22 }], "desglose por dispositivo");
igual(await cuenta("with u as (update public.peso_paginas set bytes_por_visita = 1 returning 1) select count(*)::int n from u"), 0, "con «Ver» no cambia los pesos");
await comoUsuario(TRAFICO_EDITA);
await q("insert into public.peso_paginas (proyecto, ruta, bytes_por_visita, nota) values ('cristaleriabv', '/trabajos', 3000000, 'muchas fotos')");
const peso = await uno("select bytes_por_visita::int b, actualizado_en > now() - interval '1 minute' reciente from public.peso_paginas where ruta = '/trabajos'");
igual([peso.b, peso.reciente], [3000000, true], "con «Editar» añade un peso (y queda la fecha)");
await comoServidor();
igual(await cuenta("select count(*)::int n from public.audit_log where tabla = 'peso_paginas' and accion = 'crear'"), 1, "y queda en la auditoría");

igual((await uno("select public.trafico_web_disparar() r")).r, "sin_vault", "sin Vault la tarea no llama a nadie");
await q("insert into vault.secrets (name, secret) values ('project_url', 'https://gorekooabfhqudeshtgq.supabase.co'), ('ocr_trabajos_secret', 'secreto')");
igual((await uno("select public.trafico_web_disparar() r")).r, "llamada", "con Vault llama a sync-trafico-web");
await comoUsuario(TRAFICO_EDITA);
await falla(q("select public.trafico_web_disparar()"), /permission denied/i, "el panel no la dispara");

// ─── 5. Logs: configuración y permisos ──────────────────────────────────────
await comoServidor();
const cfg = await uno("select linear_modo, linear_equipo_id, linear_etiquetas, entorno_bd, umbral_ocurrencias, entornos_aceptados from public.web_logs_config");
igual(cfg, { linear_modo: "real", linear_equipo_id: "equipo-cbv", linear_etiquetas: ["web"], entorno_bd: "produccion", umbral_ocurrencias: 3,
  entornos_aceptados: ["produccion", "demo"] }, "la configuración del núcleo (Linear) se conserva y se completa");
igual(await cuenta("select count(*)::int n from public.web_linear_prueba where titulo = 'Ticket de una petición'"), 1, "lo de Tickets en el destino de pruebas, intacto");
await q("update public.web_logs_config set linear_modo = 'prueba'");
const catalogo = (await q("select tipo from public.web_eventos_catalogo order by tipo")).rows.map((r) => r.tipo);
ok(catalogo.includes("presupuesto_solicitado") && catalogo.includes("contacto_enviado") && catalogo.includes("calculadora"), "catálogo de la web de la cristalería");
igual(catalogo.filter((t) => /reserva|cheque|carta|vino|plato|bebida|pedido/.test(t)), [], "sin nada de restaurante");

await comoUsuario(STAFF);
igual(await cuenta("select count(*)::int n from public.web_eventos"), 0, "el personal no ve eventos");
igual(await cuenta("select count(*)::int n from public.web_logs_config"), 0, "ni la configuración");
await falla(q("select public.web_logs_ingerir('[]'::jsonb, '{}'::jsonb)"), /permission denied/i, "ni ingiere");
await falla(q("select public.web_logs_estado_recogida('produccion')"), /super admin/i, "ni ve el estado de la recogida");
await falla(q("select public.web_comportamiento(current_date - 7, current_date)"), /permiso/i, "ni las estadísticas");
await falla(q("select public.web_logs_entorno()"), /permiso/i, "ni el entorno");
await comoUsuario(SA);
await falla(q("select public.web_logs_agrupar_errores()"), /permission denied/i, "agrupar es solo del servidor");
await falla(q("update public.web_logs_config set entorno_bd = 'demo'"), /permission denied/i, "el entorno de la base no se cambia desde el panel");
await q("update public.web_logs_config set umbral_sesiones = 2");
ok((await uno("select actualizado_por from public.web_logs_config")).actualizado_por === SA, "el super admin cambia la configuración (y queda quién)");
await comoUsuario(TRAFICO_VER);
igual((await uno("select public.web_logs_entorno() e")).e, "produccion", "quien ve Tráfico web sabe el entorno");
igual(await cuenta("select count(*)::int n from public.web_eventos"), 0, "pero no lee los eventos sueltos");

// ─── 6. Ingesta ─────────────────────────────────────────────────────────────
const ahora = Date.now();
const iso = (msAntes) => new Date(ahora - msAntes).toISOString();
const ev = (o) => ({ evento_id: randomUUID(), fuente: "navegador", categoria: "actividad", proyecto: "cristaleriabv", consentimiento: true,
  dispositivo: "movil", navegador: "Safari", so: "iOS", ...o });
const ingerir = async (eventos, ctx = { entorno: "produccion" }) => {
  await comoFuncion();
  return (await uno("select public.web_logs_ingerir($1::jsonb, $2::jsonb) r", [JSON.stringify(eventos), JSON.stringify(ctx)])).r;
};
const agrupar = async () => { await comoFuncion("procesar-logs-web"); return (await uno("select public.web_logs_agrupar_errores() r")).r; };

const S1 = randomUUID(), S2 = randomUUID();
const vista1 = randomUUID(), vista2 = randomUUID();
const lote1 = [
  ev({ tipo: "pagina_vista", sesion_id: S1, secuencia: 1, ocurrido_en: iso(90_000), ruta: "/", propiedades: { origen_tipo: "buscador", origen_detalle: "google.es", idioma: "es", vista_id: vista1 } }),
  ev({ tipo: "pagina_salida", sesion_id: S1, secuencia: 2, ocurrido_en: iso(80_000), ruta: "/", valor: 10_000, accion: "navegacion", propiedades: { scroll_max: 60, vista_id: vista1 } }),
  ev({ tipo: "pagina_vista", sesion_id: S1, secuencia: 3, ocurrido_en: iso(79_000), ruta: "/presupuesto", propiedades: { vista_id: vista2 } }),
  ev({ tipo: "calculadora", accion: "categoria", objetivo: "Mamparas", sesion_id: S1, secuencia: 4, ocurrido_en: iso(70_000), ruta: "/presupuesto", propiedades: { categoria: "mamparas" } }),
  ev({ tipo: "calculadora", accion: "calculado", objetivo: "Mamparas", valor: 520, sesion_id: S1, secuencia: 5, ocurrido_en: iso(60_000), ruta: "/presupuesto", propiedades: { categoria: "mamparas" } }),
  ev({ tipo: "formulario", accion: "inicio", objetivo: "presupuesto", sesion_id: S1, secuencia: 6, ocurrido_en: iso(50_000), ruta: "/presupuesto" }),
  ev({ tipo: "formulario", accion: "envio", objetivo: "presupuesto", sesion_id: S1, secuencia: 7, ocurrido_en: iso(40_000), ruta: "/presupuesto" }),
  ev({ tipo: "presupuesto_solicitado", categoria: "operacion", accion: "ok", objetivo: "Mamparas", valor: 520, sesion_id: S1, secuencia: 8, ocurrido_en: iso(39_000), ruta: "/presupuesto" }),
  ev({ tipo: "contacto", accion: "whatsapp", objetivo: "WhatsApp", sesion_id: S1, secuencia: 9, ocurrido_en: iso(35_000), ruta: "/presupuesto" }),
  ev({ tipo: "pagina_salida", sesion_id: S1, secuencia: 10, ocurrido_en: iso(30_000), ruta: "/presupuesto", valor: 25_000, accion: "oculta", propiedades: { scroll_max: 90, vista_id: vista2 } }),
];
let r = await ingerir(lote1);
igual([r.aceptados, r.duplicados, r.descartados, r.rechazados], [10, 0, 0, 0], "primer lote");
r = await ingerir(lote1);
igual([r.aceptados, r.duplicados], [0, 10], "un reenvío (sendBeacon + reintento) no duplica");
await comoServidor();
const s1 = await uno("select * from public.web_sesiones where sesion_id = $1", [S1]);
igual([s1.pagina_entrada, s1.ultima_pagina, s1.paginas_vistas, s1.eventos, s1.origen_tipo, s1.idioma, s1.visitante_id],
  ["/", "/presupuesto", 2, 10, "buscador", "es", null], "resumen de la sesión (sin visitante: la web no guarda nada en el navegador)");
igual([Number(s1.tiempo_activo_ms), s1.scroll_max, s1.inicio_operacion, s1.conversiones], [35_000, 90, true, 1], "tiempo, scroll, precio calculado y la solicitud como conversión");

// Sin poder medir («No rastrear»): errores sí, sin sesión.
r = await ingerir([ev({ tipo: "error_js", categoria: "error", consentimiento: false, sesion_id: S2, secuencia: 1, ruta: "/trabajos",
  huella: "a".repeat(32), mensaje: "TypeError: x is undefined", gravedad: "error" })]);
igual(r.aceptados, 1, "error sin poder medir aceptado");
igual(await cuenta("select count(*)::int n from public.web_sesiones where sesion_id = $1", [S2]), 0, "pero no crea sesión");

r = await ingerir([ev({ tipo: "pagina_vista", sesion_id: randomUUID(), secuencia: 1, ruta: "/" })], { entorno: "local" });
igual([r.aceptados, r.motivo], [0, "entorno_no_aceptado"], "local no se acepta por defecto");
r = await ingerir([ev({ tipo: "Pagina Vista!" }), ev({ tipo: "x", categoria: "nada" }), ev({ tipo: "error_js", categoria: "error", huella: null })]);
igual([r.aceptados, r.rechazados], [0, 3], "eventos inválidos rechazados");
const futuro = randomUUID();
await ingerir([ev({ evento_id: futuro, tipo: "clic", sesion_id: randomUUID(), secuencia: 1, ocurrido_en: "2099-01-01T00:00:00Z", objetivo: "x" })]);
await comoServidor();
ok((await uno("select ocurrido_en <= now() + interval '5 minutes' f from public.web_eventos where evento_id = $1", [futuro])).f, "una hora del navegador en el futuro se acota");

await q("update public.web_logs_config set limite_eventos_sesion = 20, rutas_excluidas = array['/privado']");
const S3 = randomUUID();
const muchos = Array.from({ length: 25 }, (_, i) => ev({ tipo: "scroll", sesion_id: S3, secuencia: i + 1, valor: 25, ruta: "/" }));
muchos.push(ev({ tipo: "error_js", categoria: "error", sesion_id: S3, secuencia: 99, huella: "b".repeat(32), mensaje: "boom" }));
muchos.push(ev({ tipo: "pagina_vista", sesion_id: S3, secuencia: 100, ruta: "/privado/x" }));
r = await ingerir(muchos);
igual([r.aceptados, r.descartados], [21, 6], "tope por sesión (20 + el error) y ruta excluida");
await comoServidor();
await q("update public.web_logs_config set limite_eventos_ip_minuto = 10");
const ip = "c".repeat(64);
r = await ingerir(Array.from({ length: 8 }, () => ev({ tipo: "clic", objetivo: "a" })), { entorno: "produccion", ip_hash: ip });
igual(r.aceptados, 8, "dentro del límite por IP");
r = await ingerir(Array.from({ length: 5 }, () => ev({ tipo: "clic", objetivo: "a" })), { entorno: "produccion", ip_hash: ip });
igual([r.aceptados, r.motivo], [0, "limite_ip"], "límite por IP y minuto");
await comoServidor();
const hoyAceptados = await cuenta("select sum(aceptados)::int n from public.web_logs_ingesta_diaria");
await q(`update public.web_logs_config set limite_eventos_ip_minuto = 300, limite_eventos_sesion = 400, rutas_excluidas = '{}', limite_eventos_dia = ${hoyAceptados + 102}`);
r = await ingerir(Array.from({ length: 105 }, () => ev({ tipo: "clic", objetivo: "b" })));
igual(r.aceptados, 102, "cupo diario");
await comoServidor();
await q("update public.web_logs_config set limite_eventos_dia = 50000");
await q("delete from public.web_eventos where objetivo in ('a', 'b')");

// ─── 7. Agrupación, umbrales, origen y tickets ──────────────────────────────
const H1 = "d".repeat(32);
const errores = (n, sesiones, extra = {}) => Array.from({ length: n }, (_, i) => ev({ tipo: "error_js", categoria: "error", gravedad: "error", huella: H1,
  ruta: "/presupuesto", mensaje: "TypeError: categoria.quote is not a function", sesion_id: sesiones[i % sesiones.length], secuencia: 50 + i, version: "1.3.0", ...extra }));
const porHuella = async (h, entorno = "produccion") => { await comoServidor(); return uno("select * from public.web_incidencias where huella = $1 and entorno = $2", [h, entorno]); };
await ingerir(errores(2, [S1]));
await agrupar();
let inc = await porHuella(H1);
igual([inc.ocurrencias, inc.sesiones_afectadas, inc.linear_estado, inc.estado, inc.origen], [2, 1, "sin_ticket", "nueva", "web"], "por debajo del umbral no hay ticket");
await ingerir(errores(1, [S2]));
await Promise.all([agrupar(), agrupar()]);
igual(await cuenta("select count(*)::int n from public.web_incidencias where huella = $1", [H1]), 1, "una sola incidencia aunque se agrupe dos veces a la vez");
inc = await porHuella(H1);
igual([inc.ocurrencias, inc.sesiones_afectadas, inc.linear_estado, inc.requiere_ticket], [3, 2, "pendiente", true], "umbral alcanzado: ticket pendiente");
ok(/3 ocurrencias y 2 sesiones/.test(inc.motivo_ticket), "motivo con cifras");

await ingerir(errores(5, [randomUUID(), randomUUID()]), { entorno: "demo" });
await agrupar();
igual((await porHuella(H1, "demo")).linear_estado, "sin_ticket", "la demo no abre tickets por defecto");

await ingerir([ev({ tipo: "error_servidor", categoria: "error", fuente: "servidor", proyecto: "supabase", gravedad: "critico", huella: "e".repeat(32),
  mensaje: "web-solicitud-presupuesto: Error interno del servidor", objetivo: "web-solicitud-presupuesto", consentimiento: false })]);
await ingerir(Array.from({ length: 30 }, (_, i) => ev({ tipo: "error_404", categoria: "error", gravedad: "aviso", huella: "f".repeat(32), ruta: "/servicios/viejo", sesion_id: randomUUID(), secuencia: i })));
await ingerir(Array.from({ length: 5 }, () => ev({ tipo: "error_js", categoria: "error", huella: "1".repeat(32), sesion_id: randomUUID(), mensaje: "Error in chrome-extension://abc/content.js" })));
await ingerir(Array.from({ length: 6 }, () => ev({ tipo: "error_js", categoria: "error", huella: "2".repeat(32), sesion_id: randomUUID(), es_bot: true, mensaje: "bot" })));
// Sin cobertura del visitante: no depende de la web y no abre ticket.
await ingerir(Array.from({ length: 6 }, () => ev({ tipo: "error_peticion", categoria: "error", huella: "3".repeat(32), sesion_id: randomUUID(),
  mensaje: "Sin respuesta de rest:web_tarifas (sin conexión)", objetivo: "rest:web_tarifas", propiedades: { status: 0, endpoint: "rest:web_tarifas" } })));
// Versión antigua tras publicar (Next.js): la sesión siguió con actividad → sin impacto, no cuenta.
const S4 = randomUUID();
await ingerir([
  ev({ tipo: "error_js", categoria: "error", huella: "4".repeat(32), sesion_id: S4, secuencia: 1, ocurrido_en: iso(20_000), mensaje: "ChunkLoadError: Loading chunk 12 failed." }),
  ev({ tipo: "pagina_vista", sesion_id: S4, secuencia: 2, ocurrido_en: iso(10_000), ruta: "/trabajos" }),
]);
await ingerir(Array.from({ length: 4 }, () => ev({ tipo: "error_js", categoria: "error", huella: "4".repeat(32), sesion_id: randomUUID(), mensaje: "ChunkLoadError: Loading chunk 12 failed." })));
await agrupar();
igual((await porHuella("e".repeat(32))).linear_estado, "pendiente", "la caída de «Solicitar presupuesto» (crítica) abre ticket a la primera");
igual((await porHuella("f".repeat(32))).linear_estado, "sin_ticket", "los 404 no abren ticket por defecto");
const ign = await porHuella("1".repeat(32));
igual([ign.estado, ign.origen], ["ignorada", "navegador"], "extensión del navegador: ignorada");
const bot = await porHuella("2".repeat(32));
igual([bot.ocurrencias, bot.linear_estado, bot.origen], [0, "sin_ticket", "bots"], "los bots no cuentan");
const con = await porHuella("3".repeat(32));
igual([con.origen, con.linear_estado, con.ocurrencias_ventana], ["conexion", "sin_ticket", 0], "sin conexión del visitante: no depende de la web");
const ver = await porHuella("4".repeat(32));
igual([ver.origen, ver.linear_estado, ver.ocurrencias_tras_publicar], ["version_antigua", "sin_ticket", 5], "versión antigua tras publicar: no abre ticket");
await comoServidor();
igual((await uno("select tras_publicar from public.web_eventos where sesion_id = $1 and categoria = 'error'", [S4])).tras_publicar, "sin_impacto", "la sesión siguió: sin impacto");
igual((await uno("select errores_web from public.web_sesiones where sesion_id = $1", [S1])).errores_web, 2, "errores de la web por sesión");
await q("update public.web_logs_config set tickets_404 = true");
await ingerir([ev({ tipo: "error_404", categoria: "error", gravedad: "aviso", huella: "f".repeat(32), ruta: "/servicios/viejo", sesion_id: randomUUID() })]);
await agrupar();
igual((await porHuella("f".repeat(32))).linear_estado, "pendiente", "con tickets_404 y por encima del umbral diario, sí");

// Origen: los mismos casos que origen.ts.
await comoServidor();
for (const c of CASOS_ORIGEN) {
  const d = c.datos;
  const fila = await uno(`select public.web_logs_origen_error($1, $2, $3, $4, $5, $6::jsonb, $7, $8) o, public.web_logs_proveedor_externo($1, $2, $3, $4, $5) p`,
    [d.tipo, d.fuente ?? null, d.mensaje ?? null, d.pila ?? null, d.objetivo ?? null, JSON.stringify(d.propiedades ?? {}), d.accion ?? null, d.tras_publicar ?? null]);
  igual(fila.o, c.origen, `origen: ${c.nombre}`);
  if (c.origen === "externo") igual(fila.p, c.proveedor, `proveedor: ${c.nombre}`);
}
// El patrón de versión antigua es el mismo en el SQL y en huella.ts.
const patronTs = /export const PATRON_CHUNK_CADUCADO =\s*\/(.+)\/i;/.exec(HUELLA_TS)[1].replace(/\\\//g, "/");
ok(LOGS.includes(patronTs.replace(/'/g, "''")), "PATRON_CHUNK_CADUCADO = web_logs_es_version_antigua()");

// Cambios a mano del super admin: estado y nota, nada más; el personal, nada.
await comoUsuario(SA);
await falla(q(`update public.web_incidencias set ocurrencias = 0 where huella = '${H1}'`), /permission denied/i, "las cifras no se editan a mano");
await comoUsuario(STAFF);
igual(await cuenta("with u as (update public.web_incidencias set nota = 'x' returning 1) select count(*)::int n from u"), 0, "el personal no toca incidencias");

// Reapertura: ticket creado → reabierta y aviso pendiente al ticket.
await comoServidor();
await q(`update public.web_incidencias set linear_estado = 'creado', linear_issue_id = 'iss_1', linear_identificador = 'CBV-1' where huella = '${H1}' and entorno = 'produccion'`);
await comoUsuario(SA);
await q(`update public.web_incidencias set estado = 'resuelta', nota = 'arreglado en 1.3.1' where huella = '${H1}' and entorno = 'produccion'`);
inc = await porHuella(H1);
ok(inc.estado === "resuelta" && inc.resuelta_en !== null, "resolver a mano fija resuelta_en");
await new Promise((res) => setTimeout(res, 20));
await ingerir(errores(1, [S1], { ocurrido_en: new Date().toISOString(), version: "1.3.1" }));
await agrupar();
inc = await porHuella(H1);
igual([inc.estado, inc.reabierta_veces, inc.linear_pendiente_reapertura, inc.linear_estado, inc.version_ultima], ["reabierta", 1, true, "creado", "1.3.1"],
  "reaparece tras resolverse: se reabre el mismo ticket");

// «Pedir ticket» a mano vale para lo que no depende de la web.
await comoUsuario(STAFF);
await falla(q("select public.web_incidencia_pedir_ticket($1)", [con.id]), /super admin/i, "solo el super admin pide tickets");
await comoUsuario(SA);
await q("select public.web_incidencia_pedir_ticket($1)", [con.id]);
const pedida = await porHuella("3".repeat(32));
ok(pedida.linear_estado === "pendiente" && pedida.motivo_ticket.startsWith("Pedido a mano"), "pedida a mano: pendiente aunque no dependa de la web");
await agrupar();
igual((await porHuella("3".repeat(32))).linear_estado, "pendiente", "y el proceso la respeta");

// Lecturas del panel.
await comoUsuario(SA);
const busq = (await q("select (sesion).sesion_id, total from public.web_buscar_sesiones(now() - interval '1 day', now() + interval '1 minute', 'produccion', null, null, null, null, null, null, true)")).rows;
ok(busq.some((x) => x.sesion_id === S1) && busq.every((x) => Number(x.total) === busq.length), "buscar sesiones con conversión");
const ctxEv = await uno("select id from public.web_eventos where sesion_id = $1 and tipo = 'presupuesto_solicitado'", [S1]);
const ctxFilas = (await q("select tipo from public.web_contexto_evento($1, 2, 1)", [ctxEv.id])).rows.map((x) => x.tipo);
igual(ctxFilas, ["formulario", "formulario", "presupuesto_solicitado", "contacto"], "contexto: antes y después en la misma sesión");
const recogida = (await uno("select public.web_logs_estado_recogida('produccion') r")).r;
igual(recogida.vercel_ultimo_dia.visitas, 900, "estado de la recogida con las visitas de Vercel como referencia");

// ─── 8. Estadísticas de comportamiento ──────────────────────────────────────
const hoy = (await uno("select (now() at time zone 'Europe/Madrid')::date::text d")).d;
for (const quien of [SA, TRAFICO_VER]) {
  await comoUsuario(quien);
  const c = (await uno("select public.web_comportamiento($1::date - 6, $1::date, 'produccion', false) c", [hoy])).c;
  const presupuesto = c.embudos.find((e) => e.operacion === "presupuesto");
  igual([presupuesto.consulta, presupuesto.inicio, presupuesto.envio, presupuesto.fin], [1, 1, 1, 1], `embudo de presupuesto (${quien === SA ? "super admin" : "Tráfico web"})`);
  ok(c.resumen.conversiones === 1 && c.contactos.some((x) => x.accion === "whatsapp"), "conversiones y clics en WhatsApp");
  ok(c.contenidos.some((x) => x.tipo === "calculadora" && x.objetivo === "Mamparas"), "lo que se mira: categorías de la calculadora");
  igual(c.calculadora[0], { categoria: "Mamparas", calculos: 1, sesiones: 1, precio_medio: 520 }, "precios calculados por servicio");
  ok(c.paginas.some((x) => x.ruta === "/presupuesto"), "páginas vistas");
}
await comoUsuario(TRAFICO_VER);
await q("select * from public.web_resumenes_ia");
igual(await cuenta("select count(*)::int n from public.web_resumenes_ia"), 0, "quien ve Tráfico web lee los resúmenes de IA (vacíos)");

// ─── 9. Presupuestos de la web: lo apunta la base ───────────────────────────
await comoFuncion("web-solicitud-presupuesto");
const sol = (await uno("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb) r", ["9".repeat(64),
  JSON.stringify({ nombre: "Eva", telefono: "650000000", categoria: "mamparas", valores: {}, total: 515, resumen: "x" })])).r;
await comoServidor();
igual(await cuenta("select count(*)::int n from public.web_eventos where tipo = 'presupuesto_solicitado_bd' and fuente = 'base_datos' and entorno = 'produccion'"), 1,
  "cada solicitud de la web queda apuntada (todos los visitantes)");
await q("update public.presupuestos set estado = 'aceptado' where id = $1", [sol.id]);
await q("update public.presupuestos set estado = 'aceptado', notas_internas = 'otra vez' where id = $1", [sol.id]);
igual(await cuenta("select count(*)::int n from public.web_eventos where tipo = 'presupuesto_aceptado_bd'"), 1, "y su aceptación, una sola vez");
await q("insert into public.presupuestos (cliente_nombre) values ('Del panel')");
igual(await cuenta("select count(*)::int n from public.web_eventos where fuente = 'base_datos'"), 2, "los del panel no cuentan");
await q("alter table public.web_eventos rename to web_eventos_x");
await comoFuncion("web-solicitud-presupuesto");
ok((await uno("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb) r", ["8".repeat(64),
  JSON.stringify({ nombre: "Ana", telefono: "650000001", categoria: "espejos", valores: {}, total: 90, resumen: "x" })])).r.ok, "si apuntarlo falla, la solicitud se guarda igual");
await comoServidor();
await q("alter table public.web_eventos_x rename to web_eventos");

// ─── 10. Tarea procesar-logs-web y purga ────────────────────────────────────
igual((await uno("select public.logs_web_disparar() r")).r, "llamada", "con Vault llama a procesar-logs-web");
await q("delete from vault.secrets where name = 'ocr_trabajos_secret'");
igual((await uno("select public.logs_web_disparar() r")).r, "sin_vault", "sin el secreto no llama a nadie");
await q("update public.web_eventos set ocurrido_en = now() - interval '200 days' where tipo = 'scroll'");
await comoFuncion("procesar-logs-web");
const purga = (await uno("select public.web_logs_purgar() r")).r;
ok(purga.eventos >= 20, "la purga borra la actividad fuera de la retención");
await comoServidor();
ok((await uno("select ultima_purga is not null p from public.web_logs_estado")).p, "y lo anota");

// ─── 11. Vueltas atrás y reaplicación ───────────────────────────────────────
await comoServidor();
await db.exec(adaptar(LOGS_RB));
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS_LOGS])).rows, [], "la vuelta atrás de Logs quita sus tablas");
igual((await q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'web_logs_config' order by ordinal_position")).rows.map((x) => x.column_name),
  ["id", "linear_modo", "linear_equipo_id", "linear_proyecto_id", "linear_etiquetas", "actualizado_en", "actualizado_por"], "web_logs_config vuelve a la del núcleo");
igual((await uno("select linear_equipo_id, linear_etiquetas from public.web_logs_config")), { linear_equipo_id: "equipo-cbv", linear_etiquetas: ["web"] }, "sin perder Linear");
igual((await q("select titulo from public.web_linear_prueba")).rows, [{ titulo: "Ticket de una petición" }], "Tickets conserva su destino de pruebas");
ok(await auditada("web_linear_prueba"), "que vuelve a auditarse");
igual(await cuenta("select count(*)::int n from pg_trigger where tgname = 'web_logs_operacion_bd'"), 0, "sin el disparador de presupuestos");
igual(await cuenta("select count(*)::int n from cron.job where jobname = 'procesar-logs-web'"), 0, "ni la tarea");
igual(await cuenta("select count(*)::int n from public.ia_funciones where funcion in ('procesar-logs-web', 'resumen-logs-web')"), 0, "ni sus funciones de IA");
const defAudit = (await uno("select pg_get_functiondef('public.instalar_auditoria_panel'::regproc) d")).d;
ok(!defAudit.includes("'web_eventos'") && defAudit.includes("'ia_uso','metricas'"), "la lista de la auditoría vuelve a la del núcleo");
await comoUsuario(SA);
await q("update public.web_logs_config set linear_modo = 'prueba'");
igual((await uno("select linear_modo from public.web_logs_config")).linear_modo, "prueba", "el super admin vuelve a editar Linear como antes");

await comoServidor();
await db.exec(adaptar(TRAFICO_RB));
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS_TRAFICO])).rows, [], "la de Tráfico web quita las suyas");
igual(await cuenta("select count(*)::int n from public.user_permissions where section_key = 'trafico_web'"), 0, "y los permisos de la sección");
igual(await cuenta("select count(*)::int n from cron.job where jobname = 'sync-trafico-web'"), 0, "y la tarea nocturna");
igual(await cuenta("select count(*)::int n from pg_proc where proname like 'trafico_web%'"), 0, "y sus funciones");

await aplicar(TRAFICO);
await aplicar(LOGS);
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [[...TABLAS_TRAFICO, ...TABLAS_LOGS]])).rows.length,
  TABLAS_TRAFICO.length + TABLAS_LOGS.length, "se vuelven a aplicar");
igual((await uno("select linear_equipo_id from public.web_logs_config")).linear_equipo_id, "equipo-cbv", "con Linear intacto");

console.log(`test-trafico-logs-web: ${comprobaciones} comprobaciones correctas.`);
