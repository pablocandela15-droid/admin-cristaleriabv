-- ============================================================================
--  Panel de Cristalería BV · Logs web y comportamiento de los visitantes (24/11/2026)
-- ----------------------------------------------------------------------------
--  Super Admin › Logs (/super-admin/logs) y la sección «Comportamiento» de
--  Tráfico web. Portado del panel de referencia (20261118100000_logs_web,
--  20261118100100_logs_web_operaciones_bd, 20261118100200_logs_web_cron,
--  20261129143000_logs_web_legibles y 20261130100000_logs_web_origen, en su
--  estado final y en una sola migración), sin nada de restaurante: los embudos
--  y conversiones son los de la web de la cristalería (calculadora y solicitud
--  de presupuesto, contacto, WhatsApp y teléfono, trabajos y servicios).
--
--  Flujo:
--    navegador (cristaleriabv, src/lib/actividad) --lotes text/plain cada 5 s
--    o al ocultar la página (sendBeacon)--> Edge Function registrar-actividad-web
--    (origen permitido, saneado, bots, HMAC de la IP) --> web_logs_ingerir()
--    --> web_eventos + web_sesiones (+ contadores).
--    Funciones del servidor (envoltorio audit-client: los 5xx), recolectores
--    (pg_cron fallido, Tráfico web, despliegues de Vercel) y la base de datos
--    (disparador en presupuestos de origen web) escriben por el mismo camino.
--    pg_cron cada 5 min → logs_web_disparar() (Vault: project_url +
--    ocr_trabajos_secret) → Edge Function procesar-logs-web: agrupa errores en
--    incidencias (web_logs_agrupar_errores), umbrales, tickets en Linear (o en
--    el destino de pruebas web_linear_prueba si no hay LINEAR_API_KEY o el modo
--    es «prueba»), explicación con IA y purga diaria.
--
--  La web NO usa cookies ni guarda nada en el navegador: el id de sesión vive
--  en memoria de la pestaña (navegar por la web sin recargar es la misma
--  sesión) y no hay identificador de visitante. «consentimiento» = el
--  navegador deja medir (sin «No rastrear» ni Global Privacy Control): sin eso
--  solo se reciben errores, sin sesión. Ni IP (solo un HMAC con sal diaria para
--  el límite por minuto, borrado a la hora), ni lo escrito en formularios, ni
--  medidas o datos del cliente.
--
--  Ya existían en el núcleo web_logs_config (solo las columnas de Linear que
--  usa Tickets) y web_linear_prueba: aquí se completan, no se duplican.
--
--  Permisos: todo lo de Logs, solo super admin (RLS). La sección «trafico_web»
--  puede además leer las estadísticas AGREGADAS (web_comportamiento,
--  web_logs_entorno y los resúmenes de IA), que enseña Tráfico web.
--
--  Vuelta atrás: supabase/rollbacks/20261124120000_logs_web_ROLLBACK.sql.
--  Pruebas: scripts/test-trafico-logs-web.mjs (dentro de npm run test:nucleo:db).
-- ============================================================================

set check_function_bodies = off;

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null or to_regclass('public.web_logs_config') is null then
    raise exception 'logs_web: falta el núcleo del panel (20261118120000_nucleo_panel.sql). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 0. Auditoría: las tablas de datos derivados, fuera ─────────────────────
-- Igual que ia_uso: se añaden a la lista de exclusión de instalar_auditoria_panel() y del disparador de eventos que
-- pone la auditoría a cada tabla nueva (así ni ahora ni en una reinstalación reciben el trigger). La configuración
-- (web_logs_config) y los pesos de Tráfico web sí se auditan.
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''ia_uso'',' in v_def) > 0 and position('''web_eventos''' in v_def) = 0 then
      execute replace(v_def, '''ia_uso'',',
        '''ia_uso'',''web_eventos'',''web_sesiones'',''web_incidencias'',''web_logs_estado'',''web_logs_ingesta_diaria'',''web_logs_limite_ip'',''web_linear_prueba'',''web_resumenes_ia'',''web_eventos_catalogo'',''trafico_web_diario'',''trafico_web_desglose'',''trafico_web_sync_estado'',');
    end if;
  end loop;
end;
$$;

-- ─── 1. Configuración (fila única del núcleo, ahora completa) ───────────────
alter table public.web_logs_config
  add column if not exists recoger_actividad          boolean not null default true,
  add column if not exists recoger_errores_navegador  boolean not null default true,
  add column if not exists recoger_peticiones         boolean not null default true,
  add column if not exists recoger_errores_servidor   boolean not null default true,
  add column if not exists recoger_integraciones      boolean not null default true,
  add column if not exists recoger_hosting            boolean not null default true,
  add column if not exists entornos_aceptados         text[]  not null default array['produccion', 'demo'],
  add column if not exists entornos_ticket            text[]  not null default array['produccion'],
  add column if not exists rutas_excluidas            text[]  not null default array[]::text[],
  add column if not exists mensajes_ignorados         text[]  not null default array[
    'ResizeObserver loop', 'Script error.', 'chrome-extension://', 'moz-extension://', 'safari-extension://',
    'Non-Error promise rejection captured', 'AbortError'],
  add column if not exists umbral_ocurrencias         integer not null default 3,
  add column if not exists umbral_sesiones            integer not null default 2,
  add column if not exists umbral_ventana_horas       integer not null default 24,
  add column if not exists tickets_404                boolean not null default false,
  add column if not exists umbral_404_diario          integer not null default 20,
  add column if not exists excluir_pruebas_tickets    boolean not null default true,
  add column if not exists reapertura                 text    not null default 'reabrir',
  add column if not exists retencion_actividad_dias   integer not null default 90,
  add column if not exists retencion_errores_dias     integer not null default 180,
  add column if not exists limite_eventos_dia         integer not null default 50000,
  add column if not exists limite_eventos_sesion      integer not null default 400,
  add column if not exists limite_eventos_ip_minuto   integer not null default 300,
  add column if not exists linear_estado_reabrir_id   text,
  add column if not exists linear_max_tickets_dia     integer not null default 10,
  add column if not exists linear_tickets_externos    boolean not null default false,
  add column if not exists ia_activada                boolean not null default true,
  add column if not exists ia_max_analisis_dia        integer not null default 20,
  add column if not exists entorno_bd                 text    not null default 'produccion';

alter table public.web_logs_config drop constraint if exists web_logs_config_logs_chk;
alter table public.web_logs_config add constraint web_logs_config_logs_chk check (
  umbral_ocurrencias between 1 and 100000 and umbral_sesiones between 1 and 100000 and umbral_ventana_horas between 1 and 720
  and umbral_404_diario between 1 and 100000 and reapertura in ('reabrir', 'nuevo_ticket', 'ignorar')
  and retencion_actividad_dias between 7 and 400 and retencion_errores_dias between 7 and 730
  and limite_eventos_dia between 100 and 2000000 and limite_eventos_sesion between 20 and 5000
  and limite_eventos_ip_minuto between 10 and 10000
  and (linear_estado_reabrir_id is null or linear_estado_reabrir_id ~ '^[A-Za-z0-9-]{1,64}$')
  and linear_max_tickets_dia between 0 and 500 and ia_max_analisis_dia between 0 and 500
  and entorno_bd in ('produccion', 'demo', 'local')
  and entornos_aceptados <@ array['produccion', 'demo', 'local'] and entornos_ticket <@ array['produccion', 'demo', 'local']
  and cardinality(rutas_excluidas) <= 50 and cardinality(mensajes_ignorados) <= 100);
comment on table public.web_logs_config is
  'Super Admin › Logs › Configuración (fila única): fuentes, entornos, exclusiones, umbrales de ticket, retención, '
  'límites de coste, Linear (también lo usa Tickets) e IA. Las claves (LINEAR_API_KEY, OpenAI) son secretos de las '
  'Edge Functions, nunca de aquí.';
comment on column public.web_logs_config.entorno_bd is
  'Entorno de ESTA base de datos (para los eventos que nacen en ella y lo que enseña el panel). Se pone solo: demo si '
  'el project_url de Vault no es el de producción. Se puede corregir a mano.';

insert into public.web_logs_config (id) values (true) on conflict (id) do nothing;
-- La demo es otro proyecto de Supabase: se reconoce porque su project_url (Vault) no es el de producción.
do $$
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$
      update public.web_logs_config set entorno_bd = 'demo'
       where id and entorno_bd = 'produccion'
         and exists (select 1 from vault.decrypted_secrets
                      where name = 'project_url' and coalesce(decrypted_secret, '') <> ''
                        and decrypted_secret not like '%gorekooabfhqudeshtgq%')
    $q$;
  end if;
end;
$$;

create or replace function public.web_logs_config_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;
revoke all on function public.web_logs_config_al_editar() from public, anon, authenticated;
drop trigger if exists web_logs_config_al_editar on public.web_logs_config;
create trigger web_logs_config_al_editar before update on public.web_logs_config
  for each row execute function public.web_logs_config_al_editar();

-- El super admin cambia lo de la pantalla; entorno_bd y las marcas de edición, no (las pone la base).
revoke update on public.web_logs_config from authenticated;
grant update (recoger_actividad, recoger_errores_navegador, recoger_peticiones, recoger_errores_servidor, recoger_integraciones,
              recoger_hosting, entornos_aceptados, entornos_ticket, rutas_excluidas, mensajes_ignorados, umbral_ocurrencias,
              umbral_sesiones, umbral_ventana_horas, tickets_404, umbral_404_diario, excluir_pruebas_tickets, reapertura,
              retencion_actividad_dias, retencion_errores_dias, limite_eventos_dia, limite_eventos_sesion, limite_eventos_ip_minuto,
              linear_modo, linear_equipo_id, linear_proyecto_id, linear_etiquetas, linear_estado_reabrir_id, linear_max_tickets_dia,
              linear_tickets_externos, ia_activada, ia_max_analisis_dia)
  on public.web_logs_config to authenticated;

-- ─── 2. Catálogo: qué se observa ────────────────────────────────────────────
create table if not exists public.web_eventos_catalogo (
  tipo                    text primary key check (tipo ~ '^[a-z0-9_]{2,40}$'),
  categoria               text not null check (categoria in ('actividad', 'operacion', 'tecnico', 'error')),
  fuente                  text not null check (fuente in ('navegador', 'servidor', 'base_datos', 'hosting', 'integracion')),
  operacion               text check (operacion in ('presupuesto', 'contacto')),
  etapa_embudo            smallint check (etapa_embudo between 1 and 4),
  requiere_consentimiento boolean not null default true,
  descripcion             text not null,
  orden                   smallint not null default 100
);
comment on table public.web_eventos_catalogo is
  'Tipos de evento y qué significan (Super Admin › Logs › Cobertura). etapa_embudo: 1 entrada, 2 consulta, 3 inicio, '
  '4 operación completada. requiere_consentimiento = solo si el navegador deja medir (sin «No rastrear» ni GPC). El '
  '«desde cuándo» es el primer evento recibido de cada tipo: no hay históricos anteriores.';

delete from public.web_eventos_catalogo;
insert into public.web_eventos_catalogo (tipo, categoria, fuente, operacion, etapa_embudo, requiere_consentimiento, descripcion, orden) values
  ('pagina_vista',           'actividad', 'navegador', null,          1,    true,  'Página vista (entrada, procedencia y orden de navegación). También al navegar por la web sin recargar.', 10),
  ('pagina_salida',          'actividad', 'navegador', null,          null, true,  'Fin de una página: tiempo con la página visible (ms) y hasta dónde bajó. «Última página observada», no una salida confirmada.', 11),
  ('scroll',                 'actividad', 'navegador', null,          null, true,  'Hito de scroll (25, 50, 75 o 100 % de la página).', 12),
  ('clic',                   'actividad', 'navegador', null,          null, true,  'Clic en un botón, enlace o llamada a la acción (texto visible o data-track; nunca lo escrito en un campo).', 20),
  ('contacto',               'actividad', 'navegador', 'contacto',    null, true,  'Clic en teléfono, WhatsApp, correo, mapa o red social. Es un clic: no confirma que la llamada o el mensaje se hicieran.', 21),
  ('calculadora',            'actividad', 'navegador', 'presupuesto', 2,    true,  'Calculadora: elegir servicio, avanzar de paso, precio calculado (con el importe orientativo, IVA incluido) o volver a empezar. Nunca medidas ni datos del cliente.', 30),
  ('media',                  'actividad', 'navegador', null,          null, true,  'Fotos de los trabajos: abrir un book o una foto, pasar a la siguiente o cerrar.', 40),
  ('formulario',             'actividad', 'navegador', null,          3,    true,  'Formulario (solicitud de presupuesto, contacto o visita técnica): inicio, avance (n.º de campos, nunca lo escrito), envío, error de validación y abandono estimado.', 50),
  ('chat',                   'actividad', 'navegador', null,          null, true,  'Asistente de la web: abrir, enviar mensaje (sin el texto), respuesta o error.', 51),
  ('presupuesto_solicitado', 'operacion', 'navegador', 'presupuesto', 4,    true,  'El servidor guardó la solicitud de presupuesto de la calculadora (respondió con su número). Llega a Presupuestos › Solicitudes.', 60),
  ('presupuesto_rechazado',  'operacion', 'navegador', 'presupuesto', null, true,  'El servidor no aceptó la solicitud de presupuesto (datos no válidos o demasiadas seguidas). Sin datos del cliente.', 61),
  ('contacto_enviado',       'operacion', 'navegador', 'contacto',    4,    true,  'Formulario de contacto o de visita técnica enviado: abre WhatsApp con el mensaje ya escrito (no se sabe si el cliente llegó a mandarlo).', 62),
  ('carga_pagina',           'tecnico',   'navegador', null,          null, true,  'Tiempos de carga de la página (TTFB, DOM listo, carga, LCP).', 80),
  ('peticion',               'tecnico',   'navegador', null,          null, true,  'Petición del navegador a una función del servidor: endpoint, código HTTP y duración (sin cuerpo).', 81),
  ('error_js',               'error',     'navegador', null,          null, false, 'Excepción de JavaScript no capturada (mensaje y pila saneados).', 90),
  ('error_promesa',          'error',     'navegador', null,          null, false, 'Promesa rechazada sin capturar.', 91),
  ('error_recurso',          'error',     'navegador', null,          null, false, 'Imagen, script o estilo que no cargó.', 92),
  ('error_peticion',         'error',     'navegador', null,          null, false, 'Petición a una función del servidor con 5xx o sin respuesta. La de «Solicitar presupuesto» es crítica.', 93),
  ('error_react',            'error',     'navegador', null,          null, false, 'Error de pintado capturado por un límite de errores de React.', 94),
  ('error_404',              'error',     'navegador', null,          null, false, 'Página no encontrada (404). No abre ticket salvo que se active en Configuración y pase su umbral.', 95),
  ('error_servidor',         'error',     'servidor',  null,          null, false, 'Edge Function que respondió 5xx o lanzó una excepción (sin cuerpo de la petición).', 100),
  ('error_integracion',      'error',     'integracion', null,        null, false, 'Integración o tarea programada con fallo (pg_cron, sincronización de Tráfico web).', 101),
  ('error_despliegue',       'error',     'hosting',   null,          null, false, 'Despliegue de Vercel de la web en estado ERROR.', 102),
  ('presupuesto_solicitado_bd', 'operacion', 'base_datos', 'presupuesto', null, false, 'Solicitud de presupuesto de la web guardada en la base de datos (todos los visitantes, midan o no).', 110),
  ('presupuesto_aceptado_bd',   'operacion', 'base_datos', 'presupuesto', null, false, 'Un presupuesto que llegó de la web pasa a «aceptado» en el panel.', 111);

-- ─── 3. Incidencias agrupadas ───────────────────────────────────────────────
create table if not exists public.web_incidencias (
  id                   bigint generated always as identity primary key,
  entorno              text not null check (entorno in ('produccion', 'demo', 'local')),
  huella               text not null check (huella ~ '^[a-f0-9]{16,64}$'),
  titulo               text not null check (length(titulo) between 1 and 200),
  tipo                 text not null check (tipo ~ '^[a-z0-9_]{2,40}$'),
  fuente               text not null,
  proyecto             text not null,
  gravedad             text not null default 'error' check (gravedad in ('info', 'aviso', 'error', 'critico')),
  estado               text not null default 'nueva' check (estado in ('nueva', 'abierta', 'resuelta', 'reabierta', 'ignorada')),
  primera_vez          timestamptz not null,
  ultima_vez           timestamptz not null,
  ocurrencias          integer not null default 0,
  sesiones_afectadas   integer not null default 0,
  ocurrencias_ventana  integer not null default 0,
  sesiones_ventana     integer not null default 0,
  ocurrencias_24h      integer not null default 0,
  ocurrencias_tras_publicar integer not null default 0,
  repetidas_tras_recargar   integer not null default 0,
  rutas                jsonb not null default '[]'::jsonb check (jsonb_typeof(rutas) = 'array'),
  version_primera      text,
  version_ultima       text,
  despliegue_ultimo    text,
  mensaje              text check (length(mensaje) <= 500),
  pila                 text check (length(pila) <= 4000),
  ejemplo_evento_id    bigint,
  -- Origen: fallo de la web, servicio externo o no depende de la web (reglas fijas, sin IA).
  origen               text not null default 'web',
  origen_proveedor     text,
  origen_prioridad     smallint generated always as (case origen when 'web' then 1 when 'externo' then 2 else 3 end) stored,
  -- Ticket
  requiere_ticket      boolean not null default false,
  motivo_ticket        text,
  linear_estado        text not null default 'sin_ticket' check (linear_estado in ('sin_ticket', 'pendiente', 'creado', 'error', 'no_aplica')),
  linear_uuid          uuid not null default gen_random_uuid(),
  linear_issue_id      text,
  linear_identificador text,
  linear_url           text,
  linear_estado_remoto text,
  linear_destino       text check (linear_destino in ('prueba', 'real')),
  linear_intentos      integer not null default 0,
  linear_ultimo_error  text check (length(linear_ultimo_error) <= 500),
  linear_proximo_intento timestamptz,
  linear_bloqueo_hasta timestamptz,
  linear_ultima_sync   timestamptz,
  linear_creado_en     timestamptz,
  linear_pendiente_reapertura boolean not null default false,
  ocurrencias_en_ticket integer not null default 0,
  -- IA (hechos e hipótesis separados) y explicación en sencillo (una vez por incidencia)
  analisis_ia          jsonb,
  analisis_ia_en       timestamptz,
  analisis_ia_error    text check (length(analisis_ia_error) <= 500),
  explicacion_ia       jsonb,
  explicacion_ia_en    timestamptz,
  explicacion_ia_error text,
  explicacion_ia_intentos smallint not null default 0,
  -- Seguimiento
  resuelta_en          timestamptz,
  reabierta_veces      integer not null default 0,
  nota                 text check (length(nota) <= 2000),
  actualizado_en       timestamptz not null default now(),
  constraint web_incidencias_entorno_huella_key unique (entorno, huella),
  constraint web_incidencias_origen_chk check (origen in ('web', 'externo', 'conexion', 'navegador', 'version_antigua', 'bots')
                                               and (origen_proveedor is null or length(origen_proveedor) <= 120)),
  constraint web_incidencias_explicacion_ia_chk check (
    (explicacion_ia is null or (jsonb_typeof(explicacion_ia) = 'object' and length(explicacion_ia::text) <= 4000))
    and (explicacion_ia_error is null or length(explicacion_ia_error) <= 500))
);
comment on table public.web_incidencias is
  'Errores agrupados por huella estable (una por entorno + huella). La crea y recalcula web_logs_agrupar_errores(); '
  'el ticket lo crea procesar-logs-web con linear_uuid como id determinista (sin duplicados aunque se reintente). Un '
  'super admin puede cambiar estado y nota.';
comment on column public.web_incidencias.origen is
  'Fallo de la web (web), servicio externo (externo) o no depende de la web (conexion, navegador, version_antigua, '
  'bots). Solo web (y externo si linear_tickets_externos) abre tickets.';
create index if not exists web_incidencias_ultima_idx on public.web_incidencias (entorno, ultima_vez desc);
create index if not exists web_incidencias_origen_idx on public.web_incidencias (entorno, origen_prioridad, ultima_vez desc);
create index if not exists web_incidencias_linear_idx on public.web_incidencias (linear_estado, linear_proximo_intento)
  where linear_estado in ('pendiente', 'error', 'creado');

-- ─── 4. Eventos ─────────────────────────────────────────────────────────────
create table if not exists public.web_eventos (
  id             bigint generated always as identity primary key,
  evento_id      uuid not null,
  recibido_en    timestamptz not null default now(),
  ocurrido_en    timestamptz not null,
  entorno        text not null check (entorno in ('produccion', 'demo', 'local')),
  proyecto       text not null check (proyecto ~ '^[a-z0-9-]{2,40}$'),
  fuente         text not null check (fuente in ('navegador', 'servidor', 'base_datos', 'hosting', 'integracion')),
  categoria      text not null check (categoria in ('actividad', 'operacion', 'tecnico', 'error')),
  tipo           text not null check (tipo ~ '^[a-z0-9_]{2,40}$'),
  accion         text check (accion ~ '^[a-z0-9_]{1,40}$'),
  sesion_id      uuid,
  visitante_id   uuid,
  secuencia      integer check (secuencia >= 0),
  ruta           text check (length(ruta) <= 300),
  objetivo       text check (length(objetivo) <= 200),
  valor          numeric,
  propiedades    jsonb not null default '{}'::jsonb check (jsonb_typeof(propiedades) = 'object' and length(propiedades::text) <= 4000),
  dispositivo    text check (dispositivo in ('movil', 'tablet', 'escritorio', 'desconocido')),
  navegador      text check (length(navegador) <= 40),
  so             text check (length(so) <= 40),
  es_bot         boolean not null default false,
  es_interno     boolean not null default false,
  es_prueba      boolean not null default false,
  consentimiento boolean not null default false,
  version        text check (length(version) <= 40),
  despliegue     text check (length(despliegue) <= 80),
  gravedad       text check (gravedad in ('info', 'aviso', 'error', 'critico')),
  huella         text check (huella ~ '^[a-f0-9]{16,64}$'),
  mensaje        text check (length(mensaje) <= 500),
  pila           text check (length(pila) <= 4000),
  tras_publicar  text check (tras_publicar is null or tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion', 'repetido')),
  origen         text check (origen is null or origen in ('web', 'externo', 'conexion', 'navegador', 'version_antigua')),
  incidencia_id  bigint references public.web_incidencias (id) on delete set null,
  constraint web_eventos_evento_id_key unique (evento_id),
  constraint web_eventos_error_huella_chk check (categoria <> 'error' or huella is not null)
);
comment on table public.web_eventos is
  'Eventos de la web y sus servicios. evento_id lo genera el emisor: reenvíos y reintentos no duplican. ocurrido_en = '
  'hora del emisor acotada a [recepción − 2 días, recepción + 5 min]. Sin IP ni lo escrito en formularios. '
  'tras_publicar y origen: solo errores (ver web_logs_agrupar_errores).';
create index if not exists web_eventos_ocurrido_idx on public.web_eventos (entorno, ocurrido_en desc);
create index if not exists web_eventos_sesion_idx on public.web_eventos (sesion_id, ocurrido_en, secuencia) where sesion_id is not null;
create index if not exists web_eventos_tipo_idx on public.web_eventos (tipo, ocurrido_en desc);
create index if not exists web_eventos_incidencia_idx on public.web_eventos (incidencia_id, ocurrido_en desc) where incidencia_id is not null;
create index if not exists web_eventos_sin_agrupar_idx on public.web_eventos (id) where categoria = 'error' and incidencia_id is null;
create index if not exists web_eventos_recibido_idx on public.web_eventos (fuente, recibido_en desc);

-- ─── 5. Sesiones (resumen exacto, recalculado desde web_eventos) ────────────
create table if not exists public.web_sesiones (
  sesion_id        uuid primary key,
  visitante_id     uuid,
  entorno          text not null,
  proyecto         text not null,
  inicio           timestamptz not null,
  ultima_actividad timestamptz not null,
  pagina_entrada   text,
  ultima_pagina    text,
  origen_tipo      text check (origen_tipo in ('buscador', 'campana', 'qr', 'red_social', 'enlace', 'directo', 'interno', 'desconocido')),
  origen_detalle   text check (length(origen_detalle) <= 200),
  campana          text check (length(campana) <= 200),
  idioma           text check (idioma in ('es', 'en', 'fr')),
  dispositivo      text,
  navegador        text,
  so               text,
  paginas_vistas   integer not null default 0,
  eventos          integer not null default 0,
  errores          integer not null default 0,
  errores_web      integer,
  errores_externos integer,
  scroll_max       smallint,
  tiempo_activo_ms bigint not null default 0,
  inicio_operacion boolean not null default false,
  conversiones     integer not null default 0,
  es_bot           boolean not null default false,
  es_interno       boolean not null default false,
  es_prueba        boolean not null default false,
  consentimiento   boolean not null default false,
  actualizado_en   timestamptz not null default now()
);
comment on table public.web_sesiones is
  'Una fila por sesión (id en memoria de la pestaña: sin cookies; 30 min de inactividad abren otra). Se recalcula '
  'entera desde web_eventos en cada lote, con un advisory lock por sesión. ultima_pagina es la última OBSERVADA.';
create index if not exists web_sesiones_inicio_idx on public.web_sesiones (entorno, inicio desc);
create index if not exists web_sesiones_visitante_idx on public.web_sesiones (visitante_id) where visitante_id is not null;

-- ─── 6. Estado, contadores, límite por IP, destino de pruebas y resúmenes ───
create table if not exists public.web_logs_estado (
  id                      boolean primary key default true check (id),
  ultimo_proceso_inicio   timestamptz,
  ultimo_proceso_fin      timestamptz,
  ultimo_proceso_ok       timestamptz,
  ultimo_error            text check (length(ultimo_error) <= 1000),
  ultimo_resumen          jsonb not null default '{}'::jsonb,
  cursores                jsonb not null default '{}'::jsonb,
  proceso_bloqueado_hasta timestamptz,
  ultima_purga            timestamptz
);
insert into public.web_logs_estado (id) values (true) on conflict (id) do nothing;

create table if not exists public.web_logs_ingesta_diaria (
  dia         date not null,
  entorno     text not null,
  aceptados   integer not null default 0,
  duplicados  integer not null default 0,
  descartados integer not null default 0,
  rechazados  integer not null default 0,
  bots        integer not null default 0,
  lotes       integer not null default 0,
  primary key (dia, entorno)
);
comment on table public.web_logs_ingesta_diaria is
  'Contadores de la ingesta por día (Madrid) y entorno: aceptados, duplicados (reenvíos), descartados (límites o '
  'filtros), rechazados (inválidos u origen no permitido) y bots. Para «la recogida se ha parado» y vigilar el coste.';

create table if not exists public.web_logs_limite_ip (
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{16,64}$'),
  minuto  timestamptz not null,
  n       integer not null default 0,
  primary key (ip_hash, minuto)
);
comment on table public.web_logs_limite_ip is 'HMAC (sal diaria) de la IP y eventos por minuto. Se borra pasada una hora. Nunca la IP.';

-- web_linear_prueba ya existe (núcleo, la usa Tickets): las filas de una incidencia se van con ella.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'web_linear_prueba_incidencia_fk') then
    -- Antes de esta migración no había incidencias: lo que tuviera un número (no debería) no apunta a nada.
    update public.web_linear_prueba p set incidencia_id = null
     where p.incidencia_id is not null and not exists (select 1 from public.web_incidencias i where i.id = p.incidencia_id);
    alter table public.web_linear_prueba
      add constraint web_linear_prueba_incidencia_fk foreign key (incidencia_id) references public.web_incidencias (id) on delete cascade;
  end if;
end;
$$;

create table if not exists public.web_resumenes_ia (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  creado_por  uuid,
  desde       date not null,
  hasta       date not null,
  entorno     text not null,
  cifras      jsonb not null,
  resumen     jsonb,
  modelo      text,
  estado      text not null check (estado in ('ok', 'error')),
  error       text check (length(error) <= 500),
  check (hasta >= desde)
);
create index if not exists web_resumenes_ia_periodo_idx on public.web_resumenes_ia (entorno, desde, hasta, creado_en desc);

-- Datos derivados: sin trigger de auditoría (por si el disparador de eventos se lo puso antes de la lista).
drop trigger if exists trg_auditoria on public.web_eventos;
drop trigger if exists trg_auditoria on public.web_sesiones;
drop trigger if exists trg_auditoria on public.web_incidencias;
drop trigger if exists trg_auditoria on public.web_logs_estado;
drop trigger if exists trg_auditoria on public.web_logs_ingesta_diaria;
drop trigger if exists trg_auditoria on public.web_logs_limite_ip;
drop trigger if exists trg_auditoria on public.web_linear_prueba;
drop trigger if exists trg_auditoria on public.web_resumenes_ia;
drop trigger if exists trg_auditoria on public.web_eventos_catalogo;

-- ─── 7. RLS: lee el super admin; escribe el servidor ────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['web_eventos_catalogo', 'web_incidencias', 'web_eventos', 'web_sesiones', 'web_logs_estado',
                           'web_logs_ingesta_diaria', 'web_logs_limite_ip', 'web_resumenes_ia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if t <> 'web_logs_limite_ip' then
      execute format('grant select on public.%I to authenticated', t);
      execute format('drop policy if exists %I on public.%I', t || '_select_super_admin', t);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.is_super_admin((select auth.uid()))))',
                     t || '_select_super_admin', t);
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end if;
  end loop;
end;
$$;
-- Los resúmenes de IA (cifras agregadas) los ve también quien ve Tráfico web.
drop policy if exists web_resumenes_ia_select_trafico on public.web_resumenes_ia;
create policy web_resumenes_ia_select_trafico on public.web_resumenes_ia for select to authenticated
  using ((select public.can_read_section('trafico_web')));
-- La configuración y el destino de pruebas (del núcleo) también con la barrera de sesión.
do $$
declare
  t text;
begin
  foreach t in array array['web_logs_config', 'web_linear_prueba'] loop
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
  end loop;
end;
$$;

grant update (estado, nota) on public.web_incidencias to authenticated;
drop policy if exists web_incidencias_update_super_admin on public.web_incidencias;
create policy web_incidencias_update_super_admin on public.web_incidencias for update to authenticated
  using ((select public.is_super_admin((select auth.uid())))) with check ((select public.is_super_admin((select auth.uid()))));

-- Cambiar el estado a mano deja un rastro coherente (resuelta_en, actualizado_en).
create or replace function public.web_incidencias_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'resuelta' then
      new.resuelta_en := now();
    elsif old.estado = 'resuelta' and new.estado in ('abierta', 'reabierta') then
      new.resuelta_en := null;
    end if;
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function public.web_incidencias_al_editar() from public, anon, authenticated;
drop trigger if exists web_incidencias_al_editar on public.web_incidencias;
create trigger web_incidencias_al_editar before update on public.web_incidencias
  for each row execute function public.web_incidencias_al_editar();

-- ¿Puede ver las estadísticas agregadas? (super admin o «Ver» en Tráfico web, con la sesión del panel permitida).
create or replace function public.web_logs_puede_ver_estadisticas()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or ((select private.sesion_panel_permitida())
          and (coalesce(public.is_super_admin(auth.uid()), false) or public.has_section_permission(auth.uid(), 'trafico_web', 'view')))
$$;
revoke all on function public.web_logs_puede_ver_estadisticas() from public, anon;
grant execute on function public.web_logs_puede_ver_estadisticas() to authenticated, service_role;

-- Entorno de esta base de datos (lo que enseña Tráfico web › Comportamiento sin leer la configuración entera).
create or replace function public.web_logs_entorno()
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  v text;
begin
  if not public.web_logs_puede_ver_estadisticas() then
    raise exception 'Sin permiso para ver las estadísticas de la web' using errcode = '42501';
  end if;
  select entorno_bd into v from public.web_logs_config where id;
  return coalesce(v, 'produccion');
end;
$$;
revoke all on function public.web_logs_entorno() from public, anon;
grant execute on function public.web_logs_entorno() to authenticated, service_role;

-- ─── 8. Ingesta (solo service role) ─────────────────────────────────────────
-- p_eventos: array de eventos YA validados y saneados por la Edge Function. p_ctx: { entorno, ip_hash? }.
create or replace function public.web_logs_ingerir(p_eventos jsonb, p_ctx jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_ahora timestamptz := now();
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_entorno text := p_ctx ->> 'entorno';
  v_ip text := p_ctx ->> 'ip_hash';
  v_total integer;
  v_validos integer := 0;
  v_aceptados integer := 0;
  v_bots integer := 0;
  v_n_ip integer;
  v_hoy_aceptados bigint;
  v_cupo integer;
  v_sesiones uuid[];
  v_sid uuid;
begin
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then
    raise exception 'web_logs_ingerir: p_eventos debe ser un array' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_eventos);
  if v_total = 0 then
    return jsonb_build_object('aceptados', 0, 'duplicados', 0, 'descartados', 0);
  end if;
  if v_total > 200 then
    raise exception 'web_logs_ingerir: como mucho 200 eventos por lote' using errcode = '22023';
  end if;

  select * into c from public.web_logs_config where id;
  if not found then
    insert into public.web_logs_config (id) values (true) on conflict do nothing;
    select * into c from public.web_logs_config where id;
  end if;

  if v_entorno is null or not (v_entorno = any (c.entornos_aceptados)) then
    if v_entorno in ('produccion', 'demo', 'local') then
      insert into public.web_logs_ingesta_diaria as d (dia, entorno, rechazados, lotes) values (v_hoy, v_entorno, v_total, 1)
      on conflict (dia, entorno) do update set rechazados = d.rechazados + excluded.rechazados, lotes = d.lotes + 1;
    end if;
    return jsonb_build_object('aceptados', 0, 'duplicados', 0, 'descartados', v_total, 'motivo', 'entorno_no_aceptado');
  end if;

  -- Límite por IP (HMAC) y minuto: atómico por insert … on conflict.
  if v_ip is not null and v_ip ~ '^[a-f0-9]{16,64}$' then
    insert into public.web_logs_limite_ip as l (ip_hash, minuto, n) values (v_ip, date_trunc('minute', v_ahora), v_total)
    on conflict (ip_hash, minuto) do update set n = l.n + excluded.n
    returning n into v_n_ip;
    if v_n_ip > c.limite_eventos_ip_minuto then
      insert into public.web_logs_ingesta_diaria as d (dia, entorno, descartados, lotes) values (v_hoy, v_entorno, v_total, 1)
      on conflict (dia, entorno) do update set descartados = d.descartados + excluded.descartados, lotes = d.lotes + 1;
      return jsonb_build_object('aceptados', 0, 'duplicados', 0, 'descartados', v_total, 'motivo', 'limite_ip');
    end if;
    delete from public.web_logs_limite_ip where minuto < v_ahora - interval '1 hour';
  end if;

  -- Cupo diario global (coste): lo que no cabe se descarta (los errores, los últimos en descartarse).
  select coalesce(sum(aceptados), 0) into v_hoy_aceptados from public.web_logs_ingesta_diaria where dia = v_hoy;
  v_cupo := greatest(c.limite_eventos_dia - v_hoy_aceptados, 0)::integer;

  -- Un advisory lock por sesión (en orden: sin interbloqueos): dos lotes a la vez de la misma sesión se ven.
  for v_sid in
    select distinct (e ->> 'sesion_id')::uuid from jsonb_array_elements(p_eventos) e
     where e ->> 'sesion_id' ~ '^[0-9a-fA-F-]{36}$' order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('web_sesion:' || v_sid::text, 0));
  end loop;

  create temporary table if not exists web_lote on commit drop as
    select evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id, visitante_id, secuencia, ruta,
           objetivo, valor, propiedades, dispositivo, navegador, so, es_bot, es_interno, es_prueba, consentimiento, version,
           despliegue, gravedad, huella, mensaje, pila
      from public.web_eventos limit 0;
  truncate pg_temp.web_lote;

  insert into pg_temp.web_lote (evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id, visitante_id,
                                secuencia, ruta, objetivo, valor, propiedades, dispositivo, navegador, so, es_bot, es_interno,
                                es_prueba, consentimiento, version, despliegue, gravedad, huella, mensaje, pila)
  select e.evento_id,
         least(greatest(coalesce(e.ocurrido_en, v_ahora), v_ahora - interval '2 days'), v_ahora + interval '5 minutes'),
         v_entorno, coalesce(e.proyecto, 'cristaleriabv'), e.fuente, e.categoria, e.tipo, e.accion,
         e.sesion_id, case when coalesce(e.consentimiento, false) then e.visitante_id end,
         e.secuencia, left(e.ruta, 300), left(e.objetivo, 200), e.valor, coalesce(e.propiedades, '{}'::jsonb),
         e.dispositivo, left(e.navegador, 40), left(e.so, 40), coalesce(e.es_bot, false), coalesce(e.es_interno, false),
         coalesce(e.es_prueba, false), coalesce(e.consentimiento, false), left(e.version, 40), left(e.despliegue, 80),
         e.gravedad, e.huella, left(e.mensaje, 500), left(e.pila, 4000)
    from jsonb_to_recordset(p_eventos) as e(
           evento_id uuid, ocurrido_en timestamptz, proyecto text, fuente text, categoria text, tipo text, accion text,
           sesion_id uuid, visitante_id uuid, secuencia integer, ruta text, objetivo text, valor numeric, propiedades jsonb,
           dispositivo text, navegador text, so text, es_bot boolean, es_interno boolean, es_prueba boolean,
           consentimiento boolean, version text, despliegue text, gravedad text, huella text, mensaje text, pila text)
   where e.evento_id is not null
     and e.tipo ~ '^[a-z0-9_]{2,40}$'
     and e.categoria in ('actividad', 'operacion', 'tecnico', 'error')
     and e.fuente in ('navegador', 'servidor', 'base_datos', 'hosting', 'integracion')
     and (e.accion is null or e.accion ~ '^[a-z0-9_]{1,40}$')
     and (e.categoria <> 'error' or e.huella ~ '^[a-f0-9]{16,64}$')
     and (e.propiedades is null or (jsonb_typeof(e.propiedades) = 'object' and length(e.propiedades::text) <= 4000))
     and (e.dispositivo is null or e.dispositivo in ('movil', 'tablet', 'escritorio', 'desconocido'))
     and (e.gravedad is null or e.gravedad in ('info', 'aviso', 'error', 'critico'))
     and (e.proyecto is null or e.proyecto ~ '^[a-z0-9-]{2,40}$')
     and (e.secuencia is null or e.secuencia >= 0);
  get diagnostics v_validos = row_count;

  -- Fuentes desactivadas y rutas excluidas.
  delete from pg_temp.web_lote l
   where (l.fuente = 'navegador' and l.categoria in ('actividad', 'operacion') and not c.recoger_actividad)
      or (l.fuente = 'navegador' and l.categoria = 'tecnico' and not c.recoger_peticiones)
      or (l.fuente = 'navegador' and l.categoria = 'error' and not c.recoger_errores_navegador)
      or (l.fuente = 'servidor' and not c.recoger_errores_servidor)
      or (l.fuente = 'integracion' and not c.recoger_integraciones)
      or (l.fuente = 'hosting' and not c.recoger_hosting)
      or (l.ruta is not null and exists (select 1 from unnest(c.rutas_excluidas) r where r <> '' and l.ruta like r || '%'));

  -- Tope por sesión (los errores no cuentan) y cupo diario.
  delete from pg_temp.web_lote l
   using (
     select x.evento_id, row_number() over (partition by x.sesion_id order by x.secuencia nulls last, x.ocurrido_en) as rn,
            coalesce(s.eventos, 0) as previos
       from pg_temp.web_lote x
       left join public.web_sesiones s on s.sesion_id = x.sesion_id
      where x.sesion_id is not null and x.categoria <> 'error'
   ) n
   where n.evento_id = l.evento_id and n.previos + n.rn > c.limite_eventos_sesion;

  delete from pg_temp.web_lote l
   using (select x.evento_id, row_number() over (order by (x.categoria = 'error') desc, x.ocurrido_en) as rn from pg_temp.web_lote x) n
   where n.evento_id = l.evento_id and n.rn > v_cupo;

  with ins as (
    insert into public.web_eventos (evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id,
                                    visitante_id, secuencia, ruta, objetivo, valor, propiedades, dispositivo, navegador, so,
                                    es_bot, es_interno, es_prueba, consentimiento, version, despliegue, gravedad, huella,
                                    mensaje, pila)
    select evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id, visitante_id, secuencia,
           ruta, objetivo, valor, propiedades, dispositivo, navegador, so, es_bot, es_interno, es_prueba, consentimiento,
           version, despliegue, gravedad, huella, mensaje, pila
      from pg_temp.web_lote
    on conflict (evento_id) do nothing
    returning sesion_id, es_bot
  )
  select count(*), count(*) filter (where es_bot), array_agg(distinct sesion_id) filter (where sesion_id is not null)
    into v_aceptados, v_bots, v_sesiones
    from ins;

  if v_sesiones is not null then
    perform public.web_logs_recalcular_sesiones(v_sesiones);
  end if;

  insert into public.web_logs_ingesta_diaria as d (dia, entorno, aceptados, duplicados, descartados, rechazados, bots, lotes)
  values (v_hoy, v_entorno, v_aceptados,
          greatest((select count(*) from pg_temp.web_lote) - v_aceptados, 0),
          greatest(v_validos - (select count(*) from pg_temp.web_lote), 0),
          v_total - v_validos, v_bots, 1)
  on conflict (dia, entorno) do update set
    aceptados = d.aceptados + excluded.aceptados, duplicados = d.duplicados + excluded.duplicados,
    descartados = d.descartados + excluded.descartados, rechazados = d.rechazados + excluded.rechazados,
    bots = d.bots + excluded.bots, lotes = d.lotes + 1;

  return jsonb_build_object(
    'aceptados', v_aceptados,
    'duplicados', greatest((select count(*) from pg_temp.web_lote) - v_aceptados, 0),
    'descartados', greatest(v_validos - (select count(*) from pg_temp.web_lote), 0),
    'rechazados', v_total - v_validos);
end;
$$;
revoke all on function public.web_logs_ingerir(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.web_logs_ingerir(jsonb, jsonb) to service_role;

-- Recalcula el resumen de las sesiones dadas DESDE sus eventos (exacto). Conversiones = operaciones completadas
-- (solicitud de presupuesto guardada o formulario de contacto/visita enviado); inicio de operación = precio calculado
-- en la calculadora o un formulario empezado.
create or replace function public.web_logs_recalcular_sesiones(p_sesiones uuid[])
returns void language sql security definer set search_path = ''
as $$
  insert into public.web_sesiones as s (
    sesion_id, visitante_id, entorno, proyecto, inicio, ultima_actividad, pagina_entrada, ultima_pagina, origen_tipo,
    origen_detalle, campana, idioma, dispositivo, navegador, so, paginas_vistas, eventos, errores, scroll_max,
    tiempo_activo_ms, inicio_operacion, conversiones, es_bot, es_interno, es_prueba, consentimiento, actualizado_en)
  select e.sesion_id,
         (array_agg(e.visitante_id order by e.ocurrido_en, e.secuencia) filter (where e.visitante_id is not null))[1],
         (array_agg(e.entorno order by e.ocurrido_en, e.secuencia))[1], (array_agg(e.proyecto order by e.ocurrido_en, e.secuencia))[1],
         min(e.ocurrido_en), max(e.ocurrido_en),
         (array_agg(e.ruta order by e.ocurrido_en, e.secuencia) filter (where e.tipo = 'pagina_vista'))[1],
         (array_agg(e.ruta order by e.ocurrido_en desc, e.secuencia desc) filter (where e.tipo = 'pagina_vista'))[1],
         (array_agg(e.propiedades ->> 'origen_tipo' order by e.ocurrido_en, e.secuencia)
            filter (where e.propiedades ->> 'origen_tipo' in ('buscador', 'campana', 'qr', 'red_social', 'enlace', 'directo', 'interno', 'desconocido')))[1],
         left((array_agg(e.propiedades ->> 'origen_detalle' order by e.ocurrido_en, e.secuencia) filter (where e.propiedades ? 'origen_detalle'))[1], 200),
         left((array_agg(e.propiedades ->> 'campana' order by e.ocurrido_en, e.secuencia) filter (where e.propiedades ? 'campana'))[1], 200),
         (array_agg(e.propiedades ->> 'idioma' order by e.ocurrido_en, e.secuencia) filter (where e.propiedades ->> 'idioma' in ('es', 'en', 'fr')))[1],
         (array_agg(e.dispositivo order by e.ocurrido_en, e.secuencia) filter (where e.dispositivo is not null))[1],
         (array_agg(e.navegador order by e.ocurrido_en, e.secuencia) filter (where e.navegador is not null))[1],
         (array_agg(e.so order by e.ocurrido_en, e.secuencia) filter (where e.so is not null))[1],
         count(*) filter (where e.tipo = 'pagina_vista'),
         count(*),
         count(*) filter (where e.categoria = 'error'),
         least(max(case when e.tipo = 'pagina_salida' and e.propiedades ->> 'scroll_max' ~ '^\d{1,3}$'
                        then (e.propiedades ->> 'scroll_max')::integer end), 100)::smallint,
         coalesce(sum(case when e.tipo = 'pagina_salida' and e.valor between 0 and 3600000 then e.valor end), 0)::bigint,
         coalesce(bool_or((e.tipo = 'calculadora' and e.accion = 'calculado')
                          or (e.tipo = 'formulario' and e.accion = 'inicio' and e.objetivo in ('presupuesto', 'contacto', 'visita'))), false),
         count(*) filter (where e.categoria = 'operacion' and e.tipo in ('presupuesto_solicitado', 'contacto_enviado')),
         -- Bot solo si TODOS sus eventos lo son: un envío suelto con otro User-Agent no tumba la sesión de una persona.
         bool_and(e.es_bot), bool_or(e.es_interno), bool_or(e.es_prueba), bool_or(e.consentimiento), now()
    from public.web_eventos e
   where e.sesion_id = any (p_sesiones)
   group by e.sesion_id
  -- Solo sesiones medibles: sin permiso para medir, el navegador manda un id solo para relacionar sus errores.
  having bool_or(e.consentimiento)
  on conflict (sesion_id) do update set
    visitante_id = excluded.visitante_id, entorno = excluded.entorno, proyecto = excluded.proyecto, inicio = excluded.inicio,
    ultima_actividad = excluded.ultima_actividad, pagina_entrada = excluded.pagina_entrada, ultima_pagina = excluded.ultima_pagina,
    origen_tipo = excluded.origen_tipo, origen_detalle = excluded.origen_detalle, campana = excluded.campana,
    idioma = excluded.idioma, dispositivo = excluded.dispositivo, navegador = excluded.navegador, so = excluded.so,
    paginas_vistas = excluded.paginas_vistas, eventos = excluded.eventos, errores = excluded.errores,
    scroll_max = excluded.scroll_max, tiempo_activo_ms = excluded.tiempo_activo_ms,
    inicio_operacion = excluded.inicio_operacion, conversiones = excluded.conversiones, es_bot = excluded.es_bot,
    es_interno = excluded.es_interno, es_prueba = excluded.es_prueba, consentimiento = excluded.consentimiento,
    actualizado_en = excluded.actualizado_en;
$$;
revoke all on function public.web_logs_recalcular_sesiones(uuid[]) from public, anon, authenticated;
grant execute on function public.web_logs_recalcular_sesiones(uuid[]) to service_role;

-- ─── 9. Versión antigua tras publicar y origen de cada error ────────────────
-- ¿Es un error de «versión antigua tras publicar»? (quien tenía la web abierta pide ficheros que ya no existen). Mismo
-- patrón que PATRON_CHUNK_CADUCADO (supabase/functions/_shared/logs-web/huella.ts): si cambia uno, cambia el otro (lo
-- comprueba scripts/test-trafico-logs-web.mjs). Next.js: ChunkLoadError y /_next/static/… que no carga.
create or replace function public.web_logs_es_version_antigua(p_tipo text, p_mensaje text, p_pila text, p_objetivo text)
returns boolean language sql immutable set search_path = ''
as $$
  select case
    when p_tipo in ('error_js', 'error_promesa', 'error_react') then
      (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
        ~* 'failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|chunkloaderror|loading (css )?chunk \S+ failed|failed to load chunk|''text/html'' is not a valid javascript mime type'
    when p_tipo = 'error_recurso' then
      coalesce(p_objetivo, '') ~ '(/assets/[^/?#]+-[A-Za-z0-9_-]{8}|/_next/static/[^?#]+)\.(m?js|css)($|[?#])'
    else false
  end;
$$;
revoke all on function public.web_logs_es_version_antigua(text, text, text, text) from public, anon;
grant execute on function public.web_logs_es_version_antigua(text, text, text, text) to authenticated, service_role;

-- Clasifica las ocurrencias desde p_desde (web_eventos.tras_publicar). Devuelve las incidencias con algún cambio.
create or replace function public.web_logs_clasificar_tras_publicar(p_desde timestamptz)
returns bigint[] language plpgsql security definer set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  with cand as (
    select e.id, e.sesion_id, e.ocurrido_en, e.propiedades, e.incidencia_id, e.accion
      from public.web_eventos e
     where e.categoria = 'error' and not e.es_bot and e.ocurrido_en >= p_desde
       and e.tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso')
       and (e.accion in ('recuperado_tras_recarga', 'recarga_sin_efecto', 'aviso_version_nueva', 'sin_version_nueva', 'sin_conexion')
            or public.web_logs_es_version_antigua(e.tipo, e.mensaje, e.pila, e.objetivo))
  ), nueva as (
    select c.id,
           case
             when c.accion = 'recuperado_tras_recarga' then 'sin_impacto'
             when c.accion in ('recarga_sin_efecto', 'aviso_version_nueva') then 'repetido'
             when c.accion = 'sin_conexion' then 'sin_conexion'
             when c.accion = 'sin_version_nueva' then null
             when coalesce(c.propiedades ->> 'recargado', '') = 'true' then 'sin_impacto'
             when c.sesion_id is not null and exists (
               select 1 from public.web_eventos y
                where y.sesion_id = c.sesion_id and y.id <> c.id and y.categoria = 'error' and not y.es_bot
                  and y.ocurrido_en < c.ocurrido_en
                  and public.web_logs_es_version_antigua(y.tipo, y.mensaje, y.pila, y.objetivo)
                  and (coalesce(y.propiedades ->> 'recargado', '') = 'true'
                       or exists (select 1 from public.web_eventos p
                                   where p.sesion_id = c.sesion_id and p.tipo = 'pagina_vista' and not p.es_bot
                                     and p.propiedades ->> 'navegacion' = 'inicial'
                                     and p.ocurrido_en > y.ocurrido_en and p.ocurrido_en < c.ocurrido_en))) then 'repetido'
             when c.sesion_id is not null and exists (
               select 1 from public.web_eventos x
                where x.sesion_id = c.sesion_id and x.categoria <> 'error' and not x.es_bot and x.ocurrido_en > c.ocurrido_en) then 'sin_impacto'
             else 'sin_datos'
           end as clase
      from cand c
  ), cambiadas as (
    update public.web_eventos e set tras_publicar = n.clase
      from nueva n
     where e.id = n.id and e.tras_publicar is distinct from n.clase
    returning e.incidencia_id
  )
  select array_agg(distinct incidencia_id) filter (where incidencia_id is not null) into v_ids from cambiadas;
  return coalesce(v_ids, array[]::bigint[]);
end;
$$;
revoke all on function public.web_logs_clasificar_tras_publicar(timestamptz) from public, anon, authenticated;
grant execute on function public.web_logs_clasificar_tras_publicar(timestamptz) to service_role;

-- Servicio de fuera que falla, o null (espejo de supabase/functions/_shared/logs-web/origen.ts; los mismos casos de
-- __tests__/logs-web-origen-casos.json pasan por los dos). Lo propio: la web, el panel, localhost y Supabase.
create or replace function public.web_logs_proveedor_externo(p_tipo text, p_fuente text, p_mensaje text, p_pila text, p_objetivo text)
returns text language sql immutable set search_path = ''
as $$
  with t as (
    select coalesce(p_fuente, 'navegador') = 'navegador' as nav,
           case when coalesce(p_fuente, 'navegador') = 'navegador'
                then coalesce(p_objetivo, '') || E'\n' || coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, '')
                when p_objetivo is not null and left(coalesce(p_mensaje, ''), length(p_objetivo) + 2) = p_objetivo || ': '
                then substr(p_mensaje, length(p_objetivo) + 3)
                else coalesce(p_mensaje, '')
           end as texto,
           regexp_replace(lower(substring(coalesce(p_objetivo, '') from '^[Hh][Tt][Tt][Pp][Ss]?://([^/:?#]+)')), '^www\.', '') as host
  )
  select case
    when not t.nav and t.texto ~* 'job startup timeout|could not start background process|out of background worker slots|too many (clients|connections)|remaining connection slots are reserved|the database system is (starting up|shutting down|in recovery mode)' then 'Supabase'
    when t.texto ~* 'maps\.googleapis\.com|maps\.gstatic\.com|google maps|google\.maps|maps\.google\.' then 'Google Maps'
    when t.texto ~* 'openstreetmap\.org|tile\.osm|nominatim|router\.project-osrm\.org|osrm' then 'OpenStreetMap'
    when t.texto ~* 'instagram\.com|cdninstagram\.com|graph\.facebook\.com|fbcdn\.net|connect\.facebook\.net' then 'Instagram / Meta'
    when t.texto ~* 'openai|chatgpt' then 'OpenAI'
    when t.texto ~* 'google drive|drive token|googleapis\.com/(upload/)?drive' then 'Google Drive'
    when t.texto ~* 'api\.resend\.com|resend (api|respondió|devolvió|no respond)' then 'Resend'
    when t.texto ~* 'api\.vercel\.com|vercel [0-9]{3}|vercel (api|no respond)' then 'Vercel'
    when t.texto ~* 'api\.telegram\.org|telegram (api|respondió|devolvió|no respond)' then 'Telegram'
    when t.texto ~* 'api\.linear\.app|linear (api|no respond)' then 'Linear'
    when t.texto ~* 'fonts\.googleapis\.com|fonts\.gstatic\.com' then 'Google Fonts'
    when t.texto ~* 'youtube\.com|ytimg\.com|youtube-nocookie\.com' then 'YouTube'
    when t.texto ~* 'wa\.me|api\.whatsapp\.com|web\.whatsapp\.com' then 'WhatsApp'
    when t.nav and p_tipo = 'error_recurso' and t.host is not null and t.host <> ''
         and t.host !~ '(^|\.)(cristaleriabaixvinalopo\.es|cristaleriabv[a-z0-9-]*\.vercel\.app|admin-cristaleriabv[a-z0-9-]*\.vercel\.app|localhost|127\.0\.0\.1|[a-z]{20}\.supabase\.co)$'
      then left(t.host, 120)
    else null
  end
  from t;
$$;
revoke all on function public.web_logs_proveedor_externo(text, text, text, text, text) from public, anon;
grant execute on function public.web_logs_proveedor_externo(text, text, text, text, text) to authenticated, service_role;

-- Origen técnico de UNA ocurrencia (sin bots: esos se miran por sus indicadores).
create or replace function public.web_logs_origen_error(p_tipo text, p_fuente text, p_mensaje text, p_pila text, p_objetivo text,
                                                         p_propiedades jsonb, p_accion text, p_tras_publicar text)
returns text language sql immutable set search_path = ''
as $$
  select case
    when p_tras_publicar = 'repetido' then 'web'
    when p_tras_publicar = 'sin_conexion' then 'conexion'
    when p_tras_publicar in ('sin_impacto', 'sin_datos') then 'version_antigua'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso')
         and p_accion in ('recarga_sin_efecto', 'aviso_version_nueva', 'sin_version_nueva') then 'web'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso') and p_accion = 'sin_conexion' then 'conexion'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso') and p_accion = 'recuperado_tras_recarga' then 'version_antigua'
    when public.web_logs_es_version_antigua(p_tipo, p_mensaje, p_pila, p_objetivo) then 'version_antigua'
    when p_tipo = 'error_despliegue' then 'web'
    when coalesce(p_fuente, 'navegador') <> 'navegador'
         and (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
             ~* 'falta_secreto|falta (el |la )?(secreto|clave|configur|firma)|not_configured|no_configurado|no está configurad|missing (secret|api key|env)|dns error|failed to lookup address|enotfound|name or service not known'
      then 'web'
    when coalesce(p_fuente, 'navegador') = 'navegador'
         and ((coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, '') || E'\n' || coalesce(p_objetivo, ''))
                ~* '(chrome|moz|safari|safari-web|ms-browser|edge)-extension://|webkit-masked-url://'
              or (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
                ~* 'resizeobserver loop|_autofillcallbackhandler|instantsearchsdkjsbridge|__gcrweb|weixinjsbridge|webkit\.messagehandlers|java object is gone|zalojsv2|getreadmode(config|render|extract)|symbrowser_|cefsharp|non-error promise rejection captured|can.t find variable: (gmo|zalo|_autofill)'
              or btrim(coalesce(p_mensaje, ''), E' \t\n\r') ~* '^(uncaught )?script error\.?$'
              or (p_tipo = 'error_recurso' and coalesce(p_objetivo, '')
                ~* 'googletagmanager\.com|google-analytics\.com|doubleclick\.net|googlesyndication\.com|clarity\.ms|hotjar\.com|cloudflareinsights\.com|fbevents\.js|/_vercel/(insights|speed-insights)|vercel-insights\.com'))
      then 'navegador'
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo = 'error_peticion'
         and (coalesce(p_propiedades ->> 'status', '') = '0' or coalesce(p_mensaje, '') ~* '^sin respuesta')
      then 'conexion'
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo in ('error_js', 'error_promesa', 'error_react')
         and coalesce(p_mensaje, '') ~* 'failed to fetch|load failed|networkerror when attempting to fetch resource|network ?error|network request failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network_changed|err_connection_(reset|closed|refused|timed_out|aborted)|aborterror|user aborted a request|operation was aborted|signal is aborted|fetch is aborted|request aborted|failed to send a request to the edge function|authretryablefetcherror|^(typeerror: )?(cancelled|canceled|cancelado)$'
      then 'conexion'
    when public.web_logs_proveedor_externo(p_tipo, p_fuente, p_mensaje, p_pila, p_objetivo) is not null then 'externo'
    else 'web'
  end;
$$;
revoke all on function public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) to authenticated, service_role;

-- ─── 10. Agrupación de errores en incidencias (solo service role) ───────────
-- Un proceso a la vez (advisory lock) + UNIQUE (entorno, huella): sin incidencias duplicadas aunque coincidan el cron y
-- «Procesar ahora». Recalcula las cifras de cada incidencia tocada desde TODOS sus eventos, clasifica «tras publicar» y
-- el origen, aplica la reapertura y los umbrales. Solo los fallos de la web (y los externos con el interruptor) cuentan
-- para los umbrales y abren o reabren tickets; las pedidas a mano, siempre.
create or replace function public.web_logs_agrupar_errores(p_limite integer default 5000)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_ids bigint[];
  v_afectadas bigint[];
  v_nuevas integer := 0;
  v_reabiertas integer := 0;
  v_pendientes integer := 0;
  v_reclasificadas bigint[];
begin
  if not pg_try_advisory_xact_lock(hashtext('web_logs_agrupar_errores')) then
    return jsonb_build_object('ocupado', true);
  end if;
  select * into c from public.web_logs_config where id;

  select array_agg(id order by id) into v_ids
    from (select id from public.web_eventos
           where categoria = 'error' and incidencia_id is null and huella is not null
           order by id limit greatest(p_limite, 1)) t;

  if v_ids is not null then
    with nuevas as (
      insert into public.web_incidencias (entorno, huella, titulo, tipo, fuente, proyecto, gravedad, primera_vez, ultima_vez,
                                          mensaje, pila, ejemplo_evento_id)
      select distinct on (e.entorno, e.huella)
             e.entorno, e.huella,
             left(coalesce(nullif(e.mensaje, ''), e.tipo) || coalesce(' · ' || nullif(e.objetivo, ''), ''), 200),
             e.tipo, e.fuente, e.proyecto, coalesce(e.gravedad, 'error'), e.ocurrido_en, e.ocurrido_en, e.mensaje, e.pila, e.id
        from public.web_eventos e
       where e.id = any (v_ids)
       order by e.entorno, e.huella, e.id
      on conflict (entorno, huella) do nothing
      returning 1
    )
    select count(*) into v_nuevas from nuevas;

    update public.web_eventos e
       set incidencia_id = i.id
      from public.web_incidencias i
     where e.id = any (v_ids) and i.entorno = e.entorno and i.huella = e.huella;

    select array_agg(distinct incidencia_id) into v_afectadas from public.web_eventos where id = any (v_ids);
  end if;

  -- Ficheros de una versión anterior (tras publicar): se clasifican con lo que pasó después en la misma sesión.
  v_reclasificadas := public.web_logs_clasificar_tras_publicar(now() - interval '2 days');

  -- Origen de cada ocurrencia nueva o reclasificada.
  update public.web_eventos e
     set origen = public.web_logs_origen_error(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo, e.propiedades, e.accion, e.tras_publicar)
   where e.categoria = 'error'
     and (e.id = any (coalesce(v_ids, array[]::bigint[])) or e.incidencia_id = any (v_reclasificadas))
     and e.origen is distinct from public.web_logs_origen_error(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo, e.propiedades, e.accion, e.tras_publicar);

  -- Errores de la web y externos de cada sesión tocada.
  with ses as (
    select distinct e.sesion_id from public.web_eventos e
     where e.sesion_id is not null and e.categoria = 'error'
       and (e.id = any (coalesce(v_ids, array[]::bigint[])) or e.incidencia_id = any (v_reclasificadas))
  ), cuenta as (
    select e.sesion_id, count(*) filter (where e.origen = 'web') as w, count(*) filter (where e.origen = 'externo') as x
      from public.web_eventos e
     where e.sesion_id in (select sesion_id from ses) and e.categoria = 'error'
     group by e.sesion_id
  )
  update public.web_sesiones s
     set errores_web = cuenta.w, errores_externos = cuenta.x
    from cuenta
   where s.sesion_id = cuenta.sesion_id
     and (s.errores_web, s.errores_externos) is distinct from (cuenta.w::integer, cuenta.x::integer);

  -- También las que tienen ocurrencias que salen de las ventanas (cifras al día).
  select array_agg(distinct x) into v_afectadas
    from (select unnest(coalesce(v_afectadas, array[]::bigint[])) as x
          union select unnest(v_reclasificadas)
          union select id from public.web_incidencias where ocurrencias_ventana > 0 or ocurrencias_24h > 0) t;

  if v_afectadas is null then
    return jsonb_build_object('agrupados', 0, 'nuevas', 0, 'reabiertas', 0, 'pendientes_linear', 0);
  end if;

  with st as (
    select e.incidencia_id as id,
           min(e.ocurrido_en) as primera,
           max(e.ocurrido_en) as ultima,
           count(*) filter (where not e.es_bot) as n,
           count(distinct e.sesion_id) filter (where not e.es_bot) as ses,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and (e.origen = 'web' or (e.origen = 'externo' and c.linear_tickets_externos))
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and (e.origen = 'web' or (e.origen = 'externo' and c.linear_tickets_externos))
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana,
           count(*) filter (where not e.es_bot and e.tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion')) as n_tras_publicar,
           count(*) filter (where not e.es_bot and e.tras_publicar = 'repetido') as n_repetidas,
           count(*) filter (where not e.es_bot and e.ocurrido_en > now() - interval '24 hours') as n24,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'web') as o_web,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'externo') as o_ext,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'conexion') as o_con,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'navegador') as o_nav,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno)) and e.origen = 'version_antigua') as o_ver,
           mode() within group (order by public.web_logs_proveedor_externo(e.tipo, e.fuente, e.mensaje, e.pila, e.objetivo))
             filter (where not e.es_bot and e.origen = 'externo') as prov,
           max(case e.gravedad when 'critico' then 4 when 'error' then 3 when 'aviso' then 2 else 1 end) as grav,
           (array_agg(e.version order by e.ocurrido_en) filter (where e.version is not null))[1] as vprim,
           (array_agg(e.version order by e.ocurrido_en desc) filter (where e.version is not null))[1] as vult,
           (array_agg(e.despliegue order by e.ocurrido_en desc) filter (where e.despliegue is not null))[1] as dult
      from public.web_eventos e
     where e.incidencia_id = any (v_afectadas)
     group by e.incidencia_id
  ), st2 as (
    select st.*,
           case
             when st.o_web > 0 then 'web'
             when st.o_ext > 0 then 'externo'
             when st.o_con + st.o_nav + st.o_ver = 0 then 'bots'
             when st.o_nav >= st.o_con and st.o_nav >= st.o_ver then 'navegador'
             when st.o_con >= st.o_ver then 'conexion'
             else 'version_antigua'
           end as origen
      from st
  ), rutas as (
    select r.incidencia_id as id, jsonb_agg(jsonb_build_object('ruta', r.ruta, 'n', r.n) order by r.n desc) as rutas
      from (select e.incidencia_id, coalesce(e.ruta, '(sin ruta)') as ruta, count(*) as n,
                   row_number() over (partition by e.incidencia_id order by count(*) desc) as rk
              from public.web_eventos e
             where e.incidencia_id = any (v_afectadas) and not e.es_bot
             group by e.incidencia_id, coalesce(e.ruta, '(sin ruta)')) r
     where r.rk <= 5
     group by r.incidencia_id
  )
  update public.web_incidencias i
     set primera_vez = st2.primera,
         ultima_vez = st2.ultima,
         ocurrencias = st2.n,
         sesiones_afectadas = st2.ses,
         ocurrencias_ventana = st2.n_ventana,
         sesiones_ventana = st2.ses_ventana,
         ocurrencias_24h = st2.n24,
         gravedad = case st2.grav when 4 then 'critico' when 3 then 'error' when 2 then 'aviso' else 'info' end,
         rutas = coalesce(rutas.rutas, '[]'::jsonb),
         version_primera = st2.vprim,
         version_ultima = st2.vult,
         despliegue_ultimo = st2.dult,
         ocurrencias_tras_publicar = st2.n_tras_publicar,
         repetidas_tras_recargar = st2.n_repetidas,
         origen = st2.origen,
         origen_proveedor = case when st2.origen = 'externo' then left(st2.prov, 120) end,
         actualizado_en = now()
    from st2 left join rutas on rutas.id = st2.id
   where i.id = st2.id
     and (i.ultima_vez, i.ocurrencias, i.ocurrencias_ventana, i.sesiones_ventana, i.ocurrencias_24h, i.sesiones_afectadas, i.rutas,
          i.ocurrencias_tras_publicar, i.repetidas_tras_recargar, i.origen, i.origen_proveedor)
         is distinct from (st2.ultima, st2.n::integer, st2.n_ventana::integer, st2.ses_ventana::integer, st2.n24::integer, st2.ses::integer,
          coalesce(rutas.rutas, '[]'::jsonb), st2.n_tras_publicar::integer, st2.n_repetidas::integer, st2.origen,
          case when st2.origen = 'externo' then left(st2.prov, 120) end);

  -- Incidencias cuyos eventos ya se purgaron: ventanas a cero.
  update public.web_incidencias i
     set ocurrencias_ventana = 0, sesiones_ventana = 0, ocurrencias_24h = 0
   where i.id = any (v_afectadas)
     and not exists (select 1 from public.web_eventos e where e.incidencia_id = i.id)
     and (i.ocurrencias_ventana > 0 or i.ocurrencias_24h > 0);

  -- Patrones ignorados (extensiones del navegador, ruido conocido).
  update public.web_incidencias i
     set estado = 'ignorada', linear_estado = case when i.linear_estado = 'pendiente' then 'no_aplica' else i.linear_estado end,
         motivo_ticket = 'Coincide con un patrón ignorado en Configuración'
   where i.id = any (v_afectadas) and i.estado = 'nueva'
     and exists (select 1 from unnest(c.mensajes_ignorados) p
                  where p <> '' and (position(lower(p) in lower(coalesce(i.mensaje, ''))) > 0
                                     or position(lower(p) in lower(coalesce(i.pila, ''))) > 0));

  -- Pendientes que ya no pueden abrir ticket (no dependen de la web, o externas sin el interruptor): «sin ticket».
  update public.web_incidencias i
     set linear_estado = 'sin_ticket', requiere_ticket = false, linear_proximo_intento = null,
         motivo_ticket = case when i.origen = 'externo'
                              then left('Servicio externo (' || coalesce(i.origen_proveedor, 'de fuera') || '): no abre ticket salvo que se active en Configuración', 500)
                              else 'No depende de la web: no abre ticket' end
   where i.id = any (v_afectadas)
     and i.linear_estado in ('pendiente', 'error')
     and not (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
     and coalesce(i.motivo_ticket, '') not like 'Pedido a mano%';

  -- Reaparición de una resuelta: reabrir el mismo ticket, uno nuevo enlazando el anterior, o dejarla resuelta.
  with r as (
    update public.web_incidencias i
       set estado = 'reabierta',
           reabierta_veces = i.reabierta_veces + 1,
           linear_pendiente_reapertura = (c.reapertura = 'reabrir' and i.linear_estado = 'creado'
                                          and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))),
           linear_estado = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                     and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos)) then 'sin_ticket' else i.linear_estado end,
           linear_uuid = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                   and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos)) then gen_random_uuid() else i.linear_uuid end,
           linear_issue_id = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                       and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos)) then null else i.linear_issue_id end,
           motivo_ticket = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                     and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
                                then left('Reaparecida tras resolverse (ticket anterior: ' || coalesce(i.linear_identificador, i.linear_issue_id, '?') || ')', 500)
                                else i.motivo_ticket end
     where i.id = any (v_afectadas) and i.estado = 'resuelta' and i.resuelta_en is not null
       and c.reapertura <> 'ignorar'
       and exists (select 1 from public.web_eventos e where e.incidencia_id = i.id and e.ocurrido_en > i.resuelta_en and not e.es_bot)
    returning 1
  )
  select count(*) into v_reabiertas from r;

  -- Umbrales de ticket (solo fallos de la web; externos si linear_tickets_externos).
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = coalesce(i.linear_proximo_intento, now()),
         motivo_ticket = case
           when i.gravedad = 'critico' then 'Gravedad crítica: se abre con la primera ocurrencia'
           when i.tipo = 'error_404' then format('%s 404 en 24 h (umbral %s)', i.ocurrencias_24h, c.umbral_404_diario)
           else format('%s ocurrencias y %s sesiones en %s h (umbral %s y %s)', i.ocurrencias_ventana, i.sesiones_ventana,
                       c.umbral_ventana_horas, c.umbral_ocurrencias, c.umbral_sesiones)
         end || case when i.motivo_ticket like 'Reaparecida%' then ' · ' || i.motivo_ticket else '' end
   where i.id = any (v_afectadas)
     and i.linear_estado = 'sin_ticket'
     and i.estado in ('nueva', 'abierta', 'reabierta')
     and c.linear_modo <> 'desactivado'
     and i.entorno = any (c.entornos_ticket)
     and (i.origen = 'web' or (i.origen = 'externo' and c.linear_tickets_externos))
     and i.ocurrencias_ventana > 0
     and (
       (i.tipo = 'error_404' and c.tickets_404 and i.ocurrencias_24h >= c.umbral_404_diario)
       or (i.tipo <> 'error_404' and (
             i.gravedad = 'critico'
             or (i.ocurrencias_ventana >= c.umbral_ocurrencias
                 and (i.fuente <> 'navegador' or i.sesiones_ventana >= c.umbral_sesiones))))
     );

  select count(*) into v_pendientes from public.web_incidencias
   where linear_estado in ('pendiente', 'error') or linear_pendiente_reapertura;

  return jsonb_build_object('agrupados', coalesce(cardinality(v_ids), 0), 'nuevas', v_nuevas,
                            'reabiertas', v_reabiertas, 'pendientes_linear', v_pendientes);
end;
$$;
revoke all on function public.web_logs_agrupar_errores(integer) from public, anon, authenticated;
grant execute on function public.web_logs_agrupar_errores(integer) to service_role;

-- ─── 11. Retención (solo service role; la llama procesar-logs-web a diario) ─
create or replace function public.web_logs_purgar(p_lote integer default 20000)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_eventos integer := 0;
  v_errores integer := 0;
  v_sesiones integer := 0;
  v_incidencias integer := 0;
begin
  select * into c from public.web_logs_config where id;

  with d as (
    delete from public.web_eventos where id in (
      select id from public.web_eventos
       where categoria <> 'error' and ocurrido_en < now() - make_interval(days => c.retencion_actividad_dias) limit p_lote)
    returning 1)
  select count(*) into v_eventos from d;

  with d as (
    delete from public.web_eventos where id in (
      select id from public.web_eventos
       where categoria = 'error' and ocurrido_en < now() - make_interval(days => c.retencion_errores_dias) limit p_lote)
    returning 1)
  select count(*) into v_errores from d;

  with d as (
    delete from public.web_sesiones s
     where s.ultima_actividad < now() - make_interval(days => c.retencion_actividad_dias)
       and not exists (select 1 from public.web_eventos e where e.sesion_id = s.sesion_id)
    returning 1)
  select count(*) into v_sesiones from d;

  with d as (
    delete from public.web_incidencias i
     where i.estado in ('resuelta', 'ignorada')
       and i.ultima_vez < now() - make_interval(days => c.retencion_errores_dias)
       and not exists (select 1 from public.web_eventos e where e.incidencia_id = i.id)
    returning 1)
  select count(*) into v_incidencias from d;

  delete from public.web_logs_limite_ip where minuto < now() - interval '1 hour';
  delete from public.web_linear_prueba where creado_en < now() - interval '90 days';
  delete from public.web_resumenes_ia where creado_en < now() - interval '400 days';
  delete from public.web_logs_ingesta_diaria where dia < current_date - 400;

  update public.web_logs_estado set ultima_purga = now() where id;
  return jsonb_build_object('eventos', v_eventos, 'errores', v_errores, 'sesiones', v_sesiones, 'incidencias', v_incidencias);
end;
$$;
revoke all on function public.web_logs_purgar(integer) from public, anon, authenticated;
grant execute on function public.web_logs_purgar(integer) to service_role;

-- ─── 12. Lecturas de Super Admin › Logs ─────────────────────────────────────
-- Bots fuera siempre (salvo p_incluir_bots); tráfico interno y pruebas fuera salvo p_incluir_internos.
create or replace function public.web_buscar_sesiones(
  p_desde timestamptz, p_hasta timestamptz, p_entorno text default null, p_ruta text default null,
  p_tipo text default null, p_origen text default null, p_dispositivo text default null, p_texto text default null,
  p_con_error boolean default null, p_con_conversion boolean default null,
  p_incluir_internos boolean default false, p_incluir_bots boolean default false,
  p_limite integer default 25, p_offset integer default 0)
returns table (sesion public.web_sesiones, total bigint)
language sql stable security invoker set search_path = ''
as $$
  select s, count(*) over ()
    from public.web_sesiones s
   where s.inicio >= p_desde and s.inicio < p_hasta
     and (p_entorno is null or s.entorno = p_entorno)
     and (p_incluir_bots or not s.es_bot)
     and (p_incluir_internos or not (s.es_interno or s.es_prueba))
     and (p_origen is null or s.origen_tipo = p_origen)
     and (p_dispositivo is null or s.dispositivo = p_dispositivo)
     and (p_con_error is null or (s.errores > 0) = p_con_error)
     and (p_con_conversion is null or (s.conversiones > 0) = p_con_conversion)
     and (p_ruta is null or exists (select 1 from public.web_eventos e
                                     where e.sesion_id = s.sesion_id and e.tipo = 'pagina_vista' and e.ruta = p_ruta))
     and (p_tipo is null or exists (select 1 from public.web_eventos e where e.sesion_id = s.sesion_id and e.tipo = p_tipo))
     and (p_texto is null or p_texto = ''
          or s.sesion_id::text like lower(p_texto) || '%'
          or s.pagina_entrada ilike '%' || p_texto || '%'
          or s.ultima_pagina ilike '%' || p_texto || '%'
          or s.campana ilike '%' || p_texto || '%'
          or s.origen_detalle ilike '%' || p_texto || '%')
   order by s.inicio desc
   limit least(greatest(p_limite, 1), 200) offset greatest(p_offset, 0);
$$;

create or replace function public.web_buscar_eventos(
  p_desde timestamptz, p_hasta timestamptz, p_entorno text default null, p_categoria text default null,
  p_tipo text default null, p_ruta text default null, p_fuente text default null, p_gravedad text default null,
  p_dispositivo text default null, p_texto text default null,
  p_incluir_internos boolean default false, p_incluir_bots boolean default false,
  p_limite integer default 50, p_offset integer default 0)
returns table (evento public.web_eventos, total bigint)
language sql stable security invoker set search_path = ''
as $$
  select e, count(*) over ()
    from public.web_eventos e
   where e.ocurrido_en >= p_desde and e.ocurrido_en < p_hasta
     and (p_entorno is null or e.entorno = p_entorno)
     and (p_categoria is null or e.categoria = p_categoria or (p_categoria = 'actividad' and e.categoria = 'operacion'))
     and (p_tipo is null or e.tipo = p_tipo)
     and (p_ruta is null or e.ruta = p_ruta)
     and (p_fuente is null or e.fuente = p_fuente)
     and (p_gravedad is null or e.gravedad = p_gravedad)
     and (p_dispositivo is null or e.dispositivo = p_dispositivo)
     and (p_incluir_bots or not e.es_bot)
     and (p_incluir_internos or not (e.es_interno or e.es_prueba))
     and (p_texto is null or p_texto = ''
          or e.sesion_id::text like lower(p_texto) || '%'
          or e.ruta ilike '%' || p_texto || '%'
          or e.objetivo ilike '%' || p_texto || '%'
          or e.mensaje ilike '%' || p_texto || '%'
          or e.tipo ilike '%' || p_texto || '%')
   order by e.ocurrido_en desc, e.id desc
   limit least(greatest(p_limite, 1), 500) offset greatest(p_offset, 0);
$$;

-- Contexto de un evento: lo que pasó antes y después en la MISMA sesión.
create or replace function public.web_contexto_evento(p_evento_id bigint, p_antes integer default 15, p_despues integer default 10)
returns setof public.web_eventos
language sql stable security invoker set search_path = ''
as $$
  with ref as (select * from public.web_eventos where id = p_evento_id)
  (select e.* from public.web_eventos e, ref
    where ref.sesion_id is not null and e.sesion_id = ref.sesion_id
      and (e.ocurrido_en, coalesce(e.secuencia, 0), e.id) < (ref.ocurrido_en, coalesce(ref.secuencia, 0), ref.id)
    order by e.ocurrido_en desc, e.secuencia desc nulls last, e.id desc
    limit least(greatest(p_antes, 0), 100))
  union all
  (select ref.* from ref)
  union all
  (select e.* from public.web_eventos e, ref
    where ref.sesion_id is not null and e.sesion_id = ref.sesion_id
      and (e.ocurrido_en, coalesce(e.secuencia, 0), e.id) > (ref.ocurrido_en, coalesce(ref.secuencia, 0), ref.id)
    order by e.ocurrido_en, e.secuencia nulls last, e.id
    limit least(greatest(p_despues, 0), 100));
$$;

-- Salud de la recogida (para distinguir «no hay actividad» de «la recogida se ha parado»).
create or replace function public.web_logs_estado_recogida(p_entorno text default 'produccion')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
  v_vercel jsonb;
begin
  if not (coalesce(public.is_super_admin(auth.uid()), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo un super admin puede ver el estado de la recogida' using errcode = '42501';
  end if;
  -- Referencia independiente: visitas de Vercel Web Analytics (sin cookies) del último día cerrado, si hay Tráfico web.
  if to_regclass('public.trafico_web_diario') is not null then
    execute $q$select jsonb_build_object('fecha', d.fecha, 'visitas', d.visitas)
                 from public.trafico_web_diario d
                where d.proyecto = 'cristaleriabv' and d.ruta = '*'
                order by d.fecha desc limit 1$q$ into v_vercel;
  end if;
  select jsonb_build_object(
    'ahora', now(),
    'entorno', p_entorno,
    'fuentes', coalesce((
      select jsonb_agg(jsonb_build_object('fuente', f.fuente, 'ultimo_recibido', f.ultimo, 'n_1h', f.n1, 'n_24h', f.n24) order by f.fuente)
        from (select e.fuente, max(e.recibido_en) as ultimo,
                     count(*) filter (where e.recibido_en > now() - interval '1 hour') as n1,
                     count(*) filter (where e.recibido_en > now() - interval '24 hours') as n24
                from public.web_eventos e
               where e.entorno = p_entorno and e.recibido_en > now() - interval '30 days'
               group by e.fuente) f), '[]'::jsonb),
    'primer_evento', (select min(ocurrido_en) from public.web_eventos where entorno = p_entorno),
    'primer_evento_por_tipo', coalesce((
      select jsonb_object_agg(tipo, primero) from (
        select tipo, min(ocurrido_en) as primero from public.web_eventos where entorno = p_entorno group by tipo) t), '{}'::jsonb),
    'primer_evento_por_categoria', coalesce((
      select jsonb_object_agg(categoria, primero) from (
        select categoria, min(ocurrido_en) as primero from public.web_eventos where entorno = p_entorno group by categoria) t), '{}'::jsonb),
    'ingesta', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.dia desc)
        from public.web_logs_ingesta_diaria d
       where d.entorno = p_entorno and d.dia > (now() at time zone 'Europe/Madrid')::date - 8), '[]'::jsonb),
    'proceso', (select to_jsonb(s) - 'cursores' from public.web_logs_estado s where id),
    'config', (select jsonb_build_object('linear_modo', linear_modo, 'entornos_aceptados', entornos_aceptados,
                                         'entornos_ticket', entornos_ticket, 'recoger_actividad', recoger_actividad,
                                         'recoger_errores_navegador', recoger_errores_navegador)
                 from public.web_logs_config where id),
    'vercel_ultimo_dia', v_vercel
  ) into v;
  return v;
end;
$$;

-- ─── 13. Estadísticas de comportamiento (super admin o «Ver» en Tráfico web) ─
-- Días y horas en Madrid. Una sesión cuenta en el periodo si EMPIEZA en él. Definiciones (las mismas en Tráfico web y
-- Logs: src/components/trafico-web/comportamiento/definiciones.ts):
--   sesiones       visitas seguidas de una pestaña que deja medir (30 min sin actividad = nueva)
--   paginas_vistas eventos pagina_vista de esas sesiones
--   conversiones   operaciones COMPLETADAS: solicitud de presupuesto guardada (presupuesto_solicitado) o formulario de
--                  contacto/visita enviado (contacto_enviado)
--   ultima página  la última observada, no una salida confirmada
-- Solo agregados: nunca una sesión suelta. SECURITY DEFINER con su propia comprobación de permisos.
create or replace function public.web_comportamiento_resumen(
  p_desde date, p_hasta date, p_entorno text default 'produccion', p_incluir_internos boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  r jsonb;
begin
  if not public.web_logs_puede_ver_estadisticas() then
    raise exception 'Sin permiso para ver las estadísticas de la web' using errcode = '42501';
  end if;
  with s as (
    select * from public.web_sesiones x
     where x.entorno = p_entorno and not x.es_bot
       and (p_incluir_internos or not (x.es_interno or x.es_prueba))
       and x.inicio >= (p_desde::timestamp at time zone 'Europe/Madrid')
       and x.inicio < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
  )
  select jsonb_build_object(
    'sesiones', count(*),
    'visitantes_estimados', count(distinct visitante_id),
    'paginas_vistas', coalesce(sum(paginas_vistas), 0),
    'paginas_por_sesion', round(avg(paginas_vistas)::numeric, 2),
    'sesiones_una_pagina', count(*) filter (where paginas_vistas <= 1),
    'tiempo_activo_medio_s', round(avg(tiempo_activo_ms) / 1000.0, 1),
    'tiempo_activo_mediana_s', round((percentile_cont(0.5) within group (order by tiempo_activo_ms) / 1000.0)::numeric, 1),
    'scroll_medio', round(avg(scroll_max)::numeric, 1),
    'sesiones_inicio_operacion', count(*) filter (where inicio_operacion),
    'sesiones_con_conversion', count(*) filter (where conversiones > 0),
    'conversiones', coalesce(sum(conversiones), 0),
    'errores', coalesce(sum(errores), 0),
    'sesiones_con_error', count(*) filter (where errores > 0)
  ) into r from s;
  return r;
end;
$$;

create or replace function public.web_comportamiento(
  p_desde date, p_hasta date, p_entorno text default 'produccion', p_incluir_internos boolean default false)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ini timestamptz := (p_desde::timestamp at time zone 'Europe/Madrid');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid');
  v_dias integer := (p_hasta - p_desde) + 1;
  r jsonb;
begin
  if not public.web_logs_puede_ver_estadisticas() then
    raise exception 'Sin permiso para ver las estadísticas de la web' using errcode = '42501';
  end if;
  if p_hasta < p_desde or v_dias > 400 then
    raise exception 'Periodo no válido (como mucho 400 días)' using errcode = '22023';
  end if;

  with wc_s as materialized (
    select * from public.web_sesiones x
     where x.entorno = p_entorno and not x.es_bot
       and (p_incluir_internos or not (x.es_interno or x.es_prueba))
       and x.inicio >= v_ini and x.inicio < v_fin
  ), wc_e as materialized (
    select e.* from public.web_eventos e join wc_s on wc_s.sesion_id = e.sesion_id
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', v_dias, 'zona', 'Europe/Madrid', 'entorno', p_entorno),
    'datos_desde', (select min(ocurrido_en) from public.web_eventos where entorno = p_entorno and fuente = 'navegador' and consentimiento),
    'resumen', public.web_comportamiento_resumen(p_desde, p_hasta, p_entorno, p_incluir_internos),
    'anterior', public.web_comportamiento_resumen(p_desde - v_dias, p_desde - 1, p_entorno, p_incluir_internos),
    'excluidas', jsonb_build_object(
      'bots', (select count(*) from public.web_sesiones x where x.entorno = p_entorno and x.es_bot and x.inicio >= v_ini and x.inicio < v_fin),
      'internas_pruebas', (select count(*) from public.web_sesiones x where x.entorno = p_entorno and not x.es_bot
                             and (x.es_interno or x.es_prueba) and x.inicio >= v_ini and x.inicio < v_fin),
      'incluidas_internas', p_incluir_internos),
    'serie', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'sesiones', coalesce(t.sesiones, 0), 'paginas_vistas', coalesce(t.pv, 0),
                                          'conversiones', coalesce(t.conv, 0), 'errores', coalesce(t.err, 0)) order by d.dia)
        from generate_series(p_desde, p_hasta, interval '1 day') as d(dia)
        left join (select (inicio at time zone 'Europe/Madrid')::date as dia, count(*) as sesiones, sum(paginas_vistas) as pv,
                          sum(conversiones) as conv, sum(errores) as err
                     from wc_s group by 1) t on t.dia = d.dia::date), '[]'::jsonb),
    'paginas', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.vistas desc, p.ruta)
        from (select v.ruta, count(*) as vistas, count(distinct v.sesion_id) as sesiones,
                     round(avg(sal.tiempo_ms) / 1000.0, 1) as tiempo_medio_s, round(avg(sal.scroll)::numeric, 1) as scroll_medio
                from wc_e v
                left join lateral (
                  select sum(case when o.valor between 0 and 3600000 then o.valor end) as tiempo_ms,
                         max(case when o.propiedades ->> 'scroll_max' ~ '^\d{1,3}$' then (o.propiedades ->> 'scroll_max')::integer end) as scroll
                    from wc_e o
                   where o.sesion_id = v.sesion_id and o.tipo = 'pagina_salida' and o.ruta = v.ruta
                     and (o.propiedades ->> 'vista_id') = (v.propiedades ->> 'vista_id')
                ) sal on true
               where v.tipo = 'pagina_vista'
               group by v.ruta order by count(*) desc limit 20) p), '[]'::jsonb),
    -- Lo que se mira: servicios (páginas /servicios/<servicio>), books de trabajos y categorías de la calculadora.
    'contenidos', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.tipo, c.n desc)
        from (select tipo, objetivo, n, sesiones from (
                select x.tipo, x.objetivo, count(*) as n, count(distinct x.sesion_id) as sesiones,
                       row_number() over (partition by x.tipo order by count(*) desc, x.objetivo) as rk
                  from (select case when e.tipo = 'pagina_vista' then 'servicio' when e.tipo = 'media' then 'trabajos' else 'calculadora' end as tipo,
                               case when e.tipo = 'pagina_vista' then substring(e.ruta from '^/servicios/([^/]+)$') else e.objetivo end as objetivo,
                               e.sesion_id
                          from wc_e e
                         where (e.tipo = 'pagina_vista' and e.ruta ~ '^/servicios/[^/]+$')
                            or (e.tipo = 'media' and e.objetivo is not null)
                            or (e.tipo = 'calculadora' and e.accion = 'categoria' and e.objetivo is not null)) x
                 group by x.tipo, x.objetivo) t where rk <= 10) c), '[]'::jsonb),
    -- Calculadora: precios calculados por servicio (importe orientativo medio, IVA incluido).
    'calculadora', coalesce((
      select jsonb_agg(to_jsonb(k) order by k.calculos desc)
        from (select coalesce(nullif(e.objetivo, ''), e.propiedades ->> 'categoria', '(sin servicio)') as categoria,
                     count(*) as calculos, count(distinct e.sesion_id) as sesiones,
                     round(avg(e.valor) filter (where e.valor > 0)) as precio_medio
                from wc_e e where e.tipo = 'calculadora' and e.accion = 'calculado'
               group by 1 order by count(*) desc limit 10) k), '[]'::jsonb),
    'clics', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.n desc)
        from (select e.tipo, e.accion, e.objetivo, count(*) as n, count(distinct e.sesion_id) as sesiones
                from wc_e e
               where e.tipo in ('clic', 'contacto') and e.objetivo is not null
               group by e.tipo, e.accion, e.objetivo order by count(*) desc limit 20) c), '[]'::jsonb),
    'contactos', coalesce((
      select jsonb_agg(jsonb_build_object('accion', accion, 'n', n, 'sesiones', ses) order by n desc)
        from (select e.accion, count(*) as n, count(distinct e.sesion_id) as ses
                from wc_e e where e.tipo = 'contacto' group by e.accion) c), '[]'::jsonb),
    'origenes', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.sesiones desc)
        from (select coalesce(origen_tipo, 'desconocido') as origen_tipo, count(*) as sesiones,
                     count(*) filter (where conversiones > 0) as sesiones_con_conversion
                from wc_s group by 1) o), '[]'::jsonb),
    'campanas', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.sesiones desc)
        from (select origen_tipo, coalesce(campana, origen_detalle) as nombre, count(*) as sesiones,
                     count(*) filter (where inicio_operacion) as inicios,
                     count(*) filter (where conversiones > 0) as sesiones_con_conversion
                from wc_s
               where origen_tipo in ('campana', 'qr', 'red_social', 'buscador', 'enlace')
               group by 1, 2 order by count(*) desc limit 20) o), '[]'::jsonb),
    'dispositivos', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.sesiones desc)
        from (select coalesce(dispositivo, 'desconocido') as dispositivo, count(*) as sesiones,
                     count(*) filter (where conversiones > 0) as sesiones_con_conversion
                from wc_s group by 1) o), '[]'::jsonb),
    'horas', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h, 'sesiones', coalesce(n, 0)) order by h)
        from generate_series(0, 23) h
        left join (select extract(hour from inicio at time zone 'Europe/Madrid')::integer as hora, count(*) as n
                     from wc_s group by 1) t on t.hora = h), '[]'::jsonb),
    'dias_semana', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d, 'sesiones', coalesce(n, 0)) order by d)
        from generate_series(1, 7) d
        left join (select extract(isodow from inicio at time zone 'Europe/Madrid')::integer as dia, count(*) as n
                     from wc_s group by 1) t on t.dia = d), '[]'::jsonb),
    'tiempo', (select jsonb_build_object(
                 'menos_10s', count(*) filter (where tiempo_activo_ms < 10000),
                 'de_10s_a_1m', count(*) filter (where tiempo_activo_ms >= 10000 and tiempo_activo_ms < 60000),
                 'de_1m_a_3m', count(*) filter (where tiempo_activo_ms >= 60000 and tiempo_activo_ms < 180000),
                 'mas_3m', count(*) filter (where tiempo_activo_ms >= 180000))
               from wc_s),
    'scroll', (select jsonb_build_object(
                 'hasta_25', count(*) filter (where sc < 25),
                 'de_25_a_50', count(*) filter (where sc >= 25 and sc < 50),
                 'de_50_a_75', count(*) filter (where sc >= 50 and sc < 75),
                 'de_75_a_100', count(*) filter (where sc >= 75),
                 'vistas_medidas', count(*))
               from (select max(case when e.propiedades ->> 'scroll_max' ~ '^\d{1,3}$' then (e.propiedades ->> 'scroll_max')::integer end) as sc
                       from wc_e e where e.tipo = 'pagina_salida'
                      group by e.sesion_id, coalesce(e.propiedades ->> 'vista_id', e.ruta)) v
              where sc is not null),
    'recorridos', coalesce((
      select jsonb_agg(jsonb_build_object('recorrido', recorrido, 'sesiones', n) order by n desc, recorrido)
        from (select recorrido, count(*) as n from (
                select sesion_id, string_agg(ruta, ' → ' order by pos) as recorrido
                  from (select sesion_id, ruta, row_number() over (partition by sesion_id order by ocurrido_en, secuencia) as pos
                          from (select sesion_id, ruta, ocurrido_en, secuencia,
                                       lag(ruta) over (partition by sesion_id order by ocurrido_en, secuencia) as previa
                                  from wc_e where tipo = 'pagina_vista') x
                         where previa is distinct from ruta) y
                 where pos <= 3
                 group by sesion_id) z
              group by recorrido order by count(*) desc limit 10) w), '[]'::jsonb),
    'ultimas_paginas', coalesce((
      select jsonb_agg(jsonb_build_object('ruta', ultima_pagina, 'sesiones', n) order by n desc)
        from (select ultima_pagina, count(*) as n from wc_s where ultima_pagina is not null
               group by 1 order by count(*) desc limit 10) u), '[]'::jsonb),
    -- Embudos de la web: presupuesto (calculadora → precio → formulario → solicitud guardada) y contacto.
    'embudos', jsonb_build_array(
      (select jsonb_build_object('operacion', 'presupuesto',
         'entrada', (select count(*) from wc_s),
         'consulta', count(distinct e.sesion_id) filter (where (e.tipo = 'pagina_vista' and e.ruta ~ '^/presupuesto(/|$)') or e.tipo = 'calculadora'),
         'inicio', count(distinct e.sesion_id) filter (where (e.tipo = 'calculadora' and e.accion = 'calculado')
                                                         or (e.tipo = 'formulario' and e.accion = 'inicio' and e.objetivo = 'presupuesto')),
         'envio', count(distinct e.sesion_id) filter (where e.tipo = 'formulario' and e.accion = 'envio' and e.objetivo = 'presupuesto'),
         'fin', count(distinct e.sesion_id) filter (where e.tipo = 'presupuesto_solicitado'),
         'rechazos', count(*) filter (where e.tipo = 'presupuesto_rechazado'))
         from wc_e e),
      (select jsonb_build_object('operacion', 'contacto',
         'entrada', (select count(*) from wc_s),
         'consulta', count(distinct e.sesion_id) filter (where (e.tipo = 'pagina_vista' and e.ruta ~ '^/contacto(/|$)') or e.tipo = 'contacto'),
         'inicio', count(distinct e.sesion_id) filter (where e.tipo = 'formulario' and e.accion = 'inicio' and e.objetivo in ('contacto', 'visita')),
         'envio', count(distinct e.sesion_id) filter (where e.tipo = 'formulario' and e.accion = 'envio' and e.objetivo in ('contacto', 'visita')),
         'fin', count(distinct e.sesion_id) filter (where e.tipo = 'contacto_enviado'),
         'rechazos', 0)
         from wc_e e)),
    'formularios', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.objetivo)
        from (select e.objetivo,
                     count(distinct e.sesion_id) filter (where e.accion = 'inicio') as inicios,
                     count(distinct e.sesion_id) filter (where e.accion = 'envio') as envios,
                     count(distinct e.sesion_id) filter (where e.accion = 'abandono') as abandonos,
                     count(*) filter (where e.accion = 'error_validacion') as errores_validacion
                from wc_e e where e.tipo = 'formulario' and e.objetivo is not null
               group by e.objetivo) f), '[]'::jsonb),
    'errores_por_ruta', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select coalesce(e.ruta, '(sin ruta)') as ruta, e.tipo, count(*) as n, count(distinct e.sesion_id) as sesiones
                from wc_e e where e.categoria = 'error'
               group by 1, 2 order by count(*) desc limit 15) x), '[]'::jsonb),
    'errores_por_operacion', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select coalesce(e.propiedades ->> 'endpoint', e.tipo) as operacion, count(*) as n, count(distinct e.sesion_id) as sesiones
                from wc_e e where e.tipo in ('error_peticion', 'presupuesto_rechazado')
               group by 1 order by count(*) desc limit 10) x), '[]'::jsonb),
    -- Lo que apunta la base de datos (TODOS los visitantes, midan o no): referencia de las conversiones.
    'operaciones_bd', (select jsonb_build_object(
                         'presupuestos_web', count(*) filter (where e.tipo = 'presupuesto_solicitado_bd'),
                         'presupuestos_aceptados', count(*) filter (where e.tipo = 'presupuesto_aceptado_bd'))
                       from public.web_eventos e
                      where e.entorno = p_entorno and e.fuente = 'base_datos' and e.ocurrido_en >= v_ini and e.ocurrido_en < v_fin)
  ) into r;
  return r;
end;
$$;

revoke all on function public.web_buscar_sesiones(timestamptz, timestamptz, text, text, text, text, text, text, boolean, boolean, boolean, boolean, integer, integer) from public, anon;
revoke all on function public.web_buscar_eventos(timestamptz, timestamptz, text, text, text, text, text, text, text, text, boolean, boolean, integer, integer) from public, anon;
revoke all on function public.web_contexto_evento(bigint, integer, integer) from public, anon;
revoke all on function public.web_logs_estado_recogida(text) from public, anon;
revoke all on function public.web_comportamiento_resumen(date, date, text, boolean) from public, anon;
revoke all on function public.web_comportamiento(date, date, text, boolean) from public, anon;
grant execute on function public.web_buscar_sesiones(timestamptz, timestamptz, text, text, text, text, text, text, boolean, boolean, boolean, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.web_buscar_eventos(timestamptz, timestamptz, text, text, text, text, text, text, text, text, boolean, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.web_contexto_evento(bigint, integer, integer) to authenticated, service_role;
grant execute on function public.web_logs_estado_recogida(text) to authenticated, service_role;
grant execute on function public.web_comportamiento_resumen(date, date, text, boolean) to authenticated, service_role;
grant execute on function public.web_comportamiento(date, date, text, boolean) to authenticated, service_role;

-- ─── 14. «Pedir ticket» y fallos de pg_cron ─────────────────────────────────
-- «Pedir ticket» (aunque no llegue al umbral) o «Reenviar al destino actual». Solo super admin. El motivo empieza
-- SIEMPRE por «Pedido a mano» (el proceso lo respeta aunque no dependa de la web). Si el ticket anterior se creó en
-- OTRO destino, id nuevo para no chocar con él.
create or replace function public.web_incidencia_pedir_ticket(p_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_modo text;
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'Solo un super admin puede pedir tickets' using errcode = '42501';
  end if;
  select linear_modo into v_modo from public.web_logs_config where id;
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = now(),
         linear_intentos = 0,
         linear_ultimo_error = null,
         linear_uuid = case when i.linear_destino is not null and i.linear_destino <> v_modo then gen_random_uuid() else i.linear_uuid end,
         linear_issue_id = case when i.linear_destino is not null and i.linear_destino <> v_modo then null else i.linear_issue_id end,
         motivo_ticket = case when coalesce(i.motivo_ticket, '') like 'Pedido a mano%' then i.motivo_ticket
                              else left('Pedido a mano desde Super Admin › Logs' || coalesce(' · ' || nullif(i.motivo_ticket, ''), ''), 500) end,
         estado = case when i.estado = 'ignorada' then 'abierta' else i.estado end
   where i.id = p_id
     and (i.linear_estado <> 'creado' or (i.linear_destino is not null and i.linear_destino <> v_modo));
end;
$$;
revoke all on function public.web_incidencia_pedir_ticket(bigint) from public, anon;
grant execute on function public.web_incidencia_pedir_ticket(bigint) to authenticated;

-- Tareas programadas que fallaron (pg_cron). Solo si existe pg_cron.
do $$
begin
  if to_regclass('cron.job_run_details') is not null then
    execute $f$
      create or replace function public.web_logs_fallos_cron(p_desde timestamptz)
      returns table (runid bigint, jobname text, status text, return_message text, start_time timestamptz)
      language sql stable security definer set search_path = ''
      as $q$
        select d.runid, j.jobname, d.status, left(d.return_message, 500), d.start_time
          from cron.job_run_details d
          join cron.job j on j.jobid = d.jobid
         where d.status = 'failed' and d.start_time > p_desde
         order by d.start_time
         limit 200
      $q$
    $f$;
    execute 'revoke all on function public.web_logs_fallos_cron(timestamptz) from public, anon, authenticated';
    execute 'grant execute on function public.web_logs_fallos_cron(timestamptz) to service_role';
  end if;
end;
$$;

-- ─── 15. Operaciones completadas que apunta la base de datos ────────────────
-- El navegador solo ve a quien deja medir. Para tener la referencia completa, la base apunta en web_eventos (fuente
-- base_datos, sin sesión ni datos personales) cada solicitud de presupuesto de la web y cada presupuesto web que pasa a
-- aceptado. REGISTRAR NUNCA ROMPE LA OPERACIÓN: todo en un bloque con EXCEPTION que solo deja un WARNING. evento_id
-- determinista (md5 de tabla + id + tipo): repetir el cambio no duplica.
create or replace function public.web_logs_operacion_bd()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_entorno text;
  v_tipo text;
  v_valor numeric;
begin
  begin
    if tg_table_name <> 'presupuestos' or coalesce(new.origen, '') <> 'web' then
      return null;
    end if;
    if tg_op = 'INSERT' then
      v_tipo := 'presupuesto_solicitado_bd';
      v_valor := null; -- el precio llega después, con la línea
    elsif new.estado is distinct from old.estado and new.estado = 'aceptado' then
      v_tipo := 'presupuesto_aceptado_bd';
      v_valor := new.total;
    else
      return null;
    end if;
    select entorno_bd into v_entorno from public.web_logs_config where id;
    insert into public.web_eventos (evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, valor, propiedades)
    values (md5(tg_table_name || ':' || new.id::text || ':' || v_tipo)::uuid, now(), coalesce(v_entorno, 'produccion'),
            'cristaleriabv', 'base_datos', 'operacion', v_tipo, v_valor, jsonb_build_object('tabla', tg_table_name))
    on conflict (evento_id) do nothing;
  exception when others then
    raise warning 'web_logs_operacion_bd (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.web_logs_operacion_bd() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.presupuestos') is not null then
    execute 'drop trigger if exists web_logs_operacion_bd on public.presupuestos';
    execute 'create trigger web_logs_operacion_bd after insert or update of estado on public.presupuestos
             for each row execute function public.web_logs_operacion_bd()';
  end if;
end;
$$;

-- ─── 16. IA: funciones con modelo elegible y consumo contabilizado ──────────
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo) values
        ('procesar-logs-web', 'Logs web: análisis de una incidencia agrupada antes de crear su ticket en Linear y explicación en sencillo.', true, 'incidencia', 950, true),
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

-- ─── 17. Tarea cada 5 minutos: procesar-logs-web ────────────────────────────
-- Como las demás tareas del panel: la URL y el secreto salen de Vault (project_url y ocr_trabajos_secret). Sin Vault no
-- llama a nadie («sin_vault»). Sin eventos de error ni tickets pendientes la pasada es barata, pero se llama siempre:
-- también recoge los fallos de pg_cron, de Tráfico web y de los despliegues, y purga una vez al día.
create or replace function public.logs_web_disparar()
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secreto text;
begin
  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return 'sin_vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return 'sin_vault';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    using rtrim(v_url, '/') || '/functions/v1/procesar-logs-web',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          jsonb_build_object('origen', 'cron');
  return 'llamada';
end;
$$;
comment on function public.logs_web_disparar() is
  'Lo llama pg_cron (procesar-logs-web, cada 5 min): POST a la Edge Function procesar-logs-web con x-ocr-secret. '
  'Necesita en Vault project_url y ocr_trabajos_secret; sin ellos devuelve sin_vault y no llama a nadie.';
revoke all on function public.logs_web_disparar() from public, anon, authenticated;
grant execute on function public.logs_web_disparar() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'procesar-logs-web';
    perform cron.schedule('procesar-logs-web', '*/5 * * * *', $cron$ select public.logs_web_disparar(); $cron$);
  else
    raise notice 'Sin pg_cron: la tarea procesar-logs-web NO se ha instalado.';
  end if;
end;
$$;
