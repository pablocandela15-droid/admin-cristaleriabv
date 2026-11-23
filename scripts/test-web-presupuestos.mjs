// Esquema de la web editable y los presupuestos (supabase/migrations/20261123100000_web_y_presupuestos.sql) y su
// vuelta atrás, encima del núcleo y de Facturas, contra un Postgres en memoria (PGlite). Nunca toca Supabase. Va
// dentro de `npm run test:nucleo:db`.
//
// Cubre: se aplica entera; RLS en todas sus tablas (barrera de sesión en las del panel; el contador y el límite por
// IP sin políticas); los datos de partida (tarifas y textos de la web); la web (anon) lee solo lo publicado y nunca
// los presupuestos; cada sección del panel («Ver» lee, «Editar» cambia) en tablas y en el bucket web-fotos; Contenido
// sube solo fotos sueltas; la numeración P-AAAA-NNNN por año (no se cambia ni se reutiliza); los totales con
// descuento e IVA; la solicitud de la web (service role): presupuesto + línea + aviso para quien ve Presupuestos,
// auditada como servicio y con límite por huella de IP; y la vuelta atrás no deja rastro y se puede volver a aplicar.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { BASE, adaptar } from "./pglite-supabase.mjs";

const NUCLEO = await readFile("supabase/migrations/20261118120000_nucleo_panel.sql", "utf8");
const FACTURAS = await readFile("supabase/migrations/20261121100000_facturas.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261123100000_web_y_presupuestos.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261123100000_web_y_presupuestos_ROLLBACK.sql", "utf8");
// En Supabase el disparador de eventos pone la auditoría al crear cada tabla y la migración se la quita después a
// las de datos derivados; aquí se repite eso tras instalar la auditoría a mano.
const SIN_AUDITORIA = [...MIGRACION.matchAll(/^drop trigger if exists trg_auditoria on public\.\w+;$/gm)].map((m) => m[0]).join("\n");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const db = await PGlite.create({ extensions: { pg_trgm, unaccent } });
const q = (sql, params) => db.query(sql, params);
const uno = async (sql, params) => (await q(sql, params)).rows[0];
const cuenta = async (sql, params) => (await uno(sql, params)).n;
await db.exec(BASE);
// Como en Supabase: anon y el panel tienen privilegios sobre storage.objects y la RLS decide.
await db.exec("grant select, insert, update, delete on storage.objects to anon, authenticated");
await db.exec(adaptar(NUCLEO));

const TABLAS = ["web_albumes", "web_fotos", "web_contenido", "web_tarifas", "presupuestos", "presupuesto_lineas",
  "presupuestos_numeracion", "web_solicitudes_limite"];
const TABLAS_PANEL = TABLAS.slice(0, 6);
const SECCIONES = ["web_fotos", "web_tarifas", "web_contenido", "presupuestos"];
const ANIO = new Date().getFullYear();

const SA = "11111111-1111-4111-8111-111111111111";
const FOTOS = "22222222-2222-4222-8222-222222222222";
const CONTENIDO = "33333333-3333-4333-8333-333333333333";
const TARIFAS_VER = "44444444-4444-4444-8444-444444444444";
const PRES_VER = "55555555-5555-4555-8555-555555555555";
const PRES_EDITA = "66666666-6666-4666-8666-666666666666";
const NADA = "77777777-7777-4777-8777-777777777777";
const sesion = (id) => id.replace(/^./, "a");

const comoUsuario = async (id) => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: "authenticated", session_id: sesion(id) })]);
  await q("select set_config('request.headers', '{}', false)");
  await db.exec("set role authenticated");
};
// La web: clave pública, sin usuario.
const comoWeb = async () => {
  await db.exec("reset role");
  await q(`select set_config('request.jwt.claims', '{"role":"anon"}', false)`);
  await q("select set_config('request.headers', '{}', false)");
  await db.exec("set role anon");
};
// La Edge Function web-solicitud-presupuesto: service role con su origen (lo exige la auditoría del núcleo).
const comoFuncion = async () => {
  await db.exec("reset role");
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await q(`select set_config('request.headers', '{"x-audit-source":"web-solicitud-presupuesto"}', false)`);
  await db.exec("set role service_role");
};
const comoServidor = async () => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', '', false)");
  await q("select set_config('request.headers', '', false)");
};

async function aplicar() {
  await comoServidor();
  await db.exec(adaptar(MIGRACION));
  await q("select public.instalar_auditoria_panel()");
  await db.exec(SIN_AUDITORIA);
}

// ─── 1. Se aplica entera encima del núcleo y de Facturas ────────────────────
await comoServidor();
await db.exec(adaptar(FACTURAS));
await q("select public.instalar_auditoria_panel()");
await aplicar();
const tablas = (await q("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
for (const t of TABLAS) ok(tablas.includes(t), `falta la tabla ${t}`);
igual(
  (await q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) and not relrowsecurity", [TABLAS])).rows,
  [], "todas las tablas con RLS");
igual(await cuenta("select count(*)::int n from pg_policies where schemaname = 'public' and tablename = any($1) and policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE'", [TABLAS_PANEL]),
  TABLAS_PANEL.length, "las del panel con la barrera de sesión bloqueada");
igual(await cuenta("select count(*)::int n from pg_policies where schemaname = 'public' and tablename in ('presupuestos_numeracion', 'web_solicitudes_limite')"), 0,
  "el contador y el límite por IP, sin políticas");
igual(await cuenta("select count(*)::int n from pg_trigger where tgname = 'trg_auditoria' and tgrelid = any(array['public.presupuestos'::regclass, 'public.web_fotos'::regclass, 'public.web_tarifas'::regclass])"), 3,
  "las tablas nuevas, auditadas");
igual(await cuenta("select count(*)::int n from pg_trigger where tgname = 'trg_auditoria' and tgrelid = any(array['public.presupuestos_numeracion'::regclass, 'public.web_solicitudes_limite'::regclass])"), 0,
  "salvo el contador y el límite (datos derivados)");
igual(await uno("select public, file_size_limit::int l, allowed_mime_types t from storage.buckets where id = 'web-fotos'"),
  { public: true, l: 15728640, t: ["image/jpeg", "image/png", "image/webp", "image/avif"] }, "bucket público web-fotos");
const tarifas = await uno("select config, catalogo from public.web_tarifas where id = 1");
igual([tarifas.config.mamparas.base, tarifas.config.espejos.basePerM2, tarifas.config.entrega.envio, tarifas.catalogo], [200, 65, 50, {}],
  "tarifas de partida = las del código de la web, catálogo vacío");
igual((await q("select clave, jsonb_typeof(valor) t from public.web_contenido order by clave")).rows,
  [{ clave: "faq", t: "array" }, { clave: "imagenes", t: "object" }, { clave: "negocio", t: "object" }, { clave: "servicios", t: "object" }],
  "contenido de partida: negocio, servicios, faq e imagenes");
igual((await uno("select jsonb_array_length(valor) n from public.web_contenido where clave = 'faq'")).n, 10, "las 10 preguntas de la web");
igual((await uno("select valor->'mamparas'->>'name' n from public.web_contenido where clave = 'servicios'")).n, "Mamparas", "los textos de cada servicio");
igual((await uno("select public.seccion_aviso('presupuesto_solicitud') a, public.seccion_aviso('subida_precio') b, public.seccion_aviso('peticion_urgente') c")),
  { a: "presupuestos", b: "facturas", c: "solo_super_admin" }, "avisos de solicitudes para quien ve Presupuestos (Facturas sigue igual)");

// ─── 2. Usuarios y permisos ─────────────────────────────────────────────────
const usuarios = [[SA, "sa@cristaleria.test"], [FOTOS, "fotos@staff.local"], [CONTENIDO, "contenido@staff.local"],
  [TARIFAS_VER, "tarifas@staff.local"], [PRES_VER, "presver@staff.local"], [PRES_EDITA, "presedita@staff.local"], [NADA, "nada@staff.local"]];
await db.exec(`
  insert into auth.users (id, email) values ${usuarios.map(([id, e]) => `('${id}', '${e}')`).join(", ")};
  insert into auth.sessions (id, user_id) values ${usuarios.map(([id]) => `('${sesion(id)}', '${id}')`).join(", ")};
  insert into public.super_admins (user_id, email) values ('${SA}', 'sa@cristaleria.test');
  insert into public.user_roles (user_id, role) values ${usuarios.slice(1).map(([id]) => `('${id}', 'staff')`).join(", ")};
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${FOTOS}', 'web_fotos', true, true), ('${CONTENIDO}', 'web_contenido', true, true),
    ('${TARIFAS_VER}', 'web_tarifas', true, false), ('${PRES_VER}', 'presupuestos', true, false),
    ('${PRES_EDITA}', 'presupuestos', true, true), ('${NADA}', 'dashboard', true, false);
`);

// ─── 3. Álbumes y fotos ─────────────────────────────────────────────────────
await comoUsuario(FOTOS);
const album = (await uno("insert into public.web_albumes (slug, titulo, servicio) values ('mamparas-crevillente', 'Mamparas en Crevillente', 'mamparas') returning id")).id;
const otro = (await uno("insert into public.web_albumes (slug, titulo, publicado, orden) values ('obra-oculta', 'Obra oculta', false, 1) returning id")).id;
const ruta = (a, n) => `albumes/${a}/${n}.webp`;
const f1 = (await uno("insert into public.web_fotos (album_id, ruta, alt, ancho, alto, orden, destacada) values ($1, $2, 'Mampara frontal', 2400, 1600, 0, true) returning id", [album, ruta(album, "f1")])).id;
const f2 = (await uno("insert into public.web_fotos (album_id, ruta, alt, orden, publicado) values ($1, $2, 'Sin publicar', 1, false) returning id", [album, ruta(album, "f2")])).id;
await q("insert into public.web_fotos (album_id, ruta, alt, destacada) values ($1, $2, 'De un álbum oculto', true)", [otro, ruta(otro, "f3")]);
await q("update public.web_albumes set portada_foto_id = $1 where id = $2", [f1, album]);
await falla(q("insert into public.web_albumes (slug, titulo) values ('Con Mayúsculas', 'Mal')"), /check constraint|violates/i, "el slug va en minúsculas y con guiones");
await falla(q("insert into public.web_fotos (ruta) values ('otra-carpeta/x.webp')"), /check constraint|violates/i, "solo rutas albumes/<id>/ o sueltas/");
ok(await cuenta(`insert into storage.objects (bucket_id, name) values ('web-fotos', '${ruta(album, "f1")}') returning 1 as n`) === 1, "Fotos sube al bucket");

await comoWeb();
igual(await cuenta("select count(*)::int n from public.web_albumes"), 0, "la web no ve álbumes sin publicar");
igual(await cuenta("select count(*)::int n from public.web_fotos"), 0, "ni sus fotos");
await comoUsuario(FOTOS);
await q("update public.web_albumes set publicado = true where id = $1", [album]);
await comoWeb();
igual((await q("select slug, servicio from public.web_albumes")).rows, [{ slug: "mamparas-crevillente", servicio: "mamparas" }], "publicado: la web lo ve");
igual((await q("select id from public.web_fotos order by orden")).rows.map((r) => r.id), [f1], "y solo sus fotos publicadas");
igual((await q("select alt from public.web_fotos where destacada")).rows, [{ alt: "Mampara frontal" }], "destacadas: nunca las de un álbum oculto");
await falla(q("insert into public.web_albumes (slug, titulo) values ('spam', 'Spam')"), /row-level security|permission denied/i, "la web no crea álbumes");
await falla(q("update public.web_fotos set alt = 'x'"), /row-level security|permission denied/i, "ni cambia fotos");
await falla(q("select count(*) from public.presupuestos"), /permission denied/i, "ni lee presupuestos");
await falla(q("insert into storage.objects (bucket_id, name) values ('web-fotos', 'sueltas/anonimo.webp')"), /row-level security|permission denied/i, "ni sube al bucket");
igual(await cuenta("select count(*)::int n from storage.objects where bucket_id = 'web-fotos'"), 0, "ni lista el bucket (las fotos se ven por su URL pública)");

await comoUsuario(NADA);
igual(await cuenta("select count(*)::int n from public.web_fotos"), 1, "sin Web, un usuario del panel ve lo mismo que la web");
await falla(q("insert into public.web_fotos (ruta) values ('sueltas/nada.webp')"), /row-level security/i, "y no crea fotos");
await falla(q("insert into storage.objects (bucket_id, name) values ('web-fotos', 'sueltas/nada.webp')"), /row-level security/i, "ni sube");

await comoUsuario(CONTENIDO);
igual(await cuenta("select count(*)::int n from public.web_fotos"), 3, "Contenido ve todas las fotos (para elegir imágenes)");
const suelta = (await uno("insert into public.web_fotos (ruta, alt) values ('sueltas/portada.webp', 'Portada') returning id")).id;
ok(suelta, "Contenido crea fotos sueltas");
await falla(q("insert into public.web_fotos (album_id, ruta) values ($1, $2)", [album, ruta(album, "c1")]), /row-level security/i, "pero no en un álbum");
ok(await cuenta("insert into storage.objects (bucket_id, name) values ('web-fotos', 'sueltas/portada.webp') returning 1 as n") === 1, "sube a sueltas/");
await falla(q(`insert into storage.objects (bucket_id, name) values ('web-fotos', '${ruta(album, "c1")}')`), /row-level security/i, "no a albumes/");
igual(await cuenta("with b as (delete from public.web_fotos where id = $1 returning 1) select count(*)::int n from b", [f1]), 0, "no borra fotos");
igual(await cuenta("with b as (delete from storage.objects where bucket_id = 'web-fotos' returning 1) select count(*)::int n from b"), 0, "ni ficheros");

await comoWeb();
igual(await cuenta("select count(*)::int n from public.web_fotos where album_id is null"), 1, "la web ve las sueltas publicadas");

await comoUsuario(FOTOS);
await q("delete from public.web_fotos where id = $1", [f1]);
igual((await uno("select portada_foto_id p from public.web_albumes where id = $1", [album])).p, null, "al borrar la portada, el álbum se queda sin portada");
igual(await cuenta("with b as (delete from storage.objects where bucket_id = 'web-fotos' and name = $1 returning 1) select count(*)::int n from b", [ruta(album, "f1")]), 1,
  "Fotos borra el fichero");
await q("delete from public.web_albumes where id = $1", [otro]);
igual(await cuenta("select count(*)::int n from public.web_fotos where album_id = $1", [otro]), 0, "borrar un álbum borra sus fotos");
void f2;

// ─── 4. Contenido y tarifas ─────────────────────────────────────────────────
await comoUsuario(TARIFAS_VER);
await q("update public.web_tarifas set config = jsonb_set(config, '{mamparas,base}', '999') where id = 1");
igual((await uno("select (config->'mamparas'->>'base')::int b from public.web_tarifas")).b, 200, "con «Ver» en Tarifas no cambia precios");
await q("update public.web_contenido set valor = '{}' where clave = 'negocio'");
await comoUsuario(CONTENIDO);
igual((await uno("select valor->>'tagline' t from public.web_contenido where clave = 'negocio'")).t, "Especialistas en cristalería y aluminio", "ni toca Contenido");
await q(`update public.web_contenido set valor = valor || '{"tagline":"Cristal con oficio"}' where clave = 'negocio'`);
igual((await uno("select valor->>'tagline' t, actualizado_por p from public.web_contenido where clave = 'negocio'")), { t: "Cristal con oficio", p: CONTENIDO },
  "Contenido cambia el negocio (y queda quién)");
await falla(q("update public.web_contenido set valor = '{}' where clave = 'faq'"), /check constraint|violates/i, "faq siempre es una lista");
await falla(q("insert into public.web_contenido (clave, valor) values ('otra', '{}')"), /check constraint|violates/i, "solo las cuatro claves");
await q(`update public.web_tarifas set catalogo = '{"categorias":{"espejos":{"activo":false}}}'`);
igual((await uno("select catalogo from public.web_tarifas")).catalogo, {}, "Contenido no toca Tarifas");
await comoUsuario(SA);
await q(`update public.web_tarifas set config = jsonb_set(config, '{mamparas,base}', '210'), catalogo = '{"categorias":{"mamparas":{"nombre":"Mampara de ducha"}}}' where id = 1`);
igual((await uno("select (config->'mamparas'->>'base')::int b, actualizado_por p from public.web_tarifas")), { b: 210, p: SA }, "el super admin cambia las tarifas");
await falla(q("insert into public.web_tarifas (id, config) values (2, '{}')"), /check constraint|violates|duplicate/i, "una sola fila de tarifas");
await comoWeb();
igual((await uno("select (config->'mamparas'->>'base')::int b, catalogo->'categorias'->'mamparas'->>'nombre' n from public.web_tarifas where id = 1")), { b: 210, n: "Mampara de ducha" },
  "la web lee tarifas y catálogo");
igual(await cuenta("select count(*)::int n from public.web_contenido"), 4, "y el contenido");

// ─── 5. Presupuestos: permisos, numeración y totales ────────────────────────
await comoUsuario(PRES_VER);
await falla(q("insert into public.presupuestos (cliente_nombre) values ('Ana')"), /row-level security/i, "con «Ver» en Presupuestos no crea");
await comoUsuario(PRES_EDITA);
const p1 = await uno("insert into public.presupuestos (cliente_nombre, numero, subtotal, total) values ('Ana López', 'P-1999-9999', 5000, 5000) returning id, numero, subtotal::float s, total::float t");
igual([p1.numero, p1.s, p1.t], [`P-${ANIO}-0001`, 0, 0], "número P-AAAA-0001 (el que se mande se ignora) y totales a cero");
const p2 = await uno("insert into public.presupuestos (cliente_nombre) values ('Bea') returning id, numero");
igual(p2.numero, `P-${ANIO}-0002`, "correlativo");
igual((await uno("insert into public.presupuestos (cliente_nombre, fecha) values ('Carlos', '2025-12-30') returning numero")).numero, "P-2025-0001", "por año (el de su fecha)");
await q("update public.presupuestos set numero = 'OTRO' where id = $1", [p1.id]);
igual((await uno("select numero from public.presupuestos where id = $1", [p1.id])).numero, `P-${ANIO}-0001`, "el número no cambia");
await q("delete from public.presupuestos where id = $1", [p2.id]);
igual((await uno("insert into public.presupuestos (cliente_nombre) values ('Dani') returning numero")).numero, `P-${ANIO}-0003`, "ni se reutiliza al borrar");

await q(`insert into public.presupuesto_lineas (presupuesto_id, orden, categoria, valores, descripcion, cantidad, precio_unitario, precio_calculado)
  values ($1, 0, 'mamparas', '{"ancho":100,"alto":195}', 'Mampara frontal', 2, 400.50, 400.50), ($1, 1, null, null, 'Portes', 1, 30, null)`, [p1.id]);
const tot = async () => uno("select subtotal::float s, total::float t from public.presupuestos where id = $1", [p1.id]);
igual(await tot(), { s: 831, t: 1005.51 }, "subtotal = suma de importes; total con el 21 % de IVA");
await q("update public.presupuestos set descuento_pct = 10 where id = $1", [p1.id]);
igual(await tot(), { s: 831, t: 904.96 }, "con un 10 % de descuento");
await q("update public.presupuestos set iva_pct = 0, total = 1 where id = $1", [p1.id]);
igual(await tot(), { s: 831, t: 747.9 }, "sin IVA (y el total que se escriba se ignora)");
await q("update public.presupuesto_lineas set cantidad = 1 where descripcion = 'Mampara frontal'");
igual(await tot(), { s: 430.5, t: 387.45 }, "cambiar una línea recalcula");
await q("delete from public.presupuesto_lineas where descripcion = 'Portes'");
igual(await tot(), { s: 400.5, t: 360.45 }, "borrarla también");
igual(Number((await uno("select importe from public.presupuesto_lineas where presupuesto_id = $1", [p1.id])).importe), 400.5, "importe = cantidad × precio");
await falla(q("insert into public.presupuesto_lineas (presupuesto_id, categoria, descripcion) values ($1, 'ventanas', 'X')", [p1.id]), /check constraint|violates/i,
  "categoría de la calculadora o ninguna");

await comoUsuario(PRES_VER);
igual(await cuenta("select count(*)::int n from public.presupuestos"), 3, "con «Ver» los consulta");
igual(await cuenta("select count(*)::int n from public.presupuesto_lineas"), 1, "y sus líneas");
igual(await cuenta("with u as (update public.presupuestos set notas_internas = 'x' returning 1) select count(*)::int n from u"), 0, "pero no los cambia");
await comoUsuario(NADA);
igual(await cuenta("select count(*)::int n from public.presupuestos"), 0, "sin Presupuestos no ve ninguno");
igual(await cuenta("select count(*)::int n from public.presupuesto_lineas"), 0, "ni sus líneas");

// ─── 6. Solicitud desde la web (Edge Function) ──────────────────────────────
const HUELLA = "a".repeat(64);
const solicitud = {
  nombre: "Eva Martínez", telefono: "650 00 00 00", email: "eva@example.com", poblacion: "Elche", notas: "Mejor por la tarde",
  categoria: "mamparas", valores: { tipoMampara: "frontal", ancho: 100, alto: 195 }, total: 515, resumen: "Tipo de mampara: Frontal\nAncho: 100 cm",
};
await comoWeb();
await falla(q("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb)", [HUELLA, JSON.stringify(solicitud)]), /permission denied/i, "la web no llama a la función de SQL directamente");
await comoUsuario(PRES_EDITA);
await falla(q("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb)", [HUELLA, JSON.stringify(solicitud)]), /permission denied/i, "ni un usuario del panel");
await comoFuncion();
const r1 = (await uno("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb) r", [HUELLA, JSON.stringify(solicitud)])).r;
igual([r1.ok, r1.numero], [true, `P-${ANIO}-0004`], "la solicitud se guarda con su número");
const guardado = await uno("select estado, origen, cliente_nombre, cliente_telefono, cliente_email, cliente_poblacion, notas_cliente, subtotal::float s, total::float t from public.presupuestos where numero = $1", [r1.numero]);
igual(guardado, { estado: "solicitud", origen: "web", cliente_nombre: "Eva Martínez", cliente_telefono: "650 00 00 00", cliente_email: "eva@example.com",
  cliente_poblacion: "Elche", notas_cliente: "Mejor por la tarde", s: 515, t: 623.15 }, "como presupuesto «solicitud» de origen web");
igual(await uno("select categoria, valores->>'ancho' a, descripcion, detalle, cantidad::float c, precio_unitario::float p, precio_calculado::float pc from public.presupuesto_lineas where presupuesto_id = $1", [r1.id]),
  { categoria: "mamparas", a: "100", descripcion: "Solicitud web · Mampara de ducha", detalle: solicitud.resumen, c: 1, p: 515, pc: 515 },
  "con una línea de la calculadora (nombre del catálogo, valores y resumen)");
const aviso = await uno("select titulo, mensaje, referencia_id, referencia_tipo, origen from public.notificaciones_dashboard where tipo = 'presupuesto_solicitud'");
igual(aviso, { titulo: "Nueva solicitud de presupuesto", mensaje: `P-${ANIO}-0004 · Eva Martínez · Mampara de ducha · 515,00 €`, referencia_id: r1.id,
  referencia_tipo: "presupuesto", origen: "web-solicitud-presupuesto" }, "y un aviso en la campana");
igual((await uno("select actor_label, actor_origin from public.audit_log where tabla = 'presupuestos' and registro_id = $1 and accion = 'crear'", [r1.id])),
  { actor_label: "API · service_role · web-solicitud-presupuesto", actor_origin: "servicio" }, "auditada como la Edge Function");
for (let i = 0; i < 4; i++) await q("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb)", [HUELLA, JSON.stringify({ ...solicitud, total: 0 })]);
igual((await uno("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb) r", [HUELLA, JSON.stringify(solicitud)])).r, { ok: false, motivo: "limite" },
  "la sexta en una hora desde la misma IP, no");
igual((await uno("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb) r", ["b".repeat(64), JSON.stringify(solicitud)])).r.ok, true, "otra IP, sí");
await falla(q("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb)", ["corta", JSON.stringify(solicitud)]), /huella/i, "sin huella válida, no");
await falla(q("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb)", ["c".repeat(64), JSON.stringify({ ...solicitud, total: 2e6 })]), /fuera de rango/i, "ni un total absurdo");
igual(await cuenta("select count(*)::int n from public.web_solicitudes_limite where ip_hash = $1", [HUELLA]), 5, "el límite guarda solo huellas");
await comoServidor();
await q("update public.web_solicitudes_limite set creado_en = now() - interval '2 days' where ip_hash = $1", [HUELLA]);
await comoFuncion();
igual((await uno("select public.web_solicitud_presupuesto_registrar($1, $2::jsonb) r", [HUELLA, JSON.stringify(solicitud)])).r.ok, true, "pasada la hora vuelve a poder");
igual(await cuenta("select count(*)::int n from public.web_solicitudes_limite where ip_hash = $1", [HUELLA]), 1, "y las huellas viejas se borran solas");

await comoUsuario(PRES_VER);
ok(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'presupuesto_solicitud'") >= 1, "quien ve Presupuestos ve el aviso");
await comoUsuario(NADA);
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'presupuesto_solicitud'"), 0, "quien no, no (lleva datos del cliente)");

// ─── 7. Vuelta atrás y nueva aplicación ─────────────────────────────────────
await comoServidor();
await q("insert into public.admin_feature_toggles (section_key, label, enabled) values ('web', 'Web', false)");
await q("update public.user_roles set seccion_inicio = 'web' where user_id = $1", [FOTOS]);
await q(`insert into public.user_role_presets (name, base_role, permissions) values ('Web', 'staff',
  '[{"section_key":"web_fotos","can_view":true,"can_edit":true},{"section_key":"dashboard","can_view":true,"can_edit":false}]')`);
// Supabase no deja borrar ficheros con SQL: la vuelta atrás solo borra el bucket vacío.
await db.exec(adaptar(ROLLBACK));
ok(await cuenta("select count(*)::int n from storage.buckets where id = 'web-fotos'") === 1, "con ficheros, el bucket se queda (se vacía desde Storage)");
await q("delete from storage.objects where bucket_id = 'web-fotos'");
await aplicar();
await db.exec(adaptar(ROLLBACK));
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows, [], "la vuelta atrás quita todas sus tablas");
igual(await cuenta(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.proname in ('web_marcar_actualizado', 'web_marcar_autor', 'web_fotos_quitar_portada', 'presupuesto_asignar_numero', 'presupuesto_calcular_totales',
                    'presupuesto_lineas_recalcular', 'web_nombre_categoria', 'web_euros', 'web_solicitud_presupuesto_registrar')`), 0, "y sus funciones");
igual(await cuenta("select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'web_fotos%'"), 0, "y las políticas del bucket");
igual(await cuenta("select count(*)::int n from storage.buckets where id = 'web-fotos'"), 0, "y el bucket vacío");
igual((await uno("select public.seccion_aviso('presupuesto_solicitud') a, public.seccion_aviso('subida_precio') b")), { a: "dashboard", b: "facturas" },
  "los avisos vuelven a los de Facturas");
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo like 'presupuesto%'"), 0, "sin sus avisos");
igual(await cuenta("select count(*)::int n from pg_policies where tablename = 'notificaciones_dashboard' and policyname like '%presupuestos%'"), 0, "ni su política");
igual(await cuenta("select count(*)::int n from public.user_permissions where section_key = any($1)", [SECCIONES]), 0, "ni los permisos de sus secciones");
igual((await uno("select permissions from public.user_role_presets where name = 'Web'")).permissions, [{ section_key: "dashboard", can_view: true, can_edit: false }],
  "ni en los roles preconfigurados");
igual((await uno("select seccion_inicio s from public.user_roles where user_id = $1", [FOTOS])).s, null, "ni como sección de inicio");
igual(await cuenta("select count(*)::int n from public.admin_feature_toggles where section_key = 'web'"), 0, "ni su interruptor");
ok(await cuenta("select count(*)::int n from public.facturas") >= 0 && await cuenta("select count(*)::int n from public.user_permissions") >= 1, "Facturas y el núcleo siguen");
await aplicar();
igual((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows.length, TABLAS.length, "se vuelve a aplicar");
igual(await cuenta("select count(*)::int n from public.web_contenido"), 4, "con sus datos de partida");

console.log(`test-web-presupuestos: ${comprobaciones} comprobaciones correctas.`);
