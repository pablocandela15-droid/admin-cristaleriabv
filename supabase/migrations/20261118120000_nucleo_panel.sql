-- ============================================================================
--  Panel de Cristalería BV · esquema inicial del núcleo (18/11/2026)
-- ----------------------------------------------------------------------------
--  Sale del panel de administración de referencia (el mismo login, Admin Panel
--  y Super Admin), sin nada de restaurante. Reúne en una sola migración la
--  versión FINAL de las tablas, funciones, políticas RLS, disparadores y tareas
--  programadas del núcleo:
--    · usuarios, roles y permisos por sección (user_roles, user_permissions,
--      user_role_presets, super_admins, user_access_status) y su RLS;
--    · Control del Panel (admin_feature_toggles);
--    · auditoría completa (audit_log, audit_log_visible, audit_auth_context,
--      registrar_acceso_panel, panel-auth, revertir cambios, informe mensual);
--    · avisos (notificaciones_dashboard) y su envío por Telegram;
--    · peticiones de los usuarios y tickets con análisis de IA (y Linear);
--    · servicios contratados, su consumo y los costes de IA (ia_*, openai_*);
--    · el Gestor Gasto de OficiosOsIA (oficiososia_*);
--    · fallos internos para desarrolladores.
--
--  Es una REPRODUCCIÓN EN ORDEN de las migraciones originales del núcleo: cada
--  bloque lleva entre corchetes el nombre de la migración de la que sale (con
--  sus comentarios de entonces) y cada función va en su versión FINAL. Los
--  marcados [override] se han adaptado (sin tablas de restaurante). Algunas
--  semillas antiguas se insertan y se quitan al final («Datos de partida»),
--  así que el estado que queda es solo el del núcleo.
--  Se aplica en la demo primero; ver docs/PROCESO-DE-CAMBIOS.md.
--
--  Después de aplicarla, para el primer super admin (con su usuario ya creado
--  en Authentication):
--    insert into public.super_admins (user_id, email)
--      select id, email from auth.users where email = '<email>';
--  Y en Vault, para las tareas programadas: «project_url» y «ocr_trabajos_secret».
-- ============================================================================

-- ─── Extensiones, esquemas y tipos ─────────────────────────────────────────
create type public.app_role as enum ('admin', 'manager', 'staff');
create schema if not exists private;
grant usage on schema private to authenticated, service_role;
create extension if not exists pg_trgm with schema extensions;
create or replace function public.update_updated_at_column() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

set check_function_bodies = off;

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
-- Tabla de roles de usuario
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'staff',
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role)
);

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
-- Habilitar RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
-- Tabla de permisos granulares por sección
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  section_key text NOT NULL,
  can_view boolean DEFAULT false,
  can_edit boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, section_key)
);

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
-- Habilitar RLS
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql] public.is_admin(uuid)
-- Función SECURITY DEFINER para verificar si es admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- [20260926060716_admin_access_requires_permissions.sql] public.has_section_permission(uuid,text,text)
-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

-- Ser "admin" ya no da acceso automático a todas las secciones: ahora un
-- admin solo ve lo que le marquen sus permisos en user_permissions, igual
-- que un manager o un staff. El único acceso incondicional que queda es el
-- de super admin (tabla super_admins), consistente con SuperAdminRoute y con
-- la nueva función admin-set-super-admin.
CREATE OR REPLACE FUNCTION public.has_section_permission(_user_id uuid, _section text, _permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    CASE WHEN public.is_super_admin(_user_id) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id 
        AND section_key = _section
        AND (
          (_permission = 'view' AND can_view = true) OR
          (_permission = 'edit' AND can_edit = true)
        )
    )
    END
$function$;

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql] public.get_user_role(uuid)
-- Función para obtener rol de usuario
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
-- Políticas RLS para user_roles
CREATE POLICY "Admins pueden ver todos los roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Admins pueden crear roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Admins pueden actualizar roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Admins pueden eliminar roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Usuarios pueden ver su propio rol"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
-- Políticas RLS para user_permissions
CREATE POLICY "Admins pueden ver todos los permisos"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Admins pueden crear permisos"
ON public.user_permissions
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Admins pueden actualizar permisos"
ON public.user_permissions
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Admins pueden eliminar permisos"
ON public.user_permissions
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

-- [20251226144838_37d2fed1-a0fa-476f-9114-960058d5147a.sql]
CREATE POLICY "Usuarios pueden ver sus propios permisos"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- [20251226152642_f08f7810-b2e8-4a37-af3f-c43649888c1e.sql]
-- Eliminar el constraint actual UNIQUE(user_id, role)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

-- [20251226152642_f08f7810-b2e8-4a37-af3f-c43649888c1e.sql]
-- Añadir nuevo constraint UNIQUE(user_id) para un solo rol por usuario
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- [20260306120000_user_role_presets.sql]
-- Plantillas de roles para preconfigurar permisos reutilizables
CREATE TABLE IF NOT EXISTS public.user_role_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  base_role public.app_role NOT NULL DEFAULT 'staff',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_role_presets_name_not_empty CHECK (char_length(trim(name)) > 0),
  CONSTRAINT user_role_presets_permissions_is_array CHECK (jsonb_typeof(permissions) = 'array'),
  CONSTRAINT user_role_presets_base_role_check CHECK (
    base_role IN ('manager'::public.app_role, 'staff'::public.app_role)
  )
);

-- [20260306120000_user_role_presets.sql]
ALTER TABLE public.user_role_presets ENABLE ROW LEVEL SECURITY;

-- [20260306120000_user_role_presets.sql]
DROP POLICY IF EXISTS "Admins can view role presets" ON public.user_role_presets;

-- [20260306120000_user_role_presets.sql]
CREATE POLICY "Admins can view role presets"
ON public.user_role_presets
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- [20260306120000_user_role_presets.sql]
DROP POLICY IF EXISTS "Admins can create role presets" ON public.user_role_presets;

-- [20260306120000_user_role_presets.sql]
CREATE POLICY "Admins can create role presets"
ON public.user_role_presets
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

-- [20260306120000_user_role_presets.sql]
DROP POLICY IF EXISTS "Admins can update role presets" ON public.user_role_presets;

-- [20260306120000_user_role_presets.sql]
CREATE POLICY "Admins can update role presets"
ON public.user_role_presets
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- [20260306120000_user_role_presets.sql]
DROP POLICY IF EXISTS "Admins can delete role presets" ON public.user_role_presets;

-- [20260306120000_user_role_presets.sql]
CREATE POLICY "Admins can delete role presets"
ON public.user_role_presets
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

-- [20260306120000_user_role_presets.sql] public.set_user_role_presets_updated_at()
CREATE OR REPLACE FUNCTION public.set_user_role_presets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- [20260306120000_user_role_presets.sql]
DROP TRIGGER IF EXISTS trg_user_role_presets_updated_at ON public.user_role_presets;

-- [20260306120000_user_role_presets.sql]
CREATE TRIGGER trg_user_role_presets_updated_at
BEFORE UPDATE ON public.user_role_presets
FOR EACH ROW
EXECUTE FUNCTION public.set_user_role_presets_updated_at();

-- [20260313000000_solicitudes_y_notificaciones.sql]
-- ============================================================
-- NOTIFICACIONES DEL DASHBOARD
-- Notificaciones internas para que el negocio vea alertas
-- desde el panel de administración.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notificaciones_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  -- Valores: 'solicitud_pendiente', 'reserva_nueva', 'sistema'
  titulo TEXT NOT NULL,
  mensaje TEXT,
  referencia_id UUID,
  -- ID de la solicitud o reserva relacionada
  referencia_tipo TEXT,
  -- 'solicitud' | 'reserva'
  leida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- [20260313000000_solicitudes_y_notificaciones.sql]
-- Índices
CREATE INDEX IF NOT EXISTS idx_notificaciones_leida ON public.notificaciones_dashboard(leida) WHERE leida = false;

-- [20260313000000_solicitudes_y_notificaciones.sql]
CREATE INDEX IF NOT EXISTS idx_notificaciones_created ON public.notificaciones_dashboard(created_at DESC);

-- [20260313000000_solicitudes_y_notificaciones.sql]
-- RLS
ALTER TABLE public.notificaciones_dashboard ENABLE ROW LEVEL SECURITY;

-- [20260313000000_solicitudes_y_notificaciones.sql]
CREATE POLICY "Authenticated users can view notificaciones"
  ON public.notificaciones_dashboard FOR SELECT
  TO authenticated USING (true);

-- [20260313000000_solicitudes_y_notificaciones.sql]
CREATE POLICY "Authenticated users can update notificaciones"
  ON public.notificaciones_dashboard FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- [20260313000000_solicitudes_y_notificaciones.sql]
CREATE POLICY "Authenticated users can insert notificaciones"
  ON public.notificaciones_dashboard FOR INSERT
  TO authenticated WITH CHECK (true);

-- [20260313000000_solicitudes_y_notificaciones.sql]
CREATE POLICY "Service role can insert notificaciones"
  ON public.notificaciones_dashboard FOR INSERT
  TO service_role WITH CHECK (true);

-- [20260313000000_solicitudes_y_notificaciones.sql]
CREATE POLICY "Service role can select notificaciones"
  ON public.notificaciones_dashboard FOR SELECT
  TO service_role USING (true);

-- [20260320062200_ba8830da-6d75-4575-824a-6c62f547b79a.sql]
-- Allow admin as base_role in presets
ALTER TABLE user_role_presets DROP CONSTRAINT user_role_presets_base_role_check;

-- [20260320062200_ba8830da-6d75-4575-824a-6c62f547b79a.sql]
ALTER TABLE user_role_presets ADD CONSTRAINT user_role_presets_base_role_check CHECK (base_role = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role]));

-- [20260320062200_ba8830da-6d75-4575-824a-6c62f547b79a.sql]
-- Fix the "Admin" preset to have correct base_role
UPDATE user_role_presets SET base_role = 'admin' WHERE name = 'Admin' AND base_role = 'staff';

-- [20260918084909_cerrar_fuga_rls_anonima.sql]
revoke select on public."notificaciones_dashboard" from anon;

-- [20260918120000_rls_por_permisos_de_seccion.sql] public.can_read_section(text)
-- ---------------------------------------------------------------------
-- BLOQUE 1 -- Las dos funciones de permiso que usaran las politicas.
--
-- Son envoltorios de has_section_permission() sin el parametro
-- _user_id, para que las politicas queden legibles y, sobre todo, para
-- tener UN UNICO punto donde cambiar la semantica de escritura.
--
-- Son STABLE y reciben un literal constante, asi que PostgreSQL las
-- evalua una vez por consulta (InitPlan), no una vez por fila.
-- `(select auth.uid())` fuerza ese mismo cacheo del uid.
-- ---------------------------------------------------------------------

-- Lectura: admin siempre; el resto necesita can_view en la seccion.
create or replace function public.can_read_section(_section text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_section_permission((select auth.uid()), _section, 'view')
$$;

-- [20260918120000_rls_por_permisos_de_seccion.sql]
comment on function public.can_read_section(text) is
  'RLS: true si el usuario actual puede VER esa seccion del panel. Admin siempre true.';

-- [20260918120000_rls_por_permisos_de_seccion.sql] public.can_write_section(text)
-- ---------------------------------------------------------------------
-- DECISION SOBRE can_edit  (punto 4 del encargo)
--
-- La escritura se ata a TENER LA SECCION (can_view), no a can_edit.
--
-- Motivo, medido en la BD de produccion:
--   - Las 26 filas de user_permissions reparten 13 secciones entre 2
--     usuarios, y TODAS tienen can_edit = false.
--   - El panel escribe `can_edit: false` A PELO en 16 sitios de 5
--     ficheros, asi que hoy es IMPOSIBLE conceder can_edit desde la UI:
--       src/hooks/useUserRolePresets.ts:26,45  (`normalizePermissions`)
--       src/hooks/useUsersManagement.ts:211,240,311
--       src/components/usuarios/ListaUsuarios.tsx:83,101,174
--       src/components/usuarios/InvitarUsuario.tsx:35,56,73
--       src/components/usuarios/ConfigurarRolesModal.tsx:46,109
--     Ademas `useCanAccessSection(section,'edit')` solo aparece en su
--     propia definicion y en los tests: ningun componente lo invoca.
--   - El unico usuario no-admin (`staff`, a14cbb89-...) tiene
--     can_view=true y can_edit=false en las 13 secciones.
--   => Atar la escritura a can_edit lo dejaria sin poder guardar NADA
--      en el instante de aplicar la migracion. Eso es una caida de
--      servicio, no una mejora de seguridad.
--
-- Por eso la separacion lectura/escritura se implementa de forma
-- ESTRUCTURAL (politicas separadas + funcion separada) aunque hoy las
-- dos funciones evaluen lo mismo. Cuando la UI deje de forzar
-- can_edit:false y los admin puedan concederlo de verdad, basta con
-- ejecutar el CREATE OR REPLACE que hay al final de este fichero: una
-- sola sentencia cambia a la vez el comportamiento de TODAS las
-- politicas de escritura de la base de datos.
-- ---------------------------------------------------------------------
create or replace function public.can_write_section(_section text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- 'view' A PROPOSITO. Ver el bloque de comentario de arriba.
  -- Para exigir can_edit: cambiar 'view' por 'edit' aqui, y nada mas.
  select public.has_section_permission((select auth.uid()), _section, 'view')
$$;

-- [20260918120000_rls_por_permisos_de_seccion.sql]
comment on function public.can_write_section(text) is
  'RLS: true si el usuario actual puede ESCRIBIR en esa seccion. Hoy exige can_view porque el panel escribe can_edit=false a pelo en 16 sitios de 5 ficheros; cambiar a edit cuando se corrija el frontend.';

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- Las politicas se evaluan con los privilegios del rol que consulta,
-- asi que `authenticated` necesita EXECUTE. A `anon` y a PUBLIC se les
-- retira: ninguna politica de este fichero aplica al rol anon.
revoke all on function public.can_read_section(text)  from public, anon;

-- [20260918120000_rls_por_permisos_de_seccion.sql]
revoke all on function public.can_write_section(text) from public, anon;

-- [20260918120000_rls_por_permisos_de_seccion.sql]
grant execute on function public.can_read_section(text)  to authenticated, service_role;

-- [20260918120000_rls_por_permisos_de_seccion.sql]
grant execute on function public.can_write_section(text) to authenticated, service_role;

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- =====================================================================
-- BLOQUE 3 -- SECCION `dashboard`  (1 tabla)
-- =====================================================================

-- --- notificaciones_dashboard : Campana del header: visible desde cualquier pagina del panel
--     politicas previas: 5
drop policy if exists "Authenticated users can insert notificaciones" on public."notificaciones_dashboard";

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- era INSERT TO authenticated
drop policy if exists "Authenticated users can update notificaciones" on public."notificaciones_dashboard";

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- era UPDATE TO authenticated
drop policy if exists "Authenticated users can view notificaciones" on public."notificaciones_dashboard";

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- era SELECT TO authenticated
drop policy if exists "Service role can insert notificaciones" on public."notificaciones_dashboard";

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- era INSERT TO service_role
drop policy if exists "Service role can select notificaciones" on public."notificaciones_dashboard";

-- [20260918120000_rls_por_permisos_de_seccion.sql]
-- era SELECT TO service_role
create policy "notificaciones_dashboard_select_seccion" on public."notificaciones_dashboard"
  for select to authenticated
  using (public.can_read_section('dashboard'));

-- [20260918120000_rls_por_permisos_de_seccion.sql]
create policy "notificaciones_dashboard_insert_seccion" on public."notificaciones_dashboard"
  for insert to authenticated
  with check (public.can_write_section('dashboard'));

-- [20260918120000_rls_por_permisos_de_seccion.sql]
create policy "notificaciones_dashboard_update_seccion" on public."notificaciones_dashboard"
  for update to authenticated
  using (public.can_write_section('dashboard'))
  with check (public.can_write_section('dashboard'));

-- [20260918120000_rls_por_permisos_de_seccion.sql]
create policy "notificaciones_dashboard_delete_seccion" on public."notificaciones_dashboard"
  for delete to authenticated
  using (public.can_write_section('dashboard'));

-- [20260918120000_rls_por_permisos_de_seccion.sql]
create policy "notificaciones_dashboard_service_role" on public."notificaciones_dashboard"
  for all to service_role using (true) with check (true);

-- [20260922200000_endurecer_funciones.sql]
-- ---------------------------------------------------------------------
-- BLOQUE 2 -- has_section_permission / get_user_role: apoyo a RLS que, tras
-- verificar pg_policies de los 3 esquemas + pg_proc.prosrc completo + las 6
-- Edge Functions que las llaman directo, no necesitan EXECUTE de
-- anon/authenticated hoy. Diverge de la nota de 20260918084909 (que las
-- metía junto a is_admin sin distinguir invocación directa de indirecta) --
-- ver "DIVERGENCIA" en la cabecera. is_admin, la tercera del mismo grupo
-- original, se deja intacta en BLOQUE 3: sí tiene un llamador directo que
-- la necesita.
-- ---------------------------------------------------------------------

-- Sin invocador directo: solo la llaman can_read_section/can_write_section,
-- ambas SECURITY DEFINER (privilegios de su dueño, no del rol que disparó
-- la política). Las 6 Edge Functions que la llaman por rpc() usan el
-- cliente service_role, no el que reenvía el JWT del usuario.
revoke all on function public.has_section_permission(_user_id uuid, _section text, _permission text) from public, anon, authenticated;

-- [20260922200000_endurecer_funciones.sql]
-- Sin invocador de ningún tipo hoy (ni política, ni función, ni RPC desde
-- ningún repo): el panel lee el rol con una consulta directa a user_roles,
-- no con esta RPC.
revoke all on function public.get_user_role(_user_id uuid) from public, anon, authenticated;

-- [20260922200000_endurecer_funciones.sql]
alter function public.set_user_role_presets_updated_at() set search_path = '';

-- [20260923120000_origen_prioridad_notificaciones.sql]
-- `origen`: NULLABLE a propósito (ver BACKFILL arriba) — solo las filas de
-- `tipo='email_fallido'` lo rellenan, con uno de los dos valores del CHECK.
alter table public.notificaciones_dashboard
  add column origen text;

-- [20260923120000_origen_prioridad_notificaciones.sql]
alter table public.notificaciones_dashboard
  add constraint notificaciones_dashboard_origen_valido
  check (origen is null or origen in ('reservas_web', 'emails_reserva'));

-- [20260923120000_origen_prioridad_notificaciones.sql]
-- `prioridad`: NOT NULL + DEFAULT 'normal' a nivel de BASE DE DATOS (no solo
-- en el código de las Edge Functions) para que cualquier INSERT que no la
-- mande —el trigger fn_notificar_solicitud, o cualquier camino futuro—
-- caiga siempre en 'normal', nunca en NULL. El ADD COLUMN backfillea las
-- filas existentes en la misma sentencia (comportamiento estándar de
-- PostgreSQL, no hace falta un UPDATE aparte).
alter table public.notificaciones_dashboard
  add column prioridad text not null default 'normal';

-- [20260923120000_origen_prioridad_notificaciones.sql]
alter table public.notificaciones_dashboard
  add constraint notificaciones_dashboard_prioridad_valida
  check (prioridad in ('alta', 'normal'));

-- [20260923120000_origen_prioridad_notificaciones.sql]
comment on column public.notificaciones_dashboard.origen is
  'Qué Edge Function generó el aviso (reservas_web | emails_reserva). NULL '
  'para filas que no sean tipo=email_fallido (no aplica) o para '
  'email_fallido insertado antes de esta migración (no se puede reconstruir '
  'con certeza). Ver supabase/functions/{reservas-web,emails-reserva} — '
  'margen anti-aluvión por carril (origen + prioridad).';

-- [20260923120000_origen_prioridad_notificaciones.sql]
comment on column public.notificaciones_dashboard.prioridad is
  'alta | normal, DEFAULT normal. Determina en qué carril de cooldown '
  'anti-aluvión cae un aviso de tipo email_fallido, para que uno de baja '
  'prioridad nunca tape a uno de alta. Ver '
  'reservas-web/plantillas.ts::prioridadAvisoEmailFallido y '
  'emails-reserva/reintentos.ts::prioridadEmailFallido.';

-- [20260923140000_webhook_resend_actua_sobre_eventos.sql]
-- Sin insert/update/delete para `authenticated` a propósito, mismo criterio
-- que envios_email_reserva: solo las Edge Functions (service_role) escriben
-- aquí.


-- ============================================================================
-- PIEZA 3 — Nuevo `origen` para los avisos de resend-webhook
-- ----------------------------------------------------------------------------
-- Mismo razonamiento que 20260923120000_origen_prioridad_notificaciones.sql
-- (que introdujo origen/prioridad para que reservas_web y emails_reserva no
-- se taparan avisos entre sí): resend-webhook es una TERCERA tubería
-- independiente que también escribe tipo='email_fallido'. Si usara
-- origen='emails_reserva' compartiría carril de cooldown con los avisos de
-- fallos de ENVÍO de emails-reserva (reintentos.ts) -- un aviso de
-- "propuesta fallida al enviar" podría tapar 30 minutos un "propuesta
-- rebotada tras enviarse", que es justo el tipo de aluvión cruzado que esa
-- migración ya corrigió una vez para otras dos tuberías. Se le da su propio
-- valor para que la protección sea real: (resend_webhook, alta) y
-- (resend_webhook, normal) quedan como dos carriles más, totalmente
-- independientes de los cuatro que ya existían.
--
-- Se busca la constraint por catálogo (no se asume su nombre) antes de
-- tocarla, mismo criterio defensivo que
-- 20260922160000_reintentos_emails_reserva.sql para envios_email_reserva_
-- resultado_check -- aunque en este caso el nombre SÍ se conoce y se ha
-- verificado hoy contra producción (notificaciones_dashboard_origen_valido,
-- CHECK ((origen IS NULL) OR (origen = ANY (ARRAY['reservas_web'::text,
-- 'emails_reserva'::text])))), se prefiere no asumirlo por si el orden real
-- de aplicación de migraciones en producción llega a diferir de este.
-- ============================================================================

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'notificaciones_dashboard'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%origen%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.notificaciones_dashboard drop constraint %I', v_constraint_name);
  end if;

  alter table public.notificaciones_dashboard
    add constraint notificaciones_dashboard_origen_valido
    check (origen is null or origen in ('reservas_web', 'emails_reserva', 'resend_webhook'));
end;
$$;

-- [20260924100000_super_admin_panel.sql]
-- ============================================================================
-- NO APLICADA — hay que ejecutarla manualmente contra Supabase
-- ============================================================================
--
-- Esta sesión no tiene ni debe usar credenciales de Supabase, así que esta
-- migración se entrega escrita pero SIN aplicar. Alguien con acceso al
-- proyecto debe correrla (supabase db push o el flujo habitual del repo)
-- antes de que el código del Super Admin (botón de engranaje en el sidebar,
-- /super-admin/*) funcione: hasta entonces, useSuperAdmin() y
-- useAdminFeatureToggles() fallan silenciosamente en modo "fail open" para
-- los toggles (todo visible) y "fail closed" para el acceso de super admin
-- (nadie entra), así que el resto del Admin Panel sigue funcionando igual.
--
-- Qué crea:
--   1. public.super_admins — quién puede entrar a /super-admin. Alta y baja
--      manuales por SQL (service role), sin autoservicio ni panel propio:
--      así un super admin no puede añadir a otro por error ni por un bug.
--   2. public.admin_feature_toggles — qué secciones del Admin Panel normal
--      están activas en el sidebar. Lectura para cualquier autenticado
--      (hace falta para pintar el sidebar), escritura solo para super admins.
--
-- No toca la estructura de user_roles/user_permissions ni ninguna política de
-- la Fase 2 de RLS (20260918120000_rls_por_permisos_de_seccion.sql): el
-- super admin es un nivel de acceso aparte, por encima de is_admin(), no un
-- reemplazo. Sí inserta una fila en user_roles (ver el INSERT al final): a
-- <email> se le da también rol 'admin' del Admin Panel
-- normal, no solo acceso a /super-admin.
-- ============================================================================

-- Tabla de super administradores (gestión manual vía SQL, no autoservicio)
CREATE TABLE public.super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- [20260924100000_super_admin_panel.sql]
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- [20260924100000_super_admin_panel.sql] public.is_super_admin(uuid)
-- Función SECURITY DEFINER para verificar si un usuario es super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins
    WHERE user_id = _user_id
  )
$$;

-- [20260924100000_super_admin_panel.sql]
-- Un super admin puede ver la lista completa de super admins
CREATE POLICY "Super admins pueden ver todos los super admins"
ON public.super_admins
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- [20260924100000_super_admin_panel.sql]
-- Cualquier usuario autenticado puede comprobar si su propia cuenta es super admin
CREATE POLICY "Usuario puede verificar su propio acceso de super admin"
ON public.super_admins
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- [20260924100000_super_admin_panel.sql]
-- No se exponen políticas de INSERT/UPDATE/DELETE: el alta/baja de super
-- admins se gestiona manualmente por SQL (service role) para máxima seguridad.

-- Tabla de funcionalidades activables/desactivables del Admin Panel
CREATE TABLE public.admin_feature_toggles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL UNIQUE,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- [20260924100000_super_admin_panel.sql]
ALTER TABLE public.admin_feature_toggles ENABLE ROW LEVEL SECURITY;

-- [20260924100000_super_admin_panel.sql]
-- Cualquier usuario autenticado necesita leer los toggles para pintar el sidebar
CREATE POLICY "Usuarios autenticados pueden leer las funcionalidades"
ON public.admin_feature_toggles
FOR SELECT
TO authenticated
USING (true);

-- [20260924100000_super_admin_panel.sql]
CREATE POLICY "Super admins pueden crear funcionalidades"
ON public.admin_feature_toggles
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

-- [20260924100000_super_admin_panel.sql]
CREATE POLICY "Super admins pueden actualizar funcionalidades"
ON public.admin_feature_toggles
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- [20260924100000_super_admin_panel.sql]
CREATE POLICY "Super admins pueden eliminar funcionalidades"
ON public.admin_feature_toggles
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- [20260924100000_super_admin_panel.sql]
-- Seed inicial: secciones que se pueden apagar desde Control del Panel
-- (dashboard queda fuera a propósito: nunca debe poder desactivarse; sin fila, activado)
INSERT INTO public.admin_feature_toggles (section_key, label, enabled) VALUES
  ('usuarios', 'Usuarios', true)
ON CONFLICT (section_key) DO NOTHING;

-- [20260925100000_espacios_al_super_admin.sql]
-- Espacios se une a Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google,
-- Plantillas Email y Tráfico web: pasa a gestionarse exclusivamente desde el
-- Super Admin y deja de ser una funcionalidad activable/desactivable del
-- Admin Panel normal (ya no tiene ruta ni permiso allí).
DELETE FROM public.admin_feature_toggles WHERE section_key = 'espacios';

-- [20260925150523_espacios_al_super_admin.sql]
-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

-- Espacios se une a Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google,
-- Plantillas Email y Tráfico web: pasa a gestionarse exclusivamente desde el
-- Super Admin y deja de ser una funcionalidad activable/desactivable del
-- Admin Panel normal (ya no tiene ruta ni permiso allí).
DELETE FROM public.admin_feature_toggles WHERE section_key = 'espacios';

-- [20260925154109_notificaciones_dashboard_delete.sql]
-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

CREATE POLICY "Authenticated users can delete notificaciones"
  ON public.notificaciones_dashboard FOR DELETE
  TO authenticated USING (true);

-- [20260926055116_revertir_policy_delete_notificaciones_redundante.sql]
-- RECONSTRUIDA DESDE PRODUCCION EL 27/09/2026.
-- Esta migracion se aplico desde el editor SQL de Supabase sin commitear el
-- fichero, asi que figuraba en supabase_migrations.schema_migrations pero no
-- en el repositorio, y eso bloqueaba `supabase db push` para todo el equipo.
-- El SQL de aqui abajo es EXACTAMENTE el que guarda el registro (columna
-- `statements`), no una reescritura. Ya esta aplicada: no vuelve a ejecutarse.

DROP POLICY IF EXISTS "Authenticated users can delete notificaciones" ON public.notificaciones_dashboard;

-- [20260926060716_admin_access_requires_permissions.sql]
-- Si cualquier admin pudiera seguir escribiendo user_permissions, un admin
-- restringido podría auto-concederse permisos y anular la restricción de
-- arriba. Solo un super admin puede editar permisos de ahora en adelante.
DROP POLICY IF EXISTS "Admins pueden crear permisos" ON public.user_permissions;

-- [20260926060716_admin_access_requires_permissions.sql]
CREATE POLICY "Super admins pueden crear permisos" ON public.user_permissions
  FOR INSERT
  WITH CHECK (is_super_admin(auth.uid()));

-- [20260926060716_admin_access_requires_permissions.sql]
DROP POLICY IF EXISTS "Admins pueden actualizar permisos" ON public.user_permissions;

-- [20260926060716_admin_access_requires_permissions.sql]
CREATE POLICY "Super admins pueden actualizar permisos" ON public.user_permissions
  FOR UPDATE
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- [20260926060716_admin_access_requires_permissions.sql]
DROP POLICY IF EXISTS "Admins pueden eliminar permisos" ON public.user_permissions;

-- [20260926060716_admin_access_requires_permissions.sql]
CREATE POLICY "Super admins pueden eliminar permisos" ON public.user_permissions
  FOR DELETE
  USING (is_super_admin(auth.uid()));

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 1. ia_precios -- catalogo de tarifas, USD por 1M de tokens
-- ---------------------------------------------------------------------------
--    Es la fuente de verdad del coste. `ia_registrar_uso` la lee en cada
--    insercion. Un modelo que no este aqui NO impide registrar el uso: la fila
--    entra con coste_usd = NULL.
-- ---------------------------------------------------------------------------

create table if not exists public.ia_precios (
  modelo                   text          primary key
                             check (length(modelo) between 1 and 120),
  usd_por_m_input          numeric(12,6) not null check (usd_por_m_input >= 0),
  -- NULL = el modelo no tiene tarifa de cache (no es lo mismo que 0).
  usd_por_m_cached         numeric(12,6)          check (usd_por_m_cached >= 0),
  usd_por_m_cache_write    numeric(12,6)          check (usd_por_m_cache_write >= 0),
  usd_por_m_output         numeric(12,6) not null check (usd_por_m_output >= 0),
  -- Dejado explicito para que nadie sume el razonamiento aparte. Ver cabecera.
  razonamiento_como_output boolean       not null default true,
  notas                    text,
  fuente                   text,
  -- NULL = tarifa NO comprobada contra una factura real. La pantalla avisa.
  verificado_en            date,
  actualizado_en           timestamptz   not null default now()
);

-- [20260928193000_costes_sistema.sql]
comment on table public.ia_precios is
  'Tarifas por modelo en USD por 1M de tokens. Fuente de verdad del coste: la '
  'calcula ia_registrar_uso, no la Edge Function. verificado_en NULL = tarifa '
  'publica sin comprobar contra factura.';

-- [20260928193000_costes_sistema.sql]
comment on column public.ia_precios.razonamiento_como_output is
  'true = los reasoning_tokens se facturan a la tarifa de output y YA van '
  'dentro de completion_tokens (no se suman aparte). Ver cabecera del fichero.';

-- [20260928193000_costes_sistema.sql]
comment on column public.ia_precios.usd_por_m_cached is
  'NULL = el modelo no tiene tarifa de lectura de cache. NO es 0: si es NULL, '
  'los cached_tokens se cobran como input normal.';

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 2. ia_funciones -- que funciones hay y cual registra de verdad
-- ---------------------------------------------------------------------------
--    Este catalogo es lo que permite a la pantalla ADMITIR QUE LE FALTAN
--    DATOS. Es el equivalente de `trafico_web_sync_estado` en trafico-web: la
--    tabla contra la que se compara lo que hay con lo que deberia haber.
--    Sin el, una funcion sin instrumentar se leeria como "0 EUR de gasto".
-- ---------------------------------------------------------------------------

create table if not exists public.ia_funciones (
  funcion       text    primary key check (length(funcion) between 1 and 80),
  descripcion   text    not null,
  -- false = todavia NO llama a ia_registrar_uso. La pantalla lo dice en rojo.
  instrumentada boolean not null default false,
  unidad        text    not null default 'llamada',
  orden         integer not null default 100,
  activo        boolean not null default true
);

-- [20260928193000_costes_sistema.sql]
comment on table public.ia_funciones is
  'Catalogo de funciones de IA. instrumentada = false significa que la funcion '
  'todavia no registra su consumo, asi que su coste real NO aparece en ia_uso. '
  'La pantalla de costes usa esto para avisar de que esta infra-declarando.';

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 3. ia_uso -- una fila por llamada a un modelo
-- ---------------------------------------------------------------------------
--    Mismo patron que chat_web_uso (20260926121000) pero comun a todas las
--    funciones y con el razonamiento desglosado.
--
--    A DIFERENCIA de chat_web_uso, aqui NO hay estado 'reservado': ia_uso no
--    controla ningun tope de abuso, solo contabiliza. Se escribe UNA vez, al
--    final de la llamada, y si esa escritura falla la funcion sigue (ver
--    supabase/functions/_shared/registrar-uso-ia.ts). Consecuencia asumida:
--    una funcion que muere a mitad no deja fila, asi que ia_uso INFRA-declara
--    en caso de caida. Es lo contrario de chat_web_uso, que sobre-declara
--    (deja la fila en 'reservado' con coste 0). Se prefiere infra-declarar
--    porque aqui la fila no defiende ningun cupo: nadie se cuela por no tener
--    fila, solo se pierde un dato de coste.
-- ---------------------------------------------------------------------------

create table if not exists public.ia_uso (
  id                  bigint        generated always as identity primary key,
  funcion             text          not null check (length(funcion) between 1 and 80),
  -- chat | embedding | vision | otro. Sin FK: una funcion nueva debe poder
  -- registrar antes de que nadie se acuerde de darla de alta en ia_funciones.
  operacion           text          not null default 'chat'
                        check (operacion in ('chat','embedding','vision','otro')),
  modelo              text          not null check (length(modelo) between 1 and 120),
  prompt_tokens       integer       not null default 0 check (prompt_tokens >= 0),
  cached_tokens       integer       not null default 0 check (cached_tokens >= 0),
  cache_write_tokens  integer       not null default 0 check (cache_write_tokens >= 0),
  completion_tokens   integer       not null default 0 check (completion_tokens >= 0),
  -- SUBCONJUNTO de completion_tokens, no un cubo aparte. Ver cabecera.
  razonamiento_tokens integer       not null default 0 check (razonamiento_tokens >= 0),
  llamadas            integer       not null default 1 check (llamadas >= 0),
  -- NULL = el modelo no estaba en ia_precios al registrar. NUNCA 0 por defecto.
  coste_usd           numeric(12,6)          check (coste_usd >= 0),
  estado              text          not null default 'ok'
                        check (estado in ('ok','error')),
  -- Que disparo la llamada, en texto libre corto y SIN datos personales:
  -- 'factura:<uuid>', 'usuario:<uuid>', 'cron', 'carta:auto'. Se usa para
  -- poder rastrear un pico hasta su origen sin guardar contenido.
  disparador          text                   check (disparador is null or length(disparador) <= 200),
  duracion_ms         integer                check (duracion_ms >= 0),
  created_at          timestamptz   not null default now(),

  -- El CHECK que impide el doble conteo del razonamiento. Si esto salta, es
  -- que alguien esta sumando reasoning_tokens FUERA de completion_tokens.
  constraint ia_uso_razonamiento_cabe_en_completion
    check (razonamiento_tokens <= completion_tokens),
  -- Los cached y los cache_write salen de los prompt_tokens, igual que en la
  -- API. Si la suma se pasa, el coste saldria negativo en el greatest() de
  -- ia_registrar_uso y quedaria enmascarado: mejor rechazar la fila.
  constraint ia_uso_cache_cabe_en_prompt
    check (cached_tokens + cache_write_tokens <= prompt_tokens)
);

-- [20260928193000_costes_sistema.sql]
comment on table public.ia_uso is
  'Contabilidad por llamada de TODAS las funciones de IA (menos chat-web, que '
  'tiene la suya en chat_web_uso desde 20260926121000 y no se migra). El coste '
  'lo calcula ia_registrar_uso leyendo ia_precios; NULL = modelo sin tarifa.';

-- [20260928193000_costes_sistema.sql]
comment on column public.ia_uso.razonamiento_tokens is
  'SUBCONJUNTO de completion_tokens (asi lo devuelve la API en '
  'completion_tokens_details.reasoning_tokens). NO se suma aparte al calcular '
  'el coste: ya se factura como output. Hay un CHECK que lo garantiza.';

-- [20260928193000_costes_sistema.sql]
comment on column public.ia_uso.disparador is
  'Origen de la llamada en texto corto y sin datos personales. Para rastrear '
  'un pico de gasto hasta el registro que lo causo.';

-- [20260928193000_costes_sistema.sql]
create index if not exists idx_ia_uso_creado
  on public.ia_uso (created_at desc);

-- [20260928193000_costes_sistema.sql]
create index if not exists idx_ia_uso_funcion_creado
  on public.ia_uso (funcion, created_at desc);

-- [20260928193000_costes_sistema.sql]
create index if not exists idx_ia_uso_modelo_creado
  on public.ia_uso (modelo, created_at desc);

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 4. costes_fijos -- el gasto que NO es IA, declarado a mano
-- ---------------------------------------------------------------------------

create table if not exists public.costes_fijos (
  id             uuid          primary key default gen_random_uuid(),
  concepto       text          not null check (length(concepto) between 1 and 120),
  proveedor      text          not null check (length(proveedor) between 1 and 80),
  categoria      text          not null
                   check (categoria in ('infraestructura','email','telefonia',
                                        'dominio','ia_plataforma','otros')),
  -- NULL = NO comprobado todavia. La pantalla lo pinta "sin datos", no 0.
  eur_mes        numeric(10,2)          check (eur_mes >= 0),
  -- 'fijo' = la cuota no se mueve con el uso. 'variable' = si (VAPI por
  -- minuto, Supabase/Vercel al pasar de plan). Esta distincion es la que el
  -- dueno necesita para decirle al negocio "esto son X al mes, mas Y si
  -- creces": sin ella el total es un numero sin contrato detras.
  naturaleza     text          not null check (naturaleza in ('fijo','variable')),
  notas          text,
  verificado_en  date,
  activo         boolean       not null default true,
  orden          integer       not null default 100,
  creado_en      timestamptz   not null default now(),
  actualizado_en timestamptz   not null default now()
);

-- [20260928193000_costes_sistema.sql]
comment on table public.costes_fijos is
  'Coste mensual que no es IA (Supabase, Vercel, Resend, VAPI, dominio). '
  'DECLARATIVA y a mano: no hay API que lea esas facturas. eur_mes NULL = sin '
  'comprobar; verificado_en dice de cuando es la cifra.';

-- [20260928193000_costes_sistema.sql]
comment on column public.costes_fijos.eur_mes is
  'NULL significa "no comprobado", NO "gratis". Inventar una cifra es peor que '
  'dejarla vacia porque parece un dato.';

-- [20260928193000_costes_sistema.sql]
create index if not exists idx_costes_fijos_activo_orden
  on public.costes_fijos (activo, orden);

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 5. ia_coste_estimado -- la estimacion medida a mano, para el dia 1
-- ---------------------------------------------------------------------------
--    `ia_uso` arranca vacia. Sin esto, la pantalla nace inutil y el dueno no
--    puede poner precio hasta que pase un mes. Estas cifras se midieron el
--    2026-09-28 llamando a cada funcion y leyendo el `usage` de la respuesta.
--
--    Es ESTIMACION, no gasto real, y la pantalla lo marca. El volumen mensual
--    es una HIPOTESIS editable (20 preguntas/dia, etc.): cambiarla es como se
--    contesta "cuanto le costara al negocio si usa mas el chatbot".
-- ---------------------------------------------------------------------------

create table if not exists public.ia_coste_estimado (
  funcion                text          primary key check (length(funcion) between 1 and 80),
  unidad                 text          not null default 'llamada',
  usd_por_unidad         numeric(12,6) not null check (usd_por_unidad >= 0),
  unidades_mes_estimadas numeric(10,2) not null check (unidades_mes_estimadas >= 0),
  modelo                 text,
  medido_en              date,
  nota                   text
);

-- [20260928193000_costes_sistema.sql]
comment on table public.ia_coste_estimado is
  'Coste por unidad MEDIDO a mano el 2026-09-28, con una hipotesis de volumen '
  'mensual editable. Sirve para que la pantalla valga desde el primer dia con '
  'ia_uso vacia. Es estimacion, y la pantalla la marca como tal.';

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 6a. Tarifas
--
--     ############  AVISO: 5 de 7 SIN VERIFICAR  ############
--     Solo `gpt-5.6-luna` esta verificada contra el codigo del proyecto
--     (supabase/functions/chat-web/index.ts:155 la tiene escrita, con la URL
--     de la doc que se consulto el 2026-09-26), y `text-embedding-3-small`
--     se deja tambien como verificada porque su tarifa aparece en la misma
--     tanda. Las otras cinco son tarifas PUBLICAS de catalogo apuntadas de
--     memoria al escribir esta migracion: NO se han comprobado contra una
--     factura real ni contra la doc, y por eso van con verificado_en = NULL.
--
--     Mientras sigan en NULL, la pantalla avisa y el coste es orientativo.
--     Comprobarlas es el paso 2 del CHECKLIST del final: son 5 numeros y se
--     leen en platform.openai.com/docs/pricing en dos minutos.
--     #######################################################
-- ---------------------------------------------------------------------------

insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write,
   usd_por_m_output, notas, fuente, verificado_en)
values
  -- La unica verificada contra el propio codigo del proyecto.
  ('gpt-5.6-luna', 0.200000, 0.020000, 0.250000, 1.200000,
   'La usa chat-web. cache_write = input x 1.25 segun la guia de prompt caching.',
   'supabase/functions/chat-web/index.ts:155 (doc consultada 2026-09-26)',
   date '2026-09-26'),

  ('text-embedding-3-small', 0.020000, null, null, 0.000000,
   'Solo input: un embedding no genera tokens de salida. La usan chat-facturas y procesar-factura.',
   'Tarifa publica de catalogo', date '2026-09-26'),

  -- ---- SIN VERIFICAR (verificado_en = NULL) --------------------------------
  ('gpt-4.1-mini', 0.400000, 0.100000, null, 1.600000,
   'La usan chat-facturas y traducir-contenido.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('gpt-4o-mini', 0.150000, 0.075000, null, 0.600000,
   'La usa format-novedad.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('gpt-5-mini', 0.250000, 0.025000, null, 2.000000,
   'La usan procesar-factura y procesar-dibujo-perimetro. Es el modelo que '
   'quema 3.060 tokens de salida leyendo una factura (medido 2026-09-28).',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('gpt-5.4-mini', 0.250000, 0.025000, null, 2.000000,
   'Candidato a sustituir a gpt-5-mini: misma tarifa y 598 tokens de salida en '
   'vez de 3.060 en la misma factura (medido 2026-09-28). Se da de alta AUNQUE '
   'todavia no se use, para que ia_coste_alternativa() pueda re-tarifar el '
   'historico contra el y ensenar el ahorro con datos propios.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('sonar', 1.000000, null, null, 1.000000,
   'Perplexity, la usa buscar-precios-mercado. OJO: Perplexity cobra ADEMAS '
   'por busqueda ($5/1000 peticiones aprox), que esto NO recoge — el coste que '
   'salga de aqui para `sonar` esta infra-declarado. Segun '
   'docs/CREDENCIALES-Y-COSTES.md esa funcion no la llama ninguna pantalla, '
   'asi que hoy deberia registrar 0 llamadas; si registra alguna, es que algo '
   'la esta llamando y conviene averiguar que.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null)
on conflict (modelo) do nothing;

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 6b. Catalogo de funciones
--
--     `instrumentada` refleja la REALIDAD DEL CODIGO en el momento de escribir
--     esto, no la intencion. Las tres en false por encargo ajeno
--     (procesar-dibujo-perimetro, procesar-factura, traducir-contenido) NO se
--     pueden tocar ahora: hay otro agente en esos ficheros. Su guia de
--     enganche esta en supabase/functions/_shared/registrar-uso-ia.ts.
--
--     QUIEN PONE ESTO A true: el que despliegue la funcion instrumentada, en
--     el mismo momento. Si se pone a true antes, la pantalla deja de avisar de
--     un agujero que sigue abierto — que es peor que no avisar nunca.
-- ---------------------------------------------------------------------------

insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
values
  ('chat-web', 'Chatbot de la web publica. Tiene su propia contabilidad en chat_web_uso desde 20260926121000; ia_uso_diario la lee de alli. Hasta 3 llamadas por pregunta (loop de tools).', true, 'pregunta', 10),
  ('procesar-factura', 'OCR de una factura o albaran: extrae lineas, importes y proveedor. LA MAS CARA: hasta 2 llamadas de vision (max_completion_tokens 16000, y el reintento reenvia la imagen entera) mas 2 de embeddings por documento.', false, 'documento', 20),
  ('chat-facturas', 'Chatbot contable sobre las facturas. Hasta 6 llamadas de chat por pregunta (MAX_PASOS=6) mas una de embeddings por consulta distinta.', false, 'pregunta', 30),
  ('traducir-contenido', 'Traduce platos y contenido de la carta. En modo bulk hace UNA llamada POR FILA, asi que una traduccion masiva son cientos de llamadas en rafaga.', false, 'plato', 40),
  ('format-novedad', 'Da formato a una novedad antes de publicarla. Una sola llamada.', false, 'llamada', 50),
  -- Las dos siguientes NO LAS LLAMA NADIE (verificado 2026-09-28: 0 resultados
  -- de functions.invoke en los 4 repos). Se dan de alta a proposito: si algun
  -- dia aparecen llamadas aqui, es que algo las esta llamando y hay que
  -- averiguar que. Es el uso mas barato de este catalogo: detectar gasto que
  -- nadie sabia que existia.
  ('procesar-dibujo-perimetro', 'Lee un plano de sala dibujado a mano y saca el perimetro. HUERFANA: su cabecera apunta a EditorPlanoArquitectonico.tsx, que YA NO EXISTE (el editor vivo es EditorPlanoEspacio.tsx / CanvasPlano.tsx) y no hay ni un functions.invoke que la llame. Instrumentarla es trabajo perdido mientras siga asi; lo que hay que decidir es si se borra.', false, 'llamada', 60),
  ('buscar-precios-mercado', 'Precios de lonja via Perplexity (modelo sonar). HUERFANA: ninguna pantalla la llama, como ya apuntaba docs/CREDENCIALES-Y-COSTES.md. Si aqui aparecen llamadas, hay que averiguar quien la llama.', false, 'consulta', 70)
on conflict (funcion) do update
  set descripcion = excluded.descripcion,
      unidad      = excluded.unidad,
      orden       = excluded.orden;

-- [20260928193000_costes_sistema.sql]
-- `instrumentada` NO se sobrescribe a proposito: si alguien ya la puso a
      -- true porque desplego la funcion, re-aplicar la migracion no debe
      -- devolverla a false y volver a mentir.

-- ---------------------------------------------------------------------------
-- 6c. Estimacion medida el 2026-09-28
--
--     Las columnas `usd_por_unidad` son MEDIDAS (se llamo a la funcion y se
--     leyo el usage). Las `unidades_mes_estimadas` son HIPOTESIS: el dueno las
--     cambia y el total se mueve. Se apunta de donde sale cada hipotesis.
-- ---------------------------------------------------------------------------

insert into public.ia_coste_estimado
  (funcion, unidad, usd_por_unidad, unidades_mes_estimadas, modelo, medido_en, nota)
values
  ('chat-facturas', 'pregunta', 0.001600, 600, 'gpt-4.1-mini', date '2026-09-28',
   'Hipotesis: 20 preguntas/dia x 30 dias = 600/mes -> 0,96 USD/mes.'),
  ('procesar-factura', 'documento', 0.007500, 100, 'gpt-5-mini', date '2026-09-28',
   'Hipotesis: 100 documentos/mes. Es el concepto mas sensible al modelo: con '
   'gpt-5.4-mini el mismo documento deberia bajar mucho (598 vs 3.060 tokens '
   'de salida, misma tarifa).'),
  ('procesar-dibujo-perimetro', 'llamada', 0.005000, 0, 'gpt-5-mini', date '2026-09-28',
   'Volumen 0 A PROPOSITO: el coste por llamada esta medido (0,005 USD), pero '
   'NO LA LLAMA NADIE (verificado 2026-09-28: su cabecera apunta a un fichero '
   'que ya no existe y no hay ni un functions.invoke). Poner 4/mes seria meter '
   'en el total un gasto que no se produce. Si se vuelve a conectar, cambiar '
   'unidades_mes_estimadas y ya esta.'),
  ('traducir-contenido', 'plato', 0.000270, 40, 'gpt-4.1-mini', date '2026-09-28',
   'Medido: 0,00027 USD/plato. El catalogo COMPLETO son 403 filas = 0,11 USD '
   'de una vez. La hipotesis de 40/mes son los cambios de carta, no el '
   'catalogo entero: retraducirlo todo cuesta 0,11 USD y se hace una vez.'),
  ('format-novedad', 'llamada', 0.000150, 20, 'gpt-4o-mini', date '2026-09-28',
   'Hipotesis: 20 novedades/mes.')
on conflict (funcion) do nothing;

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 6d. Costes fijos -- SE SIEMBRAN SIN IMPORTE, A PROPOSITO
--
--     Los importes van a NULL porque NINGUNO esta verificado:
--     docs/CREDENCIALES-Y-COSTES.md repite "no verificable desde el codigo"
--     en Supabase, Vercel, Resend y VAPI. Poner 25 EUR de Supabase seria
--     inventarse la cifra que el dueno va a usar para poner precio.
--
--     `naturaleza` si esta decidida, y esa si se puede afirmar: VAPI es por
--     minuto (variable), el dominio es anual (fijo), etc.
-- ---------------------------------------------------------------------------


-- [20260928193000_costes_sistema.sql]
alter table public.ia_precios        enable row level security;

-- [20260928193000_costes_sistema.sql]
alter table public.ia_funciones      enable row level security;

-- [20260928193000_costes_sistema.sql]
alter table public.ia_uso            enable row level security;

-- [20260928193000_costes_sistema.sql]
alter table public.costes_fijos      enable row level security;

-- [20260928193000_costes_sistema.sql]
alter table public.ia_coste_estimado enable row level security;

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 7a. Privilegios de tabla. `revoke all ... from anon` primero: estas tablas
--     no las lee ninguna web publica, y el GRANT que no se revoca se queda
--     esperando a la proxima politica descuidada (la leccion de
--     20260928120000).
-- ---------------------------------------------------------------------------

revoke all on public.ia_precios        from anon, authenticated;

-- [20260928193000_costes_sistema.sql]
revoke all on public.ia_funciones      from anon, authenticated;

-- [20260928193000_costes_sistema.sql]
revoke all on public.ia_uso            from anon, authenticated;

-- [20260928193000_costes_sistema.sql]
revoke all on public.costes_fijos      from anon, authenticated;

-- [20260928193000_costes_sistema.sql]
revoke all on public.ia_coste_estimado from anon, authenticated;

-- [20260928193000_costes_sistema.sql]
-- Lectura para authenticated (la RLS de abajo la reduce a super admins).
grant select on public.ia_precios        to authenticated;

-- [20260928193000_costes_sistema.sql]
grant select on public.ia_funciones      to authenticated;

-- [20260928193000_costes_sistema.sql]
grant select on public.ia_uso            to authenticated;

-- [20260928193000_costes_sistema.sql]
grant select on public.ia_coste_estimado to authenticated;

-- [20260928193000_costes_sistema.sql]
-- `costes_fijos` es la unica que se edita desde la pantalla: es la que se
-- rellena a mano. Las demas se tocan por SQL o por la Edge Function.
grant select, insert, update, delete on public.costes_fijos to authenticated;

-- [20260928193000_costes_sistema.sql]
grant all on public.ia_precios        to service_role;

-- [20260928193000_costes_sistema.sql]
grant all on public.ia_funciones      to service_role;

-- [20260928193000_costes_sistema.sql]
grant all on public.ia_uso            to service_role;

-- [20260928193000_costes_sistema.sql]
grant all on public.costes_fijos      to service_role;

-- [20260928193000_costes_sistema.sql]
grant all on public.ia_coste_estimado to service_role;

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 7b. EL AGUJERO QUE LA RLS NO TAPA: TRUNCATE.
--     TRUNCATE NO pasa por las politicas. Sin este revoke, cualquier
--     autenticado podria vaciar `ia_uso` de golpe y todo lo de arriba seria
--     decorativo. El `revoke all` de 7a ya lo quita; se repite explicito
--     porque es el fallo que se colo en `mesas` y en `reservas`, y porque un
--     `grant` posterior escrito sin pensar lo devuelve sin que nadie lo note.
-- ---------------------------------------------------------------------------

revoke truncate on public.ia_precios        from authenticated;

-- [20260928193000_costes_sistema.sql]
revoke truncate on public.ia_funciones      from authenticated;

-- [20260928193000_costes_sistema.sql]
revoke truncate on public.ia_uso            from authenticated;

-- [20260928193000_costes_sistema.sql]
revoke truncate on public.costes_fijos      from authenticated;

-- [20260928193000_costes_sistema.sql]
revoke truncate on public.ia_coste_estimado from authenticated;

-- [20260928193000_costes_sistema.sql]
-- ---------------------------------------------------------------------------
-- 7c. Politicas
-- ---------------------------------------------------------------------------

-- ia_precios
drop policy if exists ia_precios_select_super_admin on public.ia_precios;

-- [20260928193000_costes_sistema.sql]
create policy ia_precios_select_super_admin
  on public.ia_precios for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists ia_precios_service_role on public.ia_precios;

-- [20260928193000_costes_sistema.sql]
create policy ia_precios_service_role
  on public.ia_precios for all to service_role
  using (true) with check (true);

-- [20260928193000_costes_sistema.sql]
-- ia_funciones
drop policy if exists ia_funciones_select_super_admin on public.ia_funciones;

-- [20260928193000_costes_sistema.sql]
create policy ia_funciones_select_super_admin
  on public.ia_funciones for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists ia_funciones_service_role on public.ia_funciones;

-- [20260928193000_costes_sistema.sql]
create policy ia_funciones_service_role
  on public.ia_funciones for all to service_role
  using (true) with check (true);

-- [20260928193000_costes_sistema.sql]
-- ia_uso. Solo SELECT para authenticated: quien escribe es la Edge Function
-- via ia_registrar_uso (SECURITY DEFINER, EXECUTE solo a service_role).
drop policy if exists ia_uso_select_super_admin on public.ia_uso;

-- [20260928193000_costes_sistema.sql]
create policy ia_uso_select_super_admin
  on public.ia_uso for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists ia_uso_service_role on public.ia_uso;

-- [20260928193000_costes_sistema.sql]
create policy ia_uso_service_role
  on public.ia_uso for all to service_role
  using (true) with check (true);

-- [20260928193000_costes_sistema.sql]
-- costes_fijos: lectura Y escritura para super admin (es la tabla a mano).
drop policy if exists costes_fijos_select_super_admin on public.costes_fijos;

-- [20260928193000_costes_sistema.sql]
create policy costes_fijos_select_super_admin
  on public.costes_fijos for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists costes_fijos_insert_super_admin on public.costes_fijos;

-- [20260928193000_costes_sistema.sql]
create policy costes_fijos_insert_super_admin
  on public.costes_fijos for insert to authenticated
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists costes_fijos_update_super_admin on public.costes_fijos;

-- [20260928193000_costes_sistema.sql]
create policy costes_fijos_update_super_admin
  on public.costes_fijos for update to authenticated
  using      ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists costes_fijos_delete_super_admin on public.costes_fijos;

-- [20260928193000_costes_sistema.sql]
create policy costes_fijos_delete_super_admin
  on public.costes_fijos for delete to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists costes_fijos_service_role on public.costes_fijos;

-- [20260928193000_costes_sistema.sql]
create policy costes_fijos_service_role
  on public.costes_fijos for all to service_role
  using (true) with check (true);

-- [20260928193000_costes_sistema.sql]
-- ia_coste_estimado
drop policy if exists ia_coste_estimado_select_super_admin on public.ia_coste_estimado;

-- [20260928193000_costes_sistema.sql]
create policy ia_coste_estimado_select_super_admin
  on public.ia_coste_estimado for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20260928193000_costes_sistema.sql]
drop policy if exists ia_coste_estimado_service_role on public.ia_coste_estimado;

-- [20260928193000_costes_sistema.sql]
create policy ia_coste_estimado_service_role
  on public.ia_coste_estimado for all to service_role
  using (true) with check (true);

-- [20260928193000_costes_sistema.sql] public.costes_fijos_marcar_actualizado()
-- Trigger de actualizado_en en costes_fijos. `update_updated_at_column` ya
-- existe en el proyecto pero escribe en `updated_at`, y aqui la columna se
-- llama `actualizado_en` (como en peso_paginas / ia_precios), asi que se
-- necesita una propia. search_path fijado: lo exige 20260922200000.
create or replace function public.costes_fijos_marcar_actualizado()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- [20260928193000_costes_sistema.sql]
drop trigger if exists trg_costes_fijos_actualizado on public.costes_fijos;

-- [20260928193000_costes_sistema.sql]
create trigger trg_costes_fijos_actualizado
  before update on public.costes_fijos
  for each row execute function public.costes_fijos_marcar_actualizado();

-- [override] ia_uso_diario
-- ia_uso_diario: agregado por día natural de Madrid, función y modelo (sin el chatbot de la web, que aquí no existe).
-- security_invoker: aplica la RLS de ia_uso, así que solo un super admin ve filas.
create or replace view public.ia_uso_diario
with (security_invoker = true) as
select
  (u.created_at at time zone 'Europe/Madrid')::date            as dia,
  u.funcion                                                    as funcion,
  u.modelo                                                     as modelo,
  coalesce(sum(u.llamadas), 0)::bigint                         as llamadas,
  count(*)::bigint                                             as peticiones,
  count(*) filter (where u.estado = 'error')::bigint            as errores,
  coalesce(sum(u.prompt_tokens), 0)::bigint                    as prompt_tokens,
  coalesce(sum(u.cached_tokens), 0)::bigint                    as cached_tokens,
  coalesce(sum(u.completion_tokens), 0)::bigint                as completion_tokens,
  coalesce(sum(u.razonamiento_tokens), 0)::bigint              as razonamiento_tokens,
  -- sum() de numeric devuelve NULL si TODAS son NULL: se conserva a propósito
  -- (modelo sin tarifa -> "sin datos", no 0). No se envuelve en coalesce.
  sum(u.coste_usd)::numeric                                    as coste_usd
from public.ia_uso u
group by 1, 2, 3;

-- [20260928193000_costes_sistema.sql]
comment on view public.ia_uso_diario is
  'Consumo diario de IA por funcion y modelo. UNION de ia_uso y chat_web_uso: '
  'chat-web tiene su propia contabilidad desde 20260926121000 y no se migra '
  'porque sus topes de abuso dependen de ella. De chat_web_uso solo entran las '
  'filas ok/error (reservado tiene coste 0 falso; rechazado no llamo a OpenAI).';

-- [20260928193000_costes_sistema.sql]
revoke all on public.ia_uso_diario from anon, authenticated;

-- [20260928193000_costes_sistema.sql]
grant select on public.ia_uso_diario to authenticated;

-- [20260928193000_costes_sistema.sql] public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer)
-- ---------------------------------------------------------------------------
-- 8b. ia_registrar_uso -- LA UNICA puerta de escritura
--
--     SECURITY DEFINER y EXECUTE SOLO a service_role: la escribe la Edge
--     Function con la service key, nunca el navegador.
--
--     Calcula el coste leyendo ia_precios. Si el modelo no esta, devuelve la
--     fila con coste_usd = NULL en vez de fallar: perder el coste es malo,
--     perder tambien el recuento de tokens es peor.
--
--     Devuelve la fila insertada para que la funcion pueda loguear el USD en
--     su consola, como ya hace chat-web.
-- ---------------------------------------------------------------------------

create or replace function public.ia_registrar_uso(
  p_funcion             text,
  p_modelo              text,
  p_prompt_tokens       integer default 0,
  p_completion_tokens   integer default 0,
  p_razonamiento_tokens integer default 0,
  p_cached_tokens       integer default 0,
  p_cache_write_tokens  integer default 0,
  p_llamadas            integer default 1,
  p_operacion           text    default 'chat',
  p_estado              text    default 'ok',
  p_disparador          text    default null,
  p_duracion_ms         integer default null
)
returns table (
  id        bigint,
  coste_usd numeric,
  tarifado  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompt      integer := greatest(coalesce(p_prompt_tokens, 0), 0);
  v_completion  integer := greatest(coalesce(p_completion_tokens, 0), 0);
  v_razon       integer := greatest(coalesce(p_razonamiento_tokens, 0), 0);
  v_cached      integer := greatest(coalesce(p_cached_tokens, 0), 0);
  v_cache_w     integer := greatest(coalesce(p_cache_write_tokens, 0), 0);
  v_precio      public.ia_precios;
  v_coste       numeric(12,6);
  v_input_neto  integer;
  v_id          bigint;
begin
  -- Se NORMALIZA en vez de rechazar. Esta funcion la llama codigo de
  -- contabilidad en un bloque que nunca debe romper la funcion de negocio: si
  -- el `usage` de OpenAI viene raro, es mejor guardar una fila con numeros
  -- saneados que no guardar nada. Los CHECK de la tabla son la red de
  -- seguridad, no el sitio donde se valida.
  if v_razon > v_completion then
    v_razon := v_completion;
  end if;
  if v_cached + v_cache_w > v_prompt then
    -- Se recortan proporcionalmente por el lado del cache, que es el dato
    -- menos fiable (la API no siempre lo devuelve con el mismo nombre).
    v_cached  := least(v_cached, v_prompt);
    v_cache_w := least(v_cache_w, v_prompt - v_cached);
  end if;

  select * into v_precio from public.ia_precios p where p.modelo = p_modelo;

  if found then
    -- Los cached y los cache_write SALEN de los prompt_tokens: el input que se
    -- cobra a tarifa plena es el resto. Misma cuenta que costeUsd() de
    -- chat-web (index.ts:165), para que las dos den lo mismo.
    v_input_neto := greatest(v_prompt - v_cached - v_cache_w, 0);
    v_coste := (
        v_input_neto * v_precio.usd_por_m_input
      -- Si el modelo no declara tarifa de cache, los cached se cobran como
      -- input normal. NO se cobran a 0: eso seria regalar tokens que OpenAI
      -- factura.
      + v_cached    * coalesce(v_precio.usd_por_m_cached, v_precio.usd_por_m_input)
      + v_cache_w   * coalesce(v_precio.usd_por_m_cache_write, v_precio.usd_por_m_input)
      -- completion_tokens YA INCLUYE el razonamiento. NO se suma v_razon.
      + v_completion * v_precio.usd_por_m_output
    ) / 1000000.0;
    v_coste := round(v_coste, 6);
  else
    v_coste := null;  -- modelo sin tarifa: "sin datos", no 0.
  end if;

  insert into public.ia_uso (
    funcion, operacion, modelo,
    prompt_tokens, cached_tokens, cache_write_tokens,
    completion_tokens, razonamiento_tokens,
    llamadas, coste_usd, estado, disparador, duracion_ms
  ) values (
    p_funcion,
    coalesce(nullif(p_operacion, ''), 'chat'),
    p_modelo,
    v_prompt, v_cached, v_cache_w,
    v_completion, v_razon,
    greatest(coalesce(p_llamadas, 1), 0),
    v_coste,
    coalesce(nullif(p_estado, ''), 'ok'),
    left(nullif(p_disparador, ''), 200),
    p_duracion_ms
  )
  -- Se cualifica con el nombre de la tabla A PROPOSITO: la funcion declara una
  -- columna de salida llamada `id`, asi que un `returning id` seria ambiguo y
  -- plpgsql lo rechaza en tiempo de ejecucion. El schema (`public.`) NO se
  -- puede poner aqui: en RETURNING solo vale el nombre de la relacion.
  returning ia_uso.id into v_id;

  return query select v_id, v_coste, (v_coste is not null);
end;
$$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer) is
  'Registra una llamada a un modelo y calcula su coste con ia_precios. '
  'SECURITY DEFINER, EXECUTE solo service_role. NO suma razonamiento aparte: '
  'ya va dentro de completion_tokens. Modelo sin tarifa -> coste_usd NULL.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer) from public, anon, authenticated;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer) to service_role;

-- [20260928193000_costes_sistema.sql] public.ia_coste_serie(date,date,text)
-- ---------------------------------------------------------------------------
-- 8c. ia_coste_serie -- serie diaria con medias, desviacion y anomalias
--
--     Mismo contrato de forma que trafico_web_serie (20260923200000): se
--     rellena el calendario completo con generate_series para que un dia sin
--     llamadas exista en el resultado. AQUI, a diferencia de trafico web, un
--     dia sin filas es CERO GASTO DE VERDAD (nadie llamo), no un hueco de
--     sincronizacion: no hay nada que sincronizar. Por eso el coste de un dia
--     vacio es 0 y no NULL — es el unico sitio de este fichero donde 0 y NULL
--     no significan lo mismo que en trafico-web, y es a proposito.
--
--     La anomalia se calcula sobre la media y desviacion de los 30 dias
--     ANTERIORES (ventana que excluye el dia en curso: si no, un pico se
--     esconde a si mismo subiendo su propia media).
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_serie(
  p_desde   date default (current_date - 29),
  p_hasta   date default current_date,
  p_funcion text default null
)
returns table (
  dia                 date,
  coste_usd           numeric,
  llamadas            bigint,
  peticiones          bigint,
  errores             bigint,
  prompt_tokens       bigint,
  completion_tokens   bigint,
  razonamiento_tokens bigint,
  media_7             numeric,
  media_30            numeric,
  desv_30             numeric,
  z_30                numeric,
  desviacion_pct      numeric,
  es_anomalia         boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Se amplia 30 dias hacia atras para que la media movil del primer dia del
  -- rango no arranque en falso. El calendario completo se construye abajo en
  -- `completo`, sobre ese mismo rango ampliado, y el filtro final
  -- (`where v.dia >= p_desde`) recorta el calentamiento.
  with crudo as (
    select
      v.dia,
      coalesce(sum(v.coste_usd), 0)::numeric  as coste_usd,
      coalesce(sum(v.llamadas), 0)::bigint    as llamadas,
      coalesce(sum(v.peticiones), 0)::bigint  as peticiones,
      coalesce(sum(v.errores), 0)::bigint     as errores,
      coalesce(sum(v.prompt_tokens), 0)::bigint       as prompt_tokens,
      coalesce(sum(v.completion_tokens), 0)::bigint   as completion_tokens,
      coalesce(sum(v.razonamiento_tokens), 0)::bigint as razonamiento_tokens
    from public.ia_uso_diario v
    where v.dia between (p_desde - 30) and p_hasta
      and (p_funcion is null or v.funcion = p_funcion)
    group by v.dia
  ),
  completo as (
    select
      c.dia,
      coalesce(r.coste_usd, 0)::numeric           as coste_usd,
      coalesce(r.llamadas, 0)::bigint             as llamadas,
      coalesce(r.peticiones, 0)::bigint           as peticiones,
      coalesce(r.errores, 0)::bigint              as errores,
      coalesce(r.prompt_tokens, 0)::bigint        as prompt_tokens,
      coalesce(r.completion_tokens, 0)::bigint    as completion_tokens,
      coalesce(r.razonamiento_tokens, 0)::bigint  as razonamiento_tokens
    from (
      select d::date as dia
      from generate_series(p_desde - 30, p_hasta, interval '1 day') as d
    ) c
    left join crudo r on r.dia = c.dia
  ),
  ventanas as (
    select
      c.*,
      avg(c.coste_usd) over (order by c.dia rows between 6 preceding and current row)  as media_7,
      avg(c.coste_usd) over (order by c.dia rows between 30 preceding and 1 preceding) as media_30,
      stddev_samp(c.coste_usd) over (order by c.dia rows between 30 preceding and 1 preceding) as desv_30,
      count(*) over (order by c.dia rows between 30 preceding and 1 preceding) as n_30
    from completo c
  )
  select
    v.dia,
    round(v.coste_usd, 6)                                   as coste_usd,
    v.llamadas,
    v.peticiones,
    v.errores,
    v.prompt_tokens,
    v.completion_tokens,
    v.razonamiento_tokens,
    round(v.media_7, 6)                                     as media_7,
    round(v.media_30, 6)                                    as media_30,
    round(v.desv_30, 6)                                     as desv_30,
    -- z solo si hay al menos 7 dias de historia y la desviacion no es 0
    -- (con desv 0 cualquier cambio daria z infinito).
    case when v.n_30 >= 7 and v.desv_30 is not null and v.desv_30 > 0
         then round((v.coste_usd - v.media_30) / v.desv_30, 2)
    end                                                     as z_30,
    case when v.media_30 is not null and v.media_30 > 0
         then round(100 * (v.coste_usd - v.media_30) / v.media_30, 1)
    end                                                     as desviacion_pct,
    -- Anomalia = |z| > 2 Y ademas un salto que se note en dinero. Sin el
    -- segundo filtro, pasar de 0,000001 a 0,000004 USD saldria como anomalia:
    -- estadisticamente lo es, pero no es una noticia. El umbral de 0,01 USD/dia
    -- es deliberadamente bajo porque todo el gasto de IA aqui es de centimos.
    case when v.n_30 >= 7 and v.desv_30 is not null and v.desv_30 > 0
         then abs((v.coste_usd - v.media_30) / v.desv_30) > 2
              and abs(v.coste_usd - v.media_30) >= 0.01
    end                                                     as es_anomalia
  from ventanas v
  where v.dia >= p_desde
  order by v.dia;
$$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_coste_serie(date, date, text) is
  'Serie diaria de coste de IA con media 7/30, z y anomalias. Mismo contrato '
  'de forma que trafico_web_serie. Un dia sin llamadas es 0 de verdad (no hay '
  'nada que sincronizar), al contrario que en trafico web.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_coste_serie(date, date, text) from public, anon;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_coste_serie(date, date, text) to authenticated, service_role;

-- [20260928193000_costes_sistema.sql] public.ia_coste_por_funcion(date,date)
-- ---------------------------------------------------------------------------
-- 8d. ia_coste_por_funcion
--     LEFT JOIN desde ia_funciones para que una funcion dada de alta y SIN
--     registrar salga en la tabla con 0 peticiones y coste NULL, en vez de
--     desaparecer. Una funcion que no aparece se lee como "no gasta"; una que
--     aparece con "sin datos" se lee como "no lo sabemos". Es la diferencia
--     que hace util esta pantalla.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_por_funcion(
  p_desde date default (current_date - 29),
  p_hasta date default current_date
)
returns table (
  funcion             text,
  descripcion         text,
  instrumentada       boolean,
  llamadas            bigint,
  peticiones          bigint,
  errores             bigint,
  prompt_tokens       bigint,
  completion_tokens   bigint,
  razonamiento_tokens bigint,
  coste_usd           numeric,
  pct                 numeric,
  usd_por_peticion    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with uso as (
    select
      v.funcion,
      coalesce(sum(v.llamadas), 0)::bigint            as llamadas,
      coalesce(sum(v.peticiones), 0)::bigint          as peticiones,
      coalesce(sum(v.errores), 0)::bigint             as errores,
      coalesce(sum(v.prompt_tokens), 0)::bigint       as prompt_tokens,
      coalesce(sum(v.completion_tokens), 0)::bigint   as completion_tokens,
      coalesce(sum(v.razonamiento_tokens), 0)::bigint as razonamiento_tokens,
      sum(v.coste_usd)::numeric                       as coste_usd
    from public.ia_uso_diario v
    where v.dia between p_desde and p_hasta
    group by v.funcion
  ),
  -- FULL JOIN: salen las funciones del catalogo sin uso Y el uso de funciones
  -- que nadie dio de alta en ia_funciones (una funcion nueva que ya registra
  -- pero que se olvidaron de catalogar no debe quedar invisible).
  juntas as (
    select
      coalesce(f.funcion, u.funcion) as funcion,
      f.descripcion,
      coalesce(f.instrumentada, false) as instrumentada,
      coalesce(u.llamadas, 0)::bigint            as llamadas,
      coalesce(u.peticiones, 0)::bigint          as peticiones,
      coalesce(u.errores, 0)::bigint             as errores,
      coalesce(u.prompt_tokens, 0)::bigint       as prompt_tokens,
      coalesce(u.completion_tokens, 0)::bigint   as completion_tokens,
      coalesce(u.razonamiento_tokens, 0)::bigint as razonamiento_tokens,
      u.coste_usd,
      coalesce(f.orden, 999) as orden
    from public.ia_funciones f
    full join uso u on u.funcion = f.funcion
    where f.funcion is null or f.activo
  ),
  total as (select nullif(sum(j.coste_usd), 0) as t from juntas j)
  select
    j.funcion,
    j.descripcion,
    j.instrumentada,
    j.llamadas,
    j.peticiones,
    j.errores,
    j.prompt_tokens,
    j.completion_tokens,
    j.razonamiento_tokens,
    round(j.coste_usd, 6)                                        as coste_usd,
    case when t.t is not null and j.coste_usd is not null
         then round(100 * j.coste_usd / t.t, 1) end               as pct,
    case when j.peticiones > 0 and j.coste_usd is not null
         then round(j.coste_usd / j.peticiones, 6) end            as usd_por_peticion
  from juntas j cross join total t
  order by j.coste_usd desc nulls last, j.orden, j.funcion;
$$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_coste_por_funcion(date, date) is
  'Coste por funcion en un rango. FULL JOIN con ia_funciones: una funcion del '
  'catalogo sin registrar sale con coste NULL ("no lo sabemos") en vez de '
  'desaparecer ("no gasta"), y una que registra sin estar catalogada tampoco '
  'se pierde.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_coste_por_funcion(date, date) from public, anon;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_coste_por_funcion(date, date) to authenticated, service_role;

-- [20260928193000_costes_sistema.sql] public.ia_coste_por_modelo(date,date)
-- ---------------------------------------------------------------------------
-- 8e. ia_coste_por_modelo
--     `pct_razonamiento` es LA columna de esta pantalla: el porcentaje de la
--     salida que se gasta en pensar. Es la que contesta si merece la pena
--     cambiar de modelo.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_por_modelo(
  p_desde date default (current_date - 29),
  p_hasta date default current_date
)
returns table (
  modelo              text,
  llamadas            bigint,
  peticiones          bigint,
  prompt_tokens       bigint,
  cached_tokens       bigint,
  completion_tokens   bigint,
  razonamiento_tokens bigint,
  pct_razonamiento    numeric,
  coste_usd           numeric,
  pct                 numeric,
  usd_por_peticion    numeric,
  tarifado            boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with uso as (
    select
      v.modelo,
      coalesce(sum(v.llamadas), 0)::bigint            as llamadas,
      coalesce(sum(v.peticiones), 0)::bigint          as peticiones,
      coalesce(sum(v.prompt_tokens), 0)::bigint       as prompt_tokens,
      coalesce(sum(v.cached_tokens), 0)::bigint       as cached_tokens,
      coalesce(sum(v.completion_tokens), 0)::bigint   as completion_tokens,
      coalesce(sum(v.razonamiento_tokens), 0)::bigint as razonamiento_tokens,
      sum(v.coste_usd)::numeric                       as coste_usd
    from public.ia_uso_diario v
    where v.dia between p_desde and p_hasta
    group by v.modelo
  ),
  total as (select nullif(sum(u.coste_usd), 0) as t from uso u)
  select
    u.modelo,
    u.llamadas,
    u.peticiones,
    u.prompt_tokens,
    u.cached_tokens,
    u.completion_tokens,
    u.razonamiento_tokens,
    case when u.completion_tokens > 0
         then round(100.0 * u.razonamiento_tokens / u.completion_tokens, 1) end as pct_razonamiento,
    round(u.coste_usd, 6)                                    as coste_usd,
    case when t.t is not null and u.coste_usd is not null
         then round(100 * u.coste_usd / t.t, 1) end           as pct,
    case when u.peticiones > 0 and u.coste_usd is not null
         then round(u.coste_usd / u.peticiones, 6) end        as usd_por_peticion,
    -- false = el modelo NO esta en ia_precios, asi que su coste es NULL. La
    -- pantalla avisa en vez de pintar un 0 tranquilizador.
    exists (select 1 from public.ia_precios p where p.modelo = u.modelo) as tarifado
  from uso u cross join total t
  order by u.coste_usd desc nulls last, u.modelo;
$$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_coste_por_modelo(date, date) is
  'Coste por modelo con el porcentaje de la salida que es razonamiento. '
  'tarifado = false -> el modelo no esta en ia_precios y su coste_usd es NULL.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_coste_por_modelo(date, date) from public, anon;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_coste_por_modelo(date, date) to authenticated, service_role;

-- [20260928193000_costes_sistema.sql] public.ia_coste_mes()
-- ---------------------------------------------------------------------------
-- 8f. ia_coste_mes -- mes en curso + proyeccion a fin de mes + fijos
--     Mismo espiritu que trafico_web_fdt_mes: dos proyecciones en vez de una,
--     porque con pocos dias la lineal se dispara.
--       proy_lineal  = acumulado / dias_con_dato * dias_mes
--       proy_media7  = acumulado + media de los ultimos 7 dias x dias_restantes
--     Devuelve SIEMPRE una fila, aunque no haya nada registrado: la pantalla
--     necesita saber cuantos dias lleva el mes incluso con ia_uso vacia.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_mes()
returns table (
  mes                   date,
  coste_acumulado_usd   numeric,
  peticiones            bigint,
  dias_con_dato         integer,
  dias_mes              integer,
  dias_restantes        integer,
  usd_medio_dia         numeric,
  proy_lineal_usd       numeric,
  proy_media7_usd       numeric,
  fijos_eur_mes         numeric,
  fijos_sin_verificar   integer,
  estimado_ia_usd_mes   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with ref as (
    select
      date_trunc('month', (now() at time zone 'Europe/Madrid'))::date as primero,
      (now() at time zone 'Europe/Madrid')::date                      as hoy
  ),
  marco as (
    select
      r.primero                                                        as mes,
      r.hoy                                                            as hoy,
      extract(day from (r.primero + interval '1 month' - interval '1 day'))::integer as dias_mes,
      -- Dias transcurridos incluyendo hoy (hoy esta a medias, y eso hace que
      -- la proyeccion lineal INFRAestime un poco por la manana. Se asume:
      -- corregirlo con la hora exacta daria un numero que baila todo el dia).
      (r.hoy - r.primero + 1)::integer                                 as dias_curso
    from ref r
  ),
  dias as (
    select
      coalesce(sum(v.coste_usd), 0)::numeric as coste,
      coalesce(sum(v.peticiones), 0)::bigint as peticiones,
      count(distinct v.dia)::integer         as dias_con_dato
    from public.ia_uso_diario v, marco m
    where v.dia >= m.mes and v.dia <= m.hoy
  ),
  ult7 as (
    select coalesce(sum(v.coste_usd), 0)::numeric / 7.0 as media
    from public.ia_uso_diario v, marco m
    where v.dia > m.hoy - 7 and v.dia <= m.hoy
  ),
  fijos as (
    select
      -- sum() de numeric ignora NULL: si TODAS las filas estan sin verificar
      -- devuelve NULL, que es lo correcto ("no lo sabemos"), no 0.
      sum(c.eur_mes)::numeric                                    as eur_mes,
      count(*) filter (where c.eur_mes is null)::integer          as sin_verificar
    from public.costes_fijos c
    where c.activo
  ),
  estim as (
    select sum(e.usd_por_unidad * e.unidades_mes_estimadas)::numeric as usd_mes
    from public.ia_coste_estimado e
  )
  select
    m.mes,
    round(d.coste, 6)                                        as coste_acumulado_usd,
    d.peticiones,
    d.dias_con_dato,
    m.dias_mes,
    greatest(m.dias_mes - m.dias_curso, 0)                   as dias_restantes,
    -- Se divide por los dias TRANSCURRIDOS, no por los dias con dato: un dia
    -- sin llamadas es un dia de 0 EUR real y tiene que tirar la media abajo.
    -- (En trafico web es al contrario: alli un dia sin dato es un hueco de
    --  sincronizacion y dividir por el falsearia a la baja.)
    case when m.dias_curso > 0 then round(d.coste / m.dias_curso, 6) end as usd_medio_dia,
    case when m.dias_curso > 0
         then round(d.coste / m.dias_curso * m.dias_mes, 6) end          as proy_lineal_usd,
    round(d.coste + u.media * greatest(m.dias_mes - m.dias_curso, 0), 6) as proy_media7_usd,
    round(f.eur_mes, 2)                                      as fijos_eur_mes,
    coalesce(f.sin_verificar, 0)                             as fijos_sin_verificar,
    round(e.usd_mes, 6)                                      as estimado_ia_usd_mes
  from marco m, dias d, ult7 u, fijos f, estim e;
$$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_coste_mes() is
  'Mes en curso: acumulado, dos proyecciones a fin de mes (lineal y por media '
  'de 7 dias), coste fijo declarado y estimacion de IA. Devuelve siempre una '
  'fila. fijos_eur_mes NULL = ninguna fila de costes_fijos verificada.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_coste_mes() from public, anon;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_coste_mes() to authenticated, service_role;

-- [20260928193000_costes_sistema.sql] public.ia_coste_alternativa(text,date,date)
-- ---------------------------------------------------------------------------
-- 8g. ia_coste_alternativa -- re-tarifar el historico con otro modelo
--
--     Coge los tokens YA REGISTRADOS y los pasa por la tarifa de otro modelo.
--     Es la respuesta con datos propios a "gpt-5-mini me cuesta X, cuanto me
--     costaria gpt-5.4-mini".
--
--     LIMITE QUE HAY QUE DECIR: esto supone MISMOS TOKENS con el otro modelo,
--     y eso es justo lo que NO pasa en el caso que motiva la pantalla (3.060
--     vs 598 tokens de salida). Asi que el ahorro que salga de aqui es el
--     ahorro POR TARIFA, no el ahorro real. Con dos modelos de la misma tarifa
--     dara diferencia 0, y eso es correcto: el ahorro viene de gastar menos
--     tokens, no de pagar menos por token. La pantalla tiene que decirlo o el
--     numero engana. Para medir el ahorro de verdad hay que registrar llamadas
--     reales con el modelo nuevo y comparar usd_por_peticion en
--     ia_coste_por_modelo.
--
--     Lee de ia_uso directamente (no de la vista) porque necesita los tokens
--     sin agregar por dia para no perder el cache_write.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_alternativa(
  p_modelo_alternativo text,
  p_desde date default (current_date - 29),
  p_hasta date default current_date
)
returns table (
  modelo_real             text,
  modelo_alternativo      text,
  peticiones              bigint,
  coste_real_usd          numeric,
  coste_alternativo_usd   numeric,
  diferencia_usd          numeric,
  diferencia_pct          numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with alt as (
    select * from public.ia_precios p where p.modelo = p_modelo_alternativo
  ),
  agrupado as (
    select
      u.modelo,
      count(*)::bigint                                as peticiones,
      sum(u.coste_usd)::numeric                       as coste_real,
      sum(greatest(u.prompt_tokens - u.cached_tokens - u.cache_write_tokens, 0))::bigint as input_neto,
      sum(u.cached_tokens)::bigint                    as cached,
      sum(u.cache_write_tokens)::bigint               as cache_w,
      sum(u.completion_tokens)::bigint                as completion
    from public.ia_uso u
    where (u.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
    group by u.modelo
  )
  select
    g.modelo                                                   as modelo_real,
    p_modelo_alternativo                                       as modelo_alternativo,
    g.peticiones,
    round(g.coste_real, 6)                                     as coste_real_usd,
    round((
        g.input_neto  * a.usd_por_m_input
      + g.cached      * coalesce(a.usd_por_m_cached, a.usd_por_m_input)
      + g.cache_w     * coalesce(a.usd_por_m_cache_write, a.usd_por_m_input)
      + g.completion  * a.usd_por_m_output
    ) / 1000000.0, 6)                                          as coste_alternativo_usd,
    round(g.coste_real - (
        g.input_neto  * a.usd_por_m_input
      + g.cached      * coalesce(a.usd_por_m_cached, a.usd_por_m_input)
      + g.cache_w     * coalesce(a.usd_por_m_cache_write, a.usd_por_m_input)
      + g.completion  * a.usd_por_m_output
    ) / 1000000.0, 6)                                          as diferencia_usd,
    case when g.coste_real is not null and g.coste_real > 0 then round(100 * (g.coste_real - (
        g.input_neto  * a.usd_por_m_input
      + g.cached      * coalesce(a.usd_por_m_cached, a.usd_por_m_input)
      + g.cache_w     * coalesce(a.usd_por_m_cache_write, a.usd_por_m_input)
      + g.completion  * a.usd_por_m_output
    ) / 1000000.0) / g.coste_real, 1) end                      as diferencia_pct
  -- INNER JOIN a proposito: si el modelo alternativo no tiene tarifa, no hay
  -- nada que comparar y se devuelven 0 filas en vez de una tabla de NULLs.
  from agrupado g cross join alt a
  where g.modelo <> p_modelo_alternativo
  order by g.coste_real desc nulls last;
$$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_coste_alternativa(text, date, date) is
  'Re-tarifa los tokens ya registrados con la tarifa de otro modelo. OJO: '
  'supone MISMOS tokens, asi que mide el ahorro POR TARIFA, no el ahorro real '
  '(que viene de gastar menos tokens). Dos modelos de igual tarifa dan 0.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_coste_alternativa(text, date, date) from public, anon;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_coste_alternativa(text, date, date) to authenticated, service_role;

-- [override] ia_funciones_sin_registro
-- Funciones de IA sin registros recientes (solo ia_uso: aquí no hay chatbot de la web).
CREATE OR REPLACE FUNCTION public.ia_funciones_sin_registro(p_dias integer DEFAULT 7)
 RETURNS TABLE(funcion text, descripcion text, instrumentada boolean, ultima_fila timestamp with time zone, dias_sin_registro integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ultimas as (
    select u.funcion, max(u.created_at) as ultima
    from public.ia_uso u group by u.funcion
  ),
  mejor as (
    select t.funcion, max(t.ultima) as ultima from ultimas t group by t.funcion
  )
  select
    f.funcion,
    f.descripcion,
    f.instrumentada,
    m.ultima                                                       as ultima_fila,
    case when m.ultima is not null
         then extract(day from (now() - m.ultima))::integer end    as dias_sin_registro
  from public.ia_funciones f
  left join mejor m on m.funcion = f.funcion
  where f.activo
    and (m.ultima is null or m.ultima < now() - make_interval(days => greatest(coalesce(p_dias, 7), 1)))
  order by f.instrumentada desc, f.orden, f.funcion;
$function$;

-- [20260928193000_costes_sistema.sql]
comment on function public.ia_funciones_sin_registro(integer) is
  'Funciones del catalogo sin ninguna fila de uso en los ultimos p_dias dias. '
  'instrumentada = false -> agujero conocido (no registra todavia). '
  'instrumentada = true -> deberia registrar y no lo hace: algo se rompio.';

-- [20260928193000_costes_sistema.sql]
revoke all on function public.ia_funciones_sin_registro(integer) from public, anon;

-- [20260928193000_costes_sistema.sql]
grant execute on function public.ia_funciones_sin_registro(integer) to authenticated, service_role;

-- [20260928193000_costes_sistema.sql]
select cron.schedule(
  'ia-uso-retencion',
  '25 3 * * *',  -- 10 min despues del de chat_web_uso (15 3), para no solapar
  $$ delete from public.ia_uso where created_at < now() - interval '90 days'; $$
);

-- [20261001170000_rls_reservas_exige_edicion.sql] public.can_edit_section(text)
-- ---------------------------------------------------------------------------
-- 1) can_edit_section(text): la hermana de can_write_section() con 'edit'.
--    SECURITY DEFINER porque `authenticated` no puede ejecutar
--    has_section_permission() (y no debe: recibe un _user_id cualquiera).
--    Solo mira al usuario actual: (select auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_section(_section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_section_permission((select auth.uid()), _section, 'edit')
$$;

-- [20261001170000_rls_reservas_exige_edicion.sql]
comment on function public.can_edit_section(text) is
  'RLS: true si el usuario actual puede EDITAR esa sección del panel (can_edit en user_permissions) o es super admin. Hermana de can_write_section(), que sigue mirando can_view. 20261001170000.';

-- [20261001170000_rls_reservas_exige_edicion.sql]
-- Supabase da EXECUTE a anon y a PUBLIC por defecto en las funciones nuevas.
revoke all on function public.can_edit_section(text) from public, anon;

-- [20261001170000_rls_reservas_exige_edicion.sql]
grant execute on function public.can_edit_section(text) to authenticated, service_role;

-- [20261003160000_facturacion_oficiososia.sql]
create table public.oficiososia_facturacion_config (
  id boolean primary key default true check (id),
  documento jsonb not null check (jsonb_typeof(documento) = 'object'),
  actualizado_en timestamptz not null default clock_timestamp()
);

-- [20261003160000_facturacion_oficiososia.sql]
create table public.oficiososia_facturas (
  id uuid primary key,
  numero text not null unique check (length(btrim(numero)) between 1 and 60),
  documento jsonb not null check (jsonb_typeof(documento) = 'object'),
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp()
);

-- [20261003160000_facturacion_oficiososia.sql]
alter table public.oficiososia_facturacion_config enable row level security;

-- [20261003160000_facturacion_oficiososia.sql]
alter table public.oficiososia_facturas enable row level security;

-- [20261003160000_facturacion_oficiososia.sql]
create policy config_superadmin on public.oficiososia_facturacion_config for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

-- [20261003160000_facturacion_oficiososia.sql]
create policy facturas_superadmin on public.oficiososia_facturas for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

-- [20261003160000_facturacion_oficiososia.sql]
revoke all on public.oficiososia_facturacion_config, public.oficiososia_facturas from anon, authenticated;

-- [20261003160000_facturacion_oficiososia.sql]
grant select on public.oficiososia_facturacion_config, public.oficiososia_facturas to authenticated;

-- [20261003181000_facturacion_borradores.sql] public.oficiososia_facturacion_leer()
create or replace function public.oficiososia_facturacion_leer()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
 return jsonb_build_object(
 'config',(select to_jsonb(c) from public.oficiososia_facturacion_config c where c.id),
 'facturas',coalesce((select jsonb_agg(to_jsonb(f) order by f.creado_en desc) from public.oficiososia_facturas f),'[]'::jsonb),
 'borradores',coalesce((select jsonb_agg(to_jsonb(b) order by b.actualizado_en desc) from public.oficiososia_borradores b),'[]'::jsonb));
end;
$$;

-- [20261003160000_facturacion_oficiososia.sql] public.oficiososia_facturacion_guardar(jsonb,timestamptz,uuid,timestamptz)
create function public.oficiososia_facturacion_guardar(
  p_documento jsonb, p_version_config timestamptz,
  p_id uuid default null, p_version_factura timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_config public.oficiososia_facturacion_config;
  v_factura public.oficiososia_facturas;
  v_numero text;
begin
  if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
  if jsonb_typeof(p_documento) is distinct from 'object'
    or jsonb_typeof(p_documento->'lineas') is distinct from 'array'
    or octet_length(p_documento::text) > 200000 then
    raise exception 'Documento inválido';
  end if;
  if jsonb_array_length(p_documento->'lineas') not between 1 and 100 then raise exception 'Revisa los conceptos'; end if;
  -- Serializa el primer guardado y verifica versiones: no pisa ediciones de otro superadmin.
  perform pg_catalog.pg_advisory_xact_lock(610031600);
  select * into v_config from public.oficiososia_facturacion_config where id for update;
  if v_config.actualizado_en is distinct from p_version_config then
    raise exception 'La configuración ha cambiado. Recarga y revisa antes de guardar.';
  end if;
  if p_id is not null then
    v_numero := btrim(p_documento->>'numero');
    if v_numero is null or length(v_numero) not between 1 and 60 then raise exception 'Indica el número de factura'; end if;
    select * into v_factura from public.oficiososia_facturas where id = p_id for update;
    if v_factura.actualizado_en is distinct from p_version_factura then
      raise exception 'La factura ha cambiado. Recarga y revisa antes de guardar.';
    end if;
    insert into public.oficiososia_facturas (id, numero, documento, creado_por)
      values (p_id, v_numero, jsonb_set(p_documento, '{numero}', to_jsonb(v_numero)), auth.uid())
    on conflict (id) do update set numero = excluded.numero, documento = excluded.documento, actualizado_en = clock_timestamp();
  end if;
  insert into public.oficiososia_facturacion_config (id, documento)
    values (true, p_documento)
  on conflict (id) do update set documento = excluded.documento, actualizado_en = clock_timestamp();
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.oficiososia_facturacion_config c where c.id),
    'factura', (select to_jsonb(f) from public.oficiososia_facturas f where f.id = p_id)
  );
end;
$$;

-- [20261003160000_facturacion_oficiososia.sql]
revoke all on function public.oficiososia_facturacion_leer() from public;

-- [20261003160000_facturacion_oficiososia.sql]
revoke all on function public.oficiososia_facturacion_guardar(jsonb,timestamptz,uuid,timestamptz) from public;

-- [20261003160000_facturacion_oficiososia.sql]
grant execute on function public.oficiososia_facturacion_leer() to authenticated;

-- [20261003160000_facturacion_oficiososia.sql]
grant execute on function public.oficiososia_facturacion_guardar(jsonb,timestamptz,uuid,timestamptz) to authenticated;

-- [20261003181000_facturacion_borradores.sql]
create table public.oficiososia_borradores (
 id uuid primary key,
 numero text not null,
 documento jsonb not null check(jsonb_typeof(documento)='object'),
 factura_id uuid references public.oficiososia_facturas(id) on delete set null,
 creado_en timestamptz not null default clock_timestamp(),
 actualizado_en timestamptz not null default clock_timestamp()
);

-- [20261003181000_facturacion_borradores.sql]
alter table public.oficiososia_borradores enable row level security;

-- [20261003181000_facturacion_borradores.sql]
create policy borradores_superadmin on public.oficiososia_borradores for select to authenticated
 using ((select public.is_super_admin((select auth.uid()))));

-- [20261003181000_facturacion_borradores.sql]
revoke all on public.oficiososia_borradores from anon, authenticated;

-- [20261003181000_facturacion_borradores.sql]
grant select on public.oficiososia_borradores to authenticated;

-- [20261003181000_facturacion_borradores.sql] public.oficiososia_facturacion_guardar_v2(jsonb,timestamptz,uuid,timestamptz,uuid,timestamptz,boolean,uuid)
create function public.oficiososia_facturacion_guardar_v2(
 p_documento jsonb,p_version_config timestamptz,
 p_id uuid default null,p_version_factura timestamptz default null,
 p_borrador_id uuid default null,p_version_borrador timestamptz default null,
 p_emitir boolean default false,p_factura_origen uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_resultado jsonb; v_borrador public.oficiososia_borradores;
begin
 if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
 perform pg_catalog.pg_advisory_xact_lock(610031600);
 if p_borrador_id is not null then
  select * into v_borrador from public.oficiososia_borradores where id=p_borrador_id for update;
  if v_borrador.actualizado_en is distinct from p_version_borrador then raise exception 'El borrador ha cambiado. Recarga antes de guardar.'; end if;
 end if;
 if p_emitir and p_id is null then raise exception 'Indica la factura a emitir'; end if;
 v_resultado:=public.oficiososia_facturacion_guardar(p_documento,p_version_config,
  case when p_emitir then p_id else null end,case when p_emitir then p_version_factura else null end);
 if p_borrador_id is not null then
  if p_emitir then
   delete from public.oficiososia_borradores where id=p_borrador_id;
  else
   insert into public.oficiososia_borradores(id,numero,documento,factura_id)
    values(p_borrador_id,btrim(coalesce(p_documento->>'numero','')),p_documento,p_factura_origen)
   on conflict(id) do update set numero=excluded.numero,documento=excluded.documento,
    factura_id=excluded.factura_id,actualizado_en=clock_timestamp();
  end if;
 end if;
 return v_resultado || jsonb_build_object('borrador',(select to_jsonb(b) from public.oficiososia_borradores b where b.id=p_borrador_id),'borrador_eliminado',case when p_emitir then p_borrador_id else null end);
end;
$$;

-- [20261003181000_facturacion_borradores.sql]
revoke all on function public.oficiososia_facturacion_guardar_v2(jsonb,timestamptz,uuid,timestamptz,uuid,timestamptz,boolean,uuid) from public;

-- [20261003181000_facturacion_borradores.sql]
grant execute on function public.oficiososia_facturacion_guardar_v2(jsonb,timestamptz,uuid,timestamptz,uuid,timestamptz,boolean,uuid) to authenticated;

-- [20261003190000_facturacion_eliminar.sql] public.oficiososia_facturacion_eliminar(uuid,text,timestamptz)
create function public.oficiososia_facturacion_eliminar(p_id uuid,p_estado text,p_version timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_version timestamptz;
begin
 if public.is_super_admin(auth.uid()) is distinct from true then raise exception 'Acceso exclusivo de superadmin'; end if;
 if p_estado not in ('emitida','borrador') or p_estado is null then raise exception 'Estado inválido'; end if;
 perform pg_catalog.pg_advisory_xact_lock(610031600);
 if p_estado='emitida' then
  select actualizado_en into v_version from public.oficiososia_facturas where id=p_id for update;
 else
  select actualizado_en into v_version from public.oficiososia_borradores where id=p_id for update;
 end if;
 if v_version is null then raise exception 'La factura o el borrador ya no existe. Recarga la lista.'; end if;
 if v_version is distinct from p_version then raise exception 'El documento ha cambiado. Recarga antes de eliminar.'; end if;
 if p_estado='emitida' then
  update public.oficiososia_borradores set factura_id=null,actualizado_en=clock_timestamp() where factura_id=p_id;
  delete from public.oficiososia_facturas where id=p_id;
 else
  delete from public.oficiososia_borradores where id=p_id;
 end if;
 return public.oficiososia_facturacion_leer();
end;
$$;

-- [20261003190000_facturacion_eliminar.sql]
revoke all on function public.oficiososia_facturacion_eliminar(uuid,text,timestamptz) from public;

-- [20261003190000_facturacion_eliminar.sql]
grant execute on function public.oficiososia_facturacion_eliminar(uuid,text,timestamptz) to authenticated;

-- [20261007120000_audit_log.sql]
-- Auditoría del Admin Panel: quién entró (login/logout) y quién cambió qué
-- en las tablas de configuración y permisos sensibles. Solo lo lee el
-- super_admin (ver política de SELECT más abajo); el resto del personal no
-- tiene acceso a este rastro, ni falta que le hace para su trabajo diario.
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actor_user_id UUID,
  actor_email TEXT,
  accion TEXT NOT NULL CHECK (accion IN ('login', 'logout', 'crear', 'actualizar', 'eliminar')),
  tabla TEXT,
  registro_id TEXT,
  detalles JSONB,
  user_agent TEXT
);

-- [20261007120000_audit_log.sql]
COMMENT ON TABLE public.audit_log IS 'Rastro de auditoría del Admin Panel: accesos (login/logout, escritos por el cliente al iniciar/cerrar sesión) y cambios de datos (crear/actualizar/eliminar, escritos por fn_registrar_auditoria() vía trigger en las tablas sensibles — ver abajo). "detalles" guarda {antes, despues} en los cambios de datos y {user_agent} en los accesos. Sin paginación infinita pensada: una fila por evento, se lee desde /super-admin/auditoria con filtros.';

-- [20261007120000_audit_log.sql]
CREATE INDEX idx_audit_log_created_at ON public.audit_log(created_at DESC);

-- [20261007120000_audit_log.sql]
CREATE INDEX idx_audit_log_actor ON public.audit_log(actor_user_id);

-- [20261007120000_audit_log.sql]
CREATE INDEX idx_audit_log_tabla ON public.audit_log(tabla);

-- [20261007120000_audit_log.sql]
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- [20261007120000_audit_log.sql]
-- Solo super_admins leen el rastro completo.
CREATE POLICY "super_admins leen audit_log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

-- [20261007120000_audit_log.sql]
-- Cualquier usuario autenticado puede registrar SU PROPIO login/logout (lo
-- dispara el cliente justo al iniciar/cerrar sesión, ver src/hooks/useAuth.ts).
-- Los cambios de datos (crear/actualizar/eliminar) los escribe el trigger de
-- abajo, que es SECURITY DEFINER y por tanto no necesita (ni usa) esta
-- política para insertar.
CREATE POLICY "cada usuario registra su propio acceso"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (accion IN ('login', 'logout') AND actor_user_id = auth.uid());

-- [override] fn_registrar_auditoria
-- Disparador de auditoría de todas las tablas del panel (y de auth.users y storage.objects).
CREATE OR REPLACE FUNCTION public.fn_registrar_auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid(); v_actor_email text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_antes jsonb; v_despues jsonb; v_fila jsonb; v_detalles jsonb;
  v_accion text; v_tabla text; v_registro_id text; v_pk jsonb;
  v_request_id text := v_headers ->> 'x-audit-request-id';
  v_user_agent text; v_device_id text; v_ip text;
  v_contexto_id uuid; v_subject_id uuid; v_subject_email text;
  v_permiso_antes jsonb; v_permiso_despues jsonb; v_campos jsonb;
  v_tiempos text[] := ARRAY['created_at','updated_at','actualizado_en','modified_at'];
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND NOT public.audit_tabla_util(TG_TABLE_NAME) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  v_antes := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_fila := coalesce(v_despues, v_antes);
  v_tabla := CASE WHEN TG_TABLE_SCHEMA = 'public' THEN TG_TABLE_NAME ELSE TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME END;
  v_accion := CASE TG_OP WHEN 'INSERT' THEN 'crear' WHEN 'DELETE' THEN 'eliminar' ELSE 'actualizar' END;
  IF TG_OP = 'UPDATE' AND (v_antes - v_tiempos) IS NOT DISTINCT FROM (v_despues - v_tiempos) THEN RETURN NEW; END IF;

  IF v_actor_id IS NULL AND auth.role() = 'service_role' THEN
    v_actor_id := nullif(v_headers ->> 'x-audit-actor-id', '')::uuid;
  END IF;
  IF v_actor_id IS NULL AND session_user = 'supabase_auth_admin' THEN
    v_contexto_id := nullif(current_setting('audit.auth_context_id', true), '')::uuid;
    IF v_contexto_id IS NOT NULL THEN
      SELECT c.actor_user_id, c.actor_email, c.request_id,c.user_agent,c.device_id,c.ip_address INTO v_actor_id, v_actor_email, v_request_id,v_user_agent,v_device_id,v_ip
      FROM public.audit_auth_context c WHERE c.id = v_contexto_id AND c.expires_at >= clock_timestamp();
    END IF;
    -- Compatibilidad con una cascada que llega sin el BEFORE del usuario.
    IF v_actor_id IS NULL THEN
      v_subject_id := nullif(coalesce(v_fila ->> 'user_id', CASE WHEN TG_TABLE_NAME IN ('users','profiles') THEN v_fila ->> 'id' END), '')::uuid;
      SELECT email INTO v_subject_email FROM auth.users WHERE id = v_subject_id;
      SELECT c.actor_user_id, c.actor_email, c.request_id,c.user_agent,c.device_id,c.ip_address INTO v_actor_id, v_actor_email, v_request_id,v_user_agent,v_device_id,v_ip
      FROM public.audit_auth_context c
      WHERE c.operacion = v_accion AND c.expires_at >= clock_timestamp()
        AND (c.subject_user_id = v_subject_id OR
          (c.subject_user_id IS NULL AND lower(c.subject_email) = lower(coalesce(v_subject_email,v_fila ->> 'email'))))
      LIMIT 1;
    END IF;
  END IF;

  -- auditoria_storage_owner: Storage inserta en storage.objects SIN las claims
  -- del usuario (auth.uid() llega NULL) pero rellena owner_id con el sub del
  -- JWT. Para ese esquema, y solo si aún no hay actor, el responsable es el
  -- propietario de la fila. Sin propietario válido (subida anónima en un bucket
  -- público) se trata como las escrituras anónimas: ni se bloquea ni se audita.
  -- El service_role sigue sus reglas de siempre.
  IF v_actor_id IS NULL AND TG_TABLE_SCHEMA = 'storage' THEN
    v_subject_id := NULL;
    BEGIN
      v_subject_id := nullif(coalesce(v_fila ->> 'owner_id', v_fila ->> 'owner'), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_subject_id := NULL;
    END;
    IF v_subject_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_subject_id) THEN
      v_subject_id := NULL;
    END IF;
    v_actor_id := v_subject_id;
    IF v_actor_id IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- Las escrituras públicas anónimas de la web no son operaciones del panel.
  -- Las tablas sensibles del panel continúan rechazándolas.
  IF v_actor_id IS NULL AND auth.role() = 'anon' AND TG_TABLE_SCHEMA <> 'auth'
     AND TG_TABLE_NAME <> ALL(ARRAY['user_roles','user_permissions','super_admins','admin_feature_toggles',
       'user_role_presets','servicios_config','servicios_contratados','avisos_telegram_config']) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_actor_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(email), ''), v_actor_email) INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
  END IF;

  IF TG_TABLE_SCHEMA = 'auth' THEN
    IF TG_OP = 'UPDATE'
      AND (v_antes -> 'encrypted_password') IS NOT DISTINCT FROM (v_despues -> 'encrypted_password')
      AND (v_antes -> 'email') IS NOT DISTINCT FROM (v_despues -> 'email')
      AND (v_antes -> 'banned_until') IS NOT DISTINCT FROM (v_despues -> 'banned_until') THEN RETURN NEW; END IF;
    v_detalles := jsonb_build_object('credenciales_actualizadas', TG_OP = 'UPDATE' AND
      (v_antes -> 'encrypted_password') IS DISTINCT FROM (v_despues -> 'encrypted_password'));
    v_antes := CASE WHEN v_antes IS NULL THEN NULL ELSE jsonb_build_object('id',v_antes -> 'id','email',v_antes -> 'email','banned_until',v_antes -> 'banned_until') END;
    v_despues := CASE WHEN v_despues IS NULL THEN NULL ELSE jsonb_build_object('id',v_despues -> 'id','email',v_despues -> 'email','banned_until',v_despues -> 'banned_until') END;
  ELSE v_detalles := '{}'::jsonb;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(jsonb_agg(k), '[]'::jsonb) INTO v_campos FROM (
      SELECT key AS k FROM jsonb_object_keys(coalesce(v_antes,'{}') || coalesce(v_despues,'{}')) key
      WHERE key <> ALL(v_tiempos) AND (v_antes -> key) IS DISTINCT FROM (v_despues -> key)
    ) cambios;
    v_detalles := v_detalles || jsonb_build_object('campos_modificados',v_campos);
  END IF;
  v_detalles := v_detalles || CASE TG_OP
    WHEN 'DELETE' THEN jsonb_build_object('antes',public.fn_audit_sanitizar(v_antes))
    WHEN 'UPDATE' THEN jsonb_build_object('antes',public.fn_audit_sanitizar(v_antes),'despues',public.fn_audit_sanitizar(v_despues))
    ELSE jsonb_build_object('despues',public.fn_audit_sanitizar(v_despues)) END;

  IF TG_TABLE_NAME = 'user_permissions' THEN
    v_permiso_antes := public.fn_audit_estado_permiso(v_antes,v_fila);
    v_permiso_despues := public.fn_audit_estado_permiso(v_despues,v_fila);
    IF v_permiso_antes = v_permiso_despues THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END IF;
    v_accion := 'actualizar';
    v_detalles := v_detalles || jsonb_build_object('permiso_antes',v_permiso_antes,'permiso_despues',v_permiso_despues,
      'operacion_permiso',CASE TG_OP WHEN 'INSERT' THEN 'conceder' WHEN 'DELETE' THEN 'retirar' ELSE 'modificar' END);
  ELSIF TG_TABLE_NAME IN ('user_roles','super_admins') THEN
    v_accion := 'actualizar';
    v_detalles := v_detalles || jsonb_build_object('operacion_asignacion',CASE TG_OP WHEN 'INSERT' THEN 'asignar' WHEN 'DELETE' THEN 'retirar' ELSE 'modificar' END);
  END IF;

  SELECT jsonb_object_agg(a.attname, v_fila -> a.attname) INTO v_pk
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.contype = 'p' AND c.conrelid = TG_RELID;
  v_registro_id := coalesce(v_fila ->> 'id', v_pk::text, v_fila ->> 'user_id', 'huella:' || md5(v_fila::text));
  v_detalles := v_detalles || jsonb_build_object('operacion_sql',TG_OP,'request_id',v_request_id);
  INSERT INTO public.audit_log(actor_user_id,actor_email,accion,tabla,registro_id,detalles,user_agent,device_id,ip_address,request_id)
  VALUES(v_actor_id,v_actor_email,v_accion,v_tabla,v_registro_id,v_detalles,v_user_agent,v_device_id,v_ip,v_request_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
-- Conserva la identidad del actor, incluida la creación/baja vía GoTrue:
-- las cabeceras del cliente administrativo no llegan a sus cascadas SQL.
-- No se atribuyen cambios al user_id del registro: ese es el destinatario.
CREATE TABLE public.audit_auth_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  actor_email text,
  operacion text NOT NULL CHECK (operacion IN ('crear', 'eliminar')),
  subject_user_id uuid,
  subject_email text,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '2 minutes',
  CHECK (subject_user_id IS NOT NULL OR nullif(btrim(subject_email), '') IS NOT NULL)
);

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_auth_context ENABLE ROW LEVEL SECURITY;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
REVOKE ALL ON public.audit_auth_context FROM PUBLIC, anon, authenticated;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
GRANT SELECT, INSERT, DELETE ON public.audit_auth_context TO service_role;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
CREATE UNIQUE INDEX audit_auth_context_subject_id ON public.audit_auth_context (subject_user_id);

-- [20261007190000_audit_log_identidad_obligatoria.sql]
CREATE UNIQUE INDEX audit_auth_context_subject_email ON public.audit_auth_context (lower(subject_email));

-- [20261007220000_audit_log_panel_completo.sql] public.preparar_contexto_auditoria_auth(uuid,text,uuid,text)
CREATE OR REPLACE FUNCTION public.preparar_contexto_auditoria_auth(
  p_actor_id uuid, p_operacion text, p_user_id uuid DEFAULT NULL, p_email text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email text; v_id uuid;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El actor debe ser un usuario existente'; END IF;
  DELETE FROM public.audit_auth_context WHERE expires_at < clock_timestamp();
  INSERT INTO public.audit_auth_context (actor_user_id, actor_email, operacion, subject_user_id, subject_email, request_id,user_agent,device_id,ip_address)
  VALUES (p_actor_id, v_email, p_operacion, p_user_id, lower(nullif(btrim(p_email), '')),
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-request-id',
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-user-agent',
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-device-id',
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-audit-ip')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
REVOKE ALL ON FUNCTION public.preparar_contexto_auditoria_auth(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
GRANT EXECUTE ON FUNCTION public.preparar_contexto_auditoria_auth(uuid, text, uuid, text) TO service_role;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_log ADD COLUMN actor_label text;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_log ADD COLUMN actor_origin text;

-- [20261008080000_audit_accesos_dispositivos.sql] public.fn_identificar_actor_auditoria()
CREATE OR REPLACE FUNCTION public.fn_identificar_actor_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_email text; v_role text := nullif(auth.role(),'');
 v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 v_source text := nullif(btrim(v_headers->>'x-audit-source'),'');
 v_client text := v_headers->>'x-client-info';
BEGIN
 -- Metadatos informativos del transporte. Las cabeceras no prueban quién actúa.
 IF v_role = 'service_role' THEN
   NEW.user_agent := left(coalesce(v_headers->>'x-audit-user-agent',NEW.user_agent),1024);
   NEW.device_id := left(coalesce(v_headers->>'x-audit-device-id',NEW.device_id),128);
   NEW.ip_address := left(coalesce(v_headers->>'x-audit-ip',NEW.ip_address),128);
   NEW.request_id := left(coalesce(v_headers->>'x-audit-request-id',NEW.request_id),128);
 ELSIF v_role IS NOT NULL THEN
   NEW.user_agent := left(coalesce(v_headers->>'user-agent',NEW.user_agent),1024);
   NEW.device_id := CASE WHEN v_client LIKE 'adminpanel/%' THEN left(split_part(v_client,'/',2),128) END;
   NEW.request_id := CASE WHEN v_client LIKE 'adminpanel/%' THEN left(split_part(v_client,'/',3),128) END;
   NEW.ip_address := left(split_part(v_headers->>'x-forwarded-for',',',1),128);
   NEW.session_id := left(v_claims->>'session_id',128);
 END IF;
 IF auth.uid() IS NOT NULL THEN NEW.actor_user_id := auth.uid(); END IF;
 IF NEW.actor_user_id IS NOT NULL THEN
   SELECT email INTO v_email FROM auth.users WHERE id=NEW.actor_user_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Auditoría: el usuario responsable no existe' USING ERRCODE='28000'; END IF;
   NEW.actor_email := nullif(btrim(v_email),'');
   NEW.actor_origin := 'usuario';
   NEW.actor_label := coalesce(NEW.actor_email,'Usuario · '||NEW.actor_user_id::text);
 ELSIF v_role='service_role' AND v_source='panel-auth' AND NEW.accion IN ('intento_login','login_fallido') AND NEW.tabla='accesos_panel' THEN
   NEW.actor_email := NULL; NEW.actor_origin := 'intento';
   NEW.actor_label := coalesce(nullif(left(NEW.detalles->>'email_introducido',255),''),'Sin correo introducido') || ' · identidad no verificada';
 ELSIF v_role='service_role' THEN
   IF v_source IS NULL OR v_source IN ('admin-create-user','admin-delete-user','admin-set-super-admin','admin-update-user-password') THEN
     RAISE EXCEPTION 'Auditoría: falta el usuario responsable o el origen del proceso' USING ERRCODE='28000';
   END IF;
   NEW.actor_email := NULL; NEW.actor_origin := 'servicio'; NEW.actor_label := 'API · service_role · '||v_source;
 ELSIF v_role IS NULL AND session_user NOT IN ('supabase_auth_admin','authenticator','anon','authenticated','service_role') THEN
   NEW.actor_email := NULL; NEW.actor_origin := 'base_de_datos'; NEW.actor_label := 'Base de datos · '||session_user;
 ELSE RAISE EXCEPTION 'Auditoría: no se ha identificado al responsable' USING ERRCODE='28000';
 END IF;
 IF NEW.accion IN ('login','logout','acceso','acceso_denegado') AND NEW.actor_origin<>'usuario' THEN
   RAISE EXCEPTION 'El acceso requiere un usuario verificado' USING ERRCODE='28000';
 END IF;
 NEW.detalles := public.fn_audit_sanitizar(NEW.detalles);
 RETURN NEW;
END $$;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
CREATE TRIGGER trg_identificar_actor_auditoria BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.fn_identificar_actor_auditoria();

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_log ALTER COLUMN actor_label SET NOT NULL;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_log ALTER COLUMN actor_origin SET NOT NULL;

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_label_no_vacio CHECK (btrim(actor_label) <> '');

-- [20261007190000_audit_log_identidad_obligatoria.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_origin_valido
  CHECK (actor_origin IN ('usuario', 'servicio', 'base_de_datos', 'historico'));

-- [20261007190000_audit_log_identidad_obligatoria.sql]
COMMENT ON COLUMN public.audit_log.actor_label IS 'Identidad persistente del usuario o de la conexión que ejecutó la acción. Los históricos sin evidencia de autor conservan su ID y se distinguen explícitamente.';

-- [20261007200000_audit_log_limpiar_y_exigir_identidad.sql]
-- Tras vaciar el histórico, ninguna fila futura puede ser un histórico
-- sin autor ni tener una identidad vacía. Los checks no dependen del cliente.
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_solo_identidades_verificadas
  CHECK (
    actor_origin IN ('usuario', 'servicio', 'base_de_datos')
    AND btrim(actor_label) <> ''
    AND (actor_origin <> 'usuario' OR actor_user_id IS NOT NULL)
  );

-- [20261007200000_audit_log_limpiar_y_exigir_identidad.sql]
COMMENT ON CONSTRAINT audit_log_solo_identidades_verificadas ON public.audit_log
  IS 'La auditoría exige un usuario existente, un proceso de servicio identificado o una cuenta SQL directa. Si no se puede identificar, se cancela la operación original.';

-- [20261007210000_audit_log_cambios_permisos.sql] public.fn_audit_estado_permiso(jsonb,jsonb)
-- Estado efectivo del acceso; una fila ausente equivale a no ver/no editar.
-- Se conserva aparte el antes/después físico del registro para trazabilidad.
CREATE OR REPLACE FUNCTION public.fn_audit_estado_permiso(p_fila jsonb, p_referencia jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_id', coalesce(p_fila ->> 'user_id', p_referencia ->> 'user_id'),
    'section_key', coalesce(p_fila ->> 'section_key', p_referencia ->> 'section_key'),
    'can_view', coalesce((p_fila ->> 'can_view')::boolean, false)
                OR coalesce((p_fila ->> 'can_edit')::boolean, false),
    'can_edit', coalesce((p_fila ->> 'can_edit')::boolean, false)
  );
$$;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device_id text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS request_id text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS session_id text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS user_agent text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS device_id text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS ip_address text;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_accion_check;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_accion_check
  CHECK (accion IN ('login','logout','crear','actualizar','eliminar','ejecutar'));

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_auth_context DROP CONSTRAINT audit_auth_context_operacion_check;

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_auth_context ADD CONSTRAINT audit_auth_context_operacion_check
  CHECK (operacion IN ('crear', 'actualizar', 'eliminar'));

-- [20261007213000_audit_preparar_servidor.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS request_id text;

-- [20261007213000_audit_preparar_servidor.sql]
REVOKE ALL ON FUNCTION public.preparar_contexto_auditoria_auth(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;

-- [20261007213000_audit_preparar_servidor.sql]
GRANT EXECUTE ON FUNCTION public.preparar_contexto_auditoria_auth(uuid,text,uuid,text) TO service_role;

-- [20261007220000_audit_log_panel_completo.sql] public.fn_audit_sanitizar(jsonb)
-- Nunca persistir secretos, tampoco dentro de objetos o listas anidadas.
CREATE OR REPLACE FUNCTION public.fn_audit_sanitizar(p_dato jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE v_resultado jsonb; v_clave text; v_valor jsonb;
BEGIN
  IF p_dato IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_dato) = 'object' THEN
    v_resultado := '{}'::jsonb;
    FOR v_clave, v_valor IN SELECT key,value FROM jsonb_each(p_dato) LOOP
      v_resultado := v_resultado || jsonb_build_object(v_clave,
        CASE WHEN v_clave ~* '(password|passwd|secret|token|api_?key|authorization|verification_code|base64|embedding)'
        THEN to_jsonb('[oculto]'::text) ELSE public.fn_audit_sanitizar(v_valor) END);
    END LOOP;
    RETURN v_resultado;
  ELSIF jsonb_typeof(p_dato) = 'array' THEN
    SELECT coalesce(jsonb_agg(public.fn_audit_sanitizar(value)), '[]'::jsonb)
    INTO v_resultado FROM jsonb_array_elements(p_dato);
    RETURN v_resultado;
  END IF;
  RETURN p_dato;
END;
$$;

-- [override] registrar_accion_auditoria_panel
-- Acciones del servidor (Edge Functions) en la auditoría.
CREATE OR REPLACE FUNCTION public.registrar_accion_auditoria_panel(p_operacion text, p_detalles jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  v_actor uuid; v_id uuid; v_fuente text; v_detalles jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Solo el servidor registra estas acciones'; END IF;
  v_actor := nullif(v_headers->>'x-audit-actor-id','')::uuid;
  v_fuente := nullif(btrim(v_headers->>'x-audit-source'),'');
  IF v_actor IS NULL OR v_fuente IS NULL OR nullif(btrim(p_operacion),'') IS NULL THEN RAISE EXCEPTION 'Acción sin autor u origen'; END IF;
  v_detalles := jsonb_build_object('operacion',p_operacion,'origen',v_fuente,'request_id',v_headers->>'x-audit-request-id',
    'resultado',p_detalles->>'resultado','codigo_http',p_detalles->'codigo_http');
  INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
  VALUES(v_actor,'ejecutar','acciones_servidor',v_fuente,v_detalles) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- [20261007213000_audit_preparar_servidor.sql]
REVOKE ALL ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) FROM PUBLIC,anon,authenticated;

-- [20261007213000_audit_preparar_servidor.sql]
GRANT EXECUTE ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) TO service_role;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device_id text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS request_id text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS session_id text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS user_agent text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS device_id text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS ip_address text;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_accion_check;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_accion_check
  CHECK (accion IN ('login','logout','crear','actualizar','eliminar','ejecutar'));

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_auth_context DROP CONSTRAINT audit_auth_context_operacion_check;

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_auth_context ADD CONSTRAINT audit_auth_context_operacion_check
  CHECK (operacion IN ('crear', 'actualizar', 'eliminar'));

-- [20261007220000_audit_log_panel_completo.sql]
ALTER TABLE public.audit_auth_context ADD COLUMN IF NOT EXISTS request_id text;

-- [20261007220000_audit_log_panel_completo.sql]
REVOKE ALL ON FUNCTION public.preparar_contexto_auditoria_auth(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;

-- [20261007220000_audit_log_panel_completo.sql]
GRANT EXECUTE ON FUNCTION public.preparar_contexto_auditoria_auth(uuid,text,uuid,text) TO service_role;

-- [20261007220000_audit_log_panel_completo.sql]
REVOKE ALL ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) FROM PUBLIC,anon,authenticated;

-- [20261007220000_audit_log_panel_completo.sql]
GRANT EXECUTE ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) TO service_role;

-- [20261012153701_auditoria_legible_chat_reversion.sql] public.listar_tablas_auditoria_panel()
CREATE OR REPLACE FUNCTION public.listar_tablas_auditoria_panel()
RETURNS TABLE(tabla text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT DISTINCT a.tabla FROM public.audit_log_visible a WHERE a.tabla IS NOT NULL
  UNION
  SELECT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND p.proname='fn_registrar_auditoria'
    AND public.audit_tabla_util(CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END)
    AND EXISTS(SELECT 1 FROM public.super_admins s WHERE s.user_id=auth.uid())
  ORDER BY 1
$$;

-- [20261007220000_audit_log_panel_completo.sql]
REVOKE ALL ON FUNCTION public.listar_tablas_auditoria_panel() FROM PUBLIC,anon;

-- [20261007220000_audit_log_panel_completo.sql]
GRANT EXECUTE ON FUNCTION public.listar_tablas_auditoria_panel() TO authenticated;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS device_id text;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address text;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS request_id text;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS session_id text;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_accion_check;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_accion_check CHECK
 (accion IN ('login','logout','crear','actualizar','eliminar','ejecutar','intento_login','login_fallido','acceso','acceso_denegado'));

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_actor_origin_valido;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_origin_valido CHECK
 (actor_origin IN ('usuario','servicio','base_de_datos','intento'));

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_solo_identidades_verificadas;

-- [20261008080000_audit_accesos_dispositivos.sql]
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_solo_identidades_verificadas CHECK (
 btrim(actor_label) <> '' AND
 ((actor_origin = 'usuario' AND actor_user_id IS NOT NULL) OR
  actor_origin IN ('servicio','base_de_datos') OR
  (actor_origin = 'intento' AND actor_user_id IS NULL AND actor_email IS NULL
   AND accion IN ('intento_login','login_fallido') AND tabla = 'accesos_panel')));

-- [20261008080000_audit_accesos_dispositivos.sql]
CREATE INDEX IF NOT EXISTS idx_audit_dispositivo ON public.audit_log(device_id,created_at DESC);

-- [20261008080000_audit_accesos_dispositivos.sql]
CREATE INDEX IF NOT EXISTS idx_audit_accesos_ip ON public.audit_log(ip_address,created_at DESC) WHERE tabla='accesos_panel';

-- [20261030200000_panel_auth_cubo_sin_ip.sql] public.iniciar_intento_panel(text,text)
create or replace function public.iniciar_intento_panel(p_email text, p_ruta text default '/auth')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_ip        constant integer  := 30;                    -- por cubo de IP y minuto
  c_max_email     constant integer  := 10;                    -- por email ...
  c_ventana_email constant interval := interval '15 minutes'; -- ... en esta ventana
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip      text;
  v_email   text := left(lower(btrim(coalesce(p_email, ''))), 255);
  v_id      uuid;
  v_n_ip    bigint;
  v_n_email bigint;
  v_motivo  text;
begin
  if auth.role() is distinct from 'service_role' or v_headers->>'x-audit-source' is distinct from 'panel-auth' then
    raise exception 'Solo panel-auth';
  end if;
  -- Misma normalización que el conteo: '' / ausente -> 'sin-ip'. El trigger
  -- guarda left(x-audit-ip, 128), así que se recorta igual antes de comparar.
  v_ip := coalesce(nullif(left(v_headers->>'x-audit-ip', 128), ''), 'sin-ip');

  perform pg_advisory_xact_lock(hashtextextended('panel-auth:' || v_ip, 0));
  perform pg_advisory_xact_lock(hashtextextended('panel-auth-email:' || v_email, 0));

  select count(*) into v_n_ip from public.audit_log
  where tabla = 'accesos_panel'
    and detalles ? 'email_introducido'
    and coalesce(nullif(ip_address, ''), 'sin-ip') = v_ip
    and created_at > clock_timestamp() - interval '1 minute';

  select count(*) into v_n_email from public.audit_log
  where tabla = 'accesos_panel'
    and detalles->>'email_introducido' = v_email
    and created_at > clock_timestamp() - c_ventana_email
    and coalesce(detalles->>'resultado', '') not in ('limite_intentos', 'correcto');

  if v_n_ip >= c_max_ip then
    v_motivo := 'ip';
  elsif v_n_email >= c_max_email then
    v_motivo := 'email';
  end if;

  insert into public.audit_log (accion, tabla, detalles)
  values (
    case when v_motivo is not null then 'login_fallido' else 'intento_login' end,
    'accesos_panel',
    jsonb_build_object(
      'email_introducido', v_email,
      'ruta', case when p_ruta = '/super-admin/login' then p_ruta else '/auth' end,
      'resultado', case when v_motivo is not null then 'limite_intentos' else 'pendiente' end,
      'identidad_verificada', false)
    || case when v_motivo is not null then jsonb_build_object('limite', v_motivo) else '{}'::jsonb end)
  returning id into v_id;

  if v_motivo is not null then
    return jsonb_build_object('id', v_id, 'permitido', false, 'motivo', v_motivo);
  end if;
  return jsonb_build_object('id', v_id, 'permitido', true);
end;
$$;

-- [20261008080000_audit_accesos_dispositivos.sql] public.finalizar_intento_panel(uuid,uuid,text,text)
CREATE OR REPLACE FUNCTION public.finalizar_intento_panel(p_id uuid,p_actor uuid DEFAULT NULL,p_resultado text DEFAULT 'credenciales_invalidas',p_session_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 v_email text; v_intento public.audit_log%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR v_headers->>'x-audit-source' IS DISTINCT FROM 'panel-auth' THEN RAISE EXCEPTION 'Solo panel-auth'; END IF;
 SELECT * INTO v_intento FROM public.audit_log WHERE id=p_id AND tabla='accesos_panel' AND accion='intento_login' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'El intento no existe o ya terminó'; END IF;
 IF v_intento.request_id IS DISTINCT FROM v_headers->>'x-audit-request-id' THEN RAISE EXCEPTION 'El intento pertenece a otra petición'; END IF;
 IF p_actor IS NOT NULL THEN
   SELECT email INTO v_email FROM auth.users WHERE id=p_actor;
   IF NOT FOUND OR lower(v_email) IS DISTINCT FROM v_intento.detalles->>'email_introducido' THEN RAISE EXCEPTION 'Usuario no verificado para este intento'; END IF;
 END IF;
 UPDATE public.audit_log SET
  accion=CASE WHEN p_actor IS NULL THEN 'login_fallido' ELSE 'login' END,
  actor_user_id=p_actor,actor_email=v_email,
  actor_origin=CASE WHEN p_actor IS NULL THEN 'intento' ELSE 'usuario' END,
  actor_label=CASE WHEN p_actor IS NULL THEN actor_label ELSE coalesce(nullif(v_email,''),'Usuario · '||p_actor::text) END,
  session_id=CASE WHEN p_actor IS NOT NULL THEN left(p_session_id,128) END,
  detalles=detalles||jsonb_build_object('resultado',CASE WHEN p_actor IS NOT NULL THEN 'correcto'
    WHEN p_resultado IN ('credenciales_invalidas','error_servicio','peticion_invalida') THEN p_resultado ELSE 'credenciales_invalidas' END,
    'identidad_verificada',p_actor IS NOT NULL,'finalizado_en',clock_timestamp())
 WHERE id=p_id;
END $$;

-- [20261008080000_audit_accesos_dispositivos.sql]
REVOKE ALL ON FUNCTION public.iniciar_intento_panel(text,text), public.finalizar_intento_panel(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

-- [20261008080000_audit_accesos_dispositivos.sql]
GRANT EXECUTE ON FUNCTION public.iniciar_intento_panel(text,text), public.finalizar_intento_panel(uuid,uuid,text,text) TO service_role;

-- [20261008080000_audit_accesos_dispositivos.sql] public.registrar_acceso_panel(text,text)
CREATE OR REPLACE FUNCTION public.registrar_acceso_panel(p_tipo text,p_ruta text DEFAULT '/')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR p_tipo NOT IN ('acceso','acceso_denegado','logout') THEN RAISE EXCEPTION 'Acceso no permitido'; END IF;
 INSERT INTO public.audit_log(actor_user_id,accion,tabla,detalles)
 VALUES(auth.uid(),p_tipo,'accesos_panel',jsonb_build_object('ruta',left(split_part(coalesce(p_ruta,'/'),'?',1),200),
  'resultado',CASE p_tipo WHEN 'acceso_denegado' THEN 'denegado' WHEN 'logout' THEN 'cierre_solicitado' ELSE 'sesion_validada' END,
  'identidad_verificada',true)) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

-- [20261008080000_audit_accesos_dispositivos.sql]
REVOKE ALL ON FUNCTION public.registrar_acceso_panel(text,text) FROM PUBLIC,anon;

-- [20261008080000_audit_accesos_dispositivos.sql]
GRANT EXECUTE ON FUNCTION public.registrar_acceso_panel(text,text) TO authenticated;

-- [20261008080000_audit_accesos_dispositivos.sql]
-- La identidad y los metadatos se resuelven en las RPC, no en INSERT público.
DROP POLICY IF EXISTS "cada usuario registra su propio acceso" ON public.audit_log;

-- [20261008080000_audit_accesos_dispositivos.sql] public.version_auditoria_panel()
-- Aplicar esta migración DESPUÉS de desplegar panel-auth.
CREATE OR REPLACE FUNCTION public.version_auditoria_panel()
RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 2 $$;

-- [20261008080000_audit_accesos_dispositivos.sql]
GRANT EXECUTE ON FUNCTION public.version_auditoria_panel() TO anon,authenticated;

-- [20261008093000_audit_version_search_path.sql]
-- Fijar el contexto de la RPC de disponibilidad, como las demás RPC de auditoría.
ALTER FUNCTION public.version_auditoria_panel() SET search_path = pg_catalog;

-- [20261008110000_ia_funciones_ocr_instrumentado.sql]
do $$
begin
  if to_regclass('public.ia_uso') is null or to_regclass('public.ia_funciones') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'ia_funciones_ocr_instrumentado: faltan ia_uso / ia_funciones / can_read_section / is_super_admin. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261008110000_ia_funciones_ocr_instrumentado.sql]
-- ─── 1. Catálogo de funciones ───────────────────────────────────────────────
update public.ia_funciones
   set instrumentada = true,
       descripcion = 'OCR de una factura o albarán por el camino síncrono (una página) y al sustituir un duplicado. '
                     'Registra cada llamada (lectura, relectura, pie, contador, embeddings) en ia_uso desde el 08/10/2026.'
 where funcion = 'procesar-factura';

-- [20261008110000_ia_funciones_ocr_instrumentado.sql]
insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo)
values ('ocr-trabajo',
        'OCR en segundo plano (piezas de documentos largos, pieza única, consolidación con embeddings). '
        'Registra cada llamada en ia_uso con disparador trabajo:<uuid>#<etapa> desde el 08/10/2026.',
        true, 'documento', 25, true)
on conflict (funcion) do update
  set instrumentada = true,
      descripcion   = excluded.descripcion,
      unidad        = excluded.unidad;

-- [20261008150000_openai_costes_reales.sql]
do $$
begin
  if to_regclass('public.ia_uso') is null
     or to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'openai_costes_reales: faltan ia_uso / can_read_section / is_super_admin. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'openai_costes_reales: falta la extensión pg_cron. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'openai_costes_reales: falta la extensión pg_net. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'openai_costes_reales: falta la extensión supabase_vault. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261008150000_openai_costes_reales.sql]
-- ─── 1. Tablas ──────────────────────────────────────────────────────────────
create table if not exists public.openai_proyectos (
  project_id text primary key check (length(project_id) between 1 and 120),
  proceso    text check (proceso is null or proceso in ('ocr', 'chat', 'otros')),
  nombre     text check (nombre is null or length(nombre) <= 200),
  creado_en  timestamptz not null default now()
);

-- [20261008150000_openai_costes_reales.sql]
comment on table public.openai_proyectos is
  'Proyectos de OpenAI y el proceso al que pertenecen (ocr = carga de datos, chat = chatbot de facturas, '
  'otros = resto). La Edge Function sincronizar-costes-openai los da de alta con proceso NULL (y actualiza '
  'el nombre); el proceso lo asigna el dueño. Sin proceso, el coste sale como sin_asignar.';

-- [20261008150000_openai_costes_reales.sql]
create table if not exists public.openai_costes_diarios (
  fecha         date          not null,
  project_id    text          not null default '' check (length(project_id) <= 120),
  line_item     text          not null default '' check (length(line_item) <= 300),
  usd           numeric(16,6) not null,
  actualizado_en timestamptz  not null default now(),
  primary key (fecha, project_id, line_item)
);

-- [20261008150000_openai_costes_reales.sql]
comment on table public.openai_costes_diarios is
  'Gasto REAL facturado por OpenAI (GET /v1/organization/costs), por día UTC, proyecto y concepto. '
  '"" en project_id/line_item = sin proyecto/concepto. Lo escribe solo sincronizar-costes-openai (service_role). '
  'El día en curso es parcial; las RPC usan solo días cerrados.';

-- [20261008150000_openai_costes_reales.sql]
create table if not exists public.tipo_cambio_usd_eur (
  fecha          date          primary key,
  eur_por_usd    numeric(12,6) not null check (eur_por_usd > 0.2 and eur_por_usd < 5),
  fuente         text          not null default 'bce' check (length(fuente) <= 40),
  actualizado_en timestamptz   not null default now()
);

-- [20261008150000_openai_costes_reales.sql]
comment on table public.tipo_cambio_usd_eur is
  'Euros por 1 dólar (referencia del BCE, sin clave) que guarda sincronizar-costes-openai. '
  'Sustituye al 0,92 fijo del panel; ver tipo_cambio_usd_eur_actual().';

-- [20261008150000_openai_costes_reales.sql]
create index if not exists idx_openai_costes_diarios_proyecto
  on public.openai_costes_diarios (project_id, fecha desc);

-- [20261008150000_openai_costes_reales.sql]
-- ─── 2. Auditoría: solo el mapeo del dueño (los datos derivados no) ─────────
drop trigger if exists trg_auditoria on public.openai_costes_diarios;

-- [20261008150000_openai_costes_reales.sql]
drop trigger if exists trg_auditoria on public.tipo_cambio_usd_eur;

-- [20261008150000_openai_costes_reales.sql]
-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
alter table public.openai_proyectos      enable row level security;

-- [20261008150000_openai_costes_reales.sql]
alter table public.openai_costes_diarios enable row level security;

-- [20261008150000_openai_costes_reales.sql]
alter table public.tipo_cambio_usd_eur   enable row level security;

-- [20261008150000_openai_costes_reales.sql]
revoke all on public.openai_proyectos      from anon, authenticated;

-- [20261008150000_openai_costes_reales.sql]
revoke all on public.openai_costes_diarios from anon, authenticated;

-- [20261008150000_openai_costes_reales.sql]
revoke all on public.tipo_cambio_usd_eur   from anon, authenticated;

-- [20261008150000_openai_costes_reales.sql]
grant select on public.openai_proyectos      to authenticated;

-- [20261008150000_openai_costes_reales.sql]
grant select on public.openai_costes_diarios to authenticated;

-- [20261008150000_openai_costes_reales.sql]
grant select on public.tipo_cambio_usd_eur   to authenticated;

-- [20261008150000_openai_costes_reales.sql]
grant all on public.openai_proyectos      to service_role;

-- [20261008150000_openai_costes_reales.sql]
grant all on public.openai_costes_diarios to service_role;

-- [20261008150000_openai_costes_reales.sql]
grant all on public.tipo_cambio_usd_eur   to service_role;

-- [20261008150000_openai_costes_reales.sql]
revoke truncate on public.openai_proyectos      from authenticated;

-- [20261008150000_openai_costes_reales.sql]
revoke truncate on public.openai_costes_diarios from authenticated;

-- [20261008150000_openai_costes_reales.sql]
revoke truncate on public.tipo_cambio_usd_eur   from authenticated;

-- [20261008150000_openai_costes_reales.sql]
drop policy if exists openai_proyectos_select_super_admin on public.openai_proyectos;

-- [20261008150000_openai_costes_reales.sql]
create policy openai_proyectos_select_super_admin
  on public.openai_proyectos for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261008150000_openai_costes_reales.sql]
drop policy if exists openai_proyectos_service_role on public.openai_proyectos;

-- [20261008150000_openai_costes_reales.sql]
create policy openai_proyectos_service_role
  on public.openai_proyectos for all to service_role using (true) with check (true);

-- [20261008150000_openai_costes_reales.sql]
drop policy if exists openai_costes_diarios_select_super_admin on public.openai_costes_diarios;

-- [20261008150000_openai_costes_reales.sql]
create policy openai_costes_diarios_select_super_admin
  on public.openai_costes_diarios for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261008150000_openai_costes_reales.sql]
drop policy if exists openai_costes_diarios_service_role on public.openai_costes_diarios;

-- [20261008150000_openai_costes_reales.sql]
create policy openai_costes_diarios_service_role
  on public.openai_costes_diarios for all to service_role using (true) with check (true);

-- [20261008150000_openai_costes_reales.sql]
drop policy if exists tipo_cambio_usd_eur_select_super_admin on public.tipo_cambio_usd_eur;

-- [20261008150000_openai_costes_reales.sql]
create policy tipo_cambio_usd_eur_select_super_admin
  on public.tipo_cambio_usd_eur for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261008150000_openai_costes_reales.sql]
drop policy if exists tipo_cambio_usd_eur_service_role on public.tipo_cambio_usd_eur;

-- [20261008150000_openai_costes_reales.sql]
create policy tipo_cambio_usd_eur_service_role
  on public.tipo_cambio_usd_eur for all to service_role using (true) with check (true);

-- [override] ia_proceso_de_funcion
-- Proceso de una función de IA: todo «otros» (no hay lectura de facturas ni chatbots).
CREATE OR REPLACE FUNCTION public.ia_proceso_de_funcion(p_funcion text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 'otros'::text;
$function$;

-- [20261008150000_openai_costes_reales.sql]
comment on function public.ia_proceso_de_funcion(text) is
  'Proceso de gasto de una función de ia_uso: ocr (procesar-factura, ocr-trabajo, clasificar-productos), '
  'chat (chat-facturas) u otros. Debe coincidir con la clave que usa cada Edge Function (_shared/clave-openai.ts).';

-- [20261008150000_openai_costes_reales.sql]
revoke all on function public.ia_proceso_de_funcion(text) from public, anon;

-- [20261008150000_openai_costes_reales.sql]
grant execute on function public.ia_proceso_de_funcion(text) to authenticated, service_role;

-- [override] gasto_ia_real_resumen
-- Gasto real de IA (OpenAI) repartido por proceso. Solo super admin; sin el chatbot de la web.
CREATE OR REPLACE FUNCTION public.gasto_ia_real_resumen(p_dias integer DEFAULT 30)
 RETURNS TABLE(proceso text, usd_real numeric, ultimo_dia_real date, usd_estimado_hoy numeric, reparto text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- 20261010100000_gasto_real_claves_mixtas: reparto por proyecto y día; claves ajeno (excluidas) y mixto (según ia_uso del día).
declare
  v_dias      integer := least(greatest(coalesce(p_dias, 30), 1), 90);
  v_hoy       date    := (now() at time zone 'utc')::date;
  v_corte     date;
  v_desde     date;
  v_desde_ts  timestamptz;       -- inicio (UTC) de la ventana real
  v_desde_est timestamptz;       -- inicio (UTC) de lo que OpenAI aún no ha publicado
  v_sin_asig  numeric := 0;      -- real de proyectos sin marcar (informativo)
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'gasto_ia_real_resumen: solo super admin' using errcode = '42501';
  end if;

  -- Último día CERRADO con costes que cuentan para el negocio: de un
  -- proyecto marcado que no sea 'ajeno', o de un proyecto 'ajeno' con alguna
  -- clave que no sea 'ajeno'. El de hoy es parcial. Único para todos los
  -- procesos: lo real y lo estimado no se solapan ni dejan huecos.
  select max(c.fecha) into v_corte
    from public.openai_costes_diarios c
    join public.openai_proyectos p on p.project_id = c.project_id
   where c.fecha < v_hoy and p.proceso is not null
     and (p.proceso <> 'ajeno'
          or exists (select 1 from public.openai_claves k
                      where k.project_id = p.project_id and k.proceso <> 'ajeno'));

  if v_corte is null then
    -- Sin datos reales del negocio: todo es estimación sobre la ventana pedida.
    return query
    with fuente as (
      select u.funcion, u.coste_usd from public.ia_uso u
       where u.created_at >= now() - make_interval(days => v_dias)
    )
    select pr.proc, 0::numeric, null::date,
           coalesce((select sum(f.coste_usd) from fuente f where public.ia_proceso_gasto(f.funcion) = pr.proc), 0)::numeric,
           'sin_datos'::text
      from (select unnest(array['ocr', 'chat', 'chatweb', 'vinos', 'otros']) as proc) pr
     order by array_position(array['ocr', 'chat', 'chatweb', 'vinos', 'otros'], pr.proc);
    return;
  end if;

  v_desde     := v_corte - (v_dias - 1);
  v_desde_ts  := (v_desde::timestamp at time zone 'utc');
  v_desde_est := ((v_corte + 1)::timestamp at time zone 'utc');

  select coalesce(sum(c.usd), 0)
    into v_sin_asig
    from public.openai_costes_diarios c
    left join public.openai_proyectos p on p.project_id = c.project_id
   where c.fecha between v_desde and v_corte and p.proceso is null;

  return query
  with proy as (
    select p.project_id, p.proceso as proc_proy
      from public.openai_proyectos p
     where p.proceso is not null
  ),
  cd as (
    -- Coste real por proyecto y día (los proyectos sin marcar no entran: sin_asignar).
    select c.fecha, c.project_id, sum(c.usd) as usd
      from public.openai_costes_diarios c
      join proy on proy.project_id = c.project_id
     where c.fecha between v_desde and v_corte
     group by c.fecha, c.project_id
  ),
  uso as (
    -- Uso por clave valorado con ia_precios (acepta el modelo con sufijo de
    -- fecha: gpt-4.1-mini-2025-04-14 → gpt-4.1-mini). Una clave sin fila en
    -- openai_claves es 'otros' en un proyecto del negocio y 'ajeno' en uno ajeno.
    select u.fecha, u.project_id,
           coalesce(k.proceso, case when pj.proc_proy <> 'ajeno' then 'otros' else 'ajeno' end) as cls,
           u.peticiones,
           (t.modelo is not null) as con_tarifa,
           case when t.modelo is null then 0 else
             ( greatest(u.input_tokens - u.cached_tokens, 0) * t.usd_por_m_input
               + u.cached_tokens * coalesce(t.usd_por_m_cached, t.usd_por_m_input)
               + u.output_tokens * t.usd_por_m_output ) / 1000000.0
           end as usd
      from public.openai_uso_diario u
      join proy pj on pj.project_id = u.project_id
      left join public.openai_claves k on k.api_key_id = u.api_key_id
      left join lateral (
        select p.* from public.ia_precios p
         where p.modelo = u.modelo or left(u.modelo, length(p.modelo) + 1) = p.modelo || '-'
         order by length(p.modelo) desc
         limit 1
      ) t on true
     where u.fecha between v_desde and v_corte
  ),
  modo_dia as (
    -- Por proyecto y día: si a algún modelo le falta tarifa, a partes iguales por peticiones.
    select x.fecha, x.project_id,
           case when bool_or(not x.con_tarifa) and sum(x.peticiones) > 0 then 'clave_peticiones'
                when not bool_or(not x.con_tarifa) and sum(x.usd) > 0 then 'clave_tarifa'
                else null end as m
      from uso x
     group by x.fecha, x.project_id
  ),
  pesos as (
    select x.fecha, x.project_id, x.cls,
           case md.m when 'clave_peticiones' then sum(x.peticiones)
                     when 'clave_tarifa' then sum(x.usd)
                     else 0 end as w
      from uso x
      join modo_dia md on md.fecha = x.fecha and md.project_id = x.project_id
     group by x.fecha, x.project_id, x.cls, md.m
  ),
  pesos_tot as (
    select pe.fecha, pe.project_id, sum(pe.w) as tot
      from pesos pe group by pe.fecha, pe.project_id
     having sum(pe.w) > 0
  ),
  asig as (
    -- Coste de cada proyecto-día repartido entre las clases de clave. Sin pesos
    -- ese día: un proyecto del negocio se queda con su proceso; uno 'ajeno'
    -- no se puede atribuir a nadie y se excluye.
    select cd.fecha, pe.cls, cd.usd * pe.w / pt.tot as usd
      from cd
      join pesos_tot pt on pt.fecha = cd.fecha and pt.project_id = cd.project_id
      join pesos pe on pe.fecha = cd.fecha and pe.project_id = cd.project_id and pe.w > 0
    union all
    select cd.fecha, proy.proc_proy, cd.usd
      from cd
      join proy on proy.project_id = cd.project_id
     where not exists (select 1 from pesos_tot pt where pt.fecha = cd.fecha and pt.project_id = cd.project_id)
  ),
  fuente as (
    -- Estimado de ia_uso por función desde el inicio de la ventana.
    select u.funcion, u.coste_usd, u.created_at from public.ia_uso u
     where u.created_at >= v_desde_ts
  ),
  est_dia as (
    -- Coste estimado por día UTC y proceso, solo la parte ya publicada por OpenAI.
    select (f.created_at at time zone 'utc')::date as fecha,
           public.ia_proceso_gasto(f.funcion) as proc,
           sum(f.coste_usd) as c
      from fuente f
     where f.created_at < v_desde_est
     group by 1, 2
  ),
  est_tot as (
    select e.fecha, sum(e.c) as tot from est_dia e group by e.fecha having sum(e.c) > 0
  ),
  mixto_dia as (
    select a.fecha, sum(a.usd) as usd from asig a where a.cls = 'mixto' group by a.fecha
  ),
  mixto_rep as (
    -- Las claves mixtas, entre procesos según el estimado de ese día. R = real de
    -- la clave ese día, E_p = estimado de cada proceso, E = suma. Cada proceso
    -- recibe E_p × min(R/E, 1,3) (el 1,3 deja margen para tarifas desajustadas).
    -- Lo que sobra (R − Σ) no tiene rastro en ia_uso (pruebas o scripts locales
    -- con la clave): va a «otros» como sin_identificar. Sin estimado ese día
    -- (E = 0), todo es sin_identificar.
    select m.fecha, e.proc, e.c * least(m.usd / et.tot, 1.3) as usd, false as sin_id
      from mixto_dia m
      join est_tot et on et.fecha = m.fecha
      join est_dia e on e.fecha = m.fecha
    union all
    select m.fecha, 'otros',
           m.usd - coalesce(et.tot * least(m.usd / et.tot, 1.3), 0),
           true
      from mixto_dia m
      left join est_tot et on et.fecha = m.fecha
  ),
  directo as (
    select a.cls as proc, sum(a.usd) as usd
      from asig a where a.cls not in ('mixto', 'ajeno') group by a.cls
    union all
    select mr.proc, sum(mr.usd) from mixto_rep mr group by mr.proc
  ),
  sin_ident as (
    select round(coalesce(sum(mr.usd) filter (where mr.sin_id), 0), 6) as s from mixto_rep mr
  ),
  por_proc as (
    select d.proc, sum(d.usd) as usd from directo d group by d.proc
  ),
  tot_real as (
    select round(coalesce(sum(pp.usd), 0), 6) as t from por_proc pp
  ),
  modo as (
    -- Cómo se ha repartido el real (el peor caso gana: peticiones > tarifa > proyecto).
    select case when exists (select 1 from modo_dia md where md.m = 'clave_peticiones') then 'clave_peticiones'
                when exists (select 1 from modo_dia md where md.m = 'clave_tarifa') then 'clave_tarifa'
                else 'proyecto' end as m
  ),
  procs as (
    select unnest(array['ocr', 'chat', 'chatweb', 'vinos', 'otros']) as proc
  ),
  base as (
    select pr.proc, round(coalesce(pp.usd, 0), 6) as r
      from procs pr left join por_proc pp on pp.proc = pr.proc
  ),
  reales as (
    -- La suma es EXACTAMENTE el total real: el redondeo se lo lleva «otros».
    select b.proc,
           case when b.proc = 'otros'
                then (select t.t from tot_real t) - coalesce((select sum(b2.r) from base b2 where b2.proc <> 'otros'), 0)
                else b.r end as r
      from base b
  ),
  est as (
    select public.ia_proceso_gasto(f.funcion) as proc,
           public.ia_grupo_de_funcion(f.funcion) as grp,
           coalesce(sum(f.coste_usd) filter (where f.created_at >= v_desde_est), 0) as hoy,
           coalesce(sum(f.coste_usd) filter (where f.created_at <  v_desde_est), 0) as ventana
      from fuente f
     group by 1, 2
  ),
  grupos as (
    select e.grp, sum(e.ventana) as ventana, sum(e.hoy) as hoy
      from est e where e.proc = 'otros' group by e.grp
  ),
  suma as (select coalesce(sum(g.ventana), 0) as total from grupos g),
  otros_real as (
    -- Real de «otros» SIN la parte sin identificar (esa va en su propia sub-línea).
    select greatest(re.r - (select si.s from sin_ident si), 0) as r from reales re where re.proc = 'otros'
  ),
  filas as (
    select array_position(array['ocr', 'chat', 'chatweb', 'vinos', 'otros'], re.proc) as ord,
           re.proc as nombre, re.r as real_usd,
           coalesce((select sum(e.hoy) from est e where e.proc = re.proc), 0) as hoy_usd
      from reales re
    union all
    select 6, 'sin_asignar', v_sin_asig, 0::numeric where v_sin_asig > 0
    union all
    select 7, 'otros:' || g.grp,
           case when s.total > 0 then (select o.r from otros_real o) * g.ventana / s.total
                when g.grp = 'resto' then (select o.r from otros_real o)
                else 0 end,
           g.hoy
      from grupos g cross join suma s
     where g.ventana > 0 or g.hoy > 0
    union all
    select 7, 'otros:resto', (select o.r from otros_real o), 0::numeric
      from suma s
     where s.total = 0 and (select o.r from otros_real o) > 0
       and not exists (select 1 from grupos g where g.grp = 'resto' and (g.ventana > 0 or g.hoy > 0))
    union all
    select 7, 'otros:sin_identificar', si.s, 0::numeric from sin_ident si where si.s > 0
  )
  select f.nombre, f.real_usd::numeric, v_corte, f.hoy_usd::numeric, (select m.m from modo m)
    from filas f
   order by f.ord, f.nombre;
end;
$function$;

-- [20261008150000_openai_costes_reales.sql]
comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto de OpenAI por proceso (ocr, chat, otros y sin_asignar si hay proyectos sin proceso): usd_real = lo facturado '
  '(openai_costes_diarios) en los últimos p_dias (1-90) hasta ultimo_dia_real, el último día UTC cerrado; '
  'usd_estimado_hoy = ia_uso (estimación) desde el día siguiente, lo que OpenAI aún no ha publicado. Sin datos reales '
  'ultimo_dia_real es NULL y todo el gasto va como estimado de la ventana. Exige poder ver Facturas.';

-- [20261008150000_openai_costes_reales.sql]
revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;

-- [20261008150000_openai_costes_reales.sql]
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

-- [override] tipo_cambio_usd_eur_actual
-- Tipo de cambio: solo super admin (Servicios › Costes).
CREATE OR REPLACE FUNCTION public.tipo_cambio_usd_eur_actual()
 RETURNS TABLE(eur_por_usd numeric, fecha date, fuente text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'tipo_cambio_usd_eur_actual: solo super admin' using errcode = '42501';
  end if;

  return query
  select t.eur_por_usd::numeric, t.fecha, t.fuente
    from public.tipo_cambio_usd_eur t
   order by t.fecha desc
   limit 1;
  if not found then
    return query select 0.92::numeric, null::date, 'por_defecto'::text;
  end if;
end;
$function$;

-- [20261008150000_openai_costes_reales.sql]
comment on function public.tipo_cambio_usd_eur_actual() is
  'Último tipo de cambio guardado (euros por dólar, BCE). Si todavía no hay ninguno devuelve 0,92 con fuente por_defecto.';

-- [20261008150000_openai_costes_reales.sql]
revoke all on function public.tipo_cambio_usd_eur_actual() from public, anon;

-- [20261008150000_openai_costes_reales.sql]
grant execute on function public.tipo_cambio_usd_eur_actual() to authenticated, service_role;

-- [20261106200000_facturas_cargar_qa.sql] public.openai_despachar_sincronizacion_costes()
create or replace function public.openai_despachar_sincronizacion_costes()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261106200000: la URL sale de Vault («project_url»).
declare
  v_url     text;
  v_secreto text;
begin
  v_url := public.url_funcion_edge('sincronizar-costes-openai');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$function$;

-- [20261008150000_openai_costes_reales.sql]
comment on function public.openai_despachar_sincronizacion_costes() is
  'Lanza sincronizar-costes-openai por pg_net con el secreto de Vault ocr_trabajos_secret. La llama el cron cada 6 h; '
  'también se puede lanzar a mano: select public.openai_despachar_sincronizacion_costes();';

-- [20261008150000_openai_costes_reales.sql]
revoke all on function public.openai_despachar_sincronizacion_costes() from public, anon, authenticated;

-- [20261008150000_openai_costes_reales.sql]
grant execute on function public.openai_despachar_sincronizacion_costes() to service_role;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
DROP POLICY IF EXISTS "Admins pueden crear roles" ON public.user_roles;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
DROP POLICY IF EXISTS "Admins pueden actualizar roles" ON public.user_roles;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
DROP POLICY IF EXISTS "Admins pueden eliminar roles" ON public.user_roles;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins pueden crear roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins pueden actualizar roles" ON public.user_roles
  FOR UPDATE TO authenticated USING ((select public.is_super_admin(auth.uid())))
  WITH CHECK ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins pueden eliminar roles" ON public.user_roles
  FOR DELETE TO authenticated USING ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
DROP POLICY IF EXISTS "Admins can create role presets" ON public.user_role_presets;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
DROP POLICY IF EXISTS "Admins can update role presets" ON public.user_role_presets;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
DROP POLICY IF EXISTS "Admins can delete role presets" ON public.user_role_presets;

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins can create role presets" ON public.user_role_presets
  FOR INSERT TO authenticated WITH CHECK ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins can update role presets" ON public.user_role_presets
  FOR UPDATE TO authenticated USING ((select public.is_super_admin(auth.uid())))
  WITH CHECK ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins can delete role presets" ON public.user_role_presets
  FOR DELETE TO authenticated USING ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
-- SELECT también para un superadmin que no tenga un rol admin adicional.
CREATE POLICY "Super admins pueden consultar roles" ON public.user_roles
  FOR SELECT TO authenticated USING ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins pueden consultar permisos" ON public.user_permissions
  FOR SELECT TO authenticated USING ((select public.is_super_admin(auth.uid())));

-- [20261008164704_gestion_usuarios_solo_superadmin.sql]
CREATE POLICY "Super admins pueden consultar roles preconfigurados" ON public.user_role_presets
  FOR SELECT TO authenticated USING ((select public.is_super_admin(auth.uid())));

-- [20261008210000_ia_precios_busqueda_vino.sql]
-- Tarifas para extraer-vino-foto (búsqueda web de precio + ficha técnica).
--
-- * gpt-4.1: la lectura de la etiqueta (visión) y el precio de carta. No
--   tenía fila en ia_precios, así que su coste salía NULL.
-- * openai-web-search-call: ia_uso solo guarda tokens, así que cada llamada a
--   la herramienta web_search se registra como 1.000 "tokens" ficticios de
--   input de este pseudo-modelo; a 10 $/1M → 0,01 $ por búsqueda (tarifa
--   pública de la herramienta web_search: 10 $/1.000 llamadas). Los tokens de
--   contenido de búsqueda van en la fila de gpt-4.1-mini, a su tarifa.
-- Tarifas públicas sin verificar contra factura (verificado_en NULL).
insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write,
   usd_por_m_output, notas, fuente, verificado_en)
values
  ('gpt-4.1', 2.000000, 0.500000, null, 8.000000,
   'La usa extraer-vino-foto (visión + precio de carta).',
   'Tarifa pública de catálogo', null),
  ('openai-web-search-call', 10.000000, null, null, 0.000000,
   'Pseudo-modelo: 1 llamada a web_search = 1.000 tokens de input → 0,01 $/llamada. Lo usa extraer-vino-foto.',
   'Tarifa pública de la herramienta web_search (10 $/1.000 llamadas)', null)
on conflict (modelo) do nothing;

-- [20261009100000_openai_gasto_por_clave.sql]
-- ─── 0. Auditoría: las tablas derivadas entran en la lista de exclusión ────
-- Se parte de la definición ACTUAL de cada función (por si otra migración la
-- ha tocado) y solo se amplía la lista; no se copia su cuerpo.
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''ia_uso'',' in v_def) > 0 and position('''openai_uso_diario''' in v_def) = 0 then
      execute replace(v_def, '''ia_uso'',',
                      '''ia_uso'',''openai_costes_diarios'',''tipo_cambio_usd_eur'',''openai_uso_diario'',');
    end if;
  end loop;
end;
$$;

-- [20261009100000_openai_gasto_por_clave.sql]
-- ─── 1. 'ajeno' como proceso de proyecto ────────────────────────────────────
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.openai_proyectos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%proceso%'
  loop
    execute format('alter table public.openai_proyectos drop constraint %I', v_nombre);
  end loop;
end;
$$;

-- [20261009100000_openai_gasto_por_clave.sql]
alter table public.openai_proyectos
  add constraint openai_proyectos_proceso_check
  check (proceso is null or proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros', 'ajeno'));

-- [20261009100000_openai_gasto_por_clave.sql]
comment on table public.openai_proyectos is
  'Proyectos de OpenAI. proceso NULL = sin marcar (sale como sin_asignar y NO cuenta en el total); '
  '''ajeno'' = no es del negocio (p. ej. Default): no cuenta; cualquier otro valor = del negocio '
  '(su coste suma al total real; el reparto por proceso se hace por CLAVE con openai_claves, y solo si no hay '
  'uso por clave se usa este valor). La Edge Function sincronizar-costes-openai los da de alta y actualiza el nombre.';

-- [20261009100000_openai_gasto_por_clave.sql]
-- ─── 2. Tablas nuevas ───────────────────────────────────────────────────────
create table if not exists public.openai_claves (
  api_key_id text primary key check (length(api_key_id) between 1 and 120),
  project_id text not null check (length(project_id) between 1 and 120),
  nombre     text check (nombre is null or length(nombre) <= 200),
  proceso    text not null default 'otros' check (proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros')),
  creado_en  timestamptz not null default now()
);

-- [20261009100000_openai_gasto_por_clave.sql]
comment on table public.openai_claves is
  'Claves de API de los proyectos del negocio y el proceso al que pertenece su gasto (ocr = lectura de facturas, '
  'chat = chatbot de facturas, chatweb = chat de la web, vinos = vino desde foto, otros = clave general: traducciones, '
  'novedades…). La alta la hace sincronizar-costes-openai deduciendo el proceso del NOMBRE de la clave (solo al crearla); '
  'se puede corregir a mano. '
  'Nunca guarda el valor de la clave.';

-- [20261009100000_openai_gasto_por_clave.sql]
create index if not exists idx_openai_claves_proyecto on public.openai_claves (project_id);

-- [20261009100000_openai_gasto_por_clave.sql]
create table if not exists public.openai_uso_diario (
  fecha          date        not null,
  project_id     text        not null default '' check (length(project_id) <= 120),
  api_key_id     text        not null default '' check (length(api_key_id) <= 120),
  modelo         text        not null default '' check (length(modelo) <= 120),
  input_tokens   bigint      not null default 0 check (input_tokens >= 0),
  cached_tokens  bigint      not null default 0 check (cached_tokens >= 0 and cached_tokens <= input_tokens),
  output_tokens  bigint      not null default 0 check (output_tokens >= 0),
  peticiones     bigint      not null default 0 check (peticiones >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (fecha, project_id, api_key_id, modelo)
);

-- [20261009100000_openai_gasto_por_clave.sql]
comment on table public.openai_uso_diario is
  'Uso REAL de OpenAI (GET /v1/organization/usage/completions y /embeddings) por día UTC, proyecto, clave y modelo. '
  'input_tokens incluye los cacheados. "" = sin proyecto/clave/modelo. Lo escribe solo sincronizar-costes-openai '
  '(service_role). Sirve para repartir el coste real entre procesos (gasto_ia_real_resumen); no es una factura.';

-- [20261009100000_openai_gasto_por_clave.sql]
create index if not exists idx_openai_uso_diario_clave on public.openai_uso_diario (api_key_id, fecha desc);

-- [20261009100000_openai_gasto_por_clave.sql]
-- Datos derivados: sin trigger de auditoría (el event trigger puede haberlo puesto antes de la lista).
drop trigger if exists trg_auditoria on public.openai_uso_diario;

-- [20261009100000_openai_gasto_por_clave.sql]
drop trigger if exists trg_auditoria on public.openai_costes_diarios;

-- [20261009100000_openai_gasto_por_clave.sql]
drop trigger if exists trg_auditoria on public.tipo_cambio_usd_eur;

-- [20261009100000_openai_gasto_por_clave.sql]
-- ─── 3. RLS: lectura super admin, escritura service_role ────────────────────
alter table public.openai_claves     enable row level security;

-- [20261009100000_openai_gasto_por_clave.sql]
alter table public.openai_uso_diario enable row level security;

-- [20261009100000_openai_gasto_por_clave.sql]
revoke all on public.openai_claves     from anon, authenticated;

-- [20261009100000_openai_gasto_por_clave.sql]
revoke all on public.openai_uso_diario from anon, authenticated;

-- [20261009100000_openai_gasto_por_clave.sql]
grant select on public.openai_claves     to authenticated;

-- [20261009100000_openai_gasto_por_clave.sql]
grant select on public.openai_uso_diario to authenticated;

-- [20261009100000_openai_gasto_por_clave.sql]
grant all on public.openai_claves     to service_role;

-- [20261009100000_openai_gasto_por_clave.sql]
grant all on public.openai_uso_diario to service_role;

-- [20261009100000_openai_gasto_por_clave.sql]
revoke truncate on public.openai_claves     from authenticated;

-- [20261009100000_openai_gasto_por_clave.sql]
revoke truncate on public.openai_uso_diario from authenticated;

-- [20261009100000_openai_gasto_por_clave.sql]
drop policy if exists openai_claves_select_super_admin on public.openai_claves;

-- [20261009100000_openai_gasto_por_clave.sql]
create policy openai_claves_select_super_admin
  on public.openai_claves for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261009100000_openai_gasto_por_clave.sql]
drop policy if exists openai_claves_service_role on public.openai_claves;

-- [20261009100000_openai_gasto_por_clave.sql]
create policy openai_claves_service_role
  on public.openai_claves for all to service_role using (true) with check (true);

-- [20261009100000_openai_gasto_por_clave.sql]
drop policy if exists openai_uso_diario_select_super_admin on public.openai_uso_diario;

-- [20261009100000_openai_gasto_por_clave.sql]
create policy openai_uso_diario_select_super_admin
  on public.openai_uso_diario for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261009100000_openai_gasto_por_clave.sql]
drop policy if exists openai_uso_diario_service_role on public.openai_uso_diario;

-- [20261009100000_openai_gasto_por_clave.sql]
create policy openai_uso_diario_service_role
  on public.openai_uso_diario for all to service_role using (true) with check (true);

-- [override] ia_proceso_gasto
-- Proceso del gasto de IA: todo «otros».
CREATE OR REPLACE FUNCTION public.ia_proceso_gasto(p_funcion text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 'otros'::text;
$function$;

-- [20261009100000_openai_gasto_por_clave.sql]
comment on function public.ia_proceso_gasto(text) is
  'Proceso de gasto de una función de ia_uso según la clave que usa (_shared/clave-openai.ts): ocr, chat, chatweb '
  '(chat-web), vinos (extraer-vino-foto) u otros (clave general).';

-- [20261009100000_openai_gasto_por_clave.sql]
revoke all on function public.ia_proceso_gasto(text) from public, anon;

-- [20261009100000_openai_gasto_por_clave.sql]
grant execute on function public.ia_proceso_gasto(text) to authenticated, service_role;

-- [override] ia_grupo_de_funcion
-- Grupo de una función de IA: todo «resto».
CREATE OR REPLACE FUNCTION public.ia_grupo_de_funcion(p_funcion text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 'resto'::text;
$function$;

-- [20261009100000_openai_gasto_por_clave.sql]
comment on function public.ia_grupo_de_funcion(text) is
  'Sub-línea de «otros» en el monitor de gasto: traducciones (traducir-*), novedades (format-novedad) o resto.';

-- [20261009100000_openai_gasto_por_clave.sql]
revoke all on function public.ia_grupo_de_funcion(text) from public, anon;

-- [20261009100000_openai_gasto_por_clave.sql]
grant execute on function public.ia_grupo_de_funcion(text) to authenticated, service_role;

-- [20261009100000_openai_gasto_por_clave.sql]
comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto REAL de OpenAI de los proyectos del negocio (openai_proyectos.proceso no nulo y distinto de ajeno) en los '
  'últimos p_dias (1-90) hasta ultimo_dia_real (último día UTC cerrado), repartido en ocr / chat / chatweb / vinos / otros '
  'por el coste de cada clave (openai_uso_diario × ia_precios; reparto = clave_tarifa | clave_peticiones | proyecto) de modo '
  'que la suma es el total real exacto. Filas otros:traducciones / novedades / resto = desglose ESTIMADO de «otros» '
  '(ia_uso) escalado a su real. sin_asignar = proyectos sin marcar (no suma al total). usd_estimado_hoy = ia_uso + '
  'chat_web_uso desde el día siguiente, lo que OpenAI aún no ha publicado. Sin gasto real del negocio ultimo_dia_real '
  'es NULL y todo es estimado. Exige poder ver Facturas.';

-- [20261009100000_openai_gasto_por_clave.sql]
revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;

-- [20261009100000_openai_gasto_por_clave.sql]
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

-- [override] fijar_tope_ia_mes
-- Tope mensual de IA: en servicios_config (en el panel original iba en configuracion_facturas).
CREATE OR REPLACE FUNCTION public.fijar_tope_ia_mes(p_eur numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nuevo numeric(8,2);
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'fijar_tope_ia_mes: solo super admin' using errcode = '42501';
  end if;
  if p_eur is null or p_eur < 0.01 or p_eur > 10000 then
    raise exception 'fijar_tope_ia_mes: el tope tiene que estar entre 0,01 y 10000 €' using errcode = '22023';
  end if;
  update public.servicios_config set tope_ia_mes_eur = round(p_eur, 2) where id
  returning tope_ia_mes_eur into v_nuevo;
  if not found then
    insert into public.servicios_config (id, tope_ia_mes_eur) values (true, round(p_eur, 2))
    returning tope_ia_mes_eur into v_nuevo;
  end if;
  return v_nuevo;
end;
$function$;

-- [20261009110000_tope_gasto_ia.sql]
comment on function public.fijar_tope_ia_mes(numeric) is
  'Cambia el tope mensual de gasto de IA (configuracion_facturas.tope_ia_mes_eur). Solo super admin. Devuelve el tope guardado.';

-- [20261009110000_tope_gasto_ia.sql]
revoke all on function public.fijar_tope_ia_mes(numeric) from public, anon;

-- [20261009110000_tope_gasto_ia.sql]
grant execute on function public.fijar_tope_ia_mes(numeric) to authenticated, service_role;

-- [20261009110000_tope_gasto_ia.sql] public.openai_sincronizar_ahora()
-- ─── 3. «Sincronizar ahora» ─────────────────────────────────────────────────
create or replace function public.openai_sincronizar_ahora()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'openai_sincronizar_ahora: solo super admin' using errcode = '42501';
  end if;
  -- Como mucho una vez por minuto en todo el sistema: no martillear a OpenAI
  -- (30 peticiones por minuto en su API de costes).
  if not pg_try_advisory_xact_lock(hashtext('openai_sincronizar_ahora')) then
    return 0;
  end if;
  if exists (select 1 from public.openai_costes_diarios c where c.actualizado_en > now() - interval '1 minute') then
    return 0;
  end if;
  return public.openai_despachar_sincronizacion_costes();
end;
$$;

-- [20261009110000_tope_gasto_ia.sql]
comment on function public.openai_sincronizar_ahora() is
  'Lanza ya la sincronización de costes de OpenAI (la misma llamada que el cron de 6 h). Solo super admin. '
  'Devuelve 1 si la ha lanzado, 0 si se acaba de sincronizar (<1 min) o falta el secreto de Vault.';

-- [20261009110000_tope_gasto_ia.sql]
revoke all on function public.openai_sincronizar_ahora() from public, anon;

-- [20261009110000_tope_gasto_ia.sql]
grant execute on function public.openai_sincronizar_ahora() to authenticated, service_role;

-- [20261010100000_gasto_real_claves_mixtas.sql]
-- ─── 1. 'ajeno' y 'mixto' como proceso de CLAVE ─────────────────────────────
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.openai_claves'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%proceso%'
  loop
    execute format('alter table public.openai_claves drop constraint %I', v_nombre);
  end loop;
end;
$$;

-- [20261010100000_gasto_real_claves_mixtas.sql]
alter table public.openai_claves
  add constraint openai_claves_proceso_check
  check (proceso in ('ocr', 'chat', 'chatweb', 'vinos', 'otros', 'ajeno', 'mixto'));

-- [20261010100000_gasto_real_claves_mixtas.sql]
comment on table public.openai_claves is
  'Claves de API de OpenAI y el proceso al que pertenece su gasto: ocr = lectura de facturas, chat = chatbot de facturas, '
  'chatweb = chat de la web, vinos = vino desde foto, otros = clave general (traducciones, novedades…), '
  'ajeno = NO es del negocio (se excluye; vale también en proyectos ''ajeno'' como Default) y '
  'mixto = servía a varios procesos (la antigua clave «negocio»: se reparte cada día según el coste estimado de ia_uso '
  'por función; sin ia_uso ese día va a otros). La alta la hace sincronizar-costes-openai deduciendo el proceso del NOMBRE '
  '(solo al crearla; en un proyecto ajeno entra como ajeno); se puede corregir a mano. Nunca guarda el valor de la clave.';

-- [20261010100000_gasto_real_claves_mixtas.sql]
comment on table public.openai_proyectos is
  'Proyectos de OpenAI. proceso NULL = sin marcar (sale como sin_asignar y NO cuenta en el total); '
  '''ajeno'' = proyecto que no es (todo) del negocio, p. ej. Default: su coste se reparte entre sus claves por uso y '
  'solo cuentan las claves con proceso distinto de ajeno (openai_claves.proceso); cualquier otro valor = del negocio '
  '(su coste suma al total real; el reparto por proceso se hace por CLAVE con openai_claves, y solo si no hay '
  'uso por clave ese día se usa este valor). La Edge Function sincronizar-costes-openai los da de alta y actualiza el nombre.';

-- [20261010100000_gasto_real_claves_mixtas.sql]
comment on function public.gasto_ia_real_resumen(integer) is
  'Gasto REAL de OpenAI del negocio en los últimos p_dias (1-90) hasta ultimo_dia_real (último día UTC cerrado), '
  'repartido en ocr / chat / chatweb / vinos / otros. Para cada proyecto y día, su coste se reparte entre las claves con '
  'uso (openai_uso_diario × ia_precios; reparto = clave_tarifa | clave_peticiones | proyecto): las claves ajeno '
  '(openai_claves.proceso) se excluyen, también en proyectos ajeno (Default); las mixto se reparten entre procesos según '
  'el coste estimado de ia_uso + chat_web_uso de ESE día (cada proceso E_p × min(R/E, 1,3); el resto, R − suma, va a '
  'otros:sin_identificar: pruebas o scripts sin rastro en ia_uso); un proyecto del negocio sin uso ese día '
  'se queda con su proceso y uno ajeno se excluye. La suma es el total real no ajeno exacto. Filas otros:traducciones / '
  'novedades / resto = desglose ESTIMADO de «otros» (ia_uso) escalado a su real sin la parte sin_identificar. sin_asignar = proyectos sin marcar '
  '(no suma al total). usd_estimado_hoy = ia_uso + chat_web_uso desde el día siguiente, lo que OpenAI aún no ha '
  'publicado. Sin gasto real del negocio ultimo_dia_real es NULL y todo es estimado. Exige poder ver Facturas.';

-- [20261010100000_gasto_real_claves_mixtas.sql]
revoke all on function public.gasto_ia_real_resumen(integer) from public, anon;

-- [20261010100000_gasto_real_claves_mixtas.sql]
grant execute on function public.gasto_ia_real_resumen(integer) to authenticated, service_role;

-- [override] audit_tabla_util
-- Tablas que no se auditan (datos derivados o de alto volumen).
CREATE OR REPLACE FUNCTION public.audit_tabla_util(p_tabla text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ SELECT coalesce(p_tabla, '') <> ALL(ARRAY[
  'notificaciones_dashboard','openai_uso_diario','openai_costes_diarios','servicios_uso','avisos_telegram_envios'
]::text[]) $function$;

-- [override] audit_log_visible
-- Vista de la auditoría que lee Super Admin › Auditoría (security_invoker: aplica la RLS de audit_log).
CREATE OR REPLACE VIEW public.audit_log_visible WITH (security_invoker = true) AS
SELECT id,
    created_at,
    actor_user_id,
    actor_email,
    accion,
    tabla,
    registro_id,
    detalles,
    user_agent,
    actor_label,
    actor_origin,
    device_id,
    ip_address,
    request_id,
    session_id,
        CASE
            WHEN accion = 'ejecutar'::text AND (detalles ->> 'tipo_evento'::text) IS NOT NULL THEN detalles ->> 'tipo_evento'::text
            WHEN tabla = 'user_permissions'::text THEN 'cambiar_permisos'::text
            WHEN tabla = ANY (ARRAY['user_roles'::text, 'super_admins'::text]) THEN 'cambiar_roles'::text
            WHEN accion = 'actualizar'::text AND tabla = 'auth.users'::text AND ((detalles -> 'antes'::text) -> 'banned_until'::text) IS DISTINCT FROM ((detalles -> 'despues'::text) -> 'banned_until'::text) THEN
            CASE
                WHEN NULLIF((detalles -> 'despues'::text) ->> 'banned_until'::text, ''::text)::timestamp with time zone > created_at THEN 'bloquear_acceso'::text
                ELSE 'desbloquear_acceso'::text
            END
            WHEN (detalles ->> 'credenciales_actualizadas'::text) = 'true'::text THEN 'cambiar_credenciales'::text
            WHEN accion = 'actualizar'::text AND ((detalles -> 'antes'::text) -> 'precio_eur'::text) IS DISTINCT FROM ((detalles -> 'despues'::text) -> 'precio_eur'::text) THEN 'cambiar_precio'::text
            WHEN accion = 'actualizar'::text AND ((detalles -> 'antes'::text) -> 'activado'::text) IS DISTINCT FROM ((detalles -> 'despues'::text) -> 'activado'::text) THEN 'cambiar_visibilidad'::text
            ELSE accion
        END AS tipo_evento,
        CASE
            WHEN accion = ANY (ARRAY['login_fallido'::text, 'acceso_denegado'::text]) THEN 'fallida'::text
            ELSE COALESCE(detalles ->> 'resultado'::text, 'completada'::text)
        END AS resultado,
    accion <> ALL (ARRAY['acceso'::text, 'intento_login'::text]) AS visible_por_defecto,
    concat_ws(' '::text, actor_label, tabla, detalles ->> 'pregunta'::text, detalles ->> 'respuesta'::text, (detalles -> 'despues'::text) ->> 'nombre'::text, (detalles -> 'antes'::text) ->> 'nombre'::text, (detalles -> 'despues'::text) ->> 'contenido'::text, (detalles -> 'antes'::text) ->> 'contenido'::text, (detalles -> 'despues'::text) ->> 'content'::text, (detalles -> 'antes'::text) ->> 'content'::text, detalles ->> 'operacion'::text) AS texto_busqueda
   FROM public.audit_log a
  WHERE public.audit_tabla_util(tabla);

-- [20261012153701_auditoria_legible_chat_reversion.sql]
REVOKE ALL ON public.audit_log_visible FROM PUBLIC, anon;

-- [20261012153701_auditoria_legible_chat_reversion.sql]
GRANT SELECT ON public.audit_log_visible TO authenticated, service_role;

-- [20261012153701_auditoria_legible_chat_reversion.sql]
REVOKE ALL ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) FROM PUBLIC,anon,authenticated;

-- [20261012153701_auditoria_legible_chat_reversion.sql]
GRANT EXECUTE ON FUNCTION public.registrar_accion_auditoria_panel(text,jsonb) TO service_role;

-- [20261012153701_auditoria_legible_chat_reversion.sql]
CREATE INDEX IF NOT EXISTS audit_log_reversion_original_unica
ON public.audit_log ((detalles->>'evento_original_id')) WHERE accion='ejecutar' AND detalles->>'tipo_evento'='reversion';

-- [override] revertir_cambio_auditoria
-- Revertir un cambio desde Super Admin › Auditoría (solo tablas del panel).
CREATE OR REPLACE FUNCTION public.revertir_cambio_auditoria(p_evento uuid, p_actor uuid, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_evento public.audit_log%ROWTYPE; v_tabla text; v_op text;
  v_actual jsonb; v_antes jsonb; v_despues jsonb; v_objetivo jsonb;
  v_pk text[]; v_cond text; v_columnas text; v_valores text; v_cambios text; v_fila jsonb;
  v_tiempos text[] := ARRAY['created_at','updated_at','actualizado_en','modified_at'];
  v_fk record; v_fk_cond text; v_depende boolean; v_id uuid;
BEGIN
  IF current_user <> 'service_role' OR NOT EXISTS(SELECT 1 FROM public.super_admins WHERE user_id=p_actor) THEN
    RAISE EXCEPTION 'Solo superadmin' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reversion:'||p_evento::text,0));
  SELECT * INTO v_evento FROM public.audit_log WHERE id=p_evento;
  IF NOT FOUND THEN RAISE EXCEPTION 'El registro de auditoría no existe'; END IF;
  IF EXISTS(SELECT 1 FROM public.audit_log WHERE accion='ejecutar' AND detalles->>'tipo_evento'='reversion' AND detalles->>'evento_original_id'=p_evento::text) THEN
    RAISE EXCEPTION 'Este cambio ya se ha revertido';
  END IF;
  v_tabla:=v_evento.tabla;
  IF v_tabla IS NULL OR v_tabla <> ALL(ARRAY['oficiososia_borradores',
    'user_permissions','user_roles','admin_feature_toggles','user_role_presets'])
    OR v_evento.accion NOT IN ('crear','actualizar','eliminar') THEN
    RAISE EXCEPTION 'Este registro requiere una operación específica y no admite restauración automática';
  END IF;
  v_op:=coalesce(v_evento.detalles->>'operacion_sql',CASE v_evento.accion WHEN 'crear' THEN 'INSERT' WHEN 'eliminar' THEN 'DELETE' ELSE 'UPDATE' END);
  v_antes:=v_evento.detalles->'antes'; v_despues:=v_evento.detalles->'despues';
  IF coalesce(v_antes::text,'')||coalesce(v_despues::text,'') LIKE '%[oculto]%' THEN RAISE EXCEPTION 'No se puede restaurar un registro con valores ocultos'; END IF;
  IF (v_op='UPDATE' AND (v_antes IS NULL OR v_despues IS NULL)) OR (v_op='INSERT' AND v_despues IS NULL) OR (v_op='DELETE' AND v_antes IS NULL) THEN
    RAISE EXCEPTION 'No se conservan suficientes datos para restaurar este cambio';
  END IF;
  v_fila:=coalesce(v_despues,v_antes);
  SELECT array_agg(a.attname ORDER BY k.orden) INTO v_pk FROM pg_catalog.pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(num,orden)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num
    WHERE c.contype='p' AND c.conrelid=to_regclass(format('public.%I',v_tabla));
  IF v_pk IS NULL THEN RAISE EXCEPTION 'No se puede identificar el registro de forma segura'; END IF;
  SELECT string_agg(format('to_jsonb(t)->%L IS NOT DISTINCT FROM $1->%L',k,k),' AND ') INTO v_cond FROM unnest(v_pk) k;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE %s FOR UPDATE',v_tabla,v_cond) INTO v_actual USING v_fila;
  IF v_op='DELETE' THEN
    IF v_actual IS NOT NULL THEN RAISE EXCEPTION 'Ya existe un registro con esa identidad'; END IF;
    v_objetivo:=v_antes;
  ELSE
    IF v_actual IS NULL THEN RAISE EXCEPTION 'El registro ya no existe'; END IF;
    IF (public.fn_audit_sanitizar(v_actual)-v_tiempos) IS DISTINCT FROM (v_despues-v_tiempos) THEN
      RAISE EXCEPTION 'Hay cambios posteriores. No se han sobrescrito';
    END IF;
    v_objetivo:=CASE WHEN v_op='INSERT' THEN NULL ELSE v_antes END;
  END IF;
  -- Impide borrar en cascada otras entidades al deshacer una creación.
  IF v_op='INSERT' THEN
    FOR v_fk IN SELECT c.*,n.nspname AS esquema,h.relname AS tabla FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class h ON h.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=h.relnamespace
      WHERE c.contype='f' AND c.confrelid=to_regclass(format('public.%I',v_tabla)) LOOP
      SELECT string_agg(format('to_jsonb(h)->%L = $1->%L',a.attname,b.attname),' AND ') INTO v_fk_cond
        FROM unnest(v_fk.conkey,v_fk.confkey) k(a_num,b_num)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=v_fk.conrelid AND a.attnum=k.a_num
        JOIN pg_catalog.pg_attribute b ON b.attrelid=v_fk.confrelid AND b.attnum=k.b_num;
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I h WHERE %s)',v_fk.esquema,v_fk.tabla,v_fk_cond) INTO v_depende USING v_actual;
      IF v_depende THEN RAISE EXCEPTION 'Hay registros relacionados. No se puede deshacer esta creación automáticamente'; END IF;
    END LOOP;
  END IF;
  IF NOT p_confirmar THEN RETURN jsonb_build_object('evento_id',p_evento,'tabla',v_tabla,'operacion',CASE v_op WHEN 'INSERT' THEN 'eliminar' WHEN 'DELETE' THEN 'restaurar' ELSE 'restaurar_valores' END,'actual',public.fn_audit_sanitizar(v_actual),'restaurado',v_objetivo); END IF;
  IF v_op='INSERT' THEN
    EXECUTE format('DELETE FROM public.%I t WHERE %s',v_tabla,v_cond) USING v_fila;
  ELSIF v_op='UPDATE' THEN
    SELECT string_agg(format('%I = r.%I',a.attname,a.attname),',') INTO v_cambios
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',v_tabla)) AND a.attnum>0 AND NOT a.attisdropped
      AND a.attgenerated='' AND a.attidentity='' AND a.attname<>ALL(v_pk) AND a.attname<>ALL(v_tiempos)
      AND v_antes ? a.attname AND (v_antes->a.attname) IS DISTINCT FROM (v_despues->a.attname);
    IF v_cambios IS NULL THEN RAISE EXCEPTION 'No hay campos restaurables en este cambio'; END IF;
    EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$2) r WHERE %s',v_tabla,v_cambios,v_tabla,v_cond) USING v_fila,v_antes;
  ELSIF v_op='DELETE' THEN
    SELECT string_agg(format('%I',a.attname),','),string_agg(format('r.%I',a.attname),',') INTO v_columnas,v_valores
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',v_tabla)) AND a.attnum>0 AND NOT a.attisdropped
      AND a.attgenerated='' AND v_antes ? a.attname;
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r',v_tabla,v_columnas,v_valores,v_tabla) USING v_antes;
  ELSE RAISE EXCEPTION 'Operación no restaurable'; END IF;
  INSERT INTO public.audit_log(actor_user_id,accion,tabla,registro_id,detalles)
    VALUES(p_actor,'ejecutar',v_tabla,v_evento.registro_id,jsonb_build_object('tipo_evento','reversion','operacion','Revertir cambio','evento_original_id',p_evento,'resultado','completada','antes',public.fn_audit_sanitizar(v_actual),'despues',v_objetivo)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'evento_reversion_id',v_id);
END $function$;

-- [20261012153701_auditoria_legible_chat_reversion.sql]
REVOKE ALL ON FUNCTION public.revertir_cambio_auditoria(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;

-- [20261012153701_auditoria_legible_chat_reversion.sql]
GRANT EXECUTE ON FUNCTION public.revertir_cambio_auditoria(uuid,uuid,boolean) TO service_role;

-- [20261013082609_bloquear_acceso_usuarios.sql] private.sesion_panel_permitida()
-- Lee exclusivamente el usuario del JWT validado. No permite consultar Auth
-- de otra persona y no usa metadatos editables ni un JWT con permisos antiguos.
CREATE OR REPLACE FUNCTION private.sesion_panel_permitida()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id
        AND s.id::text = auth.jwt()->>'session_id')
  )
$$;

-- [20261013082609_bloquear_acceso_usuarios.sql]
REVOKE ALL ON FUNCTION private.sesion_panel_permitida() FROM PUBLIC, anon;

-- [20261013082609_bloquear_acceso_usuarios.sql]
GRANT EXECUTE ON FUNCTION private.sesion_panel_permitida() TO authenticated;

-- [20261013082609_bloquear_acceso_usuarios.sql]
-- Indicador mínimo para cerrar todas las pantallas abiertas por Realtime.
-- El usuario solo puede leer su propio estado; nunca escribirlo.
CREATE TABLE public.user_access_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_blocked boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- [20261013082609_bloquear_acceso_usuarios.sql]
-- La operación ya se audita en auth.users: evita un segundo evento técnico.
DROP TRIGGER IF EXISTS trg_auditoria ON public.user_access_status;

-- [20261013082609_bloquear_acceso_usuarios.sql]
ALTER TABLE public.user_access_status ENABLE ROW LEVEL SECURITY;

-- [20261013082609_bloquear_acceso_usuarios.sql]
REVOKE ALL ON public.user_access_status FROM PUBLIC, anon, authenticated;

-- [20261013082609_bloquear_acceso_usuarios.sql]
GRANT SELECT ON public.user_access_status TO authenticated;

-- [20261013082609_bloquear_acceso_usuarios.sql]
GRANT ALL ON public.user_access_status TO service_role;

-- [20261013082609_bloquear_acceso_usuarios.sql]
CREATE POLICY "Leer estado propio de acceso" ON public.user_access_status
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- [20261013082609_bloquear_acceso_usuarios.sql]
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_access_status;

-- [20261013082609_bloquear_acceso_usuarios.sql]
-- Realtime y Storage no ejecutan db_pre_request: añade una restricción que
-- se combina por AND con los permisos existentes. Mantiene el acceso público
-- anónimo y los procesos con service_role. La tabla de estado es la excepción
-- para poder recibir precisamente el evento que cierra la sesión bloqueada.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND c.relrowsecurity AND NOT c.relispartition
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname IN ('objects','buckets')))
      AND c.relname <> 'user_access_status'
  LOOP
    EXECUTE format('CREATE POLICY acceso_panel_no_bloqueado ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.sesion_panel_permitida())) WITH CHECK ((SELECT private.sesion_panel_permitida()))', r.nspname, r.relname);
  END LOOP;
END
$$;

-- [20261013082609_bloquear_acceso_usuarios.sql]
REVOKE ALL ON public.audit_log_visible FROM PUBLIC, anon;

-- [20261013082609_bloquear_acceso_usuarios.sql]
GRANT SELECT ON public.audit_log_visible TO authenticated, service_role;

-- [20261030152000_superadmin_minimo_uno.sql] public.establecer_superadmin_panel(uuid,boolean,text)
create or replace function public.establecer_superadmin_panel(
  p_user_id uuid,
  p_make_super_admin boolean,
  p_email text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bloqueado boolean;
begin
  if p_user_id is null or p_make_super_admin is null or p_email is null or p_email = '' then
    raise exception 'Datos de usuario no válidos' using errcode = '22023';
  end if;
  -- Lock GLOBAL (el mismo que el trigger trg_super_admins_al_menos_uno):
  -- todas las altas y bajas de superadmin se serializan.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.super_admins', 0));
  if p_make_super_admin then
    select s.access_blocked into bloqueado from public.user_access_status s
    where s.user_id = p_user_id for update;
    if coalesce(bloqueado, false) then
      raise exception 'Desbloquea el acceso antes de conceder superadmin' using errcode = '22023';
    end if;
    insert into public.user_roles (user_id, role) values (p_user_id, 'admin')
    on conflict (user_id) do update set role = excluded.role;
    insert into public.super_admins (user_id, email) values (p_user_id, p_email)
    on conflict (email) do update set user_id = excluded.user_id;
  else
    -- Si es el último, el trigger lanza 23514 y no cambia nada.
    delete from public.super_admins where user_id = p_user_id;
  end if;
end;
$$;

-- [20261013132015_gestion_superadmin_atomica.sql]
revoke all on function public.establecer_superadmin_panel(uuid, boolean, text) from public, anon, authenticated;

-- [20261013132015_gestion_superadmin_atomica.sql]
grant execute on function public.establecer_superadmin_panel(uuid, boolean, text) to service_role;

-- [20261026120000_ia_precios_replicate_fondo.sql]
insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write,
   usd_por_m_output, notas, fuente, verificado_en)
values
  ('replicate:men1scus/birefnet', 3.300000, null, null, 0.000000,
   'Pseudo-modelo: 1 foto = 1.000 tokens de input → 0,0033 $/foto. Lo usa recortar-fondo-vino (respaldo opcional; el camino gratis es el script local scripts/fotos-vino).',
   'Precio medio por ejecución en la ficha de Replicate (oct. 2026)', null)
on conflict (modelo) do nothing;

-- [20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio.sql]
-- 3. Sin oráculo de roles para anon
revoke all on function public.is_admin(uuid) from public, anon;

-- [20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio.sql]
revoke all on function public.is_super_admin(uuid) from public, anon;

-- [20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio.sql]
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- [20261030140000_rpc_roles_y_mantenimiento_minimo_privilegio.sql]
grant execute on function public.is_super_admin(uuid) to authenticated, service_role;

-- [20261030151000_panel_auth_limite_por_email.sql]
create index if not exists idx_audit_log_accesos_panel_email
  on public.audit_log ((detalles->>'email_introducido'), created_at)
  where tabla = 'accesos_panel';

-- [20261030151000_panel_auth_limite_por_email.sql]
revoke all on function public.iniciar_intento_panel(text, text) from public, anon, authenticated;

-- [20261030151000_panel_auth_limite_por_email.sql]
grant execute on function public.iniciar_intento_panel(text, text) to service_role;

-- [20261030152000_superadmin_minimo_uno.sql] public.super_admins_exigir_al_menos_uno()
create or replace function public.super_admins_exigir_al_menos_uno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'No se puede vaciar super_admins: debe quedar al menos un superadmin'
      using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.super_admins', 0));
  select count(*) into v_n from public.super_admins where user_id is not null;
  if v_n = 0 then
    raise exception 'Debe quedar al menos un superadmin'
      using errcode = '23514',
            hint = 'Concede superadmin a otra cuenta antes de quitar el último.';
  end if;
  return null;
end;
$$;

-- [20261030152000_superadmin_minimo_uno.sql]
revoke all on function public.super_admins_exigir_al_menos_uno() from public, anon, authenticated;

-- [20261030152000_superadmin_minimo_uno.sql]
drop trigger if exists trg_super_admins_al_menos_uno on public.super_admins;

-- [20261030152000_superadmin_minimo_uno.sql]
create trigger trg_super_admins_al_menos_uno
  after delete or update of user_id on public.super_admins
  for each statement execute function public.super_admins_exigir_al_menos_uno();

-- [20261030152000_superadmin_minimo_uno.sql]
drop trigger if exists trg_super_admins_sin_truncate on public.super_admins;

-- [20261030152000_superadmin_minimo_uno.sql]
create trigger trg_super_admins_sin_truncate
  before truncate on public.super_admins
  for each statement execute function public.super_admins_exigir_al_menos_uno();

-- [20261030152000_superadmin_minimo_uno.sql]
revoke all on function public.establecer_superadmin_panel(uuid, boolean, text) from public, anon, authenticated;

-- [20261030152000_superadmin_minimo_uno.sql]
grant execute on function public.establecer_superadmin_panel(uuid, boolean, text) to service_role;

-- [20261030200000_panel_auth_cubo_sin_ip.sql]
create index if not exists idx_audit_log_accesos_panel_ip_cubo
  on public.audit_log ((coalesce(nullif(ip_address, ''), 'sin-ip')), created_at)
  where tabla = 'accesos_panel';

-- [20261030200000_panel_auth_cubo_sin_ip.sql]
revoke all on function public.iniciar_intento_panel(text, text) from public, anon, authenticated;

-- [20261030200000_panel_auth_cubo_sin_ip.sql]
grant execute on function public.iniciar_intento_panel(text, text) to service_role;

-- [20261103120000_servicios_contratados.sql]
do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'servicios_contratados: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261103120000_servicios_contratados.sql]
-- ─── 0. Auditoría: servicios_uso entra en la lista de exclusión ─────────────
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''ia_uso'',' in v_def) > 0 and position('''servicios_uso''' in v_def) = 0 then
      execute replace(v_def, '''ia_uso'',', '''ia_uso'',''servicios_uso'',');
    end if;
  end loop;
end;
$$;

-- [20261103120000_servicios_contratados.sql] public.servicios_limites_validos(jsonb)
-- ─── 1. Validación del JSON de límites ──────────────────────────────────────
create or replace function public.servicios_limites_validos(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clave text;
  v_valor jsonb;
  v_n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for v_clave, v_valor in select key, value from jsonb_each(p) loop
    v_n := v_n + 1;
    if v_n > 40 or v_clave !~ '^[a-z0-9_]{1,60}$' or jsonb_typeof(v_valor) <> 'object' then
      return false;
    end if;
    -- limite: número >= 0 o null/ausente (= «sin dato»).
    if v_valor ? 'limite' and jsonb_typeof(v_valor -> 'limite') not in ('number', 'null') then
      return false;
    end if;
    if jsonb_typeof(v_valor -> 'limite') = 'number' and (v_valor ->> 'limite')::numeric < 0 then
      return false;
    end if;
    if v_valor ? 'orden' and jsonb_typeof(v_valor -> 'orden') not in ('number', 'null') then
      return false;
    end if;
    -- Textos cortos; la fuente, solo https.
    if length(coalesce(v_valor ->> 'etiqueta', '')) > 120
       or length(coalesce(v_valor ->> 'unidad', '')) > 30
       or length(coalesce(v_valor ->> 'periodo', '')) > 60
       or length(coalesce(v_valor ->> 'nota', '')) > 500
       or length(coalesce(v_valor ->> 'fuente', '')) > 500 then
      return false;
    end if;
    if nullif(v_valor ->> 'fuente', '') is not null and (v_valor ->> 'fuente') !~ '^https://[^\s]+$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- [20261103120000_servicios_contratados.sql]
-- ─── 2. Tablas ──────────────────────────────────────────────────────────────
create table if not exists public.servicios_contratados (
  proveedor       text primary key,
  nombre          text not null,
  plan            text,
  precio_mensual  numeric(10, 2),
  moneda          text not null default 'USD',
  ciclo           text not null default 'mensual',
  renovacion      date,
  cuenta          text,
  panel_url       text,
  limites         jsonb not null default '{}'::jsonb,
  notas           text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid() references auth.users(id) on delete set null,
  constraint servicios_contratados_proveedor_chk check (proveedor ~ '^[a-z0-9_-]{2,40}$'),
  constraint servicios_contratados_nombre_chk check (length(btrim(nombre)) between 1 and 80),
  constraint servicios_contratados_plan_chk check (plan is null or length(plan) <= 80),
  constraint servicios_contratados_precio_chk check (precio_mensual is null or (precio_mensual >= 0 and precio_mensual <= 100000)),
  constraint servicios_contratados_moneda_chk check (moneda ~ '^[A-Z]{3}$'),
  constraint servicios_contratados_ciclo_chk check (ciclo in ('mensual', 'anual', 'gratuito', 'por_uso')),
  constraint servicios_contratados_cuenta_chk check (cuenta is null or length(cuenta) <= 300),
  constraint servicios_contratados_panel_chk check (panel_url is null or (panel_url ~ '^https://[^\s]+$' and length(panel_url) <= 500)),
  constraint servicios_contratados_notas_chk check (notas is null or length(notas) <= 2000),
  constraint servicios_contratados_limites_chk check (public.servicios_limites_validos(limites))
);

-- [20261103120000_servicios_contratados.sql]
comment on table public.servicios_contratados is
  'Servicios contratados (Super Admin › Servicios): plan, precio, renovación, cuenta, enlace al panel y LÍMITES del plan '
  '({ métrica: { etiqueta, limite, unidad, periodo, fuente, nota, orden } }; limite null = sin dato). Solo super admin. '
  'El consumo lo lee la Edge Function servicios-uso y lo guarda en servicios_uso.';

-- [20261103120000_servicios_contratados.sql]
create table if not exists public.servicios_uso (
  id         uuid primary key default gen_random_uuid(),
  proveedor  text not null,
  tomado_en  timestamptz not null default now(),
  metricas   jsonb not null default '{}'::jsonb,
  error      text,
  detalles   jsonb not null default '{}'::jsonb,
  constraint servicios_uso_proveedor_chk check (proveedor ~ '^[a-z0-9_-]{2,40}$'),
  constraint servicios_uso_metricas_chk check (jsonb_typeof(metricas) = 'object' and length(metricas::text) <= 20000),
  constraint servicios_uso_detalles_chk check (jsonb_typeof(detalles) = 'object' and length(detalles::text) <= 4000),
  constraint servicios_uso_error_chk check (error is null or error ~ '^[a-z_]{1,40}$')
);

-- [20261103120000_servicios_contratados.sql]
comment on table public.servicios_uso is
  'Lecturas de consumo de cada servicio contratado (Edge Function servicios-uso): histórico y caché de 15 min. '
  'metricas = { métrica: { etiqueta, valor, unidad, limite, unidad_limite, periodo, nota, orden } }; '
  'error = código (falta_secreto, credencial_rechazada, error_api…); detalles nunca lleva claves. Dato derivado: no se audita.';

-- [20261103120000_servicios_contratados.sql]
create index if not exists servicios_uso_proveedor_tomado_idx on public.servicios_uso (proveedor, tomado_en desc);

-- [20261103120000_servicios_contratados.sql]
-- Datos derivados: sin trigger de auditoría (el event trigger puede habérselo
-- puesto si la lista de exclusión no tenía el patrón esperado).
drop trigger if exists trg_auditoria on public.servicios_uso;

-- [20261103120000_servicios_contratados.sql]
-- La configuración SÍ se audita. No se confía solo en el event trigger
-- `audit_panel_nuevas_tablas`: la demo (copia de producción del 20/10/2026) no
-- lo tiene, y sin él la tabla nacería sin auditar. Mismo trigger y misma
-- función que instala `instalar_auditoria_panel()`.
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.servicios_contratados'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.servicios_contratados';
    execute 'create trigger trg_auditoria after insert or update or delete on public.servicios_contratados
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- [20261103120000_servicios_contratados.sql] public.servicios_contratados_al_editar()
-- Quién y cuándo editó por última vez (el proveedor no se cambia nunca).
create or replace function public.servicios_contratados_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.proveedor is distinct from old.proveedor then
    raise exception 'El proveedor de un servicio no se puede cambiar' using errcode = '23514';
  end if;
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;

-- [20261103120000_servicios_contratados.sql]
revoke all on function public.servicios_contratados_al_editar() from public, anon, authenticated;

-- [20261103120000_servicios_contratados.sql]
drop trigger if exists servicios_contratados_al_editar on public.servicios_contratados;

-- [20261103120000_servicios_contratados.sql]
create trigger servicios_contratados_al_editar
  before update on public.servicios_contratados
  for each row execute function public.servicios_contratados_al_editar();

-- [20261103120000_servicios_contratados.sql]
-- ─── 3. RLS: solo super admin; las lecturas, solo service_role las escribe ──
alter table public.servicios_contratados enable row level security;

-- [20261103120000_servicios_contratados.sql]
alter table public.servicios_uso         enable row level security;

-- [20261103120000_servicios_contratados.sql]
revoke all on public.servicios_contratados from anon, authenticated;

-- [20261103120000_servicios_contratados.sql]
revoke all on public.servicios_uso         from anon, authenticated;

-- [20261103120000_servicios_contratados.sql]
grant select on public.servicios_contratados to authenticated;

-- [20261103120000_servicios_contratados.sql]
grant update (nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas)
  on public.servicios_contratados to authenticated;

-- [20261103120000_servicios_contratados.sql]
grant select on public.servicios_uso to authenticated;

-- [20261103120000_servicios_contratados.sql]
grant all on public.servicios_contratados to service_role;

-- [20261103120000_servicios_contratados.sql]
grant all on public.servicios_uso         to service_role;

-- [20261103120000_servicios_contratados.sql]
drop policy if exists servicios_contratados_select_super_admin on public.servicios_contratados;

-- [20261103120000_servicios_contratados.sql]
create policy servicios_contratados_select_super_admin
  on public.servicios_contratados for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261103120000_servicios_contratados.sql]
drop policy if exists servicios_contratados_update_super_admin on public.servicios_contratados;

-- [20261103120000_servicios_contratados.sql]
create policy servicios_contratados_update_super_admin
  on public.servicios_contratados for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20261103120000_servicios_contratados.sql]
drop policy if exists servicios_contratados_service_role on public.servicios_contratados;

-- [20261103120000_servicios_contratados.sql]
create policy servicios_contratados_service_role
  on public.servicios_contratados for all to service_role using (true) with check (true);

-- [20261103120000_servicios_contratados.sql]
drop policy if exists servicios_uso_select_super_admin on public.servicios_uso;

-- [20261103120000_servicios_contratados.sql]
create policy servicios_uso_select_super_admin
  on public.servicios_uso for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261103120000_servicios_contratados.sql]
drop policy if exists servicios_uso_service_role on public.servicios_uso;

-- [20261103120000_servicios_contratados.sql]
create policy servicios_uso_service_role
  on public.servicios_uso for all to service_role using (true) with check (true);

-- [20261103120000_servicios_contratados.sql]
-- Sesión de panel viva y usuario no bloqueado (si existe el control).
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_contratados';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_contratados as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_uso';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_uso as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- [20261103160000_servicios_planes_costes.sql] public.servicios_uso_ultimas()
-- La fila cambia de forma: se vuelve a crear igual (SECURITY INVOKER).
create or replace function public.servicios_uso_ultimas()
returns setof public.servicios_uso
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (u.proveedor) u.*
    from public.servicios_uso u
   order by u.proveedor, u.tomado_en desc;
$$;

-- [20261103120000_servicios_contratados.sql]
revoke all on function public.servicios_uso_ultimas() from public, anon;

-- [20261103120000_servicios_contratados.sql]
grant execute on function public.servicios_uso_ultimas() to authenticated, service_role;

-- [override] servicios_metricas_supabase
-- Métricas de Supabase y del gasto de IA para Super Admin › Servicios (sin correos de reservas, newsletter, cheques ni llamadas).
CREATE OR REPLACE FUNCTION public.servicios_metricas_supabase()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mes timestamptz := date_trunc('month', now(), 'UTC');
  v_dia timestamptz := date_trunc('day', now(), 'UTC');
  v_mes_fecha date := (date_trunc('month', now(), 'UTC') at time zone 'UTC')::date;
  v_hoy date := (now() at time zone 'UTC')::date;
  v jsonb := jsonb_build_object(
    'bd_bytes', pg_database_size(current_database()),
    'mes_desde', v_mes,
    'dia_desde', v_dia
  );
  v_a bigint;
  v_b bigint;
  v_n1 numeric;
  v_n2 numeric;
  v_f date;
  v_ultimo_real date;
begin
  -- Storage y usuarios.
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum(case when (metadata ->> 'size') ~ '^[0-9]+$' then (metadata ->> 'size')::bigint else 0 end), 0)::bigint,
                      count(*)::bigint
                 from storage.objects$q$ into v_a, v_b;
    v := v || jsonb_build_object('storage_bytes', v_a, 'storage_objetos', v_b);
  end if;

  if to_regclass('auth.users') is not null then
    if to_regclass('auth.sessions') is not null then
      execute $q$select count(*)::bigint from auth.users u
                  where u.last_sign_in_at >= $1
                     or exists (select 1 from auth.sessions s where s.user_id = u.id and s.updated_at >= $1)$q$
        into v_a using v_mes;
    else
      execute $q$select count(*)::bigint from auth.users u where u.last_sign_in_at >= $1$q$ into v_a using v_mes;
    end if;
    execute $q$select count(*)::bigint from auth.users$q$ into v_b;
    v := v || jsonb_build_object('usuarios_activos_mes', v_a, 'usuarios_total', v_b);
  end if;

  -- (Nuevo) Tipo de cambio: el de la pantalla y el último del BCE.
  if to_regclass('public.servicios_config') is not null then
    execute $q$select eur_por_usd from public.servicios_config limit 1$q$ into v_n1;
    if v_n1 is not null then
      v := v || jsonb_build_object('eur_por_usd', v_n1);
    end if;
  end if;
  if to_regclass('public.tipo_cambio_usd_eur') is not null then
    execute $q$select eur_por_usd, fecha from public.tipo_cambio_usd_eur order by fecha desc limit 1$q$ into v_n1, v_f;
    if v_n1 is not null then
      v := v || jsonb_build_object('eur_por_usd_bce', v_n1, 'eur_por_usd_bce_fecha', v_f);
    end if;
  end if;

  -- (Nuevo) IA: lo que OpenAI ya ha facturado este mes (días cerrados, UTC) y,
  -- de `ia_uso`, la estimación de lo que aún no ha publicado (desde el día
  -- siguiente al último real), como gasto_ia_real_resumen.
  if to_regclass('public.openai_costes_diarios') is not null then
    execute $q$select coalesce(sum(usd) filter (where fecha >= $1 and fecha < $2), 0),
                      max(fecha) filter (where fecha < $2)
                 from public.openai_costes_diarios$q$
      into v_n1, v_ultimo_real using v_mes_fecha, v_hoy;
    v := v || jsonb_build_object('openai_usd_mes_real', v_n1, 'openai_ultimo_dia_real', v_ultimo_real);
  end if;
  if to_regclass('public.ia_uso') is not null then
    execute $q$select coalesce(sum(coste_usd), 0),
                      coalesce(sum(coste_usd) filter (where created_at >= $2), 0)
                 from public.ia_uso
                where created_at >= $1$q$
      into v_n1, v_n2
      using v_mes, greatest(v_mes, coalesce(((v_ultimo_real + 1)::timestamp at time zone 'UTC'), v_mes));
    v := v || jsonb_build_object('ia_usd_mes_estimado', v_n1, 'ia_usd_estimado_sin_real', v_n2);
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.servicios_config')
                and attname = 'tope_ia_mes_eur' and not attisdropped) then
    execute $q$select tope_ia_mes_eur from public.servicios_config limit 1$q$ into v_n1;
    if v_n1 is not null then
      v := v || jsonb_build_object('tope_ia_mes_eur', v_n1);
    end if;
  end if;

  return v;
end;
$function$;

-- [20261103120000_servicios_contratados.sql]
revoke all on function public.servicios_metricas_supabase() from public, anon, authenticated;

-- [20261103120000_servicios_contratados.sql]
grant execute on function public.servicios_metricas_supabase() to service_role;

-- [20261103120000_servicios_contratados.sql]
-- ─── 6. Semilla (no pisa lo editado) ────────────────────────────────────────
insert into public.servicios_contratados
  (proveedor, nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas, actualizado_por)
values
  ('vercel', 'Vercel', 'Hobby', 0, 'USD', 'gratuito', null,
   'Equipo «Cristalería BV» (cristaleria-bv, <equipo-vercel>) · proyectos cristaleriabv y admin-cristaleriabv',
   'https://vercel.com/cristaleria-bv/~/usage',
   $j${
     "peticiones_cdn": {"orden": 1, "etiqueta": "Visitas a las webs (peticiones al CDN)", "limite": 1000000, "unidad": "peticiones", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "transferencia_rapida": {"orden": 2, "etiqueta": "Datos servidos a los visitantes (Fast Data Transfer)", "limite": 100, "unidad": "GB", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "transferencia_origen": {"orden": 3, "etiqueta": "Datos desde el servidor (Fast Origin Transfer)", "limite": 10, "unidad": "GB", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "invocaciones_funciones": {"orden": 4, "etiqueta": "Ejecuciones de funciones", "limite": 1000000, "unidad": "invocaciones", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "cpu_activa": {"orden": 5, "etiqueta": "Tiempo de CPU de las funciones", "limite": 4, "unidad": "horas", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "transformaciones_imagen": {"orden": 6, "etiqueta": "Imágenes optimizadas", "limite": 5000, "unidad": "transformaciones", "periodo": "últimos 30 días", "fuente": "https://vercel.com/docs/plans/hobby"},
     "despliegues_24h": {"orden": 7, "etiqueta": "Publicaciones (despliegues)", "limite": 100, "unidad": "despliegues", "periodo": "últimas 24 h", "fuente": "https://vercel.com/docs/plans/hobby"}
   }$j$::jsonb,
   'Plan gratuito. Si se pasa de un límite, Vercel pausa ese recurso hasta que pasen 30 días. El plan Hobby es para uso no comercial (Pro: 20 USD por persona y mes).',
   null),
  ('supabase', 'Supabase', 'Free', 0, 'USD', 'gratuito', null,
   'Organización «Cristalería BV» · proyectos cristaleriabv-prod (<ref-produccion>) y cristaleriabv-demo (<ref-demo>)',
   'https://supabase.com/dashboard/org/_/usage',
   $j${
     "bd_tamano": {"orden": 1, "etiqueta": "Tamaño de la base de datos", "limite": 500, "unidad": "MB", "periodo": "ahora", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "Límite por proyecto."},
     "almacenamiento": {"orden": 2, "etiqueta": "Fotos y archivos guardados (Storage)", "limite": 1, "unidad": "GB", "periodo": "ahora", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "Se mide solo este proyecto; el límite es para toda la organización."},
     "usuarios_activos_mes": {"orden": 3, "etiqueta": "Usuarios activos este mes", "limite": 50000, "unidad": "usuarios", "periodo": "mes en curso", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase"},
     "invocaciones_funciones_mes": {"orden": 4, "etiqueta": "Ejecuciones de funciones este mes", "limite": 500000, "unidad": "invocaciones", "periodo": "mes en curso", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "En el plan Free, Supabase no da el total del mes por API: aquí sale el de las últimas 24 h y el del mes está en su panel (Usage)."},
     "egreso": {"orden": 5, "etiqueta": "Datos servidos (egress)", "limite": 5, "unidad": "GB", "periodo": "mes en curso", "fuente": "https://supabase.com/docs/guides/platform/billing-on-supabase", "nota": "Supabase no da este dato por API en el plan Free: míralo en su panel (Usage)."}
   }$j$::jsonb,
   'Plan gratuito. Un proyecto Free se pausa tras una semana sin actividad.',
   null),
  ('github', 'GitHub', 'Free', 0, 'USD', 'gratuito', null,
   'Cuenta oficiososia · repositorios cristaleriabv y admin-cristaleriabv',
   'https://github.com/settings/billing/usage',
   $j${
     "actions_computo": {"orden": 1, "etiqueta": "Pruebas automáticas (GitHub Actions)", "limite": 12, "unidad": "USD", "periodo": "mes en curso", "fuente": "https://docs.github.com/en/billing/concepts/product-billing/github-actions", "nota": "El plan gratuito incluye 12 USD de cómputo al mes en repositorios privados (unos 2.000 minutos de Linux)."},
     "almacenamiento_artefactos": {"orden": 2, "etiqueta": "Almacenamiento de artefactos y paquetes", "limite": 500, "unidad": "MB", "periodo": "media del mes", "fuente": "https://docs.github.com/en/billing/concepts/product-billing/github-actions"}
   }$j$::jsonb,
   'Plan gratuito. Los repositorios privados del plan Free no admiten reglas de protección de ramas (ver docs/PROCESO-DE-CAMBIOS.md).',
   null),
  ('resend', 'Resend', 'Free (por confirmar)', 0, 'USD', 'gratuito', null,
   'Correos de reservas y newsletter',
   'https://resend.com/settings/usage',
   $j${
     "correos_mes": {"orden": 1, "etiqueta": "Correos enviados este mes", "limite": 3000, "unidad": "correos", "periodo": "mes en curso", "fuente": "https://resend.com/docs/knowledge-base/account-quotas-and-limits"},
     "correos_hoy": {"orden": 2, "etiqueta": "Correos enviados hoy", "limite": 100, "unidad": "correos", "periodo": "hoy (UTC)", "fuente": "https://resend.com/docs/knowledge-base/account-quotas-and-limits", "nota": "Solo el plan gratuito tiene tope diario."},
     "contactos_marketing": {"orden": 3, "etiqueta": "Contactos de la newsletter", "limite": 1000, "unidad": "contactos", "periodo": "ahora", "fuente": "https://resend.com/docs/knowledge-base/account-quotas-and-limits"},
     "dominios": {"orden": 4, "etiqueta": "Dominios de envío", "limite": 3, "unidad": "dominios", "periodo": "ahora", "fuente": "https://resend.com/pricing"}
   }$j$::jsonb,
   'Plan por confirmar: si la API devuelve el tope diario, la cuenta es Free (solo se manda al plan gratuito). Límites del plan Free; si el plan es otro, cámbialos aquí (Pro: 20 USD/mes y 50.000 correos/mes).',
   null),
  ('stripe', 'Stripe', 'Sin cuota (comisión por cobro)', null, 'EUR', 'por_uso', null,
   'Cuenta en MODO PRUEBA (todavía no cobra de verdad)',
   'https://dashboard.stripe.com/',
   '{}'::jsonb,
   'Sin cuota fija ni límite de uso: Stripe cobra una comisión por cada pago (1,5 % + 0,25 € con tarjetas estándar del Espacio Económico Europeo, según https://stripe.com/es/pricing).',
   null)
on conflict (proveedor) do nothing;

-- [20261103120000_servicios_contratados.sql]
do $$
begin
  raise notice 'servicios_contratados: aplicada';
end;
$$;

-- [20261103160000_servicios_planes_costes.sql]
do $$
begin
  if to_regclass('public.servicios_contratados') is null or to_regclass('public.servicios_uso') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'servicios_planes_costes: falta 20261103120000_servicios_contratados. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261103160000_servicios_planes_costes.sql]
-- ─── 1. servicios_contratados: categoría, orden, en uso, por confirmar… ─────
alter table public.servicios_contratados
  add column if not exists categoria     text,
  add column if not exists orden         integer,
  add column if not exists activo        boolean not null default true,
  add column if not exists por_confirmar boolean not null default false,
  add column if not exists precio_anual  numeric(10, 2),
  add column if not exists fuente_precio text;

-- [20261103160000_servicios_planes_costes.sql]
-- Primera vez (categoria vacía): categoría, orden y fuente de las 5 filas de
-- 20261103120000. Vercel: el equipo tiene también el proyecto cristaleriabv
-- (comprobado en Vercel el 03/11/2026); solo se cambia si el texto es el de la
-- semilla. Resend: el plan sigue sin confirmar.
update public.servicios_contratados s
   set categoria     = v.categoria,
       orden         = v.orden,
       fuente_precio = coalesce(s.fuente_precio, v.fuente),
       por_confirmar = v.por_confirmar,
       cuenta        = case
         when s.proveedor = 'vercel'
          and s.cuenta = 'Equipo «Cristalería BV» (cristaleria-bv, <equipo-vercel>) · proyectos cristaleriabv y admin-cristaleriabv'
         then 'Equipo «Cristalería BV» (cristaleria-bv, <equipo-vercel>) · proyectos cristaleriabv, admin-cristaleriabv y cristaleriabv'
         else s.cuenta end
  from (values
    ('vercel',   'alojamiento', 10, 'https://vercel.com/pricing',     false),
    ('supabase', 'base_datos',  20, 'https://supabase.com/pricing',   false),
    ('github',   'codigo',      30, 'https://github.com/pricing',     false),
    ('resend',   'correo',      40, 'https://resend.com/pricing',     true),
    ('stripe',   'pagos',       50, 'https://stripe.com/es/pricing',  false)
  ) as v(proveedor, categoria, orden, fuente, por_confirmar)
 where s.proveedor = v.proveedor
   and s.categoria is null;

-- [20261103160000_servicios_planes_costes.sql]
update public.servicios_contratados set categoria = 'otros' where categoria is null;

-- [20261103160000_servicios_planes_costes.sql]
update public.servicios_contratados set orden = 100 where orden is null;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados alter column categoria set default 'otros';

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados alter column categoria set not null;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados alter column orden set default 100;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados alter column orden set not null;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_categoria_chk;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados add constraint servicios_contratados_categoria_chk
  check (categoria in ('alojamiento', 'base_datos', 'codigo', 'correo', 'pagos', 'ia', 'telefonia', 'mapas', 'archivos', 'dominio', 'otros'));

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_orden_chk;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados add constraint servicios_contratados_orden_chk
  check (orden between 0 and 10000);

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_anual_chk;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados add constraint servicios_contratados_precio_anual_chk
  check (precio_anual is null or (precio_anual >= 0 and precio_anual <= 1000000));

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_fuente_precio_chk;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_contratados add constraint servicios_contratados_fuente_precio_chk
  check (fuente_precio is null or (fuente_precio ~ '^https://[^\s]+$' and length(fuente_precio) <= 500));

-- [20261103160000_servicios_planes_costes.sql]
comment on column public.servicios_contratados.categoria is 'Grupo del servicio en la pantalla (alojamiento, base_datos, codigo, correo, pagos, ia, telefonia, mapas, archivos, dominio, otros).';

-- [20261103160000_servicios_planes_costes.sql]
comment on column public.servicios_contratados.activo is '«Lo usamos». false = no se lee su consumo ni suma al coste (sale aparte, plegado).';

-- [20261103160000_servicios_planes_costes.sql]
comment on column public.servicios_contratados.por_confirmar is 'Plan y precio sin comprobar: la pantalla lo dice en la tarjeta y en el resumen de coste.';

-- [20261103160000_servicios_planes_costes.sql]
comment on column public.servicios_contratados.precio_anual is 'Lo que se paga al año cuando ciclo = anual (coste al mes = precio_anual / 12). Con otros ciclos, null.';

-- [20261103160000_servicios_planes_costes.sql]
comment on column public.servicios_contratados.fuente_precio is 'Página oficial del precio del plan (solo https).';

-- [20261103160000_servicios_planes_costes.sql]
grant update (nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas,
              categoria, orden, activo, por_confirmar, precio_anual, fuente_precio)
  on public.servicios_contratados to authenticated;

-- [20261103160000_servicios_planes_costes.sql]
-- ─── 2. servicios_uso: coste variable de la lectura ─────────────────────────
alter table public.servicios_uso add column if not exists coste_variable jsonb;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_uso drop constraint if exists servicios_uso_coste_chk;

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_uso add constraint servicios_uso_coste_chk
  check (coste_variable is null or (jsonb_typeof(coste_variable) = 'object' and length(coste_variable::text) <= 2000));

-- [20261103160000_servicios_planes_costes.sql]
comment on column public.servicios_uso.coste_variable is
  'Lo gastado por uso en el periodo de la lectura: { importe, moneda, periodo, origen (api | bd | estimado), nota }. null = sin coste variable medible.';

-- [20261103160000_servicios_planes_costes.sql]
revoke all on function public.servicios_uso_ultimas() from public, anon;

-- [20261103160000_servicios_planes_costes.sql]
grant execute on function public.servicios_uso_ultimas() to authenticated, service_role;

-- [20261103160000_servicios_planes_costes.sql]
-- ─── 3. servicios_config: tipo de cambio (una sola fila) ────────────────────
create table if not exists public.servicios_config (
  id              boolean primary key default true,
  eur_por_usd     numeric(12, 6) not null default 0.92,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid() references auth.users(id) on delete set null,
  constraint servicios_config_unica check (id),
  constraint servicios_config_cambio_chk check (eur_por_usd > 0.2 and eur_por_usd < 5)
);

-- [20261103160000_servicios_planes_costes.sql]
comment on table public.servicios_config is
  'Configuración de Super Admin › Servicios (una sola fila): eur_por_usd = euros por 1 dólar con los que se pasan a EUR '
  'los precios en USD. La edita el super admin; nace con el último cambio del BCE (tipo_cambio_usd_eur) o 0,92.';

-- [20261103160000_servicios_planes_costes.sql]
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.servicios_config'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.servicios_config';
    execute 'create trigger trg_auditoria after insert or update or delete on public.servicios_config
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- [20261103160000_servicios_planes_costes.sql] public.servicios_config_al_editar()
create or replace function public.servicios_config_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;

-- [20261103160000_servicios_planes_costes.sql]
revoke all on function public.servicios_config_al_editar() from public, anon, authenticated;

-- [20261103160000_servicios_planes_costes.sql]
drop trigger if exists servicios_config_al_editar on public.servicios_config;

-- [20261103160000_servicios_planes_costes.sql]
create trigger servicios_config_al_editar
  before update on public.servicios_config
  for each row execute function public.servicios_config_al_editar();

-- [20261103160000_servicios_planes_costes.sql]
alter table public.servicios_config enable row level security;

-- [20261103160000_servicios_planes_costes.sql]
revoke all on public.servicios_config from anon, authenticated;

-- [20261103160000_servicios_planes_costes.sql]
grant select on public.servicios_config to authenticated;

-- [20261103160000_servicios_planes_costes.sql]
grant update (eur_por_usd) on public.servicios_config to authenticated;

-- [20261103160000_servicios_planes_costes.sql]
grant all on public.servicios_config to service_role;

-- [20261103160000_servicios_planes_costes.sql]
drop policy if exists servicios_config_select_super_admin on public.servicios_config;

-- [20261103160000_servicios_planes_costes.sql]
create policy servicios_config_select_super_admin
  on public.servicios_config for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261103160000_servicios_planes_costes.sql]
drop policy if exists servicios_config_update_super_admin on public.servicios_config;

-- [20261103160000_servicios_planes_costes.sql]
create policy servicios_config_update_super_admin
  on public.servicios_config for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20261103160000_servicios_planes_costes.sql]
drop policy if exists servicios_config_service_role on public.servicios_config;

-- [20261103160000_servicios_planes_costes.sql]
create policy servicios_config_service_role
  on public.servicios_config for all to service_role using (true) with check (true);

-- [20261103160000_servicios_planes_costes.sql]
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_config';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_config as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- [20261103160000_servicios_planes_costes.sql]
-- La fila: con el último cambio del BCE si lo hay (no pisa una ya guardada).
do $$
declare
  v_cambio numeric;
begin
  if to_regclass('public.tipo_cambio_usd_eur') is not null then
    execute 'select eur_por_usd from public.tipo_cambio_usd_eur order by fecha desc limit 1' into v_cambio;
  end if;
  insert into public.servicios_config (id, eur_por_usd, actualizado_por)
  values (true, coalesce(v_cambio, 0.92), null)
  on conflict (id) do nothing;
end;
$$;

-- [20261103160000_servicios_planes_costes.sql]
revoke all on function public.servicios_metricas_supabase() from public, anon, authenticated;

-- [20261103160000_servicios_planes_costes.sql]
grant execute on function public.servicios_metricas_supabase() to service_role;

-- [20261103170000_cambio_contrasena_propia.sql]
create index if not exists idx_audit_log_cambio_contrasena
  on public.audit_log (actor_user_id, created_at)
  where tabla = 'acciones_servidor' and registro_id = 'cambiar-mi-contrasena';

-- [20261103170000_cambio_contrasena_propia.sql] public.iniciar_cambio_contrasena(uuid)
create or replace function public.iniciar_cambio_contrasena(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_cuenta constant integer  := 10;                    -- fallos de la cuenta (login + cambio)
  c_max_cambio constant integer  := 5;                     -- de ellos, cambios fallidos
  c_ventana    constant interval := interval '15 minutes';
  v_headers  jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_email    text;
  v_n_login  bigint;
  v_n_cambio bigint;
  v_motivo   text;
  v_id       uuid;
begin
  if auth.role() is distinct from 'service_role'
     or v_headers->>'x-audit-source' is distinct from 'cambiar-mi-contrasena' then
    raise exception 'Solo cambiar-mi-contrasena';
  end if;

  select left(lower(btrim(coalesce(u.email, ''))), 255) into v_email
  from auth.users u where u.id = p_actor;
  if not found or v_email = '' then
    raise exception 'La cuenta no existe';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('panel-auth-email:' || v_email, 0));

  -- Mismo criterio que iniciar_intento_panel para el email.
  select count(*) into v_n_login from public.audit_log
  where tabla = 'accesos_panel'
    and detalles->>'email_introducido' = v_email
    and created_at > clock_timestamp() - c_ventana
    and coalesce(detalles->>'resultado', '') not in ('limite_intentos', 'correcto');

  select count(*) into v_n_cambio from public.audit_log
  where tabla = 'acciones_servidor'
    and registro_id = 'cambiar-mi-contrasena'
    and actor_user_id = p_actor
    and created_at > clock_timestamp() - c_ventana
    and (detalles->>'resultado' = 'pendiente'
         or detalles->>'motivo' = 'contrasena_actual_incorrecta');

  if v_n_login + v_n_cambio >= c_max_cuenta then
    v_motivo := 'cuenta';
  elsif v_n_cambio >= c_max_cambio then
    v_motivo := 'cambio';
  end if;

  insert into public.audit_log (actor_user_id, accion, tabla, registro_id, detalles)
  values (
    p_actor, 'ejecutar', 'acciones_servidor', 'cambiar-mi-contrasena',
    jsonb_build_object(
      'operacion', 'cambiar-mi-contrasena',
      'origen', 'cambiar-mi-contrasena',
      'tipo_evento', 'cambio_contrasena',
      'request_id', v_headers->>'x-audit-request-id',
      'resultado', case when v_motivo is null then 'pendiente' else 'fallida' end)
    || case when v_motivo is not null
         then jsonb_build_object('motivo', 'limite_intentos', 'limite', v_motivo, 'finalizado_en', clock_timestamp())
         else '{}'::jsonb end)
  returning id into v_id;

  if v_motivo is not null then
    return jsonb_build_object('id', v_id, 'permitido', false, 'motivo', v_motivo);
  end if;
  return jsonb_build_object('id', v_id, 'permitido', true);
end;
$$;

-- [20261103170000_cambio_contrasena_propia.sql] public.finalizar_cambio_contrasena(uuid,uuid,text)
create or replace function public.finalizar_cambio_contrasena(p_id uuid, p_actor uuid, p_resultado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_motivo  text;
begin
  if auth.role() is distinct from 'service_role'
     or v_headers->>'x-audit-source' is distinct from 'cambiar-mi-contrasena' then
    raise exception 'Solo cambiar-mi-contrasena';
  end if;
  v_motivo := case
    when p_resultado in ('correcto', 'contrasena_actual_incorrecta', 'contrasena_rechazada', 'error_servicio')
      then p_resultado
    else 'error_servicio' end;

  update public.audit_log
  set detalles = detalles
    || jsonb_build_object(
         'resultado', case when v_motivo = 'correcto' then 'completada' else 'fallida' end,
         'finalizado_en', clock_timestamp())
    || case when v_motivo <> 'correcto' then jsonb_build_object('motivo', v_motivo) else '{}'::jsonb end
  where id = p_id
    and tabla = 'acciones_servidor'
    and registro_id = 'cambiar-mi-contrasena'
    and actor_user_id = p_actor
    and detalles->>'resultado' = 'pendiente'
    -- La misma petición que lo empezó (como finalizar_intento_panel).
    and request_id is not distinct from v_headers->>'x-audit-request-id';
  if not found then
    raise exception 'El intento no existe o ya terminó';
  end if;
end;
$$;

-- [20261103170000_cambio_contrasena_propia.sql]
revoke all on function public.iniciar_cambio_contrasena(uuid) from public, anon, authenticated;

-- [20261103170000_cambio_contrasena_propia.sql]
revoke all on function public.finalizar_cambio_contrasena(uuid, uuid, text) from public, anon, authenticated;

-- [20261103170000_cambio_contrasena_propia.sql]
grant execute on function public.iniciar_cambio_contrasena(uuid) to service_role;

-- [20261103170000_cambio_contrasena_propia.sql]
grant execute on function public.finalizar_cambio_contrasena(uuid, uuid, text) to service_role;

-- [20261103180000_recorte_servidor_cupo.sql]
do $$
begin
  if to_regclass('public.ia_uso') is null or to_regclass('public.ia_precios') is null then
    raise exception 'recorte_servidor_cupo: faltan ia_uso / ia_precios (20260928193000). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    raise exception 'recorte_servidor_cupo: falta public.can_write_section(text). No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261103180000_recorte_servidor_cupo.sql]
-- ─── 1. Tarifa (0: plan Hobby) y alta en el catálogo de funciones ───────────
insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output, notas, fuente, verificado_en)
values ('vercel:recortar-foto', 0, null, null, 0,
        'Pseudo-modelo: recorte de fondo en la Vercel Function api/recortar-foto (plan Hobby, sin coste en dinero; el gasto es CPU: ver duracion_ms y Super Admin › Servicios).',
        'https://vercel.com/docs/plans/hobby', null)
on conflict (modelo) do nothing;

-- [20261103180000_recorte_servidor_cupo.sql]
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('recortar-foto', 'Quita el fondo de las fotos de la carta que se suben desde el móvil (Vercel Function, mismo modelo que el ordenador). Una fila por foto con su duración de CPU.', true, 'foto', 90)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- [20261103180000_recorte_servidor_cupo.sql]
-- ─── 2. Topes por defecto en la fila de Vercel (no pisa lo editado) ─────────
do $$
begin
  if to_regclass('public.servicios_contratados') is not null then
    update public.servicios_contratados
       set limites = $j${
             "recortes_servidor_mes": {"orden": 8, "etiqueta": "Recortes de fotos en el servidor (tope del panel)", "limite": 600, "unidad": "fotos", "periodo": "mes en curso", "nota": "Tope nuestro, no de Vercel: al llegar, el móvil deja las fotos para un ordenador. 600 fotos × ~12 s de CPU (peor caso) ≈ 2 h, la mitad del cupo de 4 h."},
             "recortes_servidor_dia": {"orden": 9, "etiqueta": "Recortes de fotos en el servidor hoy (tope del panel)", "limite": 60, "unidad": "fotos", "periodo": "hoy"},
             "cpu_recortes_mes": {"orden": 10, "etiqueta": "CPU de los recortes en el servidor (tope del panel)", "limite": 120, "unidad": "minutos", "periodo": "mes en curso"}
           }$j$::jsonb || limites
     where proveedor = 'vercel';
  end if;
end;
$$;

-- [20261104121000_servicios_configurables.sql]
do $$
begin
  if to_regclass('public.servicios_contratados') is null or to_regclass('public.servicios_uso') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'servicios_configurables: falta 20261103120000_servicios_contratados. No se ha cambiado nada.';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.servicios_contratados'::regclass
                    and attname = 'activo' and not attisdropped) then
    raise exception 'servicios_configurables: falta 20261103160000_servicios_planes_costes. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261104121000_servicios_configurables.sql]
-- ─── 1. Altas (solo super admin) ────────────────────────────────────────────
grant insert (proveedor, nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas,
              categoria, orden, activo, por_confirmar, precio_anual, fuente_precio)
  on public.servicios_contratados to authenticated;

-- [20261104121000_servicios_configurables.sql]
drop policy if exists servicios_contratados_insert_super_admin on public.servicios_contratados;

-- [20261104121000_servicios_configurables.sql]
create policy servicios_contratados_insert_super_admin
  on public.servicios_contratados for insert to authenticated
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20261104121000_servicios_configurables.sql]
-- ─── 3. Borrar del todo: solo lo ya quitado (activo = false) ────────────────
grant delete on public.servicios_contratados to authenticated;

-- [20261104121000_servicios_configurables.sql]
drop policy if exists servicios_contratados_delete_super_admin on public.servicios_contratados;

-- [20261104121000_servicios_configurables.sql]
create policy servicios_contratados_delete_super_admin
  on public.servicios_contratados for delete to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) and not activo );

-- [20261104121000_servicios_configurables.sql] public.servicios_contratados_al_borrar()
-- Las lecturas del servicio borrado se van con él (si no, un servicio nuevo
-- con la misma clave heredaría la última lectura del viejo).
create or replace function public.servicios_contratados_al_borrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.servicios_uso where proveedor = old.proveedor;
  return old;
end;
$$;

-- [20261104121000_servicios_configurables.sql]
revoke all on function public.servicios_contratados_al_borrar() from public, anon, authenticated;

-- [20261104121000_servicios_configurables.sql]
drop trigger if exists servicios_contratados_al_borrar on public.servicios_contratados;

-- [20261104121000_servicios_configurables.sql]
create trigger servicios_contratados_al_borrar
  after delete on public.servicios_contratados
  for each row execute function public.servicios_contratados_al_borrar();

-- [20261104121000_servicios_configurables.sql]
comment on table public.servicios_contratados is
  'Servicios contratados (Super Admin › Servicios): plan, precio, renovación, cuenta, enlace al panel y LÍMITES del plan '
  '({ métrica: { etiqueta, limite, unidad, periodo, fuente, nota, orden } }; limite null = sin dato). Solo super admin: '
  'lee, edita, da de alta y borra (solo lo quitado, activo = false; 20261104121000). '
  'El consumo lo lee la Edge Function servicios-uso y lo guarda en servicios_uso.';

-- [20261104121000_servicios_configurables.sql]
-- ─── 4. Texto del límite automático de OpenAI (solo si es el de la semilla) ─
update public.servicios_contratados
   set limites = jsonb_set(limites, '{gasto_ia_mes,limite_desde}', to_jsonb('Tope de gasto de IA de Super Admin › Servicios › Costes'::text))
 where proveedor = 'openai'
   and limites -> 'gasto_ia_mes' ->> 'limite_desde' = 'Tope de gasto de IA de Super Admin › Costes';

-- [20261104121000_servicios_configurables.sql]
-- ─── Comprobación final ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'servicios_contratados'
                    and policyname = 'servicios_contratados_insert_super_admin' and cmd = 'INSERT')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'servicios_contratados'
                       and policyname = 'servicios_contratados_delete_super_admin' and cmd = 'DELETE')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.servicios_contratados'::regclass
                       and tgname = 'servicios_contratados_al_borrar' and not tgisinternal)
     or not has_column_privilege('authenticated', 'public.servicios_contratados', 'proveedor', 'INSERT')
     or has_column_privilege('authenticated', 'public.servicios_contratados', 'actualizado_por', 'INSERT')
     or not has_table_privilege('authenticated', 'public.servicios_contratados', 'DELETE') then
    raise exception 'servicios_configurables: la comprobación final ha fallado. No se ha cambiado nada.';
  end if;
  raise notice 'servicios_configurables: aplicada';
end;
$$;

-- [20261106200000_facturas_cargar_qa.sql] public.url_funcion_edge(text)
-- ─── 1. S-4: URL de las Edge Functions desde Vault ─────────────────────────
create or replace function public.url_funcion_edge(p_funcion text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when coalesce(s.decrypted_secret, '') = '' or coalesce(p_funcion, '') = '' then null
           else rtrim(s.decrypted_secret, '/') || '/functions/v1/' || p_funcion
         end
    from (select (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) as decrypted_secret) s;
$$;

-- [20261106200000_facturas_cargar_qa.sql]
comment on function public.url_funcion_edge(text) is
  'URL de una Edge Function del proyecto (secreto de Vault «project_url»). Null sin el secreto. 20261106200000.';

-- [20261106200000_facturas_cargar_qa.sql]
-- ─── 6. Permisos ────────────────────────────────────────────────────────────
revoke all on function public.url_funcion_edge(text) from public, anon, authenticated;

-- [20261106200000_facturas_cargar_qa.sql]
revoke all on function public.openai_despachar_sincronizacion_costes() from public, anon, authenticated;

-- [20261106200000_facturas_cargar_qa.sql]
grant execute on function public.url_funcion_edge(text) to service_role;

-- [20261106200000_facturas_cargar_qa.sql]
grant execute on function public.openai_despachar_sincronizacion_costes() to service_role;

-- [20261106530000_usuarios_seccion_configurable.sql]
-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_t text;
  v_f text;
begin
  foreach v_t in array array['public.user_permissions', 'public.user_roles', 'public.super_admins'] loop
    if to_regclass(v_t) is null then
      v_faltan := v_faltan || v_t;
    end if;
  end loop;
  foreach v_f in array array['public.can_read_section(text)', 'public.is_super_admin(uuid)'] loop
    if to_regprocedure(v_f) is null then
      v_faltan := v_faltan || v_f;
    end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'usuarios_seccion_configurable: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- [20261106530000_usuarios_seccion_configurable.sql]
-- ─── 1. Semilla: quien hoy ve Usuarios (rol admin) la conserva ──────────────
do $$
declare
  v_n integer := 0;
begin
  if exists (select 1 from public.user_permissions where section_key = 'usuarios') then
    raise notice 'usuarios_seccion_configurable: la sección ya tiene permisos; no se siembra otra vez';
    return;
  end if;

  insert into public.user_permissions (user_id, section_key, can_view, can_edit)
  select distinct r.user_id, 'usuarios', true, false
    from public.user_roles r
   where r.role::text = 'admin'
     and not public.is_super_admin(r.user_id)
  on conflict (user_id, section_key) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'usuarios_seccion_configurable: % admin(s) conservan la pantalla Usuarios', v_n;

  if to_regclass('public.user_role_presets') is not null then
    update public.user_role_presets
       set permissions = permissions || jsonb_build_array(jsonb_build_object(
             'section_key', 'usuarios', 'can_view', true, 'can_edit', false))
     where base_role::text = 'admin'
       and jsonb_typeof(permissions) = 'array'
       and not exists (select 1 from jsonb_array_elements(permissions) e
                        where e ->> 'section_key' = 'usuarios');
    get diagnostics v_n = row_count;
    raise notice 'usuarios_seccion_configurable: % rol(es) preconfigurado(s) con la sección', v_n;
  end if;
end;
$$;

-- [20261106530000_usuarios_seccion_configurable.sql]
-- ─── 2. Lectura de roles, permisos y super admins ───────────────────────────
drop policy if exists "Admins pueden ver todos los roles" on public.user_roles;

-- [20261106530000_usuarios_seccion_configurable.sql]
drop policy if exists user_roles_select_seccion_usuarios on public.user_roles;

-- [20261106530000_usuarios_seccion_configurable.sql]
create policy user_roles_select_seccion_usuarios
  on public.user_roles for select to authenticated
  using ((select public.can_read_section('usuarios')));

-- [20261106530000_usuarios_seccion_configurable.sql]
drop policy if exists "Admins pueden ver todos los permisos" on public.user_permissions;

-- [20261106530000_usuarios_seccion_configurable.sql]
drop policy if exists user_permissions_select_seccion_usuarios on public.user_permissions;

-- [20261106530000_usuarios_seccion_configurable.sql]
create policy user_permissions_select_seccion_usuarios
  on public.user_permissions for select to authenticated
  using ((select public.can_read_section('usuarios')));

-- [20261106530000_usuarios_seccion_configurable.sql]
drop policy if exists super_admins_select_seccion_usuarios on public.super_admins;

-- [20261106530000_usuarios_seccion_configurable.sql]
create policy super_admins_select_seccion_usuarios
  on public.super_admins for select to authenticated
  using ((select public.can_read_section('usuarios')));

-- [20261106530000_usuarios_seccion_configurable.sql]
-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('user_roles', 'user_permissions')
              and policyname in ('Admins pueden ver todos los roles', 'Admins pueden ver todos los permisos')) then
    raise exception 'usuarios_seccion_configurable: siguen las políticas por rol admin. No se ha aplicado nada.';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('user_roles_select_seccion_usuarios', 'user_permissions_select_seccion_usuarios', 'super_admins_select_seccion_usuarios');
  if v_n <> 3 then
    raise exception 'usuarios_seccion_configurable: faltan políticas nuevas (%/3). No se ha aplicado nada.', v_n;
  end if;
  raise notice 'usuarios_seccion_configurable: aplicada';
end;
$$;

-- [20261107300000_facturas_alertas.sql]
-- ─── 1. Columnas nuevas de la campana ───────────────────────────────────────
alter table public.notificaciones_dashboard
  add column if not exists clave text,
  add column if not exists caduca_en timestamptz,
  add column if not exists datos jsonb;

-- [20261107300000_facturas_alertas.sql]
create unique index if not exists notificaciones_dashboard_clave_uq
  on public.notificaciones_dashboard (clave) where clave is not null;

-- [20261107300000_facturas_alertas.sql]
create index if not exists notificaciones_dashboard_tipo_idx
  on public.notificaciones_dashboard (tipo, created_at desc);

-- [20261107300000_facturas_alertas.sql]
comment on column public.notificaciones_dashboard.clave is
  '20261107300000: clave de deduplicación (alertas de Facturas). Única cuando no es NULL.';

-- [20261107300000_facturas_alertas.sql]
comment on column public.notificaciones_dashboard.caduca_en is
  '20261107300000: pasada esta hora el aviso ya no se enseña (NULL = no caduca).';

-- [20261107300000_facturas_alertas.sql]
comment on column public.notificaciones_dashboard.datos is
  '20261107300000: datos de la alerta (enlace del panel, cifras, mes, familia, proveedor, producto) para la campana y las gráficas.';

-- [20261107500000_ia_modelos_centro.sql]
do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'ia_modelos_centro: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
  if to_regclass('public.ia_funciones') is null or to_regclass('public.ia_precios') is null
     or to_regclass('public.ia_uso') is null or to_regclass('public.notificaciones_dashboard') is null then
    raise exception 'ia_modelos_centro: faltan ia_funciones/ia_precios/ia_uso/notificaciones_dashboard. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261107500000_ia_modelos_centro.sql]
-- ─── 0. La propia función en el catálogo de ia_funciones ────────────────────
-- activo = false: solo gasta en las pruebas a mano, así que no debe salir en
-- «funciones sin registro» por no tener filas en una semana.
insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo)
values ('ia-modelos-openai',
        'Centro de modelos de IA: lista los modelos de la cuenta (GET /v1/models, gratis) y hace las llamadas mínimas del botón «Probar».',
        true, 'prueba', 900, false)
on conflict (funcion) do nothing;

-- [20261107500000_ia_modelos_centro.sql]
-- ─── 1. Modelos de la cuenta ────────────────────────────────────────────────
create table if not exists public.ia_modelos_disponibles (
  id                 text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{0,119}$'),
  owned_by           text check (owned_by is null or length(owned_by) <= 120),
  creado_openai      timestamptz,
  primera_vez_visto  timestamptz not null default now(),
  ultima_vez_visto   timestamptz not null default now(),
  retirado_en        timestamptz,
  -- true = se vio en la primera carga: no es «nuevo», ya estaba.
  primera_carga      boolean not null default false,
  de_interes         boolean generated always as (id ~ '^(gpt-|o[0-9]|text-embedding-)') stored
);

-- [20261107500000_ia_modelos_centro.sql]
comment on table public.ia_modelos_disponibles is
  'Modelos que devuelve GET /v1/models de OpenAI (Edge Function ia-modelos-openai). retirado_en = dejó de salir en la lista. '
  'de_interes = familias gpt-*, o*, text-embedding-*. Dato derivado: no se audita.';

-- [20261107500000_ia_modelos_centro.sql]
drop trigger if exists trg_auditoria on public.ia_modelos_disponibles;

-- [20261107500000_ia_modelos_centro.sql]
-- ─── 2. Modelo por función ──────────────────────────────────────────────────
create table if not exists public.ia_modelo_funcion (
  funcion             text primary key references public.ia_funciones(funcion) on update cascade on delete restrict,
  modelo              text check (modelo is null or modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{2,119}$'),
  modelo_respaldo     text check (modelo_respaldo is null or modelo_respaldo ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{2,119}$'),
  modelo_codigo       text check (modelo_codigo is null or length(modelo_codigo) <= 200),
  centralizado        boolean not null default false,
  notas               text check (notas is null or length(notas) <= 2000),
  cambiado_por        uuid,
  cambiado_por_email  text,
  cambiado_en         timestamptz not null default now(),
  constraint ia_modelo_funcion_respaldo_distinto check (modelo_respaldo is null or modelo is null or modelo_respaldo <> modelo)
);

-- [20261107500000_ia_modelos_centro.sql]
comment on table public.ia_modelo_funcion is
  'Modelo de OpenAI elegido por función. modelo NULL = el del código (modelo_codigo, informativo). Lo leen las Edge Functions '
  'con _shared/modelo-funcion.ts (caché 60 s; si falla, secreto o valor por defecto). Solo super admin.';

-- [20261107500000_ia_modelos_centro.sql]
create table if not exists public.ia_modelo_funcion_historial (
  id                  bigserial primary key,
  funcion             text not null,
  modelo_anterior     text,
  modelo_nuevo        text,
  respaldo_anterior   text,
  respaldo_nuevo      text,
  notas               text,
  cambiado_por        uuid,
  cambiado_por_email  text,
  cambiado_en         timestamptz not null default now()
);

-- [20261107500000_ia_modelos_centro.sql]
create index if not exists ia_modelo_funcion_historial_funcion_idx on public.ia_modelo_funcion_historial (funcion, cambiado_en desc);

-- [20261107500000_ia_modelos_centro.sql]
drop trigger if exists trg_auditoria on public.ia_modelo_funcion_historial;

-- [20261107620000_ia_modelos_herramientas.sql] public.ia_modelo_funcion_antes()
CREATE OR REPLACE FUNCTION public.ia_modelo_funcion_antes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_m text;
  v_motivo text;
begin
  if tg_op = 'UPDATE' and new.funcion is distinct from old.funcion then
    raise exception 'La función de una fila de ia_modelo_funcion no se puede cambiar' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.modelo is not distinct from old.modelo
     and new.modelo_respaldo is not distinct from old.modelo_respaldo
     and new.notas is not distinct from old.notas
     and new.modelo_codigo is not distinct from old.modelo_codigo
     and new.centralizado is not distinct from old.centralizado then
    return new;
  end if;
  if (new.modelo is not null or new.modelo_respaldo is not null) and not new.centralizado then
    raise exception 'La función % todavía no lee el modelo de esta tabla (centralizado = false): cambiarlo aquí no tendría efecto', new.funcion
      using errcode = '23514';
  end if;
  foreach v_m in array array_remove(array[new.modelo, new.modelo_respaldo], null) loop
    if tg_op = 'UPDATE' and (v_m is not distinct from old.modelo or v_m is not distinct from old.modelo_respaldo) then
      continue; -- ya estaba puesto: no se revalida (puede haberse retirado después)
    end if;
    if not exists (select 1 from public.ia_modelos_disponibles d where d.id = v_m and d.retirado_en is null) then
      raise exception 'El modelo % no está entre los modelos disponibles de la cuenta de OpenAI (o está retirado). Actualiza la lista antes.', v_m
        using errcode = '23514';
    end if;
    -- 20261107620000_ia_modelos_herramientas: chat-facturas y chat-web llaman a
    -- Chat Completions CON herramientas; un modelo que «Probar» marcó como
    -- incompatible fallaría en cada pregunta.
    if new.usa_herramientas then
      select d.compatible_motivo into v_motivo
        from public.ia_modelos_disponibles d
       where d.id = v_m and d.compatible_herramientas is false;
      if found then
        raise exception 'El modelo % no sirve para % (usa herramientas con Chat Completions): %', v_m, new.funcion,
          coalesce(v_motivo, 'la prueba con herramientas falló') using errcode = '23514';
      end if;
    end if;
  end loop;
  new.cambiado_en := now();
  new.cambiado_por := auth.uid();
  -- Sin usuario (SQL a mano, service_role): quien lo haga puede firmar con
  -- `set local ia_modelos.cambiado_por = '…'`; si no, «sistema».
  new.cambiado_por_email := coalesce(nullif(auth.jwt() ->> 'email', ''),
                                     nullif(left(current_setting('ia_modelos.cambiado_por', true), 120), ''),
                                     'sistema');
  return new;
end;
$function$;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on function public.ia_modelo_funcion_antes() from public, anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
drop trigger if exists ia_modelo_funcion_antes on public.ia_modelo_funcion;

-- [20261107500000_ia_modelos_centro.sql]
create trigger ia_modelo_funcion_antes
  before insert or update on public.ia_modelo_funcion
  for each row execute function public.ia_modelo_funcion_antes();

-- [20261107500000_ia_modelos_centro.sql] public.ia_modelo_funcion_historiar()
create or replace function public.ia_modelo_funcion_historiar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.modelo is not distinct from old.modelo
     and new.modelo_respaldo is not distinct from old.modelo_respaldo then
    return new; -- solo notas o datos informativos: no es un cambio de modelo
  end if;
  if tg_op = 'INSERT' and new.modelo is null and new.modelo_respaldo is null then
    return new; -- alta de la fila sin modelo (semilla): nada que historiar
  end if;
  insert into public.ia_modelo_funcion_historial
    (funcion, modelo_anterior, modelo_nuevo, respaldo_anterior, respaldo_nuevo, notas, cambiado_por, cambiado_por_email, cambiado_en)
  values (new.funcion,
          case when tg_op = 'UPDATE' then old.modelo end, new.modelo,
          case when tg_op = 'UPDATE' then old.modelo_respaldo end, new.modelo_respaldo,
          new.notas, new.cambiado_por, new.cambiado_por_email, new.cambiado_en);
  return new;
end;
$$;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on function public.ia_modelo_funcion_historiar() from public, anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
drop trigger if exists ia_modelo_funcion_historiar on public.ia_modelo_funcion;

-- [20261107500000_ia_modelos_centro.sql]
create trigger ia_modelo_funcion_historiar
  after insert or update on public.ia_modelo_funcion
  for each row execute function public.ia_modelo_funcion_historiar();

-- [20261107500000_ia_modelos_centro.sql]
-- La configuración SÍ se audita (mismo criterio que servicios_contratados).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.ia_modelo_funcion'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.ia_modelo_funcion';
    execute 'create trigger trg_auditoria after insert or update or delete on public.ia_modelo_funcion
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- [20261107500000_ia_modelos_centro.sql]
-- Semilla: una fila por función, SIN modelo (= lo de antes). on conflict:
-- solo se refresca lo informativo, nunca el modelo elegido.
insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
select v.funcion, v.codigo, v.centralizado
  from (values
    ('chat-facturas',             'gpt-4.1-mini (secreto CHAT_FACTURAS_MODELO)',                 true),
    ('clasificar-productos',      'gpt-5.6-luna (secreto CLASIFICAR_PRODUCTOS_MODELO)',          true),
    ('procesar-factura',          'gpt-5.6-luna (secreto OCR_MODELO; también trabajos de 1 página)', true),
    ('ocr-trabajo',               'gpt-5.6-luna (secreto OCR_MODELO_PIEZAS u OCR_MODELO; piezas)', true),
    ('chat-web',                  'gpt-5.6-luna (secreto CHAT_WEB_MODEL)',                       true),
    ('extraer-vino-foto',         'gpt-4.1 (secreto VINO_FOTO_MODELO) y gpt-4.1-mini para buscar', false),
    ('instagram-ia',              'gpt-5.6-luna (texto) y gpt-4.1 (visión), en código',          false),
    ('traducir-contenido',        'gpt-4.1-mini, en código',                                     false),
    ('format-novedad',            'gpt-4o-mini, en código',                                      false),
    ('procesar-dibujo-perimetro', 'gpt-5.4-mini, en código',                                     false)
  ) as v(funcion, codigo, centralizado)
 where exists (select 1 from public.ia_funciones f where f.funcion = v.funcion)
on conflict (funcion) do update
  set modelo_codigo = excluded.modelo_codigo,
      centralizado = excluded.centralizado
  where public.ia_modelo_funcion.modelo_codigo is distinct from excluded.modelo_codigo
     or public.ia_modelo_funcion.centralizado is distinct from excluded.centralizado;

-- [20261107500000_ia_modelos_centro.sql]
-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
alter table public.ia_modelo_funcion           enable row level security;

-- [20261107500000_ia_modelos_centro.sql]
alter table public.ia_modelo_funcion_historial enable row level security;

-- [20261107500000_ia_modelos_centro.sql]
alter table public.ia_modelos_disponibles      enable row level security;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on public.ia_modelo_funcion           from anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on public.ia_modelo_funcion_historial from anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on public.ia_modelos_disponibles      from anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
grant select on public.ia_modelo_funcion to authenticated;

-- [20261107500000_ia_modelos_centro.sql]
grant update (modelo, modelo_respaldo, notas) on public.ia_modelo_funcion to authenticated;

-- [20261107500000_ia_modelos_centro.sql]
grant select on public.ia_modelo_funcion_historial to authenticated;

-- [20261107500000_ia_modelos_centro.sql]
grant select on public.ia_modelos_disponibles to authenticated;

-- [20261107500000_ia_modelos_centro.sql]
grant all on public.ia_modelo_funcion           to service_role;

-- [20261107500000_ia_modelos_centro.sql]
grant all on public.ia_modelo_funcion_historial to service_role;

-- [20261107500000_ia_modelos_centro.sql]
grant all on public.ia_modelos_disponibles      to service_role;

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelo_funcion_select_super_admin on public.ia_modelo_funcion;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelo_funcion_select_super_admin on public.ia_modelo_funcion for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelo_funcion_update_super_admin on public.ia_modelo_funcion;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelo_funcion_update_super_admin on public.ia_modelo_funcion for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelo_funcion_service_role on public.ia_modelo_funcion;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelo_funcion_service_role on public.ia_modelo_funcion for all to service_role using (true) with check (true);

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelo_funcion_historial_select_super_admin on public.ia_modelo_funcion_historial;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelo_funcion_historial_select_super_admin on public.ia_modelo_funcion_historial for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelo_funcion_historial_service_role on public.ia_modelo_funcion_historial;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelo_funcion_historial_service_role on public.ia_modelo_funcion_historial for all to service_role using (true) with check (true);

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelos_disponibles_select_super_admin on public.ia_modelos_disponibles;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelos_disponibles_select_super_admin on public.ia_modelos_disponibles for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261107500000_ia_modelos_centro.sql]
drop policy if exists ia_modelos_disponibles_service_role on public.ia_modelos_disponibles;

-- [20261107500000_ia_modelos_centro.sql]
create policy ia_modelos_disponibles_service_role on public.ia_modelos_disponibles for all to service_role using (true) with check (true);

-- [20261107500000_ia_modelos_centro.sql]
do $$
declare
  t text;
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    foreach t in array array['ia_modelo_funcion', 'ia_modelo_funcion_historial', 'ia_modelos_disponibles'] loop
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end loop;
  end if;
end;
$$;

-- [20261107500000_ia_modelos_centro.sql]
-- Avisos de modelos: solo super admin (RESTRICTIVA: se suma a las de sección).
drop policy if exists notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard;

-- [20261107500000_ia_modelos_centro.sql]
create policy notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard
  as restrictive for all to authenticated
  using ( tipo not like 'ia\_modelo%' or (select public.is_super_admin((select auth.uid()))) )
  with check ( tipo not like 'ia\_modelo%' or (select public.is_super_admin((select auth.uid()))) );

-- [20261107500000_ia_modelos_centro.sql] public.ia_modelos_registrar(jsonb)
-- ─── 4. Registrar la lista de OpenAI y avisar ───────────────────────────────
create or replace function public.ia_modelos_registrar(p_modelos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ahora      timestamptz := clock_timestamp();
  v_primera    boolean;
  v_nuevos     text[];
  v_retirados  text[];
  v_vuelven    text[];
  v_en_uso     text[];
  v_uso_ret    text[];
  v_uso_inex   text[];
  v_sin_precio text[];
  v_m          text;
  v_avisos     int := 0;
  v_quien      text;
begin
  if p_modelos is null or jsonb_typeof(p_modelos) <> 'array' then
    raise exception 'ia_modelos_registrar: se esperaba un array de modelos' using errcode = '22023';
  end if;
  -- Una lista vacía (fallo de la API) marcaría todo como retirado: se rechaza.
  if not exists (select 1 from jsonb_array_elements(p_modelos) e
                  where jsonb_typeof(e) = 'object' and coalesce(btrim(e ->> 'id'), '') <> '') then
    raise exception 'ia_modelos_registrar: la lista no trae ningún modelo; no se cambia nada' using errcode = '22023';
  end if;

  create temp table if not exists ia_modelos_entrada (id text primary key, owned_by text, creado timestamptz) on commit drop;
  truncate pg_temp.ia_modelos_entrada;
  insert into pg_temp.ia_modelos_entrada (id, owned_by, creado)
  select distinct on (btrim(e ->> 'id'))
         btrim(e ->> 'id'),
         left(nullif(e ->> 'owned_by', ''), 120),
         case when (e ->> 'created') ~ '^[0-9]{1,12}$' then to_timestamp((e ->> 'created')::bigint) end
    from jsonb_array_elements(p_modelos) e
   where jsonb_typeof(e) = 'object'
     and btrim(e ->> 'id') ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{0,119}$';

  v_primera := not exists (select 1 from public.ia_modelos_disponibles);

  v_nuevos := array(select e.id from pg_temp.ia_modelos_entrada e
                     where not exists (select 1 from public.ia_modelos_disponibles d where d.id = e.id)
                     order by e.id);
  v_vuelven := array(select d.id from public.ia_modelos_disponibles d join pg_temp.ia_modelos_entrada e on e.id = d.id
                      where d.retirado_en is not null order by d.id);
  v_retirados := array(select d.id from public.ia_modelos_disponibles d
                        where d.retirado_en is null
                          and not exists (select 1 from pg_temp.ia_modelos_entrada e where e.id = d.id)
                        order by d.id);

  insert into public.ia_modelos_disponibles as d (id, owned_by, creado_openai, primera_vez_visto, ultima_vez_visto, retirado_en, primera_carga)
  select e.id, e.owned_by, e.creado, v_ahora, v_ahora, null, v_primera from pg_temp.ia_modelos_entrada e
  on conflict (id) do update
    set owned_by = coalesce(excluded.owned_by, d.owned_by),
        creado_openai = coalesce(excluded.creado_openai, d.creado_openai),
        ultima_vez_visto = v_ahora,
        retirado_en = null;

  update public.ia_modelos_disponibles set retirado_en = v_ahora where id = any(v_retirados);

  -- En uso = elegido en ia_modelo_funcion (modelo o respaldo) o usado en ia_uso
  -- los últimos 30 días y que sea de OpenAI (está o estuvo en la lista).
  v_en_uso := array(
    select distinct u.m from (
      select f.modelo as m from public.ia_modelo_funcion f
      union select f.modelo_respaldo from public.ia_modelo_funcion f
      union select x.modelo from public.ia_uso x where x.created_at > now() - interval '30 days'
    ) u
    where u.m is not null and exists (select 1 from public.ia_modelos_disponibles d where d.id = u.m)
    order by u.m);
  v_uso_ret := array(select d.id from public.ia_modelos_disponibles d where d.id = any(v_en_uso) and d.retirado_en is not null order by d.id);
  v_uso_inex := array(
    select distinct u.m from (
      select f.modelo as m from public.ia_modelo_funcion f union select f.modelo_respaldo from public.ia_modelo_funcion f
    ) u
    where u.m is not null and not exists (select 1 from public.ia_modelos_disponibles d where d.id = u.m)
    order by u.m);
  v_sin_precio := array(select m from unnest(v_en_uso) m
                         where not (m = any(v_uso_ret))
                           and not exists (select 1 from public.ia_precios p where p.modelo = m)
                         order by m);

  -- Avisos (para super admin). No se repite uno igual que siga sin leer.
  if not v_primera and exists (select 1 from public.ia_modelos_disponibles d where d.id = any(v_nuevos) and d.de_interes) then
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
    select 'ia_modelo_nuevo',
           'OpenAI tiene ' || count(*) || case when count(*) = 1 then ' modelo nuevo' else ' modelos nuevos' end,
           left('Nuevos en la cuenta: ' || string_agg(d.id, ', ' order by d.id)
                || '. Revisa su precio y pruébalos en Super Admin › Servicios › Modelos.', 1000),
           'ia_modelos', 'normal'
      from public.ia_modelos_disponibles d where d.id = any(v_nuevos) and d.de_interes;
    v_avisos := v_avisos + 1;
  end if;

  foreach v_m in array v_uso_ret || v_uso_inex loop
    v_quien := (select string_agg(f.funcion, ', ' order by f.funcion) from public.ia_modelo_funcion f
                 where f.modelo = v_m or f.modelo_respaldo = v_m);
    if v_quien is null then
      v_quien := (select string_agg(distinct x.funcion, ', ') from public.ia_uso x
                   where x.modelo = v_m and x.created_at > now() - interval '30 days');
    end if;
    if not exists (select 1 from public.notificaciones_dashboard n
                    where n.tipo = 'ia_modelo_retirado' and not n.leida
                      and n.titulo = 'Modelo de IA en uso no disponible: ' || v_m) then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values ('ia_modelo_retirado', 'Modelo de IA en uso no disponible: ' || v_m,
              left('OpenAI ya no lista ' || v_m || ' y lo usa: ' || coalesce(v_quien, '¿?')
                   || '. Cambia el modelo en Super Admin › Servicios › Modelos antes de que falle.', 1000),
              'ia_modelos', 'alta');
      v_avisos := v_avisos + 1;
    end if;
  end loop;

  foreach v_m in array v_sin_precio loop
    if not exists (select 1 from public.notificaciones_dashboard n
                    where n.tipo = 'ia_modelo_sin_precio' and not n.leida
                      and n.titulo = 'Modelo de IA sin precio: ' || v_m) then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values ('ia_modelo_sin_precio', 'Modelo de IA sin precio: ' || v_m,
              left(v_m || ' está en uso y no tiene tarifa en ia_precios: su gasto sale «sin datos». Añade el precio oficial de OpenAI.', 1000),
              'ia_modelos', 'normal');
      v_avisos := v_avisos + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'primera_carga', v_primera,
    'total', (select count(*) from pg_temp.ia_modelos_entrada),
    'nuevos', to_jsonb(v_nuevos),
    'retirados', to_jsonb(v_retirados),
    'vuelven', to_jsonb(v_vuelven),
    'en_uso', to_jsonb(v_en_uso),
    'en_uso_no_disponibles', to_jsonb(v_uso_ret || v_uso_inex),
    'en_uso_sin_precio', to_jsonb(v_sin_precio),
    'avisos', v_avisos);
end;
$$;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on function public.ia_modelos_registrar(jsonb) from public, anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
grant execute on function public.ia_modelos_registrar(jsonb) to service_role;

-- [20261107620000_ia_modelos_herramientas.sql] public.ia_modelos_centro(integer)
CREATE OR REPLACE FUNCTION public.ia_modelos_centro(p_dias integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with dias as (select greatest(1, least(coalesce(p_dias, 30), 366)) as n),
  coste as (
    select u.funcion, sum(u.coste_usd) as usd, sum(u.llamadas) as llamadas,
           bool_or(u.coste_usd is null and u.llamadas > 0) as sin_tarifa
      from public.ia_uso_diario u, dias
     where u.dia >= (current_date - dias.n)
     group by u.funcion
  ),
  ultimo as (
    select distinct on (x.funcion) x.funcion, x.modelo, x.created_at
      from public.ia_uso x
     where x.created_at > now() - interval '60 days'
     order by x.funcion, x.created_at desc
  )
  select jsonb_build_object(
    'dias', (select n from dias),
    'funciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'funcion', f.funcion,
               'descripcion', fn.descripcion,
               'modelo', f.modelo,
               'modelo_respaldo', f.modelo_respaldo,
               'modelo_codigo', f.modelo_codigo,
               'centralizado', f.centralizado,
               'usa_herramientas', f.usa_herramientas,
               'notas', f.notas,
               'cambiado_por_email', f.cambiado_por_email,
               'cambiado_en', f.cambiado_en,
               'ultimo_modelo_usado', ul.modelo,
               'ultimo_uso', ul.created_at,
               'coste_usd', c.usd,
               'llamadas', c.llamadas,
               'coste_sin_tarifa', coalesce(c.sin_tarifa, false))
             order by f.centralizado desc, fn.orden, f.funcion)
        from public.ia_modelo_funcion f
        join public.ia_funciones fn on fn.funcion = f.funcion
        left join coste c on c.funcion = f.funcion
        left join ultimo ul on ul.funcion = f.funcion), '[]'::jsonb),
    'disponibles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'owned_by', d.owned_by,
               'creado_openai', d.creado_openai,
               'primera_vez_visto', d.primera_vez_visto,
               'ultima_vez_visto', d.ultima_vez_visto,
               'retirado_en', d.retirado_en,
               'de_interes', d.de_interes,
               'nuevo', (not d.primera_carga and d.primera_vez_visto > now() - interval '30 days'),
               'usd_por_m_input', p.usd_por_m_input,
               'usd_por_m_output', p.usd_por_m_output,
               'precio_fuente', p.fuente,
               'compatible_herramientas', d.compatible_herramientas,
               'compatible_motivo', d.compatible_motivo,
               'compatible_probado_en', d.compatible_probado_en)
             order by d.retirado_en is not null, d.de_interes desc, d.creado_openai desc nulls last, d.id)
        from public.ia_modelos_disponibles d
        left join public.ia_precios p on p.modelo = d.id), '[]'::jsonb),
    'ultima_lista', (select max(d.ultima_vez_visto) from public.ia_modelos_disponibles d),
    'historial', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.cambiado_en desc)
        from (select h.funcion, h.modelo_anterior, h.modelo_nuevo, h.respaldo_anterior, h.respaldo_nuevo,
                     h.notas, h.cambiado_por_email, h.cambiado_en
                from public.ia_modelo_funcion_historial h
               order by h.cambiado_en desc limit 100) h), '[]'::jsonb)
  );
$function$;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on function public.ia_modelos_centro(integer) from public, anon;

-- [20261107500000_ia_modelos_centro.sql]
grant execute on function public.ia_modelos_centro(integer) to authenticated, service_role;

-- [20261107500000_ia_modelos_centro.sql] public.ia_modelos_disparar()
-- ─── 6. Cron diario ─────────────────────────────────────────────────────────
create or replace function public.ia_modelos_disparar()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secreto text;
begin
  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return false;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using rtrim(v_url, '/') || '/functions/v1/ia-modelos-openai',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          '{"accion":"sincronizar"}'::jsonb;
  return true;
end;
$$;

-- [20261107500000_ia_modelos_centro.sql]
revoke all on function public.ia_modelos_disparar() from public, anon, authenticated;

-- [20261107500000_ia_modelos_centro.sql]
-- ─── 7. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if has_function_privilege('authenticated', 'public.ia_modelos_registrar(jsonb)', 'execute') then
    v_malos := v_malos || 'authenticated puede ejecutar ia_modelos_registrar'::text;
  end if;
  if has_table_privilege('anon', 'public.ia_modelo_funcion', 'select') then
    v_malos := v_malos || 'anon puede leer ia_modelo_funcion'::text;
  end if;
  if has_table_privilege('authenticated', 'public.ia_modelos_disponibles', 'insert') then
    v_malos := v_malos || 'authenticated puede insertar en ia_modelos_disponibles'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'ia_modelos_centro: %', array_to_string(v_malos, '; ');
  end if;
  raise notice 'ia_modelos_centro: aplicada';
end;
$$;

-- [20261107620000_ia_modelos_herramientas.sql]
alter table public.ia_modelos_disponibles
  add column if not exists compatible_herramientas boolean,
  add column if not exists compatible_motivo text check (compatible_motivo is null or length(compatible_motivo) <= 400),
  add column if not exists compatible_probado_en timestamptz;

-- [20261107620000_ia_modelos_herramientas.sql]
comment on column public.ia_modelos_disponibles.compatible_herramientas is
  'Resultado de «Probar» (ia-modelos-openai): ¿admite Chat Completions con herramientas y los parámetros de nuestras '
  'funciones? NULL = sin probar. false = no se puede elegir en funciones con usa_herramientas. 20261107620000.';

-- [20261107620000_ia_modelos_herramientas.sql]
alter table public.ia_modelo_funcion
  add column if not exists usa_herramientas boolean not null default false;

-- [20261107620000_ia_modelos_herramientas.sql]
comment on column public.ia_modelo_funcion.usa_herramientas is
  'La función llama a Chat Completions con herramientas (function calling): solo admite modelos con '
  'ia_modelos_disponibles.compatible_herramientas distinto de false. 20261107620000.';

-- [20261107620000_ia_modelos_herramientas.sql]
-- Sin pasar por la validación (solo cambia usa_herramientas: el trigger no hace nada).
update public.ia_modelo_funcion set usa_herramientas = true
 where funcion in ('chat-facturas', 'chat-web') and not usa_herramientas;

-- [20261107620000_ia_modelos_herramientas.sql]
revoke all on function public.ia_modelo_funcion_antes() from public, anon, authenticated;

-- [20261107620000_ia_modelos_herramientas.sql]
revoke all on function public.ia_modelos_centro(integer) from public, anon;

-- [20261107620000_ia_modelos_herramientas.sql]
grant execute on function public.ia_modelos_centro(integer) to authenticated, service_role;

-- [20261108000000_instagram_ia.sql]
-- ─── 6. Catálogo de funciones de IA (pantalla /super-admin/costes) ──────────
-- instrumentada = false hasta el día del despliegue (ver _shared/registrar-uso-ia.ts):
--   update public.ia_funciones set instrumentada = true where funcion = 'instagram-ia';
-- La tarifa de gpt-5.6-luna ya está en ia_precios (20260928193000_costes_sistema.sql).
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('instagram-ia',
            'Marketing › Instagram: propone textos (3 variantes con caption, hashtags y texto alternativo) y rótulos para una pieza. '
            'Clave general OPENAI_API_KEY; disparador pieza:<uuid> o usuario:<uuid>.',
            false, 'petición', 95)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- [20261112120000_servicios_github_minutos.sql]
update public.servicios_contratados
   set limites = coalesce(limites, '{}'::jsonb) || jsonb_build_object('actions_minutos', jsonb_build_object(
         'orden', 2,
         'etiqueta', 'Minutos de Actions',
         'limite', 2000,
         'unidad', 'minutos',
         'periodo', 'mes en curso',
         'fuente', 'https://docs.github.com/en/billing/concepts/product-billing/github-actions',
         'nota', 'El plan gratuito incluye 2.000 minutos de Linux al mes en repositorios privados. Al gastarlos, GitHub deja de arrancar las pruebas y la copia de seguridad hasta el mes siguiente o hasta poner un presupuesto.'
       )),
       cuenta = 'Cuenta oficiososia · repositorios cristaleriabv, admin-cristaleriabv y cristaleriabv'
 where proveedor = 'github'
   and not (coalesce(limites, '{}'::jsonb) ? 'actions_minutos');

-- [20261118100000_logs_web.sql]
-- ─── 13. Funciones de IA: modelo elegible y consumo contabilizado ──────────
-- Solo si existe el centro de modelos (20261107500000) y el catálogo de costes.
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo) values
        ('procesar-logs-web', 'Logs web: análisis de una incidencia agrupada antes de crear su ticket en Linear (hechos e hipótesis separados).', true, 'incidencia', 950, true),
        ('resumen-logs-web',  'Logs web y Tráfico web: resumen del periodo a partir de estadísticas agregadas (nunca visitas sueltas).', true, 'resumen', 951, true)
      on conflict (funcion) do nothing
    $q$;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado) values
        ('procesar-logs-web', 'gpt-4.1-mini, en código', true),
        ('resumen-logs-web',  'gpt-4.1-mini, en código', true)
      on conflict (funcion) do nothing
    $q$;
  end if;
end;
$$;

-- [20261118120000_rrss.sql]
-- ─── 7. Coste de la IA ──────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('rrss-ia', 'RRSS · editor IA (plan de edición, textos, ideas para grabar y transcripción)', false, 'llamada', 62)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- [20261120110000_servicios_estado_detalle.sql]
do $$
begin
  if to_regclass('public.servicios_contratados') is null then
    raise exception 'servicios_estado_detalle: falta 20261103120000_servicios_contratados. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261120110000_servicios_estado_detalle.sql] public.servicios_metricas_bd_extra()
-- ─── 1. Conexiones y tablas que más ocupan ──────────────────────────────────
create or replace function public.servicios_metricas_bd_extra()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tablas jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('tabla', t.nombre, 'bytes', t.bytes) order by t.bytes desc), '[]'::jsonb)
    into v_tablas
    from (
      select case when n.nspname = 'public' then c.relname else n.nspname || '.' || c.relname end as nombre,
             pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'm', 'p')
         and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       order by pg_total_relation_size(c.oid) desc
       limit 5
    ) t;
  return jsonb_build_object(
    'conexiones', (select count(*) from pg_stat_activity where backend_type = 'client backend'),
    'conexiones_max', current_setting('max_connections')::int,
    'tablas_mayores', v_tablas
  );
end;
$$;

-- [20261120110000_servicios_estado_detalle.sql]
revoke all on function public.servicios_metricas_bd_extra() from public, anon, authenticated;

-- [20261120110000_servicios_estado_detalle.sql]
grant execute on function public.servicios_metricas_bd_extra() to service_role;

-- [20261120110000_servicios_estado_detalle.sql]
-- ─── 2. GitHub: un solo límite (los minutos) ────────────────────────────────
update public.servicios_contratados
   set limites = jsonb_set(
         limites,
         '{actions_computo}',
         (limites -> 'actions_computo') - 'limite' || jsonb_build_object(
           'nota', 'Precio de lista de los minutos de repositorios privados, antes de descontar lo incluido. Informativo: el límite es el de los minutos.'
         ))
 where proveedor = 'github'
   and limites ? 'actions_computo'
   and (limites -> 'actions_computo' ->> 'limite')::numeric = 12
   and limites -> 'actions_computo' ->> 'unidad' = 'USD';

-- [20261120110000_servicios_estado_detalle.sql]
update public.servicios_contratados
   set limites = jsonb_set(limites, '{actions_minutos,etiqueta}', to_jsonb('Minutos de Actions en repositorios privados'::text))
 where proveedor = 'github'
   and limites -> 'actions_minutos' ->> 'etiqueta' = 'Minutos de Actions';

-- [20261120110000_servicios_estado_detalle.sql]
-- ─── 3. Vercel: memoria de las funciones ────────────────────────────────────
update public.servicios_contratados
   set limites = coalesce(limites, '{}'::jsonb) || jsonb_build_object('memoria_funciones', jsonb_build_object(
         'orden', 5,
         'etiqueta', 'Memoria de las funciones',
         'limite', 360,
         'unidad', 'GB-hora',
         'periodo', 'últimos 30 días',
         'fuente', 'https://vercel.com/docs/plans/hobby'
       ))
 where proveedor = 'vercel'
   and not (coalesce(limites, '{}'::jsonb) ? 'memoria_funciones');

-- [20261122153000_servicios_costes_mes.sql]
do $$
begin
  if to_regclass('public.servicios_contratados') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'servicios_uso' and column_name = 'coste_variable') then
    raise exception 'servicios_costes_mes: falta 20261103160000_servicios_planes_costes. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261122153000_servicios_costes_mes.sql]
-- ─── 1. Costes de cada mes, metidos a mano ──────────────────────────────────
create table if not exists public.servicios_costes_mes (
  proveedor        text not null references public.servicios_contratados (proveedor) on delete cascade,
  mes              date not null,
  importe          numeric(12,2) not null,
  moneda           text not null default 'EUR',
  nota             text,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid default auth.uid(),
  primary key (proveedor, mes),
  constraint servicios_costes_mes_mes_chk check (mes = date_trunc('month', mes)::date and mes >= date '2020-01-01'),
  constraint servicios_costes_mes_importe_chk check (importe >= 0 and importe < 1000000),
  constraint servicios_costes_mes_moneda_chk check (moneda in ('EUR', 'USD', 'GBP')),
  constraint servicios_costes_mes_nota_chk check (nota is null or length(nota) <= 300)
);

-- [20261122153000_servicios_costes_mes.sql]
comment on table public.servicios_costes_mes is
  'Coste real de un servicio en un mes (día 1), metido a mano por el super admin en Servicios › Costes. Manda sobre la estimación (cuota + uso) en el informe mensual.';

-- [20261122153000_servicios_costes_mes.sql] public.servicios_costes_mes_al_editar()
create or replace function public.servicios_costes_mes_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), case when tg_op = 'UPDATE' then old.actualizado_por end);
  return new;
end;
$$;

-- [20261122153000_servicios_costes_mes.sql]
revoke all on function public.servicios_costes_mes_al_editar() from public, anon, authenticated;

-- [20261122153000_servicios_costes_mes.sql]
drop trigger if exists servicios_costes_mes_al_editar on public.servicios_costes_mes;

-- [20261122153000_servicios_costes_mes.sql]
create trigger servicios_costes_mes_al_editar
  before insert or update on public.servicios_costes_mes
  for each row execute function public.servicios_costes_mes_al_editar();

-- [20261122153000_servicios_costes_mes.sql]
-- Auditada como servicios_contratados (sin fiarse del event trigger: la demo no lo tiene).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.servicios_costes_mes'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.servicios_costes_mes';
    execute 'create trigger trg_auditoria after insert or update or delete on public.servicios_costes_mes
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- [20261122153000_servicios_costes_mes.sql]
alter table public.servicios_costes_mes enable row level security;

-- [20261122153000_servicios_costes_mes.sql]
revoke all on public.servicios_costes_mes from anon, authenticated;

-- [20261122153000_servicios_costes_mes.sql]
grant select, insert, delete on public.servicios_costes_mes to authenticated;

-- [20261122153000_servicios_costes_mes.sql]
grant update (importe, moneda, nota) on public.servicios_costes_mes to authenticated;

-- [20261122153000_servicios_costes_mes.sql]
grant all on public.servicios_costes_mes to service_role;

-- [20261122153000_servicios_costes_mes.sql]
drop policy if exists servicios_costes_mes_super_admin on public.servicios_costes_mes;

-- [20261122153000_servicios_costes_mes.sql]
create policy servicios_costes_mes_super_admin
  on public.servicios_costes_mes for all to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20261122153000_servicios_costes_mes.sql]
drop policy if exists servicios_costes_mes_service_role on public.servicios_costes_mes;

-- [20261122153000_servicios_costes_mes.sql]
create policy servicios_costes_mes_service_role
  on public.servicios_costes_mes for all to service_role using (true) with check (true);

-- [20261122153000_servicios_costes_mes.sql]
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.servicios_costes_mes';
    execute 'create policy "acceso_panel_no_bloqueado" on public.servicios_costes_mes as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- [20261122153000_servicios_costes_mes.sql] public.servicios_resumen_mes(date)
-- ─── 2. Resumen de un mes (para el informe) ─────────────────────────────────
create or replace function public.servicios_resumen_mes(p_mes date)
returns table (
  proveedor        text,
  manual_importe   numeric,
  manual_moneda    text,
  manual_nota      text,
  coste_variable   jsonb,
  ultima_lectura   timestamptz,
  lecturas         integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mes as (
    select date_trunc('month', p_mes)::date as d
  ), lect as (
    select u.proveedor,
           count(*)::int as lecturas,
           max(u.tomado_en) as ultima,
           (array_agg(u.coste_variable order by u.tomado_en desc) filter (where u.coste_variable is not null))[1] as coste
      from public.servicios_uso u, mes
     where u.tomado_en >= mes.d::timestamp at time zone 'UTC'
       and u.tomado_en < (mes.d + interval '1 month')::timestamp at time zone 'UTC'
     group by u.proveedor
  )
  select s.proveedor, c.importe, c.moneda, c.nota, l.coste, l.ultima, coalesce(l.lecturas, 0)
    from public.servicios_contratados s
    cross join mes
    left join public.servicios_costes_mes c on c.proveedor = s.proveedor and c.mes = mes.d
    left join lect l on l.proveedor = s.proveedor;
$$;

-- [20261122153000_servicios_costes_mes.sql]
revoke all on function public.servicios_resumen_mes(date) from public, anon;

-- [20261122153000_servicios_costes_mes.sql]
grant execute on function public.servicios_resumen_mes(date) to authenticated, service_role;

-- [20261122153000_servicios_costes_mes.sql]
-- ─── 4. Notas de Drive y Mapbox (solo si siguen como las dejó la semilla) ──
update public.servicios_contratados
   set limites = jsonb_set(limites, '{cargas_mapa_web,nota}', to_jsonb(
         'Después, 5 US$ cada 1.000 cargas. Lectura automática: sesiones de la web que abren el mapa (solo quien acepta las cookies de análisis, así que es un mínimo). La cifra exacta, en su panel (Statistics).'::text))
 where proveedor = 'mapbox'
   and limites -> 'cargas_mapa_web' ->> 'nota' like '%Sin lectura automática%';

-- [20261122153000_servicios_costes_mes.sql]
update public.servicios_contratados
   set limites = jsonb_set(limites, '{almacenamiento,nota}', to_jsonb(
         'Compartido con Gmail y Google Fotos de esa cuenta. Lectura automática con la misma cuenta de Google que guarda las copias de las facturas.'::text))
 where proveedor = 'google_drive'
   and limites -> 'almacenamiento' ->> 'nota' like '%Sin lectura automática%';

-- [20261122153000_servicios_costes_mes.sql]
-- ─── 5. Vercel: almacenamiento de despliegues y de funciones ───────────────
update public.servicios_contratados
   set limites = coalesce(limites, '{}'::jsonb) || jsonb_build_object('almacenamiento_despliegues', jsonb_build_object(
         'orden', 11,
         'etiqueta', 'Almacenamiento de los despliegues (Deployment Storage)',
         'limite', null,
         'unidad', 'GB',
         'periodo', 'ahora',
         'fuente', 'https://vercel.com/docs/limits',
         'nota', 'Vercel no da esta cifra por API en el plan Hobby: míralo en Vercel → Usage. Pon aquí el límite del plan cuando lo confirmes.'
       ))
 where proveedor = 'vercel'
   and not (coalesce(limites, '{}'::jsonb) ? 'almacenamiento_despliegues');

-- [20261122153000_servicios_costes_mes.sql]
update public.servicios_contratados
   set limites = coalesce(limites, '{}'::jsonb) || jsonb_build_object('almacenamiento_funciones', jsonb_build_object(
         'orden', 12,
         'etiqueta', 'Almacenamiento de las funciones (Functions Storage)',
         'limite', null,
         'unidad', 'GB',
         'periodo', 'ahora',
         'fuente', 'https://vercel.com/docs/functions/limitations',
         'nota', 'Vercel no da esta cifra por API en el plan Hobby: míralo en Vercel → Usage. Cada función puede ocupar como mucho 250 MB sin comprimir.'
       ))
 where proveedor = 'vercel'
   and not (coalesce(limites, '{}'::jsonb) ? 'almacenamiento_funciones');

-- [20261122153700_newsletter_plantillas.sql]
-- ─── 6. Coste de la IA ──────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('newsletter-ia', 'Newsletter · «Crear con IA» (redacta el correo y propone su presentación por bloques)', false, 'propuesta', 63)
    on conflict (funcion) do nothing;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
      values ('newsletter-ia', 'gpt-5.6-luna, en código (NEWSLETTER_IA_MODEL)', true)
      on conflict (funcion) do nothing
    $q$;
  end if;
end;
$$;

-- [override] seccion_aviso
-- Sección de un aviso: peticiones solo para super admin; el resto, Dashboard.
CREATE OR REPLACE FUNCTION public.seccion_aviso(p_tipo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    else 'dashboard'
  end
$function$;

-- [20261124100000_avisos_revisado_por_seccion.sql]
revoke all on function public.seccion_aviso(text) from public, anon;

-- [20261124100000_avisos_revisado_por_seccion.sql]
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- [20261124100000_avisos_revisado_por_seccion.sql]
-- 2. Leer los avisos de las secciones que se ven -------------------------------------------------
drop policy if exists notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard;

-- [20261124100000_avisos_revisado_por_seccion.sql]
create policy notificaciones_dashboard_select_por_seccion_aviso on public.notificaciones_dashboard
  for select to authenticated
  using ((select public.can_read_section(public.seccion_aviso(tipo))));

-- [20261124100000_avisos_revisado_por_seccion.sql] public.marcar_avisos_revisados(uuid[],text[])
-- 3. Marcar como revisados -----------------------------------------------------------------------
-- p_ids: esos avisos. p_tipos: todos los sin revisar de esos tipos (el «Marcar todos» de una
-- sección). Sin ninguno de los dos: todos los que el usuario puede ver (la campana).
-- Devuelve cuántos ha marcado (0 si ya estaban revisados o no son de una sección que vea).
create or replace function public.marcar_avisos_revisados(p_ids uuid[] default null, p_tipos text[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_permitida boolean;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'Hay que iniciar sesión para revisar avisos' using errcode = '42501';
  end if;
  -- La misma barrera que la política restrictiva «acceso_panel_no_bloqueado» (SECURITY DEFINER
  -- se salta la RLS): una sesión bloqueada no marca nada.
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'select private.sesion_panel_permitida()' into v_permitida;
    if not coalesce(v_permitida, false) then
      raise exception 'Sesión del panel no permitida' using errcode = '42501';
    end if;
  end if;

  update public.notificaciones_dashboard n
     set leida = true
   where n.leida = false
     and (p_ids is null or n.id = any(p_ids))
     and (p_tipos is null or n.tipo = any(p_tipos))
     and public.has_section_permission(v_uid, public.seccion_aviso(n.tipo), 'view')
     -- Los de modelos de IA son solo del super admin (política notificaciones_ia_modelos_solo_super_admin).
     and (n.tipo not like 'ia\_modelo%' or public.is_super_admin(v_uid));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- [20261124100000_avisos_revisado_por_seccion.sql]
revoke all on function public.marcar_avisos_revisados(uuid[], text[]) from public, anon;

-- [20261124100000_avisos_revisado_por_seccion.sql]
grant execute on function public.marcar_avisos_revisados(uuid[], text[]) to authenticated, service_role;

-- [20261124134500_usuarios_seccion_inicio.sql]
-- Usuarios: sección que se abre al iniciar sesión (11/11/2026, petición del dueño: «Que en
-- Usuarios se pueda poner qué pestaña se le va a abrir por defecto cuando inician sesión»).
--
-- Columna `user_roles.seccion_inicio`: la entrada del menú lateral que el panel abre al entrar,
-- con las claves de src/lib/seccionInicio.ts ('reservas', 'facturas', 'gestion_web'…). NULL = lo
-- de siempre (el Dashboard o, sin él, la primera sección que puede ver). El permiso no se
-- comprueba aquí: si el usuario ya no puede ver esa sección, el panel hace lo de siempre.
--
-- Va en `user_roles` porque su RLS ya es la que hace falta, la misma que la del rol: cada usuario
-- lee su fila («Usuarios pueden ver su propio rol»), quien ve la sección Usuarios la consulta y
-- solo un super admin la escribe. No se añaden ni cambian políticas.
--
-- Vuelta atrás: supabase/rollbacks/20261124134500_usuarios_seccion_inicio_ROLLBACK.sql

alter table public.user_roles
  add column if not exists seccion_inicio text;

-- [20261124134500_usuarios_seccion_inicio.sql]
-- Solo una clave corta (no rutas ni texto libre); cuáles valen lo decide el panel.
alter table public.user_roles drop constraint if exists user_roles_seccion_inicio_formato;

-- [20261124134500_usuarios_seccion_inicio.sql]
alter table public.user_roles
  add constraint user_roles_seccion_inicio_formato
  check (seccion_inicio is null or seccion_inicio ~ '^[a-z][a-z_]{0,39}$');

-- [20261124134500_usuarios_seccion_inicio.sql]
comment on column public.user_roles.seccion_inicio is
  'Sección del menú que el panel abre al iniciar sesión (clave de src/lib/seccionInicio.ts). NULL = lo de siempre. La elige un super admin en Usuarios › Permisos.';

-- [20261126001000_avisos_telegram.sql]
do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'avisos_telegram: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
  if to_regclass('public.notificaciones_dashboard') is null then
    raise exception 'avisos_telegram: falta notificaciones_dashboard. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261126001000_avisos_telegram.sql]
-- ─── 1. Configuración (una fila) ────────────────────────────────────────────
create table if not exists public.avisos_telegram_config (
  id                 boolean primary key default true check (id),
  activo             boolean not null default false,
  chat_id            text check (chat_id is null or chat_id ~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$'),
  hora_resumen       smallint not null default 9 check (hora_resumen between 0 and 23),
  tipos_al_momento   text[] not null default array['facturas_margen_bajo', 'facturas_precio_sube'],
  silencio_activo    boolean not null default true,
  silencio_desde     smallint not null default 23 check (silencio_desde between 0 and 23),
  silencio_hasta     smallint not null default 8 check (silencio_hasta between 0 and 23),
  -- Desde cuándo está activo: lo anterior no se manda al momento (no inunda al activar).
  activo_desde       timestamptz,
  -- Día (Madrid) del último resumen enviado: uno al día.
  resumen_ultimo_dia date,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

-- [20261126001000_avisos_telegram.sql]
comment on table public.avisos_telegram_config is
  'Avisos por Telegram (20261126001000): una fila. Solo super admin. El token es el secreto TELEGRAM_BOT_TOKEN de la función avisos-telegram.';

-- [20261126001000_avisos_telegram.sql]
insert into public.avisos_telegram_config (id) values (true) on conflict (id) do nothing;

-- [20261126001000_avisos_telegram.sql] public.avisos_telegram_config_antes()
create or replace function public.avisos_telegram_config_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := true;
  new.chat_id := nullif(btrim(new.chat_id), '');
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if new.activo and (tg_op = 'INSERT' or not old.activo) then
    new.activo_desde := now();
  end if;
  return new;
end;
$$;

-- [20261126001000_avisos_telegram.sql]
drop trigger if exists avisos_telegram_config_antes on public.avisos_telegram_config;

-- [20261126001000_avisos_telegram.sql]
create trigger avisos_telegram_config_antes before insert or update on public.avisos_telegram_config
  for each row execute function public.avisos_telegram_config_antes();

-- [20261126001000_avisos_telegram.sql]
-- ─── 2. Registro de envíos ──────────────────────────────────────────────────
create table if not exists public.avisos_telegram_envios (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes')),
  aviso_id    uuid references public.notificaciones_dashboard(id) on delete set null,
  chat_id     text,
  enviado_en  timestamptz not null default now(),
  ok          boolean not null,
  error       text,
  mensaje_id  bigint
);

-- [20261126001000_avisos_telegram.sql]
comment on table public.avisos_telegram_envios is
  'Envíos a Telegram (20261126001000). tipo pendientes = intento sin aviso concreto (p. ej. «Telegram sin configurar»).';

-- [20261126001000_avisos_telegram.sql]
create index if not exists avisos_telegram_envios_aviso_idx on public.avisos_telegram_envios (aviso_id) where aviso_id is not null;

-- [20261126001000_avisos_telegram.sql]
create index if not exists avisos_telegram_envios_fecha_idx on public.avisos_telegram_envios (enviado_en desc);

-- [20261126001000_avisos_telegram.sql]
-- Un aviso solo puede tener UN envío correcto.
create unique index if not exists avisos_telegram_envios_un_ok on public.avisos_telegram_envios (aviso_id) where ok and aviso_id is not null;

-- [20261126001000_avisos_telegram.sql]
-- ─── Permisos ───────────────────────────────────────────────────────────────
alter table public.avisos_telegram_config enable row level security;

-- [20261126001000_avisos_telegram.sql]
alter table public.avisos_telegram_envios enable row level security;

-- [20261126001000_avisos_telegram.sql]
revoke all on public.avisos_telegram_config from public, anon, authenticated;

-- [20261126001000_avisos_telegram.sql]
revoke all on public.avisos_telegram_envios from public, anon, authenticated;

-- [20261126001000_avisos_telegram.sql]
grant select on public.avisos_telegram_config to authenticated;

-- [20261126001000_avisos_telegram.sql]
grant update (activo, chat_id, hora_resumen, tipos_al_momento, silencio_activo, silencio_desde, silencio_hasta)
  on public.avisos_telegram_config to authenticated;

-- [20261126001000_avisos_telegram.sql]
grant select on public.avisos_telegram_envios to authenticated;

-- [20261126001000_avisos_telegram.sql]
grant all on public.avisos_telegram_config to service_role;

-- [20261126001000_avisos_telegram.sql]
grant all on public.avisos_telegram_envios to service_role;

-- [20261126001000_avisos_telegram.sql]
drop policy if exists avisos_telegram_config_select on public.avisos_telegram_config;

-- [20261126001000_avisos_telegram.sql]
create policy avisos_telegram_config_select on public.avisos_telegram_config for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261126001000_avisos_telegram.sql]
drop policy if exists avisos_telegram_config_update on public.avisos_telegram_config;

-- [20261126001000_avisos_telegram.sql]
create policy avisos_telegram_config_update on public.avisos_telegram_config for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

-- [20261126001000_avisos_telegram.sql]
drop policy if exists avisos_telegram_config_service on public.avisos_telegram_config;

-- [20261126001000_avisos_telegram.sql]
create policy avisos_telegram_config_service on public.avisos_telegram_config for all to service_role using (true) with check (true);

-- [20261126001000_avisos_telegram.sql]
drop policy if exists avisos_telegram_envios_select on public.avisos_telegram_envios;

-- [20261126001000_avisos_telegram.sql]
create policy avisos_telegram_envios_select on public.avisos_telegram_envios for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261126001000_avisos_telegram.sql]
drop policy if exists avisos_telegram_envios_service on public.avisos_telegram_envios;

-- [20261126001000_avisos_telegram.sql]
create policy avisos_telegram_envios_service on public.avisos_telegram_envios for all to service_role using (true) with check (true);

-- [20261126001000_avisos_telegram.sql] public.avisos_telegram_en_silencio(integer,integer,integer)
-- ─── 3. Lógica de los crons ─────────────────────────────────────────────────
-- ¿Es hora de silencio? (horas de Madrid; desde = hasta → sin silencio). La misma regla
-- que supabase/functions/avisos-telegram/logica.ts → enSilencio.
create or replace function public.avisos_telegram_en_silencio(p_hora integer, p_desde integer, p_hasta integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_desde = p_hasta then false
    when p_desde > p_hasta then p_hora >= p_desde or p_hora < p_hasta
    else p_hora >= p_desde and p_hora < p_hasta
  end;
$$;

-- [override] avisos_telegram_hay_pendientes
-- ¿Hay avisos pendientes de mandar por Telegram al momento? (misma regla que pendientesDeEnvio en la Edge Function).
CREATE OR REPLACE FUNCTION public.avisos_telegram_hay_pendientes()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.notificaciones_dashboard n
      join public.avisos_telegram_config c on c.id
     where n.tipo = any(c.tipos_al_momento)
       and n.created_at > greatest(now() - interval '24 hours', coalesce(c.activo_desde, now()))
       and (n.caduca_en is null or n.caduca_en > now())
       and n.tipo not like 'ia\_modelo%'
       and coalesce(n.datos ->> 'campana', 'true') <> 'false'
       and not exists (select 1 from public.avisos_telegram_envios e where e.aviso_id = n.id and e.ok)
       and (select count(*) from public.avisos_telegram_envios e where e.aviso_id = n.id and not e.ok) < 3
  );
$function$;

-- [override] avisos_telegram_disparar
-- Lo llama pg_cron: decide si toca y llama a la Edge Function avisos-telegram (pendientes, resumen o fallos).
CREATE OR REPLACE FUNCTION public.avisos_telegram_disparar(p_accion text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c         public.avisos_telegram_config%rowtype;
  v_ahora   timestamp := now() at time zone 'Europe/Madrid';
  v_url     text;
  v_secreto text;
begin
  if p_accion not in ('pendientes', 'resumen', 'fallos') then
    raise exception 'avisos_telegram_disparar: acción desconocida %', p_accion;
  end if;
  select * into c from public.avisos_telegram_config where id;
  if not found or not c.activo or coalesce(c.chat_id, '') = '' then
    return 'inactivo';
  end if;

  if p_accion = 'pendientes' then
    if c.silencio_activo and public.avisos_telegram_en_silencio(extract(hour from v_ahora)::int, c.silencio_desde, c.silencio_hasta) then
      return 'silencio';
    end if;
    if not public.avisos_telegram_hay_pendientes() then
      return 'nada';
    end if;
  elsif p_accion = 'fallos' then
    -- Fallos internos: sin silencio nocturno; solo si hay alguno por mandar.
    if not exists (
      select 1 from public.fallos_internos f
       where f.enviado_en is null and f.intentos < 3
         and f.created_at >= public.fallos_internos_desde()
         and (f.reclamado_en is null or f.reclamado_en < now() - interval '2 minutes')
    ) then
      return 'nada';
    end if;
  else
    -- Una vez al día, a partir de la hora configurada (si una hora falla, lo intenta la siguiente).
    if extract(hour from v_ahora)::int < c.hora_resumen or c.resumen_ultimo_dia >= v_ahora::date then
      return 'no_toca';
    end if;
    -- Limpieza: el registro guarda 90 días.
    delete from public.avisos_telegram_envios where enviado_en < now() - interval '90 days';
    delete from public.fallos_internos where created_at < now() - interval '90 days';
  end if;

  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return 'sin_vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return 'sin_vault';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using rtrim(v_url, '/') || '/functions/v1/avisos-telegram',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          jsonb_build_object('accion', p_accion);
  return 'llamada';
end;
$function$;

-- [20261126001000_avisos_telegram.sql]
revoke all on function public.avisos_telegram_config_antes() from public, anon, authenticated;

-- [20261126001000_avisos_telegram.sql]
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;

-- [20261126001000_avisos_telegram.sql]
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;

-- [20261126001000_avisos_telegram.sql]
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;

-- [20261126001000_avisos_telegram.sql]
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- [20261127090000_instagram_story_tapas.sql]
-- La campana deduplica por «clave» y guarda los datos del aviso (20261107300000).
alter table public.notificaciones_dashboard add column if not exists clave text;

-- [20261127090000_instagram_story_tapas.sql]
alter table public.notificaciones_dashboard add column if not exists datos jsonb;

-- [20261127100100_fallos_internos_telegram.sql]
-- ─── 1. Tabla ───────────────────────────────────────────────────────────────
create table if not exists public.fallos_internos (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo ~ '^[a-z][a-z0-9_]{1,59}$'),
  datos         jsonb not null default '{}'::jsonb check (jsonb_typeof(datos) = 'object'),
  usuario_id    uuid,
  usuario       text,
  -- Evita repetir el mismo fallo (p. ej. el mismo albarán con los mismos avisos).
  clave         text check (clave is null or char_length(clave) <= 200),
  created_at    timestamptz not null default now(),
  intentos      smallint not null default 0,
  reclamado_en  timestamptz,
  enviado_en    timestamptz,
  ultimo_error  text
);

-- [20261127100100_fallos_internos_telegram.sql]
comment on table public.fallos_internos is
  'Fallos internos para desarrolladores (20261127100100). Se envían al Telegram de avisos con la Edge Function avisos-telegram (acción fallos).';

-- [20261127100100_fallos_internos_telegram.sql]
create unique index if not exists fallos_internos_clave_uq on public.fallos_internos (tipo, clave) where clave is not null;

-- [20261127100100_fallos_internos_telegram.sql]
create index if not exists fallos_internos_pendientes_idx on public.fallos_internos (created_at) where enviado_en is null;

-- [20261127100100_fallos_internos_telegram.sql]
create index if not exists fallos_internos_usuario_idx on public.fallos_internos (usuario_id, created_at desc) where usuario_id is not null;

-- [20261127100100_fallos_internos_telegram.sql]
alter table public.fallos_internos enable row level security;

-- [20261127100100_fallos_internos_telegram.sql]
revoke all on public.fallos_internos from public, anon, authenticated;

-- [20261127100100_fallos_internos_telegram.sql]
grant select on public.fallos_internos to authenticated;

-- [20261127100100_fallos_internos_telegram.sql]
grant all on public.fallos_internos to service_role;

-- [20261127100100_fallos_internos_telegram.sql]
drop policy if exists fallos_internos_select on public.fallos_internos;

-- [20261127100100_fallos_internos_telegram.sql]
create policy fallos_internos_select on public.fallos_internos for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- [20261127100100_fallos_internos_telegram.sql]
drop policy if exists fallos_internos_service on public.fallos_internos;

-- [20261127100100_fallos_internos_telegram.sql]
create policy fallos_internos_service on public.fallos_internos for all to service_role using (true) with check (true);

-- [20261127100100_fallos_internos_telegram.sql]
-- ─── 2. Registro de envíos: tipo 'fallo' ────────────────────────────────────
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;

-- [20261127100100_fallos_internos_telegram.sql]
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo'));

-- [20261127100100_fallos_internos_telegram.sql]
alter table public.avisos_telegram_envios add column if not exists fallo_id bigint references public.fallos_internos(id) on delete set null;

-- [20261127100100_fallos_internos_telegram.sql]
create index if not exists avisos_telegram_envios_fallo_idx on public.avisos_telegram_envios (fallo_id) where fallo_id is not null;

-- [20261209200000_chat_facturas_busqueda_precision.sql] public.fallo_interno_registrar(text,jsonb,uuid,text)
-- ─── 8. Punto único de alta: los chat_error se agrupan (máx. un aviso cada 15 min) ───
-- Devuelve el id, o null si ya existía (misma clave), los datos son demasiado grandes o
-- (chat_error) se ha sumado al último aviso de los 15 minutos anteriores.
create or replace function public.fallo_interno_registrar(
  p_tipo text, p_datos jsonb default '{}'::jsonb, p_usuario_id uuid default null, p_clave text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    bigint;
  v_email text;
  v_ult   record;
  v_rep   int;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or pg_column_size(p_datos) > 60000 then
    return null;
  end if;
  -- 20261209200000: el chat (función o panel) puede fallar en bucle («Reintentar», OpenAI caído).
  -- Si ya hubo un chat_error en los últimos 15 minutos, no se crea otra fila (ni otro Telegram):
  -- se cuenta en esa (repetidos) y el siguiente aviso dice cuántos se acumularon.
  if p_tipo = 'chat_error' then
    perform pg_advisory_xact_lock(hashtext('fallos_internos:chat_error'));
    select f.id, f.created_at, f.datos into v_ult
      from public.fallos_internos f
     where f.tipo = 'chat_error'
     order by f.created_at desc, f.id desc
     limit 1;
    if v_ult.id is not null and v_ult.created_at > now() - interval '15 minutes' then
      update public.fallos_internos f
         set datos = f.datos || jsonb_build_object(
               'repetidos', coalesce((f.datos ->> 'repetidos')::int, 0) + 1,
               'ultimo_repetido', jsonb_strip_nulls(jsonb_build_object(
                 'hora', now(), 'motivo', left(p_datos ->> 'motivo', 60), 'pregunta', left(p_datos ->> 'pregunta', 120))))
       where f.id = v_ult.id;
      return null;
    end if;
    v_rep := coalesce((v_ult.datos ->> 'repetidos')::int, 0);
    if v_rep > 0 then
      p_datos := p_datos || jsonb_build_object('acumulados_antes', v_rep, 'acumulados_desde', v_ult.created_at);
    end if;
    p_clave := null;
  end if;
  if p_usuario_id is not null then
    select u.email into v_email from auth.users u where u.id = p_usuario_id;
  end if;
  insert into public.fallos_internos (tipo, datos, usuario_id, usuario, clave)
  values (p_tipo, p_datos, p_usuario_id, v_email, p_clave)
  on conflict (tipo, clave) where clave is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- [20261127100100_fallos_internos_telegram.sql] public.fallos_internos_despues()
-- Tras insertar: avisa a la función de Telegram (nunca rompe la operación que originó el fallo).
create or replace function public.fallos_internos_despues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.avisos_telegram_disparar('fallos');
  exception when others then
    raise warning 'fallos_internos: no se pudo avisar a Telegram: %', sqlerrm;
  end;
  return null;
end;
$$;

-- [20261127100100_fallos_internos_telegram.sql]
drop trigger if exists fallos_internos_despues on public.fallos_internos;

-- [20261127100100_fallos_internos_telegram.sql]
create trigger fallos_internos_despues after insert on public.fallos_internos
  for each row execute function public.fallos_internos_despues();

-- [20261209600000_telegram_avisos_revision.sql] public.fallos_internos_reclamar(integer)
create or replace function public.fallos_internos_reclamar(p_limite integer default 20)
returns setof public.fallos_internos
language sql
security definer
set search_path = ''
as $$
  update public.fallos_internos f
     set intentos = f.intentos + 1, reclamado_en = now()
   where f.id in (
     select id from public.fallos_internos
      where enviado_en is null and intentos < 3
        and created_at >= coalesce(public.fallos_internos_desde(), now())
        and (reclamado_en is null or reclamado_en < now() - interval '2 minutes')
      order by created_at
      limit greatest(1, least(p_limite, 50))
      for update skip locked)
  returning f.*;
$$;

-- [20261127100100_fallos_internos_telegram.sql]
-- ─── Permisos ───────────────────────────────────────────────────────────────
revoke all on function public.fallo_interno_registrar(text, jsonb, uuid, text) from public, anon, authenticated;

-- [20261127100100_fallos_internos_telegram.sql]
revoke all on function public.fallos_internos_despues() from public, anon, authenticated;

-- [20261127100100_fallos_internos_telegram.sql]
revoke all on function public.fallos_internos_reclamar(integer) from public, anon, authenticated;

-- [20261127100100_fallos_internos_telegram.sql]
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;

-- [20261127100100_fallos_internos_telegram.sql]
grant execute on function public.fallo_interno_registrar(text, jsonb, uuid, text) to service_role;

-- [20261127100100_fallos_internos_telegram.sql]
grant execute on function public.fallos_internos_reclamar(integer) to service_role;

-- [20261127100100_fallos_internos_telegram.sql]
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- [20261129100000_peticiones.sql]
do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'peticiones: falta is_super_admin(uuid). No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261129100000_peticiones.sql] public.peticiones_ruta_captura_valida(text)
-- ─── 1. Ruta válida de una captura: <uid>/<uuid>.<ext> ──────────────────────

create or replace function public.peticiones_ruta_captura_valida(p_nombre text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_nombre ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$', false)
$$;

-- [20261129100000_peticiones.sql]
revoke all on function public.peticiones_ruta_captura_valida(text) from public, anon;

-- [20261129100000_peticiones.sql]
grant execute on function public.peticiones_ruta_captura_valida(text) to authenticated, service_role;

-- [20261129100000_peticiones.sql]
-- ─── 2. Tabla ───────────────────────────────────────────────────────────────

create table if not exists public.peticiones (
  id                  uuid primary key default gen_random_uuid(),
  creado_por          uuid default auth.uid() references auth.users (id) on delete set null,
  creado_por_nombre   text check (creado_por_nombre is null or char_length(creado_por_nombre) <= 200),
  creado_por_email    text check (creado_por_email is null or char_length(creado_por_email) <= 320),
  titulo              text not null check (char_length(btrim(titulo)) between 3 and 120),
  prioridad           text not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  modulo              text not null check (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
  descripcion         text not null check (char_length(btrim(descripcion)) between 10 and 4000),
  captura_path        text check (captura_path is null or public.peticiones_ruta_captura_valida(captura_path)),
  ruta                text check (ruta is null or char_length(ruta) <= 300),
  dispositivo         text check (dispositivo is null or char_length(dispositivo) <= 400),
  estado              text not null default 'nueva' check (estado in ('nueva', 'en_analisis', 'aceptada', 'hecha', 'descartada')),
  motivo_descarte     text check (motivo_descarte is null or char_length(motivo_descarte) <= 500),
  estado_cambiado_por uuid,
  estado_cambiado_en  timestamptz,
  analisis            jsonb check (analisis is null or jsonb_typeof(analisis) = 'object'),
  analisis_estado     text not null default 'pendiente' check (analisis_estado in ('pendiente', 'analizando', 'hecho', 'error')),
  analisis_error      text check (analisis_error is null or char_length(analisis_error) <= 500),
  analisis_modelo     text check (analisis_modelo is null or char_length(analisis_modelo) <= 120),
  analisis_intentos   integer not null default 0 check (analisis_intentos between 0 and 50),
  analisis_pedido_en  timestamptz,
  analizado_en        timestamptz,
  linear_id           text check (linear_id is null or char_length(linear_id) <= 100),
  linear_url          text check (linear_url is null or (linear_url ~ '^https://' and char_length(linear_url) <= 500)),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Descartar exige un motivo (lo ve quien la envió).
  constraint peticiones_descartada_con_motivo
    check (estado <> 'descartada' or char_length(btrim(coalesce(motivo_descarte, ''))) >= 3)
);

-- [20261129100000_peticiones.sql]
comment on table public.peticiones is
  'Peticiones de los usuarios del panel (Nueva petición) y Tickets del Super Admin, con análisis de IA (20261129100000). El análisis lo escribe solo analizar-peticion (service role).';

-- [20261129100000_peticiones.sql]
create index if not exists peticiones_por_autor on public.peticiones (creado_por, created_at desc);

-- [20261129100000_peticiones.sql]
create index if not exists peticiones_por_estado on public.peticiones (estado, created_at desc);

-- [20261129100000_peticiones.sql] public.peticiones_al_crear()
-- ─── 3. Al crear: autor del servidor, datos de contacto y tope diario ──────

create or replace function public.peticiones_al_crear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hoy integer;
begin
  if v_uid is not null then
    -- Desde el panel: siempre a nombre de quien la envía, recién creada y sin análisis.
    new.creado_por := v_uid;
    new.estado := 'nueva';
    new.motivo_descarte := null;
    new.estado_cambiado_por := null;
    new.estado_cambiado_en := null;
    new.analisis := null;
    new.analisis_estado := 'pendiente';
    new.analisis_error := null;
    new.analisis_modelo := null;
    new.analisis_intentos := 0;
    new.analisis_pedido_en := null;
    new.analizado_en := null;
    new.linear_id := null;
    new.linear_url := null;
    new.created_at := now();
  end if;
  new.updated_at := now();
  new.titulo := btrim(new.titulo);
  new.descripcion := btrim(new.descripcion);

  if new.creado_por is not null then
    select left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), u.email), 200), left(u.email, 320)
      into new.creado_por_nombre, new.creado_por_email
      from auth.users u
     where u.id = new.creado_por;

    -- Tope por usuario (cada petición gasta una llamada a la IA). El cerrojo
    -- evita que varias a la vez se lo salten.
    perform pg_advisory_xact_lock(hashtext('peticiones_tope_' || new.creado_por::text));
    select count(*) into v_hoy
      from public.peticiones
     where creado_por = new.creado_por
       and created_at > now() - interval '24 hours';
    if v_hoy >= 20 then
      raise exception 'Has enviado 20 peticiones en las últimas 24 horas. Espera un poco antes de mandar otra.';
    end if;
  end if;
  return new;
end;
$$;

-- [20261129100000_peticiones.sql]
revoke all on function public.peticiones_al_crear() from public, anon, authenticated;

-- [20261129100000_peticiones.sql]
drop trigger if exists trg_peticiones_al_crear on public.peticiones;

-- [20261129100000_peticiones.sql]
create trigger trg_peticiones_al_crear before insert on public.peticiones
  for each row execute function public.peticiones_al_crear();

-- [20261129100000_peticiones.sql] public.peticiones_al_cambiar()
-- ─── 4. Al cambiar: quién y cuándo, y lo que no cambia nunca ───────────────

create or replace function public.peticiones_al_cambiar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id;
  -- El autor no cambia… salvo a NULL (ON DELETE SET NULL al dar de baja al usuario).
  if new.creado_por is not null then
    new.creado_por := old.creado_por;
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.estado is distinct from old.estado then
    new.estado_cambiado_por := (select auth.uid());
    new.estado_cambiado_en := now();
  end if;
  -- El motivo solo tiene sentido descartada (si se reabre, se borra).
  if new.estado <> 'descartada' then
    new.motivo_descarte := null;
  else
    new.motivo_descarte := nullif(btrim(new.motivo_descarte), '');
  end if;
  return new;
end;
$$;

-- [20261129100000_peticiones.sql]
revoke all on function public.peticiones_al_cambiar() from public, anon, authenticated;

-- [20261129100000_peticiones.sql]
drop trigger if exists trg_peticiones_al_cambiar on public.peticiones;

-- [20261129100000_peticiones.sql]
create trigger trg_peticiones_al_cambiar before update on public.peticiones
  for each row execute function public.peticiones_al_cambiar();

-- [20261129100000_peticiones.sql] public.peticiones_avisar_urgente()
-- ─── 5. Urgente: aviso en la campana del super admin ────────────────────────

create or replace function public.peticiones_avisar_urgente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.prioridad <> 'urgente' or to_regclass('public.notificaciones_dashboard') is null then
    return new;
  end if;
  -- Un aviso nunca debe impedir guardar la petición.
  begin
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
    values (
      'peticion_urgente',
      left('Petición urgente: ' || new.titulo, 200),
      left(coalesce(new.creado_por_nombre, 'Un usuario') || ' · módulo ' || new.modulo, 300),
      new.id,
      'peticion',
      'alta'
    );
  exception when others then
    raise warning 'peticiones_avisar_urgente: no se pudo crear el aviso (%)', sqlerrm;
  end;
  return new;
end;
$$;

-- [20261129100000_peticiones.sql]
revoke all on function public.peticiones_avisar_urgente() from public, anon, authenticated;

-- [20261129100000_peticiones.sql]
drop trigger if exists trg_peticiones_avisar_urgente on public.peticiones;

-- [20261129100000_peticiones.sql]
create trigger trg_peticiones_avisar_urgente after insert on public.peticiones
  for each row execute function public.peticiones_avisar_urgente();

-- [20261129100000_peticiones.sql] public.peticion_reservar_analisis(uuid,boolean)
-- ─── 6. Reservar el análisis (solo service role: analizar-peticion) ────────

create or replace function public.peticion_reservar_analisis(p_id uuid, p_forzar boolean default false)
returns setof public.peticiones
language sql
set search_path = public
as $$
  update public.peticiones p
     set analisis_estado = 'analizando',
         analisis_pedido_en = now(),
         analisis_intentos = p.analisis_intentos + 1,
         analisis_error = null
   where p.id = p_id
     and p.analisis_intentos < 10
     and (
       coalesce(p_forzar, false)
       or p.analisis_estado = 'pendiente'
       or (p.analisis_estado = 'analizando' and p.analisis_pedido_en < now() - interval '3 minutes')
     )
  returning p.*
$$;

-- [20261129100000_peticiones.sql]
revoke all on function public.peticion_reservar_analisis(uuid, boolean) from public, anon, authenticated;

-- [20261129100000_peticiones.sql]
grant execute on function public.peticion_reservar_analisis(uuid, boolean) to service_role;

-- [20261129100000_peticiones.sql]
-- ─── 7. RLS y privilegios ───────────────────────────────────────────────────

alter table public.peticiones enable row level security;

-- [20261129100000_peticiones.sql]
drop policy if exists peticiones_insert_propia on public.peticiones;

-- [20261129100000_peticiones.sql]
create policy peticiones_insert_propia on public.peticiones for insert to authenticated
  with check (
    creado_por = (select auth.uid())
    and (captura_path is null or split_part(captura_path, '/', 1) = (select auth.uid())::text)
  );

-- [20261129100000_peticiones.sql]
drop policy if exists peticiones_select_propia on public.peticiones;

-- [20261129100000_peticiones.sql]
create policy peticiones_select_propia on public.peticiones for select to authenticated
  using (creado_por = (select auth.uid()));

-- [20261129100000_peticiones.sql]
drop policy if exists peticiones_select_super_admin on public.peticiones;

-- [20261129100000_peticiones.sql]
create policy peticiones_select_super_admin on public.peticiones for select to authenticated
  using ((select public.is_super_admin((select auth.uid()))));

-- [20261129100000_peticiones.sql]
drop policy if exists peticiones_update_super_admin on public.peticiones;

-- [20261129100000_peticiones.sql]
create policy peticiones_update_super_admin on public.peticiones for update to authenticated
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

-- [20261129100000_peticiones.sql]
revoke all on public.peticiones from anon, authenticated;

-- [20261129100000_peticiones.sql]
grant select on public.peticiones to authenticated;

-- [20261129100000_peticiones.sql]
grant insert (titulo, prioridad, modulo, descripcion, captura_path, ruta, dispositivo) on public.peticiones to authenticated;

-- [20261129100000_peticiones.sql]
grant update (estado, motivo_descarte) on public.peticiones to authenticated;

-- [20261129100000_peticiones.sql]
grant all on public.peticiones to service_role;

-- [20261129100000_peticiones.sql]
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    drop policy if exists "acceso_panel_no_bloqueado" on public.peticiones;
    create policy "acceso_panel_no_bloqueado" on public.peticiones as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  end if;
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.peticiones';
    execute 'create trigger trg_auditoria after insert or update or delete on public.peticiones for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- [20261129100000_peticiones.sql]
-- ─── 8. Avisos de peticiones: solo el super admin ───────────────────────────

do $$
begin
  if to_regclass('public.notificaciones_dashboard') is not null then
    drop policy if exists notificaciones_peticiones_solo_super_admin on public.notificaciones_dashboard;
    create policy notificaciones_peticiones_solo_super_admin on public.notificaciones_dashboard
      as restrictive for all to authenticated
      using ( tipo not like 'peticion\_%' or (select public.is_super_admin((select auth.uid()))) )
      with check ( tipo not like 'peticion\_%' or (select public.is_super_admin((select auth.uid()))) );
  end if;
end;
$$;

-- [20261129100000_peticiones.sql]
revoke all on function public.seccion_aviso(text) from public, anon;

-- [20261129100000_peticiones.sql]
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- [20261129100000_peticiones.sql]
-- ─── 9. Cubo privado «peticiones» (capturas) ────────────────────────────────

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('peticiones', 'peticiones', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

-- [20261129100000_peticiones.sql]
do $$
declare
  v_sesion text := case when to_regprocedure('private.sesion_panel_permitida()') is not null
                        then ' and (select private.sesion_panel_permitida())' else '' end;
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists peticiones_capturas_insert on storage.objects';
    execute 'create policy peticiones_capturas_insert on storage.objects for insert to authenticated with check (bucket_id = ''peticiones'''
      || ' and split_part(name, ''/'', 1) = (select auth.uid())::text and public.peticiones_ruta_captura_valida(name)' || v_sesion || ')';
    execute 'drop policy if exists peticiones_capturas_select on storage.objects';
    execute 'create policy peticiones_capturas_select on storage.objects for select to authenticated using (bucket_id = ''peticiones'''
      || ' and (split_part(name, ''/'', 1) = (select auth.uid())::text or (select public.is_super_admin((select auth.uid()))))' || v_sesion || ')';
  end if;
end;
$$;

-- [20261129100000_peticiones.sql]
-- ─── 10. Gasto IA ───────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('analizar-peticion', 'Peticiones · la IA analiza cada ticket una vez (qué quieren, tarea propuesta y prompt para la IA); «Volver a analizar» desde Super Admin › Tickets', true, 'petición', 97)
    on conflict (funcion) do nothing;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
    values ('analizar-peticion', 'gpt-4.1-mini, en código (secreto PETICIONES_IA_MODELO)', true)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- [20261129100000_peticiones.sql]
do $$ begin raise notice 'peticiones: aplicada'; end $$;

-- [20261129143100_ia_tarifas_sin_coste.sql]
do $$
begin
  if to_regclass('public.ia_uso') is null or to_regclass('public.ia_precios') is null then
    raise exception 'ia_tarifas_sin_coste: falta 20260928193000_costes_sistema (ia_uso / ia_precios). No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261129143100_ia_tarifas_sin_coste.sql]
-- ─── 1. Tarifas de los modelos del centro de modelos (solo las que falten) ──
insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output, razonamiento_como_output, notas, fuente, verificado_en)
values
  ('gpt-6.1-terra', 1.00, 0.05, 1.25,  5.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min. La usa chat-facturas desde el 12/11/2026.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6.1-sol',   2.00, 0.10, 2.50, 10.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6-astra',  10.00, 1.00, 12.50, 50.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6-sol',     2.00, 0.20, 2.50, 10.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6-luna',    0.10, 0.01, 0.125, 0.50, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.6-sol',   4.00, 0.40, null, 20.00, true, 'Tier Standard, contexto corto.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.6-terra', 2.00, 0.20, null, 12.00, true, 'Tier Standard, contexto corto.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.5',       5.00, 0.50, null, 30.00, true, 'Tier Standard, entrada < 272K tokens (más larga: 10 / 1 / 45).', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.4-nano',  0.20, 0.02, null,  1.25, true, 'Tier Standard.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null)
on conflict (modelo) do nothing;

-- [20261129143100_ia_tarifas_sin_coste.sql] public.ia_retarifar_sin_coste(text)
-- ─── 2. Poner el coste a las filas que lo tienen a NULL ─────────────────────
-- Misma cuenta que ia_registrar_uso (20260928193000, apartado 8b). Si algún
-- día cambia allí, hay que cambiarla aquí también.
create or replace function public.ia_retarifar_sin_coste(p_modelo text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.ia_uso u
     set coste_usd = round((
           greatest(u.prompt_tokens - u.cached_tokens - u.cache_write_tokens, 0) * p.usd_por_m_input
         + u.cached_tokens      * coalesce(p.usd_por_m_cached, p.usd_por_m_input)
         + u.cache_write_tokens * coalesce(p.usd_por_m_cache_write, p.usd_por_m_input)
         -- completion_tokens YA incluye el razonamiento: no se suma aparte.
         + u.completion_tokens  * p.usd_por_m_output
         ) / 1000000.0, 6)
    from public.ia_precios p
   where p.modelo = u.modelo
     and u.coste_usd is null
     and (p_modelo is null or u.modelo = p_modelo);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- [20261129143100_ia_tarifas_sin_coste.sql]
comment on function public.ia_retarifar_sin_coste(text) is
  'Pone el coste a las filas de ia_uso con coste_usd NULL cuyo modelo ya tiene tarifa en ia_precios (todas, o solo las de p_modelo). '
  'Misma cuenta que ia_registrar_uso. Nunca cambia un coste ya calculado. Devuelve cuántas filas ha arreglado.';

-- [20261129143100_ia_tarifas_sin_coste.sql]
revoke all on function public.ia_retarifar_sin_coste(text) from public, anon, authenticated;

-- [20261129143100_ia_tarifas_sin_coste.sql]
grant execute on function public.ia_retarifar_sin_coste(text) to service_role;

-- [20261129143100_ia_tarifas_sin_coste.sql] public.ia_precios_retarifar()
-- ─── 3. Al añadir o corregir una tarifa, sus filas sin coste se arreglan ────
create or replace function public.ia_precios_retarifar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ia_retarifar_sin_coste(new.modelo);
  return null;
end;
$$;

-- [20261129143100_ia_tarifas_sin_coste.sql]
revoke all on function public.ia_precios_retarifar() from public, anon, authenticated;

-- [20261129143100_ia_tarifas_sin_coste.sql]
drop trigger if exists ia_precios_retarifar on public.ia_precios;

-- [20261129143100_ia_tarifas_sin_coste.sql]
create trigger ia_precios_retarifar
  after insert or update of usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output
  on public.ia_precios
  for each row execute function public.ia_precios_retarifar();

-- [20261129143100_ia_tarifas_sin_coste.sql]
-- ─── 4. Lo que ya estaba sin coste y tiene tarifa ───────────────────────────
do $$
declare
  v_n integer;
  v_quedan integer;
begin
  v_n := public.ia_retarifar_sin_coste(null);
  select count(*) into v_quedan from public.ia_uso where coste_usd is null;
  raise notice 'ia_tarifas_sin_coste: % filas de ia_uso con coste recalculado; quedan % sin tarifa.', v_n, v_quedan;
end;
$$;

-- [20261129153000_costes_servicios_ia.sql]
do $$
begin
  if to_regclass('public.servicios_contratados') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'por_confirmar') then
    raise exception 'costes_servicios_ia: falta 20261103160000_servicios_planes_costes. No se ha cambiado nada.';
  end if;
  if to_regclass('public.ia_funciones') is null or to_regclass('public.ia_uso') is null then
    raise exception 'costes_servicios_ia: falta 20260928193000_costes_sistema (ia_funciones / ia_uso). No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261129153000_costes_servicios_ia.sql]
-- ─── 1. servicios_contratados: para qué, precio confirmado y plan siguiente ─
alter table public.servicios_contratados add column if not exists para_que text;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add column if not exists precio_confirmado_en date;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add column if not exists plan_siguiente text;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add column if not exists precio_siguiente numeric(10,2);

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add column if not exists si_se_pasa text;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_para_que_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add constraint servicios_contratados_para_que_chk
  check (para_que is null or length(para_que) <= 300);

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_plan_siguiente_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add constraint servicios_contratados_plan_siguiente_chk
  check (plan_siguiente is null or length(plan_siguiente) <= 80);

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_siguiente_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add constraint servicios_contratados_precio_siguiente_chk
  check (precio_siguiente is null or (precio_siguiente >= 0 and precio_siguiente <= 100000));

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_si_se_pasa_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add constraint servicios_contratados_si_se_pasa_chk
  check (si_se_pasa is null or length(si_se_pasa) <= 500);

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_confirmado_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.servicios_contratados add constraint servicios_contratados_precio_confirmado_chk
  check (precio_confirmado_en is null or precio_confirmado_en >= date '2020-01-01');

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.servicios_contratados.para_que is 'Para qué lo usa el negocio, en palabras (inventario de Servicios › Costes).';

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.servicios_contratados.precio_confirmado_en is 'Día en que el super admin comprobó plan y precio («Confirmar precio»). null = sin comprobar o de antes.';

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.servicios_contratados.plan_siguiente is 'Plan al que habría que pasar si se acaba el actual (p. ej. «Pro»).';

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.servicios_contratados.precio_siguiente is 'Precio al mes del plan siguiente, en la moneda del servicio. null = sin dato o pago por uso.';

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.servicios_contratados.si_se_pasa is 'Qué pasa si se pasa de un límite del plan. Una métrica puede afinarlo con limites.<clave>.si_se_pasa.';

-- [20261129153000_costes_servicios_ia.sql]
grant update (para_que, precio_confirmado_en, plan_siguiente, precio_siguiente, si_se_pasa)
  on public.servicios_contratados to authenticated;

-- [20261129153000_costes_servicios_ia.sql]
grant insert (para_que, precio_confirmado_en, plan_siguiente, precio_siguiente, si_se_pasa)
  on public.servicios_contratados to authenticated;

-- [20261129153000_costes_servicios_ia.sql]
-- Semilla (solo donde está vacío). Precios del plan siguiente según la página
-- oficial de cada proveedor (fuente_precio), consultada el 13/11/2026.
update public.servicios_contratados s
   set para_que = v.para_que
  from (values
    ('vercel',       'Publica la web y este panel.'),
    ('supabase',     'La base de datos: usuarios, permisos, auditoría, avisos, peticiones y archivos.'),
    ('github',       'Guarda el código de la web y del panel y pasa las pruebas automáticas.'),
    ('resend',       'Manda los correos del panel.'),
    ('stripe',       'Cobros con tarjeta (si se usan).'),
    ('openai',       'La inteligencia artificial: el análisis de los tickets y el centro de modelos.'),
    ('google_drive', 'El Excel de control del Gestor Gasto.'),
    ('hostinger',    'Dominio y correo (falta confirmar si se usa).')
  ) as v(proveedor, para_que)
 where s.proveedor = v.proveedor and s.para_que is null;

-- [20261129153000_costes_servicios_ia.sql]
update public.servicios_contratados s
   set plan_siguiente   = coalesce(s.plan_siguiente, v.plan),
       precio_siguiente = coalesce(s.precio_siguiente, v.precio),
       si_se_pasa       = coalesce(s.si_se_pasa, v.si_se_pasa)
  from (values
    ('vercel', 'Pro', 20.00::numeric,
     'Vercel pausa lo que se pase (las webs o el panel) hasta que pasen 30 días, salvo que se pase al plan Pro (20 US$ por persona y mes).'),
    ('supabase', 'Pro', 25.00::numeric,
     'Supabase puede limitar el proyecto hasta el mes siguiente o hasta pasar al plan Pro.'),
    ('resend', 'Pro', 20.00::numeric,
     'Los correos (confirmaciones de reserva y newsletter) dejan de salir hasta que se renueva el cupo. El plan Pro incluye 50.000 correos al mes.'),
    ('github', 'Team', 4.00::numeric,
     'GitHub deja de arrancar las pruebas automáticas y la copia de seguridad hasta el mes siguiente o hasta poner un presupuesto. El plan Team cuesta 4 US$ por persona y mes.'),
    ('google_drive', 'Google One 100 GB', 1.99::numeric,
     'Con la cuenta llena no se guardan más copias de las facturas en Drive (y el Gmail de esa cuenta deja de recibir correo).'),
    ('mapbox', 'Pago por uso', null::numeric,
     'Pasadas las 50.000 cargas del mes, Mapbox cobra 5 US$ cada 1.000 cargas más.')
  ) as v(proveedor, plan, precio, si_se_pasa)
 where s.proveedor = v.proveedor
   and (s.plan_siguiente is null or s.precio_siguiente is null or s.si_se_pasa is null);

-- [20261129153000_costes_servicios_ia.sql]
-- Qué pasa, métrica a métrica, donde no es lo mismo (solo si la métrica existe
-- y aún no lo dice).
update public.servicios_contratados s
   set limites = jsonb_set(s.limites, array[v.clave, 'si_se_pasa'], to_jsonb(v.texto))
  from (values
    ('supabase', 'bd_tamano',      'La base de datos pasa a solo lectura: no se podrían guardar cambios hasta liberar espacio o pasar al plan Pro.'),
    ('supabase', 'almacenamiento', 'No se podrían subir más fotos ni archivos (carta, facturas originales) hasta liberar espacio o pasar al plan Pro.'),
    ('supabase', 'egreso',         'Supabase avisa y, si se repite, puede limitar el proyecto hasta pasar al plan Pro.'),
    ('resend',   'correos_hoy',    'Los correos dejan de salir hasta el día siguiente (confirmaciones de reserva incluidas).'),
    ('resend',   'correos_mes',    'Los correos dejan de salir hasta el mes siguiente (confirmaciones de reserva incluidas).')
  ) as v(proveedor, clave, texto)
 where s.proveedor = v.proveedor
   and jsonb_typeof(s.limites -> v.clave) = 'object'
   and not (s.limites -> v.clave ? 'si_se_pasa');

-- [20261129153000_costes_servicios_ia.sql]
-- ─── 2. ia_funciones: qué hace y la frase de «Cuánto cuesta cada cosa» ──────
alter table public.ia_funciones add column if not exists que_hace text;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.ia_funciones add column if not exists accion text;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.ia_funciones drop constraint if exists ia_funciones_que_hace_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.ia_funciones add constraint ia_funciones_que_hace_chk check (que_hace is null or length(que_hace) <= 300);

-- [20261129153000_costes_servicios_ia.sql]
alter table public.ia_funciones drop constraint if exists ia_funciones_accion_chk;

-- [20261129153000_costes_servicios_ia.sql]
alter table public.ia_funciones add constraint ia_funciones_accion_chk check (accion is null or length(accion) <= 80);

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.ia_funciones.que_hace is 'Qué hace la función, en palabras del negocio (tabla «IA, función por función»).';

-- [20261129153000_costes_servicios_ia.sql]
comment on column public.ia_funciones.accion is 'Una acción en palabras («Leer una factura»): sale en «Cuánto cuesta cada cosa» con la mediana del coste de un uso.';

-- [20261129153000_costes_servicios_ia.sql]
-- Las que ya registraban en ia_uso sin estar en el catálogo.
insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
values
  ('buscar-puntuacion-parker', 'Carta › Vinos: busca en internet la puntuación Parker de un vino (gpt-4.1 + búsqueda web). Registra cada llamada en ia_uso.', true, 'vino', 65),
  ('interpretar-reserva-manuscrita', 'Reservas › «Escribir reserva»: lee con visión lo escrito a mano en la hoja del día. Registra cada llamada en ia_uso.', true, 'reserva', 67)
on conflict (funcion) do nothing;

-- [20261129153000_costes_servicios_ia.sql]
-- Ya registran su gasto (registrarUso en su código): el catálogo decía que no.
update public.ia_funciones
   set instrumentada = true
 where funcion in ('chat-facturas', 'traducir-contenido', 'format-novedad', 'rrss-ia', 'instagram-ia', 'buscar-precios-mercado')
   and instrumentada = false;

-- [20261129153000_costes_servicios_ia.sql]
update public.ia_funciones f
   set que_hace = coalesce(f.que_hace, v.que_hace),
       accion   = coalesce(f.accion, v.accion)
  from (values
    ('ocr-trabajo',                    'Lee las facturas y albaranes que se suben (foto o PDF) y saca sus líneas.', 'Leer una factura'),
    ('procesar-factura',               'Prepara la lectura de cada factura; aquí solo gasta al indexar productos (al sustituir una factura o al importar el histórico).', 'Indexar los productos de una factura'),
    ('clasificar-productos',           'Ordena en el catálogo los productos nuevos de las facturas (sola, cada pocos minutos).', 'Clasificar una tanda de productos nuevos'),
    ('chat-facturas',                  'Contesta a las preguntas del chat de Facturas.', 'Contestar una pregunta en el chat de Facturas'),
    ('chat-web',                       'Contesta a los clientes en el chat de la web.', 'Contestar una pregunta en el chat de la web'),
    ('traducir-contenido',             'Traduce los platos y textos de la carta a otros idiomas.', 'Traducir un plato'),
    ('extraer-vino-foto',              'Lee la etiqueta de la foto de un vino y busca sus datos.', 'Leer la etiqueta de un vino'),
    ('buscar-puntuacion-parker',       'Busca en internet la puntuación Parker de un vino.', 'Buscar la puntuación Parker de un vino'),
    ('recortar-foto',                  'Quita el fondo de las fotos de la carta, en nuestro servidor (Vercel), sin IA de pago.', 'Recortar una foto'),
    ('interpretar-reserva-manuscrita', 'Lee las reservas escritas a mano en la hoja del día.', 'Leer una reserva escrita a mano'),
    ('format-novedad',                 'Da formato a una novedad antes de publicarla.', 'Dar formato a una novedad'),
    ('instagram-ia',                   'Propone textos y rótulos para las publicaciones de Instagram.', 'Proponer los textos de una publicación'),
    ('rrss-ia',                        'Editor de redes sociales: plan de edición, textos e ideas para grabar.', 'Pedir una propuesta al editor de redes'),
    ('newsletter-ia',                  'Redacta la newsletter y propone cómo presentarla.', 'Redactar una newsletter'),
    ('resenas-contestador',            'Propone la respuesta a una reseña de Google en el tono de Cristalería BV.', 'Proponer la respuesta a una reseña'),
    ('procesar-logs-web',              'Analiza una incidencia de la web antes de abrir su aviso.', 'Analizar una incidencia de la web'),
    ('resumen-logs-web',               'Resume la actividad de la web del periodo.', 'Resumir la actividad de la web'),
    ('ia-modelos-openai',              'Prueba los modelos de IA (botón «Probar» de Servicios › Modelos).', 'Probar un modelo'),
    ('procesar-dibujo-perimetro',      'Leía un plano de sala dibujado a mano (ya no se usa).', null),
    ('buscar-precios-mercado',         'Precios de lonja con Perplexity (ya no se usa).', null)
  ) as v(funcion, que_hace, accion)
 where f.funcion = v.funcion
   and (f.que_hace is null or (f.accion is null and v.accion is not null));

-- [override] ia_coste_por_uso
-- Coste por uso de cada función de IA (solo ia_uso: aquí no hay chatbot de la web).
CREATE OR REPLACE FUNCTION public.ia_coste_por_uso(p_desde date, p_hasta date)
 RETURNS TABLE(funcion text, que_hace text, accion text, unidad text, orden integer, llamadas bigint, usos bigint, usos_con_coste bigint, coste_usd numeric, filas_sin_tarifa bigint, modelos_sin_tarifa text[], mediana_usd numeric, media_usd numeric, servidor_propio boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with filas as (
    select u.id, u.funcion, u.modelo, u.llamadas, u.coste_usd, u.created_at,
           coalesce(nullif(split_part(coalesce(u.disparador, ''), '#', 1), ''), '-') as base
      from public.ia_uso u
     where (u.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
  ),
  con_previa as (
    select f.*,
           lag(f.created_at) over (partition by f.funcion, f.base order by f.created_at, f.id) as previa
      from filas f
  ),
  islas as (
    -- Un trabajo de OCR es un uso aunque sus piezas tarden minutos; el resto,
    -- un uso nuevo cada vez que pasan más de 5 s sin filas del mismo disparador.
    select c.*,
           sum(case when c.base like 'trabajo:%' then 0
                    when c.previa is null or c.created_at - c.previa > interval '5 seconds' then 1
                    else 0 end)
             over (partition by c.funcion, c.base order by c.created_at, c.id rows unbounded preceding) as isla
      from con_previa c
  ),
  usos_ia as (
    select i.funcion,
           sum(i.llamadas)::bigint                                  as llamadas,
           sum(i.coste_usd)                                         as coste,
           count(*) filter (where i.coste_usd is null)::bigint      as sin_tarifa,
           array_agg(distinct i.modelo) filter (where i.coste_usd is null) as modelos_sin,
           bool_and(i.modelo like 'vercel:%')                       as propio
      from islas i
     group by i.funcion, i.base, i.isla
  ),
  usos as (
    select * from usos_ia
  ),
  por_funcion as (
    select u.funcion,
           sum(u.llamadas)::bigint                                              as llamadas,
           count(*)::bigint                                                     as usos,
           count(*) filter (where u.sin_tarifa = 0)::bigint                      as usos_con_coste,
           round(sum(u.coste), 6)                                               as coste_usd,
           sum(u.sin_tarifa)::bigint                                            as filas_sin_tarifa,
           (select array_agg(distinct m order by m) from usos x, unnest(x.modelos_sin) m where x.funcion = u.funcion) as modelos_sin_tarifa,
           round((percentile_cont(0.5) within group (order by u.coste) filter (where u.sin_tarifa = 0))::numeric, 6) as mediana_usd,
           round(avg(u.coste) filter (where u.sin_tarifa = 0), 6)               as media_usd,
           bool_and(u.propio)                                                   as servidor_propio
      from usos u
     group by u.funcion
  )
  select p.funcion,
         coalesce(f.que_hace, f.descripcion)  as que_hace,
         f.accion,
         coalesce(f.unidad, 'llamada')        as unidad,
         coalesce(f.orden, 999)               as orden,
         p.llamadas,
         p.usos,
         p.usos_con_coste,
         p.coste_usd,
         p.filas_sin_tarifa,
         coalesce(p.modelos_sin_tarifa, '{}'::text[]) as modelos_sin_tarifa,
         p.mediana_usd,
         p.media_usd,
         coalesce(p.servidor_propio, false)   as servidor_propio
    from por_funcion p
    left join public.ia_funciones f on f.funcion = p.funcion
   order by p.coste_usd desc nulls last, coalesce(f.orden, 999), p.funcion;
$function$;

-- [20261129153000_costes_servicios_ia.sql]
comment on function public.ia_coste_por_uso(date, date) is
  'IA función por función entre dos días (hora de Madrid): llamadas, usos (peticiones), coste conocido y mediana/media del coste de un uso. '
  'Un uso = las filas de un trabajo de OCR (trabajo:<id>) o las que una petición escribe seguidas (mismo disparador, < 5 s). '
  'chat-web sale de chat_web_uso. Las filas sin tarifa (coste NULL) no suman: filas_sin_tarifa y modelos_sin_tarifa avisan. Solo super admin (RLS).';

-- [20261129153000_costes_servicios_ia.sql]
revoke all on function public.ia_coste_por_uso(date, date) from public, anon;

-- [20261129153000_costes_servicios_ia.sql]
grant execute on function public.ia_coste_por_uso(date, date) to authenticated, service_role;

-- [override] informe_auditoria_mensual
-- Informe mensual de auditoría (Super Admin › Informes).
CREATE OR REPLACE FUNCTION public.informe_auditoria_mensual(p_mes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v_res jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.super_admins s where s.user_id = auth.uid()) then
    raise exception 'Solo el super admin puede generar el informe de auditoría' using errcode = '42501';
  end if;
  if p_mes is null or p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes inválido (se espera AAAA-MM)' using errcode = '22023';
  end if;
  v_ini := (p_mes || '-01')::date::timestamp at time zone 'Europe/Madrid';
  v_fin := ((p_mes || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Madrid';

  -- Leer audit_log es caro (cada página cuesta), así que:
  --  · «crudo» sale solo del índice idx_audit_log_informe_mensual, sin abrir la tabla;
  --  · qué tablas se ven se calcula una vez por tabla, no por fila (misma regla
  --    que la vista audit_log_visible: si cambia allí, cámbiala aquí);
  --  · el detalle (jsonb) solo se abre en las filas que pueden ser delicadas.
  with crudo as materialized (
    select a.id, a.created_at, a.actor_label, a.actor_origin, a.accion, a.tabla
    from public.audit_log a
    where a.created_at >= v_ini and a.created_at < v_fin
  ),
  tablas as materialized (
    select d.tabla, public.audit_tabla_util(d.tabla) as util from (select distinct tabla from crudo) d
  ),
  ev as materialized (
    select c.id, c.created_at, c.actor_label, c.actor_origin, c.accion, c.tabla,
           (c.created_at at time zone 'Europe/Madrid')::date as dia,
           extract(hour from c.created_at at time zone 'Europe/Madrid')::int as hora
    from crudo c join tablas t on t.tabla is not distinct from c.tabla
    where t.util
  ),
  usr as (select * from ev where actor_origin = 'usuario'),
  trabajo as (select * from usr where accion in ('crear','actualizar','eliminar','ejecutar')),
  por_tabla as (
    select actor_label, tabla, count(*) n,
           row_number() over (partition by actor_label order by count(*) desc, tabla) rn
    from trabajo where tabla is not null and tabla not in ('accesos_panel') group by actor_label, tabla
  ),
  -- Tablas que tienen precio: solo en ellas puede haber un «cambiar_precio».
  con_precio as materialized (
    select c.relname::text as tabla
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attname = 'precio_eur' and not a.attisdropped
  ),
  -- Candidatas a delicada. Los tipos delicados los decide la vista a partir de
  -- la tabla y del detalle: permisos y roles (por tabla), bloqueos y
  -- credenciales (auth.users) y precios (tablas con precio_eur). Las acciones
  -- del servidor («ejecutar») no producen ninguno de esos tipos.
  candidatas as (
    select u.id from usr u
    where u.accion = 'eliminar'
       or u.tabla in ('user_permissions','user_roles','super_admins','auth.users')
       or (u.accion = 'actualizar' and u.tabla in (select p.tabla from con_precio p))
  ),
  delicadas as materialized (
    select e.created_at, e.actor_label, e.actor_origin, e.accion, e.tabla, e.tipo_evento,
           jsonb_build_object('antes', jsonb_strip_nulls(jsonb_build_object(
               'nombre', e.detalles->'antes'->>'nombre', 'precio_eur', e.detalles->'antes'->>'precio_eur',
               'section_key', e.detalles->'antes'->>'section_key', 'can_view', e.detalles->'antes'->>'can_view',
               'can_edit', e.detalles->'antes'->>'can_edit', 'role', e.detalles->'antes'->>'role', 'email', e.detalles->'antes'->>'email')),
             'despues', jsonb_strip_nulls(jsonb_build_object(
               'nombre', e.detalles->'despues'->>'nombre', 'precio_eur', e.detalles->'despues'->>'precio_eur',
               'section_key', e.detalles->'despues'->>'section_key', 'can_view', e.detalles->'despues'->>'can_view',
               'can_edit', e.detalles->'despues'->>'can_edit', 'role', e.detalles->'despues'->>'role', 'email', e.detalles->'despues'->>'email'))) as det
    from public.audit_log_visible e
    where e.id = any(array(select k.id from candidatas k))
      and (e.accion = 'eliminar'
           or e.tipo_evento in ('cambiar_precio','cambiar_permisos','cambiar_roles','bloquear_acceso','desbloquear_acceso','cambiar_credenciales'))
  ),
  precios as (select actor_label, count(*) n from delicadas where tipo_evento = 'cambiar_precio' group by actor_label),
  usuarios as (
    select u.actor_label as quien,
           count(*) filter (where u.accion in ('crear','actualizar','eliminar','ejecutar')) as acciones,
           count(distinct u.dia) as dias,
           max(u.created_at) as ultima,
           count(*) filter (where u.accion = 'eliminar') as borrados,
           coalesce((select p.n from precios p where p.actor_label = u.actor_label), 0) as precios,
           coalesce((select jsonb_agg(jsonb_build_object('tabla', t.tabla, 'n', t.n) order by t.n desc)
                     from por_tabla t where t.actor_label = u.actor_label and t.rn <= 3), '[]'::jsonb) as secciones
    from usr u where u.actor_label is not null group by u.actor_label
  ),
  sistema as (
    select actor_label, tabla, accion, count(*) n from ev
    where actor_origin in ('servicio','base_de_datos') group by actor_label, tabla, accion
  )
  select jsonb_build_object(
    'usuarios', coalesce((select jsonb_agg(to_jsonb(u) order by u.acciones desc, u.quien) from usuarios u), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia)
                         from (select dia, count(*) n from trabajo group by dia) d), '[]'::jsonb),
    'por_hora', coalesce((select jsonb_agg(jsonb_build_object('hora', h.hora, 'n', h.n) order by h.hora)
                          from (select hora, count(*) n from trabajo group by hora) h), '[]'::jsonb),
    'delicadas_total', (select count(*) from delicadas),
    'delicadas', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                           from (select * from delicadas order by created_at desc limit 300) x), '[]'::jsonb),
    'sistema', coalesce((select jsonb_agg(to_jsonb(s) order by s.n desc) from (select * from sistema order by n desc limit 40) s), '[]'::jsonb),
    'sistema_total', (select count(*) from ev where actor_origin in ('servicio','base_de_datos')),
    'accesos_fallidos', (select count(*) from ev where accion in ('login_fallido','acceso_denegado'))
  ) into v_res;
  return v_res;
end;
$function$;

-- [20261201100000_informe_auditoria_mensual.sql]
revoke all on function public.informe_auditoria_mensual(text) from public, anon;

-- [20261201100000_informe_auditoria_mensual.sql]
grant execute on function public.informe_auditoria_mensual(text) to authenticated;

-- [20261205100000_audit_log_indice_informe.sql]
-- ===========================================================================
-- 20261205100000_audit_log_indice_informe — índice para el informe mensual de auditoría (16/11/2026)
-- ===========================================================================
-- El «Informe mensual de auditoría» daba «canceling statement due to statement
-- timeout»: recorría entera la tabla audit_log del mes (más de 100 MB con el
-- detalle de cada evento) y no cabe en los 8 s que tiene una petición del panel.
-- Este índice lleva dentro lo poco que necesita el resumen (quién, qué, dónde,
-- cuándo), así el informe lo saca del índice sin abrir la tabla.
--
-- (En el original se creaba con `concurrently` porque audit_log ya tenía datos; en un proyecto nuevo no hace falta.)
create index if not exists idx_audit_log_informe_mensual
  on public.audit_log (created_at) include (actor_origin, accion, tabla, actor_label, id);

-- [20261205100000_audit_log_indice_informe.sql]
-- La tabla casi solo recibe altas. Con el ajuste por defecto el autovacuum pasa
-- cada +20 % de filas y, hasta entonces, las filas nuevas obligan a abrir la
-- tabla aunque el dato esté en el índice. Así pasa cada 5.000 altas.
alter table public.audit_log set (autovacuum_vacuum_insert_scale_factor = 0, autovacuum_vacuum_insert_threshold = 5000);

-- [20261205100100_informe_auditoria_rapido.sql]
revoke all on function public.informe_auditoria_mensual(text) from public, anon;

-- [20261205100100_informe_auditoria_rapido.sql]
grant execute on function public.informe_auditoria_mensual(text) to authenticated;

-- [20261209100000_servicios_cierre.sql]
do $$
begin
  if to_regclass('public.servicios_contratados') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'precio_confirmado_en') then
    raise exception 'servicios_cierre: falta 20261129153000_costes_servicios_ia. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261209100000_servicios_cierre.sql]
-- ─── 0. Copia de lo que se toca (para el rollback) ──────────────────────────
create table if not exists public.servicios_contratados_copia_cierre (
  proveedor  text primary key,
  fila       jsonb not null,
  copiado_en timestamptz not null default now()
);

-- [20261209100000_servicios_cierre.sql]
comment on table public.servicios_contratados_copia_cierre is
  'Cómo estaban Loading, Vercel, Hostinger y Mapbox antes de 20261209100000_servicios_cierre. Solo la usa su rollback.';

-- [20261209100000_servicios_cierre.sql]
alter table public.servicios_contratados_copia_cierre enable row level security;

-- [20261209100000_servicios_cierre.sql]
revoke all on public.servicios_contratados_copia_cierre from public, anon, authenticated;

-- [20261209100000_servicios_cierre.sql]
grant all on public.servicios_contratados_copia_cierre to service_role;

-- [20261209100000_servicios_cierre.sql]
-- ─── 1. Loading: ya no se usa ───────────────────────────────────────────────
update public.servicios_contratados
   set activo = false,
       por_confirmar = false,
       para_que = 'El dominio, el correo y la web antigua (ya no se usa: el dominio y el correo están en Hostinger).'
 where proveedor = 'loading'
   and activo is distinct from false;

-- [20261209100000_servicios_cierre.sql]
-- ─── 2. Vercel: plan Pro ────────────────────────────────────────────────────
update public.servicios_contratados
   set plan = 'Pro',
       ciclo = 'mensual',
       precio_mensual = 20,
       precio_anual = null,
       moneda = 'USD',
       por_confirmar = false,
       precio_confirmado_en = coalesce(precio_confirmado_en, current_date),
       fuente_precio = 'https://vercel.com/pricing',
       plan_siguiente = null,
       precio_siguiente = null,
       si_se_pasa = 'Vercel no corta las webs: cobra en la factura del mes el uso que pase de los 20 US$ incluidos.'
 where proveedor = 'vercel'
   and plan is distinct from 'Pro';

-- [20261209100000_servicios_cierre.sql]
-- Los límites del plan Hobby ya no valen (se reconocen por su página oficial);
-- tampoco los dos «sin dato» de almacenamiento, que ahora salen de la facturación.
update public.servicios_contratados s
   set limites = coalesce((
         select jsonb_object_agg(l.key, l.value)
           from jsonb_each(s.limites) l
          where coalesce(l.value ->> 'fuente', '') not like 'https://vercel.com/docs/plans/hobby%'
            and not (l.key in ('almacenamiento_despliegues', 'almacenamiento_funciones') and l.value ->> 'limite' is null)
       ), '{}'::jsonb)
 where s.proveedor = 'vercel';

-- [20261209100000_servicios_cierre.sql]
update public.servicios_contratados
   set limites = limites || jsonb_build_object('uso_periodo', jsonb_build_object(
         'etiqueta', 'Uso del periodo de facturación',
         'limite', 20,
         'unidad', 'USD',
         'periodo', 'periodo de facturación',
         'orden', 0,
         'fuente', 'https://vercel.com/docs/plans/pro-plan',
         'nota', 'El plan Pro incluye 20 US$ de uso en cada periodo (compilaciones, almacenamiento, visitas…). Lo que pase se cobra aparte.',
         'si_se_pasa', 'Vercel no corta las webs: cobra el exceso en la factura del mes.'))
 where proveedor = 'vercel'
   and not (limites ? 'uso_periodo');

-- [20261209100000_servicios_cierre.sql]
update public.servicios_contratados
   set limites = jsonb_set(limites, '{cargas_mapa_web,nota}', to_jsonb(
         'Después, 5 US$ cada 1.000 cargas. Lectura automática: la web suma una carga cada vez que dibuja el mapa (contador propio, sin datos del visitante). La cifra oficial, en su panel (Statistics).'::text))
 where proveedor = 'mapbox'
   and limites ? 'cargas_mapa_web';

-- [override] ia_cuadre_openai
-- Cuadre del coste real de OpenAI con lo registrado (solo ia_uso).
CREATE OR REPLACE FUNCTION public.ia_cuadre_openai(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with reales as (
    select o.fecha, sum(o.usd) as usd
      from public.openai_costes_diarios o
     where o.fecha between p_desde and p_hasta
     group by o.fecha
  ), registrado as (
    select (i.created_at at time zone 'utc')::date as fecha, sum(i.coste_usd) as usd
      from public.ia_uso i
     where i.created_at >= (p_desde::timestamp at time zone 'utc')
       and i.created_at <  ((p_hasta + 1)::timestamp at time zone 'utc')
       and i.modelo not like 'vercel:%'
       and i.modelo not ilike 'sonar%'
       and i.funcion <> 'buscar-precios-mercado'
     group by 1
  )
  select jsonb_build_object(
           'dias', count(*),
           'primer_dia', min(r.fecha),
           'ultimo_dia', max(r.fecha),
           'real_usd', coalesce(round(sum(r.usd), 4), 0),
           'registrado_usd', coalesce(round(sum(coalesce(g.usd, 0)), 4), 0))
    from reales r
    left join registrado g on g.fecha = r.fecha;
$function$;

-- [20261209100000_servicios_cierre.sql]
comment on function public.ia_cuadre_openai(date, date) is
  'Días con coste real de OpenAI entre dos fechas (UTC): lo facturado frente a lo que registraron las funciones de este proyecto (ia_uso + chat_web_uso). La diferencia es gasto de fuera (demo, pruebas). Solo super admin (RLS).';

-- [20261209100000_servicios_cierre.sql]
revoke all on function public.ia_cuadre_openai(date, date) from public, anon;

-- [20261209100000_servicios_cierre.sql]
grant execute on function public.ia_cuadre_openai(date, date) to authenticated, service_role;

-- [20261209100000_servicios_cierre.sql]
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    update public.ia_funciones
       set instrumentada = true,
           que_hace = coalesce(que_hace, 'Convierte el dibujo a mano del plano de la sala en paredes rectas.'),
           accion = coalesce(accion, 'Pasar a limpio el dibujo de una sala'),
           unidad = case when unidad = 'llamada' then 'dibujo' else unidad end
     where funcion = 'procesar-dibujo-perimetro';
  end if;
end;
$$;

-- [20261209110000_ia_acciones_nombres.sql]
do $$
begin
  if to_regclass('public.ia_funciones') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'ia_funciones' and column_name = 'accion') then
    raise exception 'ia_acciones_nombres: falta 20261129153000_costes_servicios_ia. No se ha cambiado nada.';
  end if;
end;
$$;

-- [20261209110000_ia_acciones_nombres.sql]
update public.ia_funciones f
   set que_hace = coalesce(nullif(f.que_hace, ''), v.que_hace),
       accion   = coalesce(nullif(f.accion, ''), v.accion)
  from (values
    ('embeddings-nombres', 'Prepara los nombres de los productos de las facturas para poder buscarlos por parecido (sola, al llegar nombres nuevos).', 'Preparar una tanda de nombres de producto para el buscador'),
    ('analizar-peticion',  'Analiza una petición de mejora del panel y propone cómo hacerla.',                                                   'Analizar una petición de mejora'),
    ('buscar-precios-mercado', 'Precios de lonja con Perplexity (ya no se usa).',                                                              'Buscar precios de lonja')
  ) as v(funcion, que_hace, accion)
 where f.funcion = v.funcion
   and (nullif(f.que_hace, '') is null or nullif(f.accion, '') is null);

-- [20261209200000_chat_facturas_busqueda_precision.sql]
revoke all on function public.fallo_interno_registrar(text, jsonb, uuid, text) from public, anon, authenticated;

-- [20261209200000_chat_facturas_busqueda_precision.sql]
grant execute on function public.fallo_interno_registrar(text, jsonb, uuid, text) to service_role;

-- [20261209400000_telegram_avisos_utiles.sql]
-- ─── 1. Configuración ───────────────────────────────────────────────────────
alter table public.avisos_telegram_config
  add column if not exists reservas_al_momento boolean  not null default true,
  add column if not exists tope_hora           smallint not null default 10 check (tope_hora between 1 and 100),
  add column if not exists tope_dia            smallint not null default 30 check (tope_dia between 1 and 500),
  add column if not exists semanal_activo      boolean  not null default true,
  add column if not exists semanal_dia         smallint not null default 1 check (semanal_dia between 1 and 7),
  add column if not exists semanal_hora        smallint not null default 9 check (semanal_hora between 0 and 23),
  add column if not exists semanal_ultimo_dia  date,
  add column if not exists resumen_revision    jsonb    not null default '{}'::jsonb;

-- [20261209400000_telegram_avisos_utiles.sql]
comment on column public.avisos_telegram_config.reservas_al_momento is
  'Reservas nuevas y canceladas para hoy y mañana, al momento y sin nombre del cliente (20261209400000). No avisa de las pendientes de verificar ni de las canceladas desde el panel.';

-- [20261209400000_telegram_avisos_utiles.sql]
comment on column public.avisos_telegram_config.tope_hora is 'Máximo de avisos «al momento» por hora (20261209400000); el resto, «…y N más» en el panel.';

-- [20261209400000_telegram_avisos_utiles.sql]
comment on column public.avisos_telegram_config.tope_dia is 'Máximo de avisos «al momento» por día (20261209400000).';

-- [20261209400000_telegram_avisos_utiles.sql]
comment on column public.avisos_telegram_config.semanal_dia is 'Día del resumen semanal: 1 = lunes … 7 = domingo (hora de Madrid).';

-- [20261209400000_telegram_avisos_utiles.sql]
-- Quien configura puede cambiar lo nuevo (no el estado interno: semanal_ultimo_dia ni resumen_revision).
grant update (reservas_al_momento, tope_hora, tope_dia, semanal_activo, semanal_dia, semanal_hora)
  on public.avisos_telegram_config to authenticated;

-- [20261209400000_telegram_avisos_utiles.sql]
-- ─── 2. Registro de envíos: tipo 'semanal' ──────────────────────────────────
alter table public.avisos_telegram_envios drop constraint if exists avisos_telegram_envios_tipo_check;

-- [20261209400000_telegram_avisos_utiles.sql]
alter table public.avisos_telegram_envios add constraint avisos_telegram_envios_tipo_check
  check (tipo in ('aviso', 'resumen', 'prueba', 'pendientes', 'fallo', 'semanal'));

-- [20261209400000_telegram_avisos_utiles.sql]
revoke all on function public.avisos_telegram_hay_pendientes() from public, anon, authenticated;

-- [20261209400000_telegram_avisos_utiles.sql]
grant execute on function public.avisos_telegram_hay_pendientes() to service_role;

-- [20261209400000_telegram_avisos_utiles.sql]
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;

-- [20261209400000_telegram_avisos_utiles.sql]
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- [20261209600000_telegram_avisos_revision.sql] public.fallos_internos_agrupar()
-- ─── 4. Throttle: guarda los ids de los descartados ─────────────────────────
create or replace function public.fallos_internos_agrupar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ult record;
  v_rep int;
  v_ref jsonb;
  v_ids jsonb;
begin
  if new.tipo not in ('chat_pulgar_abajo', 'albaran_aviso') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('fallos_internos:' || new.tipo));
  select f.id, f.created_at, f.datos into v_ult
    from public.fallos_internos f
   where f.tipo = new.tipo
   order by f.created_at desc, f.id desc
   limit 1;
  if v_ult.id is not null and v_ult.created_at > now() - interval '15 minutes' then
    -- Qué se descarta: el albarán (factura_id) o el feedback del chat (feedback_id); máx. 50 ids.
    v_ref := case new.tipo when 'albaran_aviso' then new.datos -> 'factura_id' else new.datos -> 'feedback_id' end;
    v_ids := coalesce(v_ult.datos -> 'repetidos_ids', '[]'::jsonb);
    if v_ref is not null and jsonb_typeof(v_ref) <> 'null' and jsonb_array_length(v_ids) < 50 and not v_ids @> jsonb_build_array(v_ref) then
      v_ids := v_ids || jsonb_build_array(v_ref);
    end if;
    update public.fallos_internos f
       set datos = f.datos || jsonb_build_object('repetidos', coalesce((f.datos ->> 'repetidos')::int, 0) + 1, 'repetidos_ids', v_ids)
     where f.id = v_ult.id;
    return null;
  end if;
  v_rep := coalesce((v_ult.datos ->> 'repetidos')::int, 0);
  if v_rep > 0 then
    new.datos := new.datos || jsonb_build_object('acumulados_antes', v_rep, 'acumulados_desde', v_ult.created_at,
                                                 'acumulados_ids', coalesce(v_ult.datos -> 'repetidos_ids', '[]'::jsonb));
  end if;
  return new;
end;
$$;

-- [20261209400000_telegram_avisos_utiles.sql]
revoke all on function public.fallos_internos_agrupar() from public, anon, authenticated;

-- [20261209400000_telegram_avisos_utiles.sql]
drop trigger if exists fallos_internos_agrupar on public.fallos_internos;

-- [20261209400000_telegram_avisos_utiles.sql]
create trigger fallos_internos_agrupar before insert on public.fallos_internos
  for each row execute function public.fallos_internos_agrupar();

-- [20261209400000_telegram_avisos_utiles.sql]
create index if not exists fallos_internos_tipo_fecha_idx on public.fallos_internos (tipo, created_at desc);

-- [override] vigilante_fallos_telegram
-- Vigilante de fallos para Telegram: tareas programadas importantes sin éxito.
CREATE OR REPLACE FUNCTION public.vigilante_fallos_telegram()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c         public.avisos_telegram_config%rowtype;
  v_base    timestamptz;
  v_ult     timestamptz;
  v_n       int;
  v_desde   timestamptz;
  v_ej      text;
  v_crons   jsonb := '[]'::jsonb;
  v_hechos  text[] := '{}';
  v_ok      timestamptz;
  v_run     timestamptz;
  v_err     text;
  r         record;
  -- Tareas que importan y cuántos minutos sin éxito se toleran (las que no existan en este entorno se ignoran).
  v_lista   jsonb := '[
    {"job":"avisos-telegram-pendientes","min":30},
    {"job":"avisos-telegram-fallos","min":30},
    {"job":"avisos-telegram-resumen","min":180},
    {"job":"sincronizar-costes-openai","min":1500},
    {"job":"ia-modelos-openai","min":2940}
  ]'::jsonb;
begin
  select * into c from public.avisos_telegram_config where id;
  if not found or not c.activo or coalesce(c.chat_id, '') = '' then
    return 'inactivo';
  end if;
  perform pg_advisory_xact_lock(hashtext('vigilante_fallos_telegram'));
  v_base := greatest(coalesce(c.activo_desde, now()), now() - interval '1 day');

  -- Tareas programadas importantes sin éxito más de X minutos (una vez cada 6 h, máx. 4 al día).
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    select max(f.created_at) into v_ult from public.fallos_internos f where f.tipo = 'cron_caido';
    if (v_ult is null or v_ult < now() - interval '6 hours')
       and (select count(*) from public.fallos_internos f where f.tipo = 'cron_caido' and f.created_at > now() - interval '24 hours') < 4 then
      for r in
        execute 'select j.jobid, j.jobname, x.min from cron.job j join jsonb_to_recordset($1) as x(job text, min int) on x.job = j.jobname where j.active'
        using v_lista
      loop
        execute 'select max(d.end_time) filter (where d.status = ''succeeded''), max(d.start_time) from cron.job_run_details d where d.jobid = $1 and d.start_time > now() - interval ''3 days'''
          into v_ok, v_run using r.jobid;
        -- Sin ninguna ejecución en 3 días no hay datos para juzgar (tarea recién creada): se ignora.
        if v_run is not null and (v_ok is null or v_ok < now() - make_interval(mins => r.min)) then
          execute 'select left(d.return_message, 100) from cron.job_run_details d where d.jobid = $1 and d.status = ''failed'' order by d.start_time desc limit 1'
            into v_err using r.jobid;
          v_crons := v_crons || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'job', r.jobname, 'maximo', r.min, 'ultimo_exito', v_ok,
            'minutos', case when v_ok is null then null else round(extract(epoch from (now() - v_ok)) / 60) end,
            'error', v_err)));
        end if;
      end loop;
      if jsonb_array_length(v_crons) > 0 then
        perform public.fallo_interno_registrar('cron_caido', jsonb_build_object('crons', v_crons));
        v_hechos := array_append(v_hechos, 'cron');
      end if;
    end if;
  end if;

  return case when array_length(v_hechos, 1) is null then 'nada' else array_to_string(v_hechos, ',') end;
end;
$function$;

-- [20261209400000_telegram_avisos_utiles.sql]
revoke all on function public.vigilante_fallos_telegram() from public, anon, authenticated;

-- [20261209400000_telegram_avisos_utiles.sql]
grant execute on function public.vigilante_fallos_telegram() to service_role;

-- [20261209600000_telegram_avisos_revision.sql] public.fallos_internos_desde()
-- ─── 1. Solo lo posterior a la activación ───────────────────────────────────
create or replace function public.fallos_internos_desde()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(c.activo_desde, now()), now() - interval '3 days')
    from public.avisos_telegram_config c where c.id;
$$;

-- [20261209600000_telegram_avisos_revision.sql]
revoke all on function public.fallos_internos_desde() from public, anon, authenticated;

-- [20261209600000_telegram_avisos_revision.sql]
grant execute on function public.fallos_internos_desde() to service_role;

-- [20261209600000_telegram_avisos_revision.sql]
revoke all on function public.fallos_internos_reclamar(integer) from public, anon, authenticated;

-- [20261209600000_telegram_avisos_revision.sql]
grant execute on function public.fallos_internos_reclamar(integer) to service_role;

-- [20261209600000_telegram_avisos_revision.sql]
revoke all on function public.avisos_telegram_disparar(text) from public, anon, authenticated;

-- [20261209600000_telegram_avisos_revision.sql]
grant execute on function public.avisos_telegram_disparar(text) to service_role;

-- [20261209600000_telegram_avisos_revision.sql]
revoke all on function public.fallos_internos_agrupar() from public, anon, authenticated;

-- ============================================================================
--  Linear para Tickets (Super Admin › Tickets › «Enviar a Linear»)
-- ----------------------------------------------------------------------------
--  En el panel original esta configuración vivía en la tabla de «Logs web»
--  (web_logs_config). Aquí solo se conservan las columnas de Linear que lee la
--  Edge Function analizar-peticion. La clave LINEAR_API_KEY vive en los
--  secretos de la función, nunca aquí. Modo por defecto «prueba»: lo que se
--  mandaría a Linear se guarda en web_linear_prueba sin tocar el Linear real.
-- ============================================================================
create table if not exists public.web_logs_config (
  id boolean primary key default true check (id),
  linear_modo        text not null default 'prueba' check (linear_modo in ('desactivado', 'prueba', 'real')),
  linear_equipo_id   text check (linear_equipo_id is null or linear_equipo_id ~ '^[A-Za-z0-9-]{1,64}$'),
  linear_proyecto_id text check (linear_proyecto_id is null or linear_proyecto_id ~ '^[A-Za-z0-9-]{1,64}$'),
  linear_etiquetas   text[] not null default array[]::text[] check (cardinality(linear_etiquetas) <= 10),
  actualizado_en     timestamptz not null default now(),
  actualizado_por    uuid
);
comment on table public.web_logs_config is
  'Configuración de Linear para los tickets (fila única). Solo super admin la lee y la cambia.';
insert into public.web_logs_config (id) values (true) on conflict (id) do nothing;
alter table public.web_logs_config enable row level security;
revoke all on public.web_logs_config from anon, authenticated;
grant select, update on public.web_logs_config to authenticated;
grant all on public.web_logs_config to service_role;
drop policy if exists web_logs_config_superadmin_select on public.web_logs_config;
create policy web_logs_config_superadmin_select on public.web_logs_config
  for select to authenticated using ((select public.is_super_admin((select auth.uid()))));
drop policy if exists web_logs_config_superadmin_update on public.web_logs_config;
create policy web_logs_config_superadmin_update on public.web_logs_config
  for update to authenticated using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

create table if not exists public.web_linear_prueba (
  id            bigint generated always as identity primary key,
  creado_en     timestamptz not null default now(),
  incidencia_id bigint,
  operacion     text not null check (operacion in ('crear', 'comentar', 'reabrir', 'consultar')),
  linear_uuid   uuid,
  titulo        text,
  cuerpo        text check (length(cuerpo) <= 60000),
  prioridad     smallint,
  etiquetas     text[] not null default array[]::text[]
);
comment on table public.web_linear_prueba is
  'Destino de pruebas de Linear (linear_modo = prueba): lo que se mandaría a Linear, tal cual, para verificar el flujo sin tocar el Linear real.';
alter table public.web_linear_prueba enable row level security;
revoke all on public.web_linear_prueba from anon, authenticated;
grant select on public.web_linear_prueba to authenticated;
grant all on public.web_linear_prueba to service_role;
drop policy if exists web_linear_prueba_superadmin_select on public.web_linear_prueba;
create policy web_linear_prueba_superadmin_select on public.web_linear_prueba
  for select to authenticated using ((select public.is_super_admin((select auth.uid()))));

-- ============================================================================
--  Ajustes del núcleo respecto al panel original
-- ============================================================================
-- Tope mensual del gasto de IA (€): en el panel original vivía en configuracion_facturas.
alter table public.servicios_config
  add column if not exists tope_ia_mes_eur numeric(8,2) not null default 5
  check (tope_ia_mes_eur >= 0.01 and tope_ia_mes_eur <= 10000);
comment on column public.servicios_config.tope_ia_mes_eur is
  'Tope mensual del gasto de IA en euros (Super Admin › Servicios › Costes). Lo cambia fijar_tope_ia_mes.';
insert into public.servicios_config (id) values (true) on conflict (id) do nothing;

-- Telegram: fuera lo de reservas y el resumen semanal (vinos, tienda, facturas, albaranes).
alter table public.avisos_telegram_config
  drop column if exists reservas_al_momento,
  drop column if exists semanal_activo,
  drop column if exists semanal_dia,
  drop column if exists semanal_hora,
  drop column if exists semanal_ultimo_dia,
  drop column if exists resumen_revision;
alter table public.avisos_telegram_config alter column tipos_al_momento set default array['peticion_urgente']::text[];
update public.avisos_telegram_config
   set tipos_al_momento = array['peticion_urgente']::text[]
 where id;

-- ============================================================================
--  Tareas programadas (pg_cron). Necesitan en Vault «project_url» (URL del
--  proyecto) y «ocr_trabajos_secret» (el mismo valor que el secreto
--  OCR_TRABAJOS_SECRET de las Edge Functions). Sin ellos, no llaman a nada.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j
     where j.jobname in ('avisos-telegram-pendientes', 'avisos-telegram-resumen', 'avisos-telegram-fallos',
                         'avisos-telegram-vigilante', 'ia-modelos-openai', 'sincronizar-costes-openai');
    perform cron.schedule('avisos-telegram-pendientes', '*/5 * * * *', $cron$ select public.avisos_telegram_disparar('pendientes'); $cron$);
    perform cron.schedule('avisos-telegram-resumen', '0 * * * *', $cron$ select public.avisos_telegram_disparar('resumen'); $cron$);
    perform cron.schedule('avisos-telegram-fallos', '*/5 * * * *', $cron$ select public.avisos_telegram_disparar('fallos'); $cron$);
    perform cron.schedule('avisos-telegram-vigilante', '*/15 * * * *', $cron$ select public.vigilante_fallos_telegram(); $cron$);
    perform cron.schedule('ia-modelos-openai', '15 6 * * *', $cron$ select public.ia_modelos_disparar(); $cron$);
    perform cron.schedule('sincronizar-costes-openai', '7 */6 * * *', $cron$ select public.openai_despachar_sincronizacion_costes(); $cron$);
  else
    raise notice 'Sin pg_cron: las tareas programadas NO se han instalado.';
  end if;
end;
$$;

-- ============================================================================
--  Datos de partida: solo lo del núcleo
-- ============================================================================
-- Funciones de IA que existen en este panel (el resto eran del negocio).
delete from public.ia_modelo_funcion where funcion not in ('analizar-peticion', 'ia-modelos-openai');
delete from public.ia_coste_estimado where funcion not in ('analizar-peticion', 'ia-modelos-openai');
delete from public.ia_funciones where funcion not in ('analizar-peticion', 'ia-modelos-openai');
-- Interruptores de Control del Panel: solo los módulos que hay (sin fila = activado).
delete from public.admin_feature_toggles where section_key not in (
  'dashboard', 'usuarios', 'peticiones', 'ayuda', 'avisos', 'mi_cuenta');
-- Costes fijos: se meten desde Super Admin › Servicios › Costes (los de partida eran del negocio).
delete from public.costes_fijos;
-- Servicios contratados: los proveedores de siempre, con la cuenta por configurar.
update public.servicios_contratados
   set cuenta = 'Por configurar',
       por_confirmar = true,
       panel_url = case proveedor
         when 'vercel' then 'https://vercel.com/dashboard'
         when 'supabase' then 'https://supabase.com/dashboard/projects'
         else panel_url end
 where proveedor in ('github', 'resend', 'stripe', 'supabase', 'vercel');
update public.servicios_contratados set cuenta = 'Por configurar · correos del panel' where proveedor = 'resend';

-- ============================================================================
--  Datos de partida (2): precios de IA y avisos
-- ============================================================================
-- Pseudo-modelos que solo usaban funciones del restaurante.
delete from public.ia_precios where modelo in ('openai-web-search-call', 'replicate:men1scus/birefnet', 'sonar', 'vercel:recortar-foto');
-- Notas de los modelos: sin las funciones que ya no existen.
update public.ia_precios set notas = null
 where notas ~* '(chat-facturas|procesar-factura|extraer-vino|format-novedad|traducir-contenido|chat-web|recortar|dibujo)';
-- Origen de los avisos: en el original solo lo ponían las funciones de reservas; aquí, libre (o nada).
alter table public.notificaciones_dashboard drop constraint if exists notificaciones_dashboard_origen_valido;
alter table public.notificaciones_dashboard
  add constraint notificaciones_dashboard_origen_valido check (origen is null or char_length(origen) between 1 and 60);
comment on column public.notificaciones_dashboard.origen is
  'Qué proceso generó el aviso (texto libre corto). NULL en los avisos que crea la base de datos.';

-- ============================================================================
--  Auditoría en todas las tablas del panel [20261007220000_audit_log_panel_completo.sql]
-- ----------------------------------------------------------------------------
--  La instalación incluye las tablas actuales (y auth.users y storage.objects);
--  las tablas nuevas reciben el trigger solas (event trigger). Se excluyen los
--  logs derivados y las copias.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.instalar_auditoria_panel()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS esquema,c.relname AS tabla FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname = 'public'
      AND c.relname NOT IN ('audit_log','audit_auth_context','ia_uso','metricas')
      AND c.relname !~ '(respaldo|descartadas|depurados|^zz_|_backup|^backup_)'
    UNION ALL SELECT 'auth','users'
    UNION ALL SELECT 'storage','objects' WHERE to_regclass('storage.objects') IS NOT NULL
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(format('%I.%I',r.esquema,r.tabla))
      AND t.tgfoid = 'public.fn_registrar_auditoria()'::regprocedure AND NOT t.tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_auditoria()',r.esquema,r.tabla);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.instalar_auditoria_panel() FROM PUBLIC,anon,authenticated,service_role;

-- Datos derivados: sin trigger de auditoría.
SELECT public.instalar_auditoria_panel();
DROP TRIGGER IF EXISTS trg_auditoria ON public.openai_uso_diario;
DROP TRIGGER IF EXISTS trg_auditoria ON public.openai_costes_diarios;

CREATE OR REPLACE FUNCTION public.fn_audit_nueva_tabla()
RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS esquema,c.relname AS tabla FROM pg_event_trigger_ddl_commands() d
    JOIN pg_class c ON c.oid = d.objid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE d.object_type IN ('table','partitioned table') AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND n.nspname = 'public'
      AND c.relname NOT IN ('audit_log','audit_auth_context','ia_uso','metricas')
      AND c.relname !~ '(respaldo|descartadas|depurados|^zz_|_backup|^backup_)'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I.%I',r.esquema,r.tabla);
    EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_auditoria()',r.esquema,r.tabla);
  END LOOP;
END;
$$;
DROP EVENT TRIGGER IF EXISTS audit_panel_nuevas_tablas;
CREATE EVENT TRIGGER audit_panel_nuevas_tablas ON ddl_command_end
WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
EXECUTE FUNCTION public.fn_audit_nueva_tabla();
