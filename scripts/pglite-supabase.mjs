// Supabase mínimo en PGlite para las pruebas de esquema (scripts/test-*.mjs): roles, auth, storage, cron, net y
// vault simulados, y la adaptación de las migraciones a lo que PGlite no tiene. Nunca toca Supabase.
// Supabase mínimo: lo que la migración da por hecho que existe.
export const BASE = `
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
export function adaptar(sql) {
  return sql
    .replace(/^create extension if not exists (pg_cron|pg_net|supabase_vault)[^;]*;$/gim, "")
    .replace(/^create schema if not exists vault;$/gim, "")
    .replace(/^DROP EVENT TRIGGER[^;]*;$/gim, "")
    .replace(/^CREATE EVENT TRIGGER[\s\S]*?EXECUTE FUNCTION public\.fn_audit_nueva_tabla\(\);$/gim, "")
    .replace(/exists \(select 1 from (?:pg_catalog\.)?pg_extension where extname = '(?:pg_cron|pg_net|supabase_vault)'\)/gi, "true");
}
