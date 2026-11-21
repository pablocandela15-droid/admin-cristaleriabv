// Esquema de Facturas (supabase/migrations/20261121100000_facturas.sql) y su vuelta atrás, encima del núcleo, contra
// un Postgres en memoria (PGlite). Nunca toca Supabase. Va dentro de `npm run test:nucleo:db`.
//
// Cubre: se aplica entera sobre el núcleo; todas sus tablas con RLS y la barrera de sesión bloqueada; las tareas
// programadas; lo que guarda el OCR (service role) asigna proveedor, catálogo y avisa de subidas de precio; quien
// tiene «Ver» lee pero no cambia, quien tiene «Editar» cambia, quien no tiene Facturas no ve nada; «Facturas ·
// Subida» ve y corrige SOLO lo suyo (y no verifica); el bucket de originales; el CIF de la empresa nunca es
// proveedor; la vuelta atrás lo quita todo (y el núcleo sigue) y se puede volver a aplicar.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { BASE, adaptar } from "./pglite-supabase.mjs";

const NUCLEO = await readFile("supabase/migrations/20261118120000_nucleo_panel.sql", "utf8");
const MIGRACION = await readFile("supabase/migrations/20261121100000_facturas.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261121100000_facturas_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

const db = await PGlite.create({ extensions: { pg_trgm, unaccent } });
const q = (sql, params) => db.query(sql, params);
const uno = async (sql, params) => (await q(sql, params)).rows[0];
const cuenta = async (sql, params) => (await uno(sql, params)).n;
await db.exec(BASE);
// Como en Supabase: el panel tiene privilegios sobre storage.objects y la RLS decide.
await db.exec("grant select, insert on storage.objects to authenticated");
await db.exec(adaptar(NUCLEO));

const TABLAS = ["configuracion_facturas", "proveedores", "proveedores_alias", "categorias_producto", "productos_catalogo",
  "productos_alias", "ocr_trabajos", "facturas", "productos_factura", "ocr_trabajo_paginas", "facturas_sustituciones",
  "avisos_subida_precio"];
const CRONS = ["clasificar-productos", "limpiar-pendientes-ocr", "reanudar-trabajos-ocr"];

const SA = "11111111-1111-4111-8111-111111111111";
const VER = "33333333-3333-4333-8333-333333333333";
const EDITA = "44444444-4444-4444-8444-444444444444";
const SUBE = "55555555-5555-4555-8555-555555555555";
const NADA = "66666666-6666-4666-8666-666666666666";
const sesion = (id) => id.replace(/^./, "a");

const comoUsuario = async (id) => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: "authenticated", session_id: sesion(id) })]);
  await q("select set_config('request.headers', '{}', false)");
  await db.exec("set role authenticated");
};
// El OCR escribe con el service role y su origen (lo exige la auditoría del núcleo).
const comoOcr = async () => {
  await db.exec("reset role");
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await q(`select set_config('request.headers', '{"x-audit-source":"procesar-factura"}', false)`);
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
  // En Supabase el disparador de eventos del núcleo pone la auditoría en cada tabla nueva; PGlite no tiene eventos.
  await q("select public.instalar_auditoria_panel()");
}

// ─── 1. Se aplica entera encima del núcleo ──────────────────────────────────
await aplicar();
const tablas = (await q("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
for (const t of TABLAS) ok(tablas.includes(t), `falta la tabla ${t}`);
igual(
  (await q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) and not relrowsecurity", [TABLAS])).rows,
  [], "todas las tablas de Facturas con RLS");
igual(await cuenta("select count(*)::int n from pg_policies where schemaname = 'public' and tablename = any($1) and policyname = 'acceso_panel_no_bloqueado' and permissive = 'RESTRICTIVE'", [TABLAS]),
  TABLAS.length, "y con la barrera de sesión bloqueada");
const crons = (await q("select jobname from cron.job where jobname = any($1) order by 1", [CRONS])).rows.map((r) => r.jobname);
igual(crons, CRONS, "tareas programadas de Facturas");
igual((await uno("select public, file_size_limit::int l from storage.buckets where id = 'facturas-originales'")), { public: false, l: 20971520 }, "bucket privado de originales");
ok(await cuenta("select count(*)::int n from public.categorias_producto where clave like 'vidrio%'") >= 5, "categorías de cristalería");
igual((await q("select funcion from public.ia_funciones where funcion in ('procesar-factura', 'ocr-trabajo', 'clasificar-productos') order by 1")).rows.map((r) => r.funcion),
  ["clasificar-productos", "ocr-trabajo", "procesar-factura"], "funciones de IA del módulo");
igual((await uno("select public.normalizar_unidad_factura('M2 ') u, public.normalizar_unidad_factura('Uds.') v")), { u: "m2", v: "ud" }, "unidades de cristalería");

// ─── 2. Usuarios y permisos ─────────────────────────────────────────────────
await comoServidor();
await db.exec(`
  insert into auth.users (id, email) values ('${SA}', 'sa@cristaleria.test'), ('${VER}', 'ver@staff.local'),
    ('${EDITA}', 'edita@staff.local'), ('${SUBE}', 'sube@staff.local'), ('${NADA}', 'nada@staff.local');
  insert into auth.sessions (id, user_id) values ('${sesion(SA)}', '${SA}'), ('${sesion(VER)}', '${VER}'),
    ('${sesion(EDITA)}', '${EDITA}'), ('${sesion(SUBE)}', '${SUBE}'), ('${sesion(NADA)}', '${NADA}');
  insert into public.super_admins (user_id, email) values ('${SA}', 'sa@cristaleria.test');
  insert into public.user_roles (user_id, role) values ('${VER}', 'staff'), ('${EDITA}', 'manager'), ('${SUBE}', 'staff'), ('${NADA}', 'staff');
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
    ('${VER}', 'facturas', true, false), ('${EDITA}', 'facturas', true, true),
    ('${SUBE}', 'facturas_subida', true, false), ('${NADA}', 'dashboard', true, false);
`);

// ─── 3. Lo que guarda el OCR ────────────────────────────────────────────────
await comoOcr();
const f1 = (await uno(`insert into public.facturas (proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen)
  values ('Vidrios del Vinalopó, S.L.', 'B12345674', 'F-2026/001', '2026-10-01', 100, 21, 121, 'leido') returning id, proveedor_id`));
ok(f1.proveedor_id != null, "el OCR crea el proveedor solo");
await q(`insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values ($1, 'Vidrio templado 8 mm incoloro', 2, 'M2', 50, 100), ($1, 'Portes', 1, 'ud', 0, 0)`, [f1.id]);
const clasif = await uno(`select public.productos_aplicar_clasificacion_ia('[{"textos":["vidrio templado 8 mm incoloro"],"nombre":"Vidrio templado 8 mm","unidad":"m2"}]'::jsonb) r`);
igual(clasif.r.lineas_asignadas, 1, "la clasificación crea el producto y asigna la línea");
const f2 = (await uno(`insert into public.facturas (proveedor, cif, numero_documento, fecha, subtotal, iva, total, total_origen, subido_por)
  values ('VIDRIOS DEL VINALOPO SL', 'B12345674', 'F-2026/002', '2026-10-20', 120, 25.2, 145.2, 'leido', $1) returning id, proveedor_id`, [SUBE]));
igual(f2.proveedor_id, f1.proveedor_id, "el mismo proveedor escrito de otra forma");
await q(`insert into public.productos_factura (factura_id, nombre, cantidad, unidad, precio_unitario, total)
  values ($1, 'Vidrio templado 8 mm incoloro', 2, 'm2', 60, 120)`, [f2.id]);
igual(Number((await uno("select variacion_pct v from public.avisos_subida_precio where factura_id = $1", [f2.id])).v), 20, "aviso de subida de precio (+20 %)");
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'subida_precio'"), 1, "una notificación en la campana");
const resumen = await uno("select public.ocr_factura_existente('F2026001', 'Vidrios del Vinalopo', null, '2026-10-01', 121) r");
igual(resumen.r.id, f1.id, "reconoce el duplicado por número y proveedor");
ok(await cuenta("select count(*)::int n from public.audit_log where tabla in ('facturas', 'productos_factura', 'proveedores')") > 0, "auditado");
await q("update public.configuracion_facturas set cif_empresa = 'B-99999999'");
igual((await uno("select public.proveedor_resolver('Cristalería Baix Vinalopó, S.L.', null, true) p")).p, null, "el nombre de la empresa no es un proveedor");
igual((await uno("select public.proveedor_resolver('Aluminios Elda', 'B99999999', true) is not null p, (select cif from public.proveedores where nombre = 'Aluminios Elda') c")), { p: true, c: null },
  "su CIF tampoco (el proveedor se crea sin él)");

// ─── 4. Sin Facturas: nada ──────────────────────────────────────────────────
await comoUsuario(NADA);
igual(await cuenta("select count(*)::int n from public.facturas"), 0, "sin Facturas no ve facturas");
igual(await cuenta("select count(*)::int n from public.proveedores"), 0, "ni proveedores");
igual((await uno("select json_array_length(public.documentos_lista()->'docs') n")).n, 0, "ni la lista de Compras");
igual(await cuenta("select count(*)::int n from public.productos_con_subida()"), 0, "ni las subidas de precio");
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'subida_precio'"), 0, "ni sus avisos");
await falla(q("insert into public.facturas (numero_documento, fecha) values ('X-1', '2026-11-01')"), /row-level security|permission denied/i, "no crea facturas");
await falla(q("select public.productos_renombrar(1, 'Otro')"), /edición en Facturas/i, "no toca el catálogo");
await falla(q(`insert into storage.objects (bucket_id, name) values ('facturas-originales', 'pendientes/${NADA}/t/1.jpg')`), /row-level security|permission denied/i, "no sube originales");

// ─── 5. «Ver»: lee, no cambia ───────────────────────────────────────────────
await comoUsuario(VER);
igual(await cuenta("select count(*)::int n from public.facturas"), 2, "con «Ver» lee las facturas");
igual((await uno("select json_array_length(public.documentos_lista()->'docs') n")).n, 2, "y la lista de Compras");
igual((await uno("select (public.documento_compras($1)->'productos'->0->>'producto_canonico') p", [f1.id])).p, "Vidrio templado 8 mm", "y la ficha con su producto");
igual(await cuenta("select count(*)::int n from public.notificaciones_dashboard where tipo = 'subida_precio'"), 1, "y los avisos de Facturas");
igual((await q("select nombre, unidad from public.productos_con_subida()")).rows, [{ nombre: "Vidrio templado 8 mm", unidad: "m2" }], "y qué productos subieron de precio");
igual((await uno("select (f->>'docs')::int d, f->'top_productos'->0->>'producto' p from public.ficha_proveedor($1) f", [f1.proveedor_id])), { d: 2, p: "Vidrio templado 8 mm" },
  "y la ficha del proveedor");
await q("update public.facturas set observaciones = 'cambio' where id = $1", [f1.id]);
igual((await uno("select observaciones from public.facturas where id = $1", [f1.id])).observaciones, null, "pero no cambia nada");
await falla(q("select public.proveedores_editar($1, 'Otro nombre')", [f1.proveedor_id]), /edición en Facturas/i, "ni los proveedores");
await falla(q(`insert into storage.objects (bucket_id, name) values ('facturas-originales', 'pendientes/${VER}/t/1.jpg')`), /row-level security|permission denied/i, "ni sube (eso es «Subida»)");

// ─── 6. «Editar»: todo ──────────────────────────────────────────────────────
await comoUsuario(EDITA);
await q("update public.facturas set verificada = true where id = $1", [f1.id]);
igual((await uno("select verificada, verificacion_origen o from public.facturas where id = $1", [f1.id])), { verificada: true, o: "manual" }, "con «Editar» verifica");
const portes = (await uno("select id from public.productos_factura where nombre = 'Portes'")).id;
igual((await uno("select (public.productos_asignar_lineas(array[$1]::bigint[], null, 'Portes', null)->>'creado')::boolean c", [portes])).c, true, "clasifica a mano");
igual((await uno("select public.proveedores_editar($1, 'Vidrios del Vinalopó, S.L.', 'Vinalopó Vidrio')->>'nombre_comercial' n", [f1.proveedor_id])).n, "Vinalopó Vidrio", "edita proveedores");
await falla(q("select public.proveedores_editar($1, 'Cristalería Baix Vinalopó')", [f1.proveedor_id]), /propia Cristalería/i, "pero nunca con el nombre de la empresa");
ok(await cuenta(`insert into storage.objects (bucket_id, name) values ('facturas-originales', 'pendientes/${EDITA}/t/1.jpg') returning 1 as n`) === 1, "sube originales a su carpeta");

// ─── 7. «Facturas · Subida»: solo lo suyo ───────────────────────────────────
await comoUsuario(SUBE);
igual((await q("select id from public.facturas")).rows.map((r) => Number(r.id)), [Number(f2.id)], "con «Subida» ve solo lo que subió");
await q("update public.facturas set numero_documento = 'F-2026/002B' where id = $1", [f2.id]);
igual((await uno("select numero_documento n from public.facturas where id = $1", [f2.id])).n, "F-2026/002B", "corrige lo leído de lo suyo");
await falla(q("update public.facturas set verificada = not coalesce(verificada, false) where id = $1", [f2.id]), /exige «Editar»/i, "pero no verifica ni quita la verificación");
await q("update public.facturas set observaciones = 'ajena' where id = $1", [f1.id]);
await comoServidor();
igual((await uno("select observaciones from public.facturas where id = $1", [f1.id])).observaciones, null, "ni toca lo de otros");
await comoUsuario(SUBE);
ok(await cuenta(`insert into storage.objects (bucket_id, name) values ('facturas-originales', 'pendientes/${SUBE}/t/1.jpg') returning 1 as n`) === 1, "sube a su carpeta de pendientes/");
await falla(q(`insert into storage.objects (bucket_id, name) values ('facturas-originales', 'pendientes/${EDITA}/t/2.jpg')`), /row-level security|permission denied/i, "pero no a la de otro");
igual(await cuenta("select count(*)::int n from storage.objects where bucket_id = 'facturas-originales'"), 1, "y solo lee sus ficheros");

// ─── 8. Vuelta atrás y nueva aplicación ─────────────────────────────────────
await comoServidor();
await db.exec(adaptar(ROLLBACK));
const quedan = (await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows;
igual(quedan, [], "la vuelta atrás quita todas las tablas de Facturas");
igual(await cuenta("select count(*)::int n from cron.job where jobname = any($1)", [CRONS]), 0, "y sus tareas programadas");
igual(await cuenta("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('documentos_lista', 'ocr_despachar', 'proveedor_resolver', 'normalizar_texto')"), 0, "y sus funciones");
igual(await cuenta("select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'facturas_originales%'"), 0, "y las políticas del bucket");
igual((await uno("select public.seccion_aviso('subida_precio') s")).s, "dashboard", "los avisos vuelven a ser del núcleo");
igual(await cuenta("select count(*)::int n from public.ia_funciones where funcion = 'procesar-factura'"), 0, "sin sus funciones de IA");
ok(await cuenta("select count(*)::int n from public.user_permissions") >= 4, "el núcleo sigue intacto");
await aplicar();
ok((await q("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [TABLAS])).rows.length === TABLAS.length, "se vuelve a aplicar");

console.log(`test-facturas: ${comprobaciones} comprobaciones correctas.`);
