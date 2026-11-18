// Esquema del núcleo (supabase/migrations/20261118120000_nucleo_panel.sql) y su vuelta atrás contra un
// Postgres en memoria (PGlite). Nunca toca Supabase.
//
//   npm run test:nucleo:db
//
// Cubre: la migración se aplica entera sobre un Supabase mínimo (roles, auth, storage, cron, net y vault
// simulados); RLS de usuarios y permisos (cada uno ve lo suyo, el super admin todo); Control del Panel solo
// lo cambia el super admin; una petición urgente avisa SOLO al super admin; marcar avisos revisados; tope de
// IA en servicios_config; informes y métricas del Super Admin; la auditoría registra los cambios; sin rastro
// de tablas de restaurante; y la vuelta atrás lo deja todo vacío y se puede volver a aplicar.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const MIGRACION = await readFile("supabase/migrations/20261118120000_nucleo_panel.sql", "utf8");
const ROLLBACK = await readFile("supabase/rollbacks/20261118120000_nucleo_panel_ROLLBACK.sql", "utf8");

let comprobaciones = 0;
const ok = (v, msg) => { assert.ok(v, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepEqual(a, b, msg); comprobaciones++; };
const falla = async (p, re, msg) => { await assert.rejects(p, re, msg); comprobaciones++; };

// Supabase mínimo: lo que la migración da por hecho que existe.
const BASE = `
  create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
  create role supabase_auth_admin nologin;
  create schema auth; create schema storage; create schema extensions; create schema cron; create schema net;
  create table auth.users (id uuid primary key, email text, banned_until timestamptz, last_sign_in_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
  create table auth.sessions (id uuid primary key, user_id uuid, updated_at timestamptz default now());
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create table cron.job_run_details (jobid bigint, status text, start_time timestamptz, end_time timestamptz, return_message text);
  create function cron.schedule(p_nombre text, p_cuando text, p_orden text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (p_nombre, p_cuando, p_orden)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  create function cron.unschedule(p_nombre text) returns boolean language sql as $$ with b as (delete from cron.job where jobname = p_nombre returning 1) select exists (select 1 from b) $$;
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create publication supabase_realtime;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** La migración tal cual, salvo lo que PGlite no tiene: las extensiones de Supabase y el event trigger. */
function adaptar(sql) {
  return sql
    .replace(/^create extension if not exists (pg_cron|pg_net|supabase_vault)[^;]*;$/gim, "")
    .replace(/^create schema if not exists vault;$/gim, "")
    .replace(/^DROP EVENT TRIGGER[^;]*;$/gim, "")
    .replace(/^CREATE EVENT TRIGGER[\s\S]*?EXECUTE FUNCTION public\.fn_audit_nueva_tabla\(\);$/gim, "")
    .replace(/exists \(select 1 from (?:pg_catalog\.)?pg_extension where extname = '(?:pg_cron|pg_net|supabase_vault)'\)/gi, "true");
}

const db = await PGlite.create({ extensions: { pg_trgm } });
const q = (sql, params) => db.query(sql, params);
const uno = async (sql, params) => (await q(sql, params)).rows[0];
await db.exec(BASE);

const SA = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const comoUsuario = async (id, sesion) => {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: "authenticated", session_id: sesion })]);
  await db.exec("set role authenticated");
};
const comoServidor = async () => { await db.exec("reset role"); await q("select set_config('request.jwt.claims', '', false)"); };

async function aplicar() {
  await db.exec(adaptar(MIGRACION));
}

// ─── 1. Se aplica entera ────────────────────────────────────────────────────
await aplicar();
const tablas = (await q("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
ok(tablas.length >= 30, `faltan tablas: ${tablas.length}`);
for (const t of ["user_roles", "user_permissions", "super_admins", "admin_feature_toggles", "audit_log", "notificaciones_dashboard", "peticiones", "servicios_contratados", "ia_uso", "oficiososia_facturas", "avisos_telegram_config", "web_logs_config"]) {
  ok(tablas.includes(t), `falta la tabla ${t}`);
}
const RESTAURANTE = /reserva|platos|vinos|bebidas|cocteles|carta|cheques|tienda|facturas$|albaran|escandallo|mesas|espacios|instagram|newsletter|resenas|tapas|menus_diarios|trabajadores/i;
igual(tablas.filter((t) => RESTAURANTE.test(t) && !t.startsWith("oficiososia_")), [], "no queda ninguna tabla de restaurante");
const crons = (await q("select jobname from cron.job order by 1")).rows.map((r) => r.jobname);
igual(crons, ["avisos-telegram-fallos", "avisos-telegram-pendientes", "avisos-telegram-resumen", "avisos-telegram-vigilante", "ia-modelos-openai", "ia-uso-retencion", "sincronizar-costes-openai"], "tareas programadas del núcleo");

// ─── 2. Usuarios, permisos y super admin ────────────────────────────────────
await comoServidor();
await db.exec(`
  insert into auth.users (id, email) values ('${SA}', 'sa@cristaleria.test'), ('${STAFF}', 'staff@staff.local');
  insert into auth.sessions (id, user_id) values ('aaaaaaaa-1111-4111-8111-111111111111', '${SA}'), ('bbbbbbbb-2222-4222-8222-222222222222', '${STAFF}');
  insert into public.super_admins (user_id, email) values ('${SA}', 'sa@cristaleria.test');
  insert into public.user_roles (user_id, role) values ('${STAFF}', 'staff');
  insert into public.user_permissions (user_id, section_key, can_view, can_edit) values ('${STAFF}', 'dashboard', true, false);
`);
await comoUsuario(STAFF, "bbbbbbbb-2222-4222-8222-222222222222");
igual((await uno("select count(*)::int n from public.user_roles")).n, 1, "el staff ve su rol");
igual((await uno("select count(*)::int n from public.user_permissions")).n, 1, "el staff ve sus permisos");
igual((await uno("select public.is_super_admin(auth.uid()) s")).s, false, "el staff no es super admin");
igual((await uno("select public.can_read_section('dashboard') s")).s, true, "permiso de ver el Dashboard");
igual((await uno("select public.can_read_section('usuarios') s")).s, false, "sin permiso de Usuarios");
await falla(q("insert into public.user_permissions (user_id, section_key, can_view, can_edit) values ($1, 'usuarios', true, true)", [STAFF]), /row-level security|permission denied/i, "el staff no se da permisos");
await falla(q("insert into public.admin_feature_toggles (section_key, label, enabled) values ('usuarios', 'Usuarios', false)"), /row-level security|permission denied/i, "el staff no toca Control del Panel");

// ─── 3. Peticiones y aviso urgente ──────────────────────────────────────────
await q("insert into public.peticiones (titulo, prioridad, modulo, descripcion) values ('No puedo cambiar la contraseña', 'urgente', 'cuenta', 'Al pulsar guardar no pasa nada en la tablet.')");
igual((await uno("select count(*)::int n from public.peticiones")).n, 1, "el staff ve su petición");
igual((await uno("select count(*)::int n from public.notificaciones_dashboard")).n, 0, "el aviso urgente no lo ve el staff");
await q("update public.peticiones set estado = 'hecha'").catch(() => null);
await comoServidor();
igual((await uno("select estado from public.peticiones")).estado, "nueva", "el staff no cambia el estado");

await comoUsuario(SA, "aaaaaaaa-1111-4111-8111-111111111111");
igual((await uno("select count(*)::int n from public.peticiones")).n, 1, "el super admin ve las peticiones");
const aviso = await uno("select tipo, referencia_tipo from public.notificaciones_dashboard");
igual(aviso, { tipo: "peticion_urgente", referencia_tipo: "peticion" }, "aviso urgente para el super admin");
igual((await uno("select public.marcar_avisos_revisados(null, null) n")).n, 1, "marca el aviso como revisado");

// ─── 4. Super Admin: Control del Panel, costes, informes ────────────────────
await q("insert into public.admin_feature_toggles (section_key, label, enabled) values ('peticiones', 'Nueva petición', false)");
igual((await uno("select enabled from public.admin_feature_toggles where section_key = 'peticiones'")).enabled, false, "el super admin apaga un módulo");
igual(Number((await uno("select public.fijar_tope_ia_mes(12) t")).t), 12, "tope de IA");
igual(Number((await uno("select tope_ia_mes_eur t from public.servicios_config")).t), 12, "el tope vive en servicios_config");
igual((await uno("select jsonb_typeof(public.informe_auditoria_mensual(to_char(now(), 'YYYY-MM'))) t")).t, "object", "informe de auditoría");
igual((await uno("select jsonb_typeof(public.ia_modelos_centro(30)) t")).t, "object", "centro de modelos de IA");
ok((await uno("select count(*)::int n from public.servicios_resumen_mes(date_trunc('month', now())::date)")).n >= 1, "resumen de servicios del mes");
igual((await uno("select jsonb_typeof(public.oficiososia_facturacion_leer()) t")).t, "object", "Gestor Gasto");
await comoUsuario(STAFF, "bbbbbbbb-2222-4222-8222-222222222222");
await falla(q("select public.fijar_tope_ia_mes(20)"), /solo super admin/i, "el staff no cambia el tope");
await falla(q("select public.oficiososia_facturacion_leer()"), /superadmin/i, "el staff no lee el Gestor Gasto");

// ─── 5. Auditoría ───────────────────────────────────────────────────────────
await comoServidor();
ok((await uno("select count(*)::int n from public.audit_log")).n > 0, "la auditoría registra los cambios");
ok((await uno("select count(*)::int n from public.audit_log where tabla = 'user_permissions'")).n >= 1, "cambio de permisos auditado");
igual((await uno("select count(*)::int n from public.audit_log_visible")).n, (await uno("select count(*)::int n from public.audit_log where public.audit_tabla_util(tabla)")).n, "la vista enseña lo útil");

// ─── 6. Vuelta atrás y nueva aplicación ─────────────────────────────────────
await db.exec(adaptar(ROLLBACK).replace(/^drop event trigger[^;]*;$/gim, ""));
igual((await uno("select count(*)::int n from pg_tables where schemaname = 'public'")).n, 0, "la vuelta atrás deja public vacío");
igual((await uno("select count(*)::int n from cron.job")).n, 0, "y sin tareas programadas");
await aplicar();
ok((await uno("select count(*)::int n from pg_tables where schemaname = 'public'")).n >= 30, "se vuelve a aplicar");

console.log(`test-nucleo: ${comprobaciones} comprobaciones correctas.`);
