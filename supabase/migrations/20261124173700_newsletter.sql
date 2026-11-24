-- ============================================================================
--  Panel de Cristalería BV · Marketing › Newsletter (24/11/2026)
-- ----------------------------------------------------------------------------
--  Petición del dueño: «Newsletter» como uno de los módulos traídos del panel de
--  referencia, automático y tan completo como allí, adaptado a una cristalería
--  (nada de restaurante: ni reservas, ni carta, ni menús).
--
--  Portado de las migraciones del newsletter de la referencia (tabla base,
--  baja RGPD, baja automática, doble opt-in y email normalizado, Resend
--  Broadcasts, webhook sobre los eventos y plantillas) y adaptado:
--    · Aquí la gente se apunta desde la WEB (formulario del pie y, si marca la
--      casilla, al pedir presupuesto), no al reservar. El doble opt-in es el de
--      la referencia llevado a su forma directa: todo suscriptor NACE
--      «pendiente» y solo pasa a «activo» cuando pulsa el enlace del correo de
--      confirmación (newsletter_confirmar, con un token de un solo propósito que
--      aquí solo se guarda como hash). Ni el panel ni la API pueden activarlo
--      por otra vía: lo impide el disparador newsletter_suscriptores_proteger.
--    · Estados: pendiente → activo → baja (y baja → pendiente solo con un
--      consentimiento NUEVO, posterior a la baja, que vuelve a pedir
--      confirmación). La baja es inmutable mientras dure (fecha y origen).
--    · Enlaces sin sesión y no adivinables: el de baja lleva un token aleatorio
--      por suscriptor (newsletter_claves, solo service role); el de
--      confirmación, uno aleatorio que caduca a los 7 días.
--    · El personal no escribe directamente en newsletter_suscriptores: usa las
--      funciones del panel (alta manual con el consentimiento apuntado,
--      importación, baja y supresión RGPD), que exigen «Editar» en Newsletter y
--      dejan siempre al suscriptor pendiente de confirmar.
--    · Remitente, canal y demás ajustes en una fila editable desde el panel
--      (newsletter_config), no en el código.
--
--  Tablas: newsletter_config, newsletter_suscriptores, newsletter_claves,
--  newsletter_envios, newsletter_plantillas, newsletter_ia_peticiones,
--  newsletter_sincronizaciones_resend, newsletter_altas_limite, email_eventos y
--  direcciones_email_suprimidas.
--
--  Quién escribe:
--    · newsletter-alta (web, service role): newsletter_alta_web y newsletter_confirmar.
--    · newsletter-baja (enlace del correo y botón one-click): newsletter_baja_por_token.
--    · enviar-newsletter: newsletter_envios y newsletter_preparar_confirmaciones.
--    · resend-webhook: email_eventos, direcciones_email_suprimidas y newsletter_registrar_baja.
--    · newsletter-sync-resend: newsletter_sincronizaciones_resend y newsletter_marcar_sincronizados.
--    · El panel: newsletter_config (Editar), newsletter_plantillas (Editar) y las
--      funciones newsletter_alta_panel / _importar / _baja_panel / _suprimir.
--
--  Permisos: sección «newsletter» (Usuarios › Permisos). «Ver» consulta
--  suscriptores, envíos, estadísticas y ajustes; «Editar» además crea, envía,
--  da de alta y de baja y cambia los ajustes. Super admin, todo. Nadie con la
--  clave pública (anon) lee ni escribe nada de esto. Barrera de sesión
--  (acceso_panel_no_bloqueado) en las tablas que lee el panel.
--
--  Tareas pg_cron:
--    · newsletter-sync-resend (05:20 UTC): llama a la Edge Function con
--      x-ocr-secret (Vault: project_url y ocr_trabajos_secret). Sin canal
--      Broadcast o sin RESEND_API_KEY la función no hace nada.
--    · newsletter-purgar (04:10 UTC): borra las altas que nunca se confirmaron
--      (30 días), el límite por IP (1 día), las peticiones a la IA (90 días) y
--      los eventos de correo de más de 13 meses.
--
--  Lo que tiene que hacer el dueño (cuenta de Resend, dominio, secretos,
--  webhook) está en docs/NEWSLETTER.md. Sin esa configuración nada se envía ni
--  se rompe: las funciones responden «falta configurar» y el panel lo explica.
--
--  Vuelta atrás: supabase/rollbacks/20261124173700_newsletter_ROLLBACK.sql.
-- ============================================================================

set check_function_bodies = off;

-- ─── 1. Ajustes (una fila) ──────────────────────────────────────────────────
create table if not exists public.newsletter_config (
  id                   smallint primary key default 1 check (id = 1),
  -- Dirección desde la que sale la newsletter: tiene que ser de un dominio verificado en Resend (docs/NEWSLETTER.md).
  remitente_email      text check (remitente_email is null or (char_length(remitente_email) <= 254
                         and remitente_email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')),
  remitente_nombre     text not null default 'Cristalería Baix Vinalopó'
                       check (char_length(btrim(remitente_nombre)) between 1 and 80 and remitente_nombre !~ '[<>"\r\n]'),
  responder_a          text check (responder_a is null or (char_length(responder_a) <= 254
                         and responder_a ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')),
  -- transaccional = un correo por suscriptor; broadcast = un Broadcast de Resend al Segment del newsletter.
  canal                text not null default 'transaccional' check (canal in ('transaccional', 'broadcast')),
  -- A dónde va «Enviar prueba» si no se pide otra cosa (además de a quien la pide).
  email_prueba         text check (email_prueba is null or (char_length(email_prueba) <= 254
                         and email_prueba ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')),
  -- Destinatarios como mucho por envío transaccional (0 = sin límite; el plan gratuito de Resend da 100 correos al día).
  limite_transaccional integer not null default 80 check (limite_transaccional between 0 and 100000),
  -- Web donde están las páginas /newsletter/confirmada y /newsletter/baja.
  web_url              text not null default 'https://cristaleriabv.vercel.app'
                       check (char_length(web_url) <= 200 and web_url ~ '^https://[a-z0-9.-]+(:[0-9]{2,5})?$'),
  actualizado_en       timestamptz not null default now(),
  actualizado_por      uuid
);
comment on table public.newsletter_config is
  'Ajustes del newsletter (una fila, id = 1), editables en Newsletter › Configuración con «Editar»: remitente (dominio '
  'verificado en Resend), responder a, canal (transaccional | broadcast), dirección de pruebas, límite por envío '
  'transaccional y la web de las páginas de confirmación y baja. Los secretos (RESEND_API_KEY…) no van aquí.';
insert into public.newsletter_config (id) values (1) on conflict (id) do nothing;

-- ─── 2. Suscriptores ────────────────────────────────────────────────────────
create table if not exists public.newsletter_suscriptores (
  id                        uuid primary key default gen_random_uuid(),
  email                     text not null check (char_length(email) between 3 and 254
                              and email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  nombre                    text check (nombre is null or char_length(nombre) <= 120),
  estado                    text not null default 'pendiente' check (estado in ('pendiente', 'activo', 'baja')),
  -- Para el código portado de la referencia (sincronización con Resend): activo = recibe la newsletter.
  activo                    boolean generated always as (estado = 'activo') stored,
  origen_alta               text not null check (origen_alta in ('web_formulario', 'web_presupuesto', 'panel_manual', 'importacion')),
  -- Prueba del consentimiento (RGPD, art. 7.1): cuándo, qué texto aceptó y, si lo apuntó el equipo, cómo lo dio y quién.
  consentimiento_at         timestamptz not null default now(),
  consentimiento_texto      text not null check (char_length(consentimiento_texto) between 10 and 1000),
  consentimiento_detalle    text check (consentimiento_detalle is null or char_length(consentimiento_detalle) <= 500),
  registrado_por            uuid,
  -- Doble opt-in.
  fecha_verificacion_email  timestamptz,
  confirmaciones_enviadas   integer not null default 0 check (confirmaciones_enviadas >= 0),
  confirmacion_enviada_at   timestamptz,
  -- Baja (constancia RGPD; inmutable mientras dure).
  fecha_baja                timestamptz,
  origen_baja               text check (origen_baja is null or origen_baja in (
                              'enlace_email', 'cabecera_one_click', 'panel_manual',
                              'queja_spam', 'rebote_permanente', 'suprimido_resend', 'resend_baja_nativa')),
  -- Resend Marketing (solo canal broadcast; lo escribe newsletter-sync-resend). No decide quién recibe nada.
  resend_contact_id         text,
  resend_sincronizado_at    timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint newsletter_suscriptores_baja_coherente check ((estado = 'baja') = (fecha_baja is not null)),
  constraint newsletter_suscriptores_activo_verificado check (estado <> 'activo' or fecha_verificacion_email is not null)
);
comment on table public.newsletter_suscriptores is
  'Suscriptores del newsletter. estado: pendiente (se apuntó y aún no confirmó su email), activo (confirmó: recibe la '
  'newsletter) o baja. Todo suscriptor nace pendiente y solo pasa a activo con newsletter_confirmar (doble opt-in). '
  'consentimiento_* = prueba del consentimiento. Solo escriben las funciones (service role) y las RPC del panel.';
create unique index if not exists newsletter_suscriptores_email_key on public.newsletter_suscriptores (lower(email));
create index if not exists newsletter_suscriptores_estado_idx on public.newsletter_suscriptores (estado, created_at desc);
create index if not exists newsletter_suscriptores_resend_contact_idx on public.newsletter_suscriptores (resend_contact_id)
  where resend_contact_id is not null;

-- Tokens de los enlaces (sin sesión). baja_token: aleatorio por suscriptor, va en cada newsletter (enlace del pie y
-- botón one-click) y no cambia. confirmacion_hash: sha256 del token del correo de confirmación (el token no se guarda).
-- Sin políticas ni privilegios para el panel: solo las funciones (service role).
create table if not exists public.newsletter_claves (
  suscriptor_id           uuid primary key references public.newsletter_suscriptores(id) on delete cascade,
  baja_token              text not null unique check (baja_token ~ '^[0-9a-f]{64}$'),
  confirmacion_hash       text unique check (confirmacion_hash is null or confirmacion_hash ~ '^[0-9a-f]{64}$'),
  confirmacion_caduca_at  timestamptz,
  creado_en               timestamptz not null default now()
);
comment on table public.newsletter_claves is
  'Tokens de los enlaces del newsletter (solo service role): baja_token (aleatorio, 64 hex, uno por suscriptor) y el '
  'hash sha256 del token de confirmación con su caducidad (7 días). Se borran con el suscriptor.';

-- Límite de altas desde la web por huella de IP (HMAC con sal; nunca la IP). Sin políticas: solo newsletter_alta_web().
create table if not exists public.newsletter_altas_limite (
  id        bigint generated always as identity primary key,
  ip_hash   text not null check (char_length(ip_hash) between 16 and 128),
  creado_en timestamptz not null default now()
);
create index if not exists newsletter_altas_limite_ip_idx on public.newsletter_altas_limite (ip_hash, creado_en desc);

-- ─── 3. Envíos, plantillas e IA ─────────────────────────────────────────────
create table if not exists public.newsletter_envios (
  id                   uuid primary key default gen_random_uuid(),
  asunto               text not null check (char_length(asunto) between 1 and 200),
  -- Versión de texto (historial).
  mensaje              text not null default '' check (char_length(mensaje) <= 10000),
  tipo_newsletter      text not null default 'personalizada' check (char_length(tipo_newsletter) between 1 and 40),
  -- El diseño enviado (tipo, título, etiqueta, texto de vista previa y bloques), para volver a abrirlo.
  diseno               jsonb check (diseno is null or (jsonb_typeof(diseno) = 'object' and octet_length(diseno::text) <= 60000)),
  canal                text not null default 'transaccional' check (canal in ('transaccional', 'broadcast')),
  estado               text not null default 'enviando' check (estado in ('enviando', 'completado', 'parcial', 'fallido')),
  total_destinatarios  integer not null default 0 check (total_destinatarios >= 0),
  exitosos             integer not null default 0 check (exitosos >= 0),
  fallidos             integer not null default 0 check (fallidos >= 0),
  resend_broadcast_id  text unique,
  -- La pone el panel en cada pulsación de «Enviar»: repetir la misma petición no vuelve a enviar.
  clave_idempotencia   uuid unique,
  error                text check (error is null or char_length(error) <= 2000),
  enviado_por          uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  terminado_at         timestamptz
);
comment on table public.newsletter_envios is
  'Historial de envíos del newsletter (lo escribe enviar-newsletter). Un solo envío «enviando» a la vez (índice único '
  'parcial; uno colgado más de 15 min se cierra solo). Las estadísticas salen de email_eventos (metadata.envio_id o '
  'broadcast_id), con newsletter_estadisticas_envios().';
create unique index if not exists newsletter_envios_uno_enviando on public.newsletter_envios (estado) where estado = 'enviando';
create index if not exists newsletter_envios_recientes on public.newsletter_envios (created_at desc);

create table if not exists public.newsletter_plantillas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 80),
  descripcion text not null default '' check (char_length(descripcion) <= 200),
  tipo        text not null default 'personalizada' check (tipo in (
                'novedades', 'oferta', 'temporada', 'trabajos', 'consejos', 'aviso', 'personalizada')),
  titulo      text not null default '' check (char_length(titulo) <= 150),
  insignia    text not null default '' check (char_length(insignia) <= 40),
  preheader   text not null default '' check (char_length(preheader) <= 150),
  bloques     jsonb not null check (jsonb_typeof(bloques) = 'array' and jsonb_array_length(bloques) between 1 and 20
                and octet_length(bloques::text) <= 40000),
  origen      text not null default 'manual' check (origen in ('manual', 'ia')),
  creado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.newsletter_plantillas is
  'Plantillas que guarda el equipo (a mano o desde una propuesta de «Crear con IA»). Las de partida viven en el código '
  '(supabase/functions/_shared/newsletter/bloques.ts). bloques: el mismo formato que valida validarBloques().';
create index if not exists newsletter_plantillas_recientes on public.newsletter_plantillas (updated_at desc);

create table if not exists public.newsletter_ia_peticiones (
  id         bigint generated always as identity primary key,
  modelo     text check (modelo is null or char_length(modelo) <= 120),
  ok         boolean,
  creado_por uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.newsletter_ia_peticiones is
  'Cada llamada a «Crear con IA» (newsletter-ia, con el JWT del usuario): tope de 40 por usuario y día de Madrid.';
create index if not exists newsletter_ia_peticiones_cupo on public.newsletter_ia_peticiones (creado_por, created_at);

-- ─── 4. Resend: sincronización, eventos y supresiones ───────────────────────
create table if not exists public.newsletter_sincronizaciones_resend (
  id                 uuid primary key default gen_random_uuid(),
  origen             text not null check (origen in ('panel', 'cron', 'envio')),
  estado             text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'parcial', 'error')),
  iniciada_at        timestamptz not null default now(),
  terminada_at       timestamptz,
  ejecutada_por      uuid references auth.users(id) on delete set null,
  segment_id         text,
  contactos_resend   integer,
  contactos_segmento integer,
  contactos_ajenos   integer,
  destinatarios      integer,
  altas              integer not null default 0,
  actualizados       integer not null default 0,
  borrados           integer not null default 0,
  bajas_resend       integer not null default 0,
  errores            integer not null default 0,
  pendientes         integer not null default 0,
  mensaje_error      text,
  detalle            jsonb
);
comment on table public.newsletter_sincronizaciones_resend is
  'Una fila por pasada de newsletter-sync-resend (panel, cron diario o antes de un Broadcast): estado del panel y '
  'cerrojo (una sola pasada en_curso). detalle: errores por suscriptor (id, acción, motivo; sin emails).';
create unique index if not exists newsletter_sincronizaciones_resend_una_en_curso
  on public.newsletter_sincronizaciones_resend (estado) where estado = 'en_curso';
create index if not exists newsletter_sincronizaciones_resend_iniciada_idx
  on public.newsletter_sincronizaciones_resend (iniciada_at desc);

create table if not exists public.email_eventos (
  id                 uuid primary key default gen_random_uuid(),
  -- data.email_id del evento; los de contacto (contact.*) llevan un id sintético «tipo:id».
  email_id           text not null check (char_length(email_id) between 1 and 200),
  tipo_evento        text not null check (char_length(tipo_evento) between 1 and 60),
  email_destinatario text check (email_destinatario is null or char_length(email_destinatario) <= 320),
  timestamp_evento   timestamptz,
  -- from, subject, categoria, envio_id, suscriptor_id, broadcast_id, click_link, bounce_message…
  metadata           jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 20000),
  -- svix-id del webhook: Resend reintenta y el mismo evento no se guarda dos veces.
  svix_id            text unique check (svix_id is null or char_length(svix_id) <= 200),
  created_at         timestamptz not null default now()
);
comment on table public.email_eventos is
  'Eventos de Resend que archiva resend-webhook (sent, delivered, opened, clicked, bounced, complained, suppressed…). '
  'De aquí salen las estadísticas del newsletter. Se borran a los 13 meses (newsletter_purgar).';
create index if not exists email_eventos_tipo_idx on public.email_eventos (tipo_evento);
create index if not exists email_eventos_email_id_idx on public.email_eventos (email_id);
create index if not exists email_eventos_creado_idx on public.email_eventos (created_at desc);
create index if not exists email_eventos_envio_idx on public.email_eventos ((metadata ->> 'envio_id')) where metadata ? 'envio_id';
create index if not exists email_eventos_broadcast_idx on public.email_eventos ((metadata ->> 'broadcast_id')) where metadata ? 'broadcast_id';

create table if not exists public.direcciones_email_suprimidas (
  email           text primary key check (char_length(email) between 3 and 320),
  motivo          text not null check (motivo in ('bounced', 'complained', 'suppressed')),
  detalle         text,
  origen_email_id text,
  created_at      timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);
comment on table public.direcciones_email_suprimidas is
  'Direcciones a las que no se vuelve a escribir (rebote permanente, queja de spam o lista de supresión de Resend). '
  'La rellena resend-webhook; email en minúsculas. enviar-newsletter y newsletter-alta las respetan.';

-- ─── 5. Disparadores de newsletter_suscriptores ─────────────────────────────
create or replace function public.newsletter_token_aleatorio()
returns text language sql volatile set search_path = ''
as $$
  -- Dos UUID v4 (pg_strong_random): 244 bits aleatorios en 64 caracteres hexadecimales.
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function public.newsletter_hash_token(p_token text)
returns text language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

create or replace function public.newsletter_normalizar_email()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  if new.nombre is not null then
    new.nombre := nullif(btrim(regexp_replace(new.nombre, '[[:cntrl:]]+', ' ', 'g')), '');
  end if;
  return new;
end;
$$;

-- La máquina de estados (doble opt-in y baja inmutable). Vale para TODAS las escrituras, también la service role.
create or replace function public.newsletter_suscriptores_proteger()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Todo suscriptor nace pendiente de confirmar su email.
    new.estado := 'pendiente';
    new.fecha_verificacion_email := null;
    new.fecha_baja := null;
    new.origen_baja := null;
    new.confirmaciones_enviadas := 0;
    new.confirmacion_enviada_at := null;
    new.resend_contact_id := null;
    new.resend_sincronizado_at := null;
    new.created_at := now();
    new.updated_at := now();
    if new.consentimiento_at is null or new.consentimiento_at > now() + interval '5 minutes' then
      new.consentimiento_at := now();
    end if;
    return new;
  end if;

  if new.email is distinct from old.email then
    raise exception 'newsletter: el email de un suscriptor no se puede cambiar' using errcode = 'check_violation';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.estado = old.estado then
    if new.estado = 'baja' then
      new.fecha_baja := old.fecha_baja;
      new.origen_baja := old.origen_baja;
    elsif new.estado = 'activo' then
      new.fecha_verificacion_email := old.fecha_verificacion_email;
    end if;
    return new;
  end if;

  -- Baja (desde pendiente o activo): siempre con fecha y origen.
  if new.estado = 'baja' then
    new.fecha_baja := coalesce(new.fecha_baja, now());
    new.origen_baja := coalesce(new.origen_baja, 'panel_manual');
    return new;
  end if;

  -- Activación: solo desde newsletter_confirmar (el enlace del correo), que marca la transacción con el id.
  if old.estado = 'pendiente' and new.estado = 'activo' then
    if coalesce(current_setting('newsletter.confirmando', true), '') <> old.id::text then
      raise exception 'newsletter: un suscriptor solo se activa al pulsar el enlace de confirmación de su correo (doble opt-in)'
        using errcode = 'check_violation';
    end if;
    new.fecha_verificacion_email := coalesce(new.fecha_verificacion_email, now());
    return new;
  end if;

  -- Volver a apuntarse tras una baja: consentimiento nuevo y posterior a la baja; vuelve a pedir confirmación.
  if old.estado = 'baja' and new.estado = 'pendiente' then
    if new.consentimiento_at is null or new.consentimiento_at <= old.fecha_baja
       or new.consentimiento_at is not distinct from old.consentimiento_at then
      raise exception 'newsletter: para volver a apuntarse tras una baja hace falta un consentimiento nuevo'
        using errcode = 'check_violation';
    end if;
    new.fecha_baja := null;
    new.origen_baja := null;
    new.fecha_verificacion_email := null;
    new.confirmaciones_enviadas := 0;
    new.confirmacion_enviada_at := null;
    return new;
  end if;

  raise exception 'newsletter: cambio de estado no permitido (% → %)', old.estado, new.estado using errcode = 'check_violation';
end;
$$;

create or replace function public.newsletter_suscriptores_despues()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.newsletter_claves (suscriptor_id, baja_token) values (new.id, public.newsletter_token_aleatorio());
  elsif new.estado = 'baja' and old.estado <> 'baja' then
    -- Un enlace de confirmación anterior a la baja ya no vale.
    update public.newsletter_claves set confirmacion_hash = null, confirmacion_caduca_at = null where suscriptor_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_00_newsletter_normalizar on public.newsletter_suscriptores;
create trigger trg_00_newsletter_normalizar before insert or update of email, nombre on public.newsletter_suscriptores
  for each row execute function public.newsletter_normalizar_email();
drop trigger if exists trg_10_newsletter_proteger on public.newsletter_suscriptores;
create trigger trg_10_newsletter_proteger before insert or update on public.newsletter_suscriptores
  for each row execute function public.newsletter_suscriptores_proteger();
drop trigger if exists trg_newsletter_despues on public.newsletter_suscriptores;
create trigger trg_newsletter_despues after insert or update of estado on public.newsletter_suscriptores
  for each row execute function public.newsletter_suscriptores_despues();

-- Autor y fecha de los ajustes y de las plantillas (los pone el servidor).
create or replace function public.newsletter_config_autor()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.id := 1;
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  new.remitente_email := nullif(lower(btrim(coalesce(new.remitente_email, ''))), '');
  new.responder_a := nullif(lower(btrim(coalesce(new.responder_a, ''))), '');
  new.email_prueba := nullif(lower(btrim(coalesce(new.email_prueba, ''))), '');
  new.remitente_nombre := btrim(new.remitente_nombre);
  new.web_url := rtrim(btrim(new.web_url), '/');
  return new;
end;
$$;
drop trigger if exists trg_newsletter_config_autor on public.newsletter_config;
create trigger trg_newsletter_config_autor before insert or update on public.newsletter_config
  for each row execute function public.newsletter_config_autor();

create or replace function public.newsletter_plantillas_fijar_autor()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.created_at := now();
  else
    -- creado_por solo puede quedar NULL (on delete set null al borrar el usuario).
    if new.creado_por is not null then new.creado_por := old.creado_por; end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists newsletter_plantillas_autor on public.newsletter_plantillas;
create trigger newsletter_plantillas_autor before insert or update on public.newsletter_plantillas
  for each row execute function public.newsletter_plantillas_fijar_autor();

-- Tope diario de «Crear con IA» (día de Madrid), con cerrojo para que dos peticiones a la vez no se lo salten.
create or replace function public.newsletter_comprobar_cupo_ia()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_dia timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v integer;
begin
  perform pg_advisory_xact_lock(hashtext('newsletter_cupo_ia_' || coalesce(auth.uid()::text, '')));
  new.creado_por := auth.uid();
  new.created_at := now();
  new.ok := null;
  select count(*) into v from public.newsletter_ia_peticiones where creado_por = new.creado_por and created_at >= v_dia;
  if v >= 40 then
    raise exception 'newsletter_cupo_ia: has llegado al tope de 40 propuestas de la IA por hoy' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists newsletter_ia_peticiones_cupo on public.newsletter_ia_peticiones;
create trigger newsletter_ia_peticiones_cupo before insert on public.newsletter_ia_peticiones
  for each row execute function public.newsletter_comprobar_cupo_ia();

-- ─── 6. Funciones de las Edge Functions (solo service role) ─────────────────
-- Nuevo token de confirmación para un pendiente: guarda su hash (caduca a los 7 días) y cuenta el envío.
create or replace function public.newsletter_emitir_confirmacion(p_id uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare
  v_token text := public.newsletter_token_aleatorio();
begin
  update public.newsletter_claves
     set confirmacion_hash = public.newsletter_hash_token(v_token),
         confirmacion_caduca_at = now() + interval '7 days'
   where suscriptor_id = p_id;
  update public.newsletter_suscriptores
     set confirmaciones_enviadas = confirmaciones_enviadas + 1,
         confirmacion_enviada_at = now()
   where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'newsletter: solo se confirma a un suscriptor pendiente' using errcode = 'check_violation';
  end if;
  return v_token;
end;
$$;

-- Alta desde la web (Edge Function newsletter-alta, ya validada). Límite por huella de IP; nunca dice si el email ya
-- estaba (la función responde lo mismo siempre). Devuelve {ok, accion, enviar, id?, token?, email?}:
--   pendiente  → nuevo (o pendiente que puede recibir otra confirmación): enviar = true con el token
--   vuelve     → estaba de baja y vuelve a apuntarse (consentimiento nuevo): enviar = true
--   ya_activo  → ya recibe la newsletter: nada que enviar
--   espera     → pendiente con una confirmación reciente (10 min) o ya con 5: nada que enviar
--   suprimida  → la dirección rebotó o marcó spam: no se le escribe
-- {ok: false, motivo: 'limite'} si esa huella ya hizo p_max_hora altas en la última hora.
create or replace function public.newsletter_alta_web(
  p_ip_hash text, p_email text, p_nombre text, p_origen text, p_texto_consentimiento text, p_max_hora integer default 5)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_n integer;
  v_s public.newsletter_suscriptores%rowtype;
  v_token text;
begin
  if p_ip_hash is null or char_length(p_ip_hash) not between 16 and 128 then
    raise exception 'Falta la huella de la IP' using errcode = '22023';
  end if;
  if char_length(v_email) not between 3 and 254 or v_email !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'Email no válido' using errcode = '22023';
  end if;
  if p_origen is null or p_origen not in ('web_formulario', 'web_presupuesto') then
    raise exception 'Origen no válido' using errcode = '22023';
  end if;
  if p_texto_consentimiento is null or char_length(p_texto_consentimiento) not between 10 and 1000 then
    raise exception 'Falta el texto del consentimiento' using errcode = '22023';
  end if;
  if v_nombre is not null and char_length(v_nombre) > 120 then
    raise exception 'Nombre demasiado largo' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('newsletter_alta_web:' || p_ip_hash));
  delete from public.newsletter_altas_limite where creado_en < now() - interval '1 day';
  select count(*) into v_n from public.newsletter_altas_limite where ip_hash = p_ip_hash and creado_en > now() - interval '1 hour';
  if v_n >= greatest(coalesce(p_max_hora, 5), 1) then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  insert into public.newsletter_altas_limite (ip_hash) values (p_ip_hash);

  perform pg_advisory_xact_lock(hashtext('newsletter_email:' || v_email));
  select * into v_s from public.newsletter_suscriptores where email = v_email for update;

  if not found then
    insert into public.newsletter_suscriptores (email, nombre, origen_alta, consentimiento_at, consentimiento_texto)
    values (v_email, v_nombre, p_origen, now(), p_texto_consentimiento)
    returning * into v_s;
    v_token := public.newsletter_emitir_confirmacion(v_s.id);
    return jsonb_build_object('ok', true, 'accion', 'pendiente', 'enviar', true, 'id', v_s.id, 'token', v_token, 'email', v_s.email);
  end if;

  if exists (select 1 from public.direcciones_email_suprimidas d where d.email = v_email) then
    return jsonb_build_object('ok', true, 'accion', 'suprimida', 'enviar', false);
  end if;

  if v_s.estado = 'activo' then
    return jsonb_build_object('ok', true, 'accion', 'ya_activo', 'enviar', false);
  end if;

  if v_s.estado = 'baja' then
    update public.newsletter_suscriptores
       set estado = 'pendiente', nombre = coalesce(v_nombre, nombre), origen_alta = p_origen,
           consentimiento_at = now(), consentimiento_texto = p_texto_consentimiento,
           consentimiento_detalle = null, registrado_por = null
     where id = v_s.id;
    v_token := public.newsletter_emitir_confirmacion(v_s.id);
    return jsonb_build_object('ok', true, 'accion', 'vuelve', 'enviar', true, 'id', v_s.id, 'token', v_token, 'email', v_s.email);
  end if;

  -- Pendiente: se renueva el consentimiento y, si toca, otra confirmación (como mucho 5 y una cada 10 minutos).
  update public.newsletter_suscriptores
     set nombre = coalesce(v_nombre, nombre), consentimiento_at = now(), consentimiento_texto = p_texto_consentimiento
   where id = v_s.id;
  if v_s.confirmaciones_enviadas >= 5
     or (v_s.confirmacion_enviada_at is not null and v_s.confirmacion_enviada_at > now() - interval '10 minutes') then
    return jsonb_build_object('ok', true, 'accion', 'espera', 'enviar', false);
  end if;
  v_token := public.newsletter_emitir_confirmacion(v_s.id);
  return jsonb_build_object('ok', true, 'accion', 'pendiente', 'enviar', true, 'id', v_s.id, 'token', v_token, 'email', v_s.email);
end;
$$;
comment on function public.newsletter_alta_web(text, text, text, text, text, integer) is
  'Alta desde la web (Edge Function newsletter-alta, service role): límite por huella de IP, consentimiento guardado y '
  'token de confirmación (doble opt-in). Nunca activa a nadie. Ver la cabecera de la migración 20261124173700.';

-- Confirmación (enlace del correo → página de la web → newsletter-alta). Solo pendientes y antes de que caduque.
create or replace function public.newsletter_confirmar(p_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_s public.newsletter_suscriptores%rowtype;
  v_id uuid;
  v_caduca timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  select c.suscriptor_id, c.confirmacion_caduca_at into v_id, v_caduca
    from public.newsletter_claves c
   where c.confirmacion_hash = public.newsletter_hash_token(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  select * into v_s from public.newsletter_suscriptores where id = v_id for update;
  if v_s.estado = 'activo' then
    return jsonb_build_object('ok', true, 'estado', 'ya_confirmada', 'email', v_s.email, 'id', v_s.id);
  end if;
  if v_s.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  if v_caduca is null or v_caduca < now() then
    return jsonb_build_object('ok', false, 'estado', 'caducado');
  end if;
  perform set_config('newsletter.confirmando', v_s.id::text, true);
  update public.newsletter_suscriptores set estado = 'activo', fecha_verificacion_email = now() where id = v_s.id;
  perform set_config('newsletter.confirmando', '', true);
  return jsonb_build_object('ok', true, 'estado', 'confirmada', 'email', v_s.email, 'id', v_s.id);
end;
$$;

-- Estado de un enlace de baja (la página de la web lo enseña antes de pedir la confirmación). No cambia nada.
create or replace function public.newsletter_estado_baja(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_s public.newsletter_suscriptores%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  select s.* into v_s from public.newsletter_claves c join public.newsletter_suscriptores s on s.id = c.suscriptor_id
   where c.baja_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  if v_s.estado = 'baja' then
    return jsonb_build_object('ok', true, 'estado', 'ya_estaba', 'email', v_s.email, 'fecha_baja', v_s.fecha_baja);
  end if;
  return jsonb_build_object('ok', true, 'estado', 'confirmar', 'email', v_s.email);
end;
$$;

-- Baja con el token del enlace (pie del correo: enlace_email; botón nativo del programa de correo: cabecera_one_click).
create or replace function public.newsletter_baja_por_token(p_token text, p_origen text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_s public.newsletter_suscriptores%rowtype;
begin
  if p_origen is null or p_origen not in ('enlace_email', 'cabecera_one_click') then
    raise exception 'newsletter_baja_por_token: origen no válido (%)', p_origen using errcode = '22023';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  select s.* into v_s from public.newsletter_claves c join public.newsletter_suscriptores s on s.id = c.suscriptor_id
   where c.baja_token = p_token
   for update of s;
  if not found then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;
  if v_s.estado = 'baja' then
    return jsonb_build_object('ok', true, 'estado', 'ya_estaba', 'email', v_s.email, 'fecha_baja', v_s.fecha_baja, 'id', v_s.id);
  end if;
  update public.newsletter_suscriptores set estado = 'baja', fecha_baja = now(), origen_baja = p_origen
   where id = v_s.id
  returning * into v_s;
  return jsonb_build_object('ok', true, 'estado', 'baja_hecha', 'email', v_s.email, 'fecha_baja', v_s.fecha_baja, 'id', v_s.id,
                            'resend_contact_id', v_s.resend_contact_id);
end;
$$;

-- Baja automática por un evento de Resend (resend-webhook): queja, rebote permanente, supresión o baja en la página de
-- Resend. Por id (etiqueta `suscriptor` del correo) o por email; activos y pendientes. Devuelve cuántas filas cambió.
create or replace function public.newsletter_registrar_baja(p_email text, p_origen text, p_suscriptor_id uuid default null)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_filas integer := 0;
begin
  if p_origen is null or p_origen not in ('queja_spam', 'rebote_permanente', 'suprimido_resend', 'resend_baja_nativa') then
    raise exception 'newsletter_registrar_baja: origen no válido (%)', p_origen using errcode = '22023';
  end if;
  update public.newsletter_suscriptores
     set estado = 'baja', fecha_baja = now(), origen_baja = p_origen
   where estado in ('activo', 'pendiente')
     and ((p_suscriptor_id is not null and id = p_suscriptor_id)
          or (p_email is not null and email = lower(btrim(p_email))));
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- Pendientes a los que mandar (otra) confirmación desde el panel (enviar-newsletter, acción «confirmaciones», tras
-- comprobar «Editar»): como mucho 5 confirmaciones por persona y una al día; nunca a direcciones suprimidas.
create or replace function public.newsletter_preparar_confirmaciones(p_ids uuid[] default null, p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_salida jsonb := '[]'::jsonb;
begin
  for r in
    select s.id, s.email, s.nombre
      from public.newsletter_suscriptores s
     where s.estado = 'pendiente'
       and (p_ids is null or s.id = any (p_ids))
       and s.confirmaciones_enviadas < 5
       and (s.confirmacion_enviada_at is null or s.confirmacion_enviada_at < now() - interval '24 hours')
       and not exists (select 1 from public.direcciones_email_suprimidas d where d.email = s.email)
     order by s.created_at
     limit least(greatest(coalesce(p_limite, 50), 1), 100)
     for update of s skip locked
  loop
    v_salida := v_salida || jsonb_build_object('id', r.id, 'email', r.email, 'nombre', r.nombre,
                                               'token', public.newsletter_emitir_confirmacion(r.id));
  end loop;
  return v_salida;
end;
$$;

-- newsletter-sync-resend: guarda resend_contact_id / resend_sincronizado_at de las filas que cambiaron.
create or replace function public.newsletter_marcar_sincronizados(p_items jsonb)
returns integer language plpgsql security invoker set search_path = public
as $$
declare
  v_filas integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'newsletter_marcar_sincronizados: p_items debe ser un array JSON';
  end if;
  update public.newsletter_suscriptores s
     set resend_contact_id = nullif(i.contact_id, ''),
         resend_sincronizado_at = now()
    from jsonb_to_recordset(p_items) as i(id uuid, contact_id text)
   where s.id = i.id;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- ─── 7. Funciones del panel (exigen «Editar» en Newsletter) ─────────────────
create or replace function public.newsletter_exigir_edicion()
returns void language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_edit_section('newsletter') then
    raise exception 'Hace falta «Editar» en Newsletter' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.newsletter_texto_alta_panel()
returns text language sql immutable set search_path = ''
as $$
  select 'Alta desde el panel por un usuario del equipo: la persona aceptó recibir por correo las novedades de '
         || 'Cristalería Baix Vinalopó. La suscripción solo se activa cuando confirma desde el enlace que se le envía.'
$$;

-- Una alta del panel o de una importación. Siempre pendiente; una baja no se reabre desde el panel (solo vuelve si se
-- apunta él mismo en la web).
create or replace function public.newsletter_alta_equipo(p_email text, p_nombre text, p_detalle text, p_origen text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_s public.newsletter_suscriptores%rowtype;
begin
  if char_length(v_email) not between 3 and 254 or v_email !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'accion', 'invalido', 'email', left(v_email, 254));
  end if;
  if v_nombre is not null and char_length(v_nombre) > 120 then
    v_nombre := left(v_nombre, 120);
  end if;
  select * into v_s from public.newsletter_suscriptores where email = v_email for update;
  if found then
    if v_s.estado = 'activo' then return jsonb_build_object('ok', true, 'accion', 'ya_activo', 'id', v_s.id); end if;
    if v_s.estado = 'baja' then return jsonb_build_object('ok', false, 'accion', 'baja_previa', 'id', v_s.id); end if;
    if v_nombre is not null and v_s.nombre is null then
      update public.newsletter_suscriptores set nombre = v_nombre where id = v_s.id;
    end if;
    return jsonb_build_object('ok', true, 'accion', 'ya_pendiente', 'id', v_s.id);
  end if;
  insert into public.newsletter_suscriptores (email, nombre, origen_alta, consentimiento_at, consentimiento_texto,
                                              consentimiento_detalle, registrado_por)
  values (v_email, v_nombre, p_origen, now(), public.newsletter_texto_alta_panel(), p_detalle, auth.uid())
  returning * into v_s;
  return jsonb_build_object('ok', true, 'accion', 'creado', 'id', v_s.id);
end;
$$;

create or replace function public.newsletter_alta_panel(p_email text, p_nombre text, p_detalle text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_detalle text := btrim(coalesce(p_detalle, ''));
begin
  perform public.newsletter_exigir_edicion();
  if char_length(v_detalle) not between 5 and 500 then
    raise exception 'Apunta cómo dio su consentimiento (entre 5 y 500 caracteres)' using errcode = '22023';
  end if;
  return public.newsletter_alta_equipo(p_email, p_nombre, v_detalle, 'panel_manual');
end;
$$;
comment on function public.newsletter_alta_panel(text, text, text) is
  'Newsletter › Suscriptores › Añadir (con «Editar»): alta pendiente de confirmar con el consentimiento apuntado '
  '(cómo lo dio y quién lo registra). Devuelve {ok, accion: creado | ya_pendiente | ya_activo | baja_previa | invalido, id}.';

create or replace function public.newsletter_importar(p_filas jsonb, p_detalle text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_detalle text := btrim(coalesce(p_detalle, ''));
  v_fila jsonb;
  v_r jsonb;
  v_creados integer := 0; v_pendientes integer := 0; v_activos integer := 0; v_bajas integer := 0; v_invalidos integer := 0;
begin
  perform public.newsletter_exigir_edicion();
  if char_length(v_detalle) not between 5 and 500 then
    raise exception 'Apunta cómo dieron su consentimiento (entre 5 y 500 caracteres)' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'La importación no es válida' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'Como mucho 2000 filas por importación' using errcode = '22023';
  end if;
  for v_fila in select value from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      v_invalidos := v_invalidos + 1;
      continue;
    end if;
    v_r := public.newsletter_alta_equipo(v_fila->>'email', v_fila->>'nombre', v_detalle, 'importacion');
    case v_r->>'accion'
      when 'creado' then v_creados := v_creados + 1;
      when 'ya_pendiente' then v_pendientes := v_pendientes + 1;
      when 'ya_activo' then v_activos := v_activos + 1;
      when 'baja_previa' then v_bajas := v_bajas + 1;
      else v_invalidos := v_invalidos + 1;
    end case;
  end loop;
  return jsonb_build_object('ok', true, 'creados', v_creados, 'ya_pendientes', v_pendientes, 'ya_activos', v_activos,
                            'bajas_previas', v_bajas, 'invalidos', v_invalidos, 'total', jsonb_array_length(p_filas));
end;
$$;

create or replace function public.newsletter_baja_panel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_s public.newsletter_suscriptores%rowtype;
begin
  perform public.newsletter_exigir_edicion();
  select * into v_s from public.newsletter_suscriptores where id = p_id for update;
  if not found then raise exception 'Suscriptor no encontrado' using errcode = 'P0002'; end if;
  if v_s.estado = 'baja' then return jsonb_build_object('ok', true, 'estado', 'ya_estaba'); end if;
  update public.newsletter_suscriptores set estado = 'baja', fecha_baja = now(), origen_baja = 'panel_manual' where id = p_id;
  return jsonb_build_object('ok', true, 'estado', 'baja_hecha');
end;
$$;

-- Supresión RGPD (derecho de supresión, art. 17): borra al suscriptor, sus tokens y sus eventos de correo, y quita su
-- email y su nombre del rastro de auditoría. La dirección sigue en direcciones_email_suprimidas si rebotó o marcó spam
-- (para no volver a escribirle).
create or replace function public.newsletter_suprimir(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_s public.newsletter_suscriptores%rowtype;
  v_eventos integer := 0;
begin
  perform public.newsletter_exigir_edicion();
  select * into v_s from public.newsletter_suscriptores where id = p_id for update;
  if not found then raise exception 'Suscriptor no encontrado' using errcode = 'P0002'; end if;
  delete from public.email_eventos where lower(email_destinatario) = v_s.email or metadata->>'suscriptor_id' = v_s.id::text;
  get diagnostics v_eventos = row_count;
  delete from public.newsletter_suscriptores where id = p_id;
  update public.audit_log
     set detalles = detalles
         || case when jsonb_typeof(detalles -> 'antes') = 'object'
                 then jsonb_build_object('antes', (detalles -> 'antes') - 'email' - 'nombre' - 'consentimiento_detalle')
                 else '{}'::jsonb end
         || case when jsonb_typeof(detalles -> 'despues') = 'object'
                 then jsonb_build_object('despues', (detalles -> 'despues') - 'email' - 'nombre' - 'consentimiento_detalle')
                 else '{}'::jsonb end
   where tabla = 'newsletter_suscriptores' and registro_id = p_id::text and jsonb_typeof(detalles) = 'object';
  return jsonb_build_object('ok', true, 'eventos_borrados', v_eventos);
end;
$$;

-- ─── 8. Estadísticas ────────────────────────────────────────────────────────
-- Eventos de Resend por envío (envíos uno a uno: metadata.envio_id; Broadcasts: metadata.broadcast_id), con
-- destinatarios distintos. SECURITY INVOKER: respeta la RLS (quien ve Newsletter).
create or replace function public.newsletter_estadisticas_envios(p_envio_ids uuid[])
returns table (envio_id uuid, tipo_evento text, eventos bigint, destinatarios bigint)
language sql stable security invoker set search_path = public
as $$
  select e.id, ev.tipo_evento, count(*), count(distinct lower(ev.email_destinatario))
    from public.newsletter_envios e
    join public.email_eventos ev
      on ev.metadata ->> 'envio_id' = e.id::text
      or (e.resend_broadcast_id is not null and ev.metadata ->> 'broadcast_id' = e.resend_broadcast_id)
   where e.id = any (p_envio_ids)
   group by e.id, ev.tipo_evento
$$;

-- ─── 9. Tareas programadas ──────────────────────────────────────────────────
create or replace function public.newsletter_disparar_sync()
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
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 150000)'
    using rtrim(v_url, '/') || '/functions/v1/newsletter-sync-resend',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          jsonb_build_object('accion', 'sincronizar');
  return 'llamada';
end;
$$;
comment on function public.newsletter_disparar_sync() is
  'Lo llama pg_cron (newsletter-sync-resend, 05:20 UTC): POST a la Edge Function newsletter-sync-resend con x-ocr-secret. '
  'Necesita en Vault project_url y ocr_trabajos_secret; sin ellos devuelve sin_vault y no llama a nadie.';

create or replace function public.newsletter_purgar()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_pendientes integer; v_limite integer; v_ia integer; v_eventos integer;
begin
  -- Minimización (RGPD): quien no confirmó en 30 días desde su última confirmación se borra.
  delete from public.newsletter_suscriptores
   where estado = 'pendiente'
     and coalesce(confirmacion_enviada_at, consentimiento_at) < now() - interval '30 days';
  get diagnostics v_pendientes = row_count;
  delete from public.newsletter_altas_limite where creado_en < now() - interval '1 day';
  get diagnostics v_limite = row_count;
  delete from public.newsletter_ia_peticiones where created_at < now() - interval '90 days';
  get diagnostics v_ia = row_count;
  delete from public.email_eventos where created_at < now() - interval '13 months';
  get diagnostics v_eventos = row_count;
  return jsonb_build_object('pendientes', v_pendientes, 'limite', v_limite, 'ia', v_ia, 'eventos', v_eventos);
end;
$$;
comment on function public.newsletter_purgar() is
  'pg_cron newsletter-purgar (04:10 UTC): altas sin confirmar de más de 30 días, límite por IP de más de un día, '
  'peticiones a la IA de más de 90 días y eventos de correo de más de 13 meses.';

-- ─── 10. Permisos: tablas ───────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['newsletter_config', 'newsletter_suscriptores', 'newsletter_claves', 'newsletter_altas_limite',
                           'newsletter_envios', 'newsletter_plantillas', 'newsletter_ia_peticiones',
                           'newsletter_sincronizaciones_resend', 'email_eventos', 'direcciones_email_suprimidas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
  foreach t in array array['newsletter_config', 'newsletter_suscriptores', 'newsletter_envios', 'newsletter_plantillas',
                           'newsletter_ia_peticiones', 'newsletter_sincronizaciones_resend', 'email_eventos',
                           'direcciones_email_suprimidas'] loop
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
                      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    -- Lectura: quien ve Newsletter (super admin siempre).
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''newsletter'')))',
                   t || '_lectura', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- Ajustes: «Editar» los cambia (sin crear ni borrar la fila).
grant update (remitente_email, remitente_nombre, responder_a, canal, email_prueba, limite_transaccional, web_url)
  on public.newsletter_config to authenticated;
drop policy if exists newsletter_config_editar on public.newsletter_config;
create policy newsletter_config_editar on public.newsletter_config for update to authenticated
  using ((select public.can_edit_section('newsletter'))) with check ((select public.can_edit_section('newsletter')));

-- Plantillas: «Editar» crea, cambia y borra.
grant insert, update, delete on public.newsletter_plantillas to authenticated;
drop policy if exists newsletter_plantillas_insert on public.newsletter_plantillas;
create policy newsletter_plantillas_insert on public.newsletter_plantillas for insert to authenticated
  with check ((select public.can_edit_section('newsletter')));
drop policy if exists newsletter_plantillas_update on public.newsletter_plantillas;
create policy newsletter_plantillas_update on public.newsletter_plantillas for update to authenticated
  using ((select public.can_edit_section('newsletter'))) with check ((select public.can_edit_section('newsletter')));
drop policy if exists newsletter_plantillas_delete on public.newsletter_plantillas;
create policy newsletter_plantillas_delete on public.newsletter_plantillas for delete to authenticated
  using ((select public.can_edit_section('newsletter')));

-- Peticiones a la IA: las inserta newsletter-ia con el JWT del usuario y marca si salió bien (solo la columna ok, solo
-- las suyas).
grant insert on public.newsletter_ia_peticiones to authenticated;
grant update (ok) on public.newsletter_ia_peticiones to authenticated;
drop policy if exists newsletter_ia_peticiones_insert on public.newsletter_ia_peticiones;
create policy newsletter_ia_peticiones_insert on public.newsletter_ia_peticiones for insert to authenticated
  with check ((select public.can_edit_section('newsletter')));
drop policy if exists newsletter_ia_peticiones_update on public.newsletter_ia_peticiones;
create policy newsletter_ia_peticiones_update on public.newsletter_ia_peticiones for update to authenticated
  using ((select public.can_edit_section('newsletter')) and creado_por = (select auth.uid()))
  with check ((select public.can_edit_section('newsletter')) and creado_por = (select auth.uid()));

-- ─── 11. Permisos: funciones ────────────────────────────────────────────────
revoke all on function
  public.newsletter_token_aleatorio(), public.newsletter_hash_token(text), public.newsletter_normalizar_email(),
  public.newsletter_suscriptores_proteger(), public.newsletter_suscriptores_despues(), public.newsletter_config_autor(),
  public.newsletter_plantillas_fijar_autor(), public.newsletter_comprobar_cupo_ia(),
  public.newsletter_emitir_confirmacion(uuid),
  public.newsletter_alta_web(text, text, text, text, text, integer), public.newsletter_confirmar(text),
  public.newsletter_estado_baja(text), public.newsletter_baja_por_token(text, text),
  public.newsletter_registrar_baja(text, text, uuid), public.newsletter_preparar_confirmaciones(uuid[], integer),
  public.newsletter_marcar_sincronizados(jsonb), public.newsletter_exigir_edicion(), public.newsletter_texto_alta_panel(),
  public.newsletter_alta_equipo(text, text, text, text), public.newsletter_alta_panel(text, text, text),
  public.newsletter_importar(jsonb, text), public.newsletter_baja_panel(uuid), public.newsletter_suprimir(uuid),
  public.newsletter_estadisticas_envios(uuid[]), public.newsletter_disparar_sync(), public.newsletter_purgar()
from public, anon, authenticated;

-- Las de las Edge Functions, solo service role.
grant execute on function
  public.newsletter_alta_web(text, text, text, text, text, integer), public.newsletter_confirmar(text),
  public.newsletter_estado_baja(text), public.newsletter_baja_por_token(text, text),
  public.newsletter_registrar_baja(text, text, uuid), public.newsletter_preparar_confirmaciones(uuid[], integer),
  public.newsletter_marcar_sincronizados(jsonb), public.newsletter_disparar_sync(), public.newsletter_purgar()
to service_role;
-- Las del panel (comprueban «Editar» dentro) y las estadísticas (RLS).
grant execute on function
  public.newsletter_alta_panel(text, text, text), public.newsletter_importar(jsonb, text),
  public.newsletter_baja_panel(uuid), public.newsletter_suprimir(uuid), public.newsletter_estadisticas_envios(uuid[])
to authenticated, service_role;

-- ─── 12. Auditoría: fuera las tablas de datos derivados y los tokens ────────
-- En Supabase el disparador de eventos pone trg_auditoria a cada tabla nueva; estas no lo necesitan (o no deben
-- copiar tokens ni miles de eventos al rastro). Como Logs web: se añaden a la lista de exclusión de
-- instalar_auditoria_panel() y del disparador de eventos (también en una reinstalación), anclando en 'metricas' para
-- no pisar la lista de Logs web. Ajustes, suscriptores, envíos y plantillas sí se auditan.
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''metricas'')' in v_def) > 0 and position('''newsletter_claves''' in v_def) = 0 then
      execute replace(v_def, '''metricas'')',
        '''metricas'',''newsletter_claves'',''newsletter_altas_limite'',''newsletter_ia_peticiones'',''newsletter_sincronizaciones_resend'',''email_eventos'')');
    end if;
  end loop;
end;
$$;
drop trigger if exists trg_auditoria on public.newsletter_claves;
drop trigger if exists trg_auditoria on public.newsletter_altas_limite;
drop trigger if exists trg_auditoria on public.newsletter_ia_peticiones;
drop trigger if exists trg_auditoria on public.newsletter_sincronizaciones_resend;
drop trigger if exists trg_auditoria on public.email_eventos;

-- ─── 13. IA: función con modelo elegible y consumo contabilizado ────────────
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo) values
        ('newsletter-ia', 'Newsletter · «Crear con IA»: redacta el correo y propone su presentación por bloques.', true, 'propuesta', 960, true)
      on conflict (funcion) do nothing
    $q$;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado) values
        ('newsletter-ia', 'gpt-4.1-mini, en código (NEWSLETTER_IA_MODEL)', true)
      on conflict (funcion) do nothing
    $q$;
  end if;
end;
$$;

-- ─── 14. Tareas pg_cron ─────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('newsletter-sync-resend', 'newsletter-purgar');
    perform cron.schedule('newsletter-sync-resend', '20 5 * * *', $cron$ select public.newsletter_disparar_sync(); $cron$);
    perform cron.schedule('newsletter-purgar', '10 4 * * *', $cron$ select public.newsletter_purgar(); $cron$);
  else
    raise notice 'Sin pg_cron: las tareas newsletter-sync-resend y newsletter-purgar NO se han instalado.';
  end if;
end;
$$;
