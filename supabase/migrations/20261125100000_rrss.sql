-- ============================================================================
--  Panel de Cristalería BV · Marketing › RRSS (25/11/2026)
-- ----------------------------------------------------------------------------
--  Petición del dueño: «RRSS» como uno de los módulos traídos del panel de
--  referencia (después de Tráfico web, Logs y Newsletter), automático y tan
--  completo como allí, adaptado a una cristalería: nada de restaurante.
--
--  Portado de las migraciones de Instagram y RRSS de la referencia (piezas,
--  fotos, programación, publicación solo por el servidor, limpieza del cubo,
--  IA, campañas, carrusel, vídeo, métricas, «qué funciona» y ajustes de estilo)
--  y adaptado:
--    · Una sola cuenta (la de la cristalería): Instagram profesional y su página
--      de Facebook, conectadas desde el panel con el botón «Conectar con
--      Facebook» (OAuth de una app de Meta) o con un token de usuario del
--      sistema en los secretos de Supabase, como en la referencia.
--    · Los tokens NUNCA llegan al navegador: van cifrados (AES-GCM, clave en los
--      secretos de las funciones) en rrss_meta_tokens, que ni el panel ni la
--      clave pública pueden leer. Lo que sí ve el panel (cuenta, página,
--      permisos y caducidades) está en rrss_meta_cuenta.
--    · Sin servidor de render (Chromium, ffmpeg): el panel recorta las fotos a
--      JPEG en el navegador (4:5, 1:1, 1,91:1 o 9:16) y las sube al cubo
--      PRIVADO «rrss»; las funciones dan a Meta una URL firmada en el momento
--      de publicar. Los vídeos (reels, stories, carruseles) se suben tal cual.
--    · Las fotos pueden salir de Web › Fotos (web_fotos, por tipo de trabajo):
--      rrss_fotos_web() las lista para quien ve RRSS aunque no vea Web › Fotos.
--    · Facebook también publica (foto, varias fotos y vídeo) en la página
--      conectada: cada red es una pieza (rrss_piezas.red), las dos de un mismo
--      envío comparten grupo_id y los mismos ficheros.
--    · Sin encargos a una agencia ni plantillas con rótulos de restaurante;
--      las fechas señaladas y la guía de estilo son de una cristalería de Elche.
--
--  Tablas: rrss_ajustes, rrss_meta_cuenta, rrss_meta_tokens, rrss_oauth_estados,
--  rrss_campanas, rrss_piezas, rrss_medios, rrss_programaciones,
--  rrss_ia_peticiones, rrss_fechas, rrss_metricas_cuenta,
--  rrss_metricas_publicacion (y su vista _ultima) y rrss_metricas_capturas.
--  Cubo privado «rrss» (50 MB por fichero): subidas/<usuario>/<uuid>.jpg|mp4|mov.
--
--  Estados de una pieza:
--    borrador → lista → publicando → publicada
--                         └→ procesando (Meta aún procesa el vídeo o el carrusel:
--                            el programador lo retoma) → publicada
--                         └→ error (se puede corregir y volver a intentar)
--  El panel solo crea y cambia piezas en borrador, lista o error; lo demás lo
--  escriben las funciones (service role) con las RPC de reserva y cierre.
--
--  Programación (como en la referencia, tabla aparte): programada → publicando
--  → publicada, o error (3 intentos) / cancelada. Una activa por pieza.
--
--  Permisos: sección «rrss». «Ver» consulta piezas, calendario, métricas y la
--  conexión; «Editar» crea, sube, publica, programa, usa la IA, conecta la
--  cuenta y cambia el estilo. Super admin, todo. La clave pública (anon), nada.
--  Barrera de sesión (acceso_panel_no_bloqueado) en todo lo que lee el panel.
--
--  Tareas pg_cron (Vault: project_url y ocr_trabajos_secret; sin ellos no
--  llaman a nadie):
--    · rrss-programador (cada 5 min, solo si hay trabajo): publica lo vencido y
--      cierra lo que Meta estaba procesando.
--    · rrss-metricas (05:10 UTC): métricas de la cuenta y de las publicaciones.
--    · rrss-mantenimiento (03:50 UTC): purga en SQL, limpieza del cubo y
--      revisión del token (aviso en la campana si caduca pronto).
--
--  Lo que tiene que hacer el dueño (app de Meta, cuenta profesional, página,
--  secretos, URL de redirección) está en docs/RRSS.md. Sin esa configuración
--  nada se publica ni se rompe, y no se llama a Meta.
--
--  Vuelta atrás: supabase/rollbacks/20261125100000_rrss_ROLLBACK.sql.
-- ============================================================================

set check_function_bodies = off;

-- ─── 0. Comprobaciones previas ──────────────────────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regprocedure('public.can_read_section(text)') is null then v_faltan := v_faltan || 'can_read_section'::text; end if;
  if to_regprocedure('public.can_edit_section(text)') is null then v_faltan := v_faltan || 'can_edit_section'::text; end if;
  if to_regprocedure('private.sesion_panel_permitida()') is null then v_faltan := v_faltan || 'private.sesion_panel_permitida'::text; end if;
  if to_regclass('public.web_fotos') is null then v_faltan := v_faltan || 'web_fotos (20261123100000_web_y_presupuestos)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'rrss: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Utilidades ──────────────────────────────────────────────────────────
-- Ruta de un fichero del cubo «rrss»: subidas/<uuid del usuario>/<uuid>.jpg|mp4|mov.
create or replace function public.rrss_ruta_valida(p_ruta text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(p_ruta ~ '^subidas/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|mov)$', false)
$$;

-- Hashtags: «#algo», sin espacios ni otra almohadilla, 2-60 caracteres.
create or replace function public.rrss_hashtags_validos(p text[])
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(bool_and(h ~ '^#[^[:space:]#]{1,59}$'), true) from unnest(coalesce(p, '{}'::text[])) as t(h)
$$;

create or replace function public.rrss_textos_validos(p text[], p_max integer)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(bool_and(char_length(btrim(x)) between 1 and p_max), true) from unnest(coalesce(p, '{}'::text[])) as t(x)
$$;

-- Lo que puede hacer quien llama desde el panel: «Editar» en RRSS y sesión de panel viva.
create or replace function public.rrss_exigir_edicion()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_section('rrss'), false) then
    raise exception 'Hace falta «Editar» en RRSS' using errcode = '42501';
  end if;
  if not coalesce((select private.sesion_panel_permitida()), false) then
    raise exception 'Sesión de panel no válida' using errcode = '42501';
  end if;
end;
$$;

-- ¿Quien escribe es el panel (rol authenticated/anon) y no una función con service role o una RPC del servidor?
create or replace function public.rrss_es_panel()
returns boolean language sql stable set search_path = ''
as $$
  select current_user::text in ('authenticated', 'anon')
$$;

-- ─── 2. Cubo privado «rrss» ─────────────────────────────────────────────────
--   subidas/<usuario>/<uuid>.jpg    fotos ya recortadas a JPEG por el panel (de una subida o de Web › Fotos)
--   subidas/<usuario>/<uuid>.mp4    vídeos (reels, stories y carruseles), tal cual
-- Privado: Meta recibe una URL firmada en el momento de publicar (la crea la función con service role). Leer: «Ver»
-- en RRSS. Subir: «Editar», solo en su carpeta. Nada se sobrescribe (sin UPDATE). Borrar: «Editar», solo ficheros que
-- ninguna pieza usa. El resto lo limpia rrss-programador (mantenimiento).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('rrss', 'rrss', false, 52428800, array['image/jpeg', 'video/mp4', 'video/quicktime'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

-- ─── 3. Ajustes y estilo (una fila) ─────────────────────────────────────────
create table if not exists public.rrss_ajustes (
  id                   smallint primary key default 1 check (id = 1),
  -- Zona que se nombra en los textos.
  zona                 text not null default 'Elche y el Baix Vinalopó' check (char_length(btrim(zona)) between 2 and 120),
  tono                 text not null default 'cercano' check (tono in ('cercano', 'profesional', 'tecnico')),
  -- Guía de estilo para la IA (se le pasa como datos, nunca como instrucciones).
  guia                 text not null default
    'Cristalería de barrio con taller propio en Elche: hablamos claro y de tú, sin exagerar. Enseñamos el trabajo '
    'terminado (mamparas, espejos, cerramientos, ventanas y puertas de aluminio, barandillas de cristal, armarios) y '
    'explicamos en una frase qué problema resolvió: más luz, menos ruido, más espacio, un baño más fácil de limpiar. '
    'Nada de precios ni ofertas que no estén confirmados. Cerramos con una llamada a pedir presupuesto sin compromiso.'
    check (char_length(btrim(guia)) between 1 and 4000),
  hashtags_base        text[] not null default array['#cristaleria', '#elche', '#baixvinalopo', '#reformas']
    check (cardinality(hashtags_base) <= 15 and public.rrss_hashtags_validos(hashtags_base)),
  ctas                 text[] not null default array['Pide presupuesto sin compromiso', 'Escríbenos por WhatsApp',
                                                     'Ven a vernos al taller']
    check (cardinality(ctas) <= 8 and public.rrss_textos_validos(ctas, 120)),
  palabras_evitar      text[] not null default '{}'
    check (cardinality(palabras_evitar) <= 30 and public.rrss_textos_validos(palabras_evitar, 60)),
  -- Al crear una publicación, marcar también la página de Facebook.
  facebook_por_defecto boolean not null default false,
  -- Emojis en los textos que propone la IA (con moderación).
  emojis               boolean not null default true,
  -- «Aprender de lo publicado»: cuándo se aplicó la última propuesta y su resumen.
  aprendido_en         timestamptz,
  aprendido_resumen    text check (aprendido_resumen is null or char_length(aprendido_resumen) <= 2000),
  version              integer not null default 1 check (version >= 1),
  actualizado_en       timestamptz not null default now(),
  actualizado_por      uuid
);
comment on table public.rrss_ajustes is
  'Ajustes y estilo de RRSS (una fila, id = 1), editables en RRSS › Conexión y estilo con «Editar»: zona, tono, guía de '
  'estilo para la IA, hashtags base, llamadas a la acción, palabras a evitar, Facebook por defecto y emojis. '
  'version sube al cambiar la guía, los hashtags o las CTA. Los secretos no van aquí.';
insert into public.rrss_ajustes (id) values (1) on conflict (id) do nothing;

create or replace function public.rrss_ajustes_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.id := 1;
  if new.guia is distinct from old.guia or new.hashtags_base is distinct from old.hashtags_base or new.ctas is distinct from old.ctas
     or new.palabras_evitar is distinct from old.palabras_evitar or new.tono is distinct from old.tono then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;
drop trigger if exists rrss_ajustes_al_editar on public.rrss_ajustes;
create trigger rrss_ajustes_al_editar before update on public.rrss_ajustes
  for each row execute function public.rrss_ajustes_al_editar();

-- ─── 4. Conexión con Meta ───────────────────────────────────────────────────
-- Lo que ve el panel de la conexión (sin ningún token).
create table if not exists public.rrss_meta_cuenta (
  id                      smallint primary key default 1 check (id = 1),
  estado                  text not null default 'sin_conectar'
                          check (estado in ('sin_conectar', 'eligiendo_pagina', 'conectada', 'caducada', 'error')),
  -- conexion = botón «Conectar con Facebook» (tokens cifrados en rrss_meta_tokens); secretos = IG_ACCESS_TOKEN.
  origen                  text check (origen is null or origen in ('conexion', 'secretos')),
  ig_user_id              text check (ig_user_id is null or ig_user_id ~ '^[0-9]{1,30}$'),
  ig_usuario              text check (ig_usuario is null or char_length(ig_usuario) <= 60),
  ig_nombre               text check (ig_nombre is null or char_length(ig_nombre) <= 200),
  ig_foto_url             text check (ig_foto_url is null or (char_length(ig_foto_url) <= 2000 and ig_foto_url ~ '^https://')),
  fb_pagina_id            text check (fb_pagina_id is null or fb_pagina_id ~ '^[0-9]{1,30}$'),
  fb_pagina_nombre        text check (fb_pagina_nombre is null or char_length(fb_pagina_nombre) <= 200),
  permisos                text[] not null default '{}' check (cardinality(permisos) <= 60),
  -- null = no caduca (token de usuario del sistema o de página) o sin dato.
  token_caduca_en         timestamptz,
  -- A los 90 días sin volver a conectar, Meta corta el acceso a los datos: hay que pulsar «Renovar conexión».
  acceso_datos_caduca_en  timestamptz,
  -- Páginas para elegir (si la persona administra varias). SIN tokens: esos van cifrados en rrss_meta_tokens.
  paginas_candidatas      jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(paginas_candidatas) = 'array' and jsonb_array_length(paginas_candidatas) <= 50
                                 and pg_column_size(paginas_candidatas) <= 32768),
  conectado_por           uuid,
  conectado_en            timestamptz,
  comprobado_en           timestamptz,
  error                   text check (error is null or char_length(error) <= 1000),
  -- Clave del último aviso de caducidad enviado a la campana (para no repetirlo).
  aviso_clave             text check (aviso_clave is null or char_length(aviso_clave) <= 120),
  actualizado_en          timestamptz not null default now()
);
comment on table public.rrss_meta_cuenta is
  'Conexión de RRSS con Meta (una fila): cuenta de Instagram, página de Facebook, permisos y caducidades. SIN tokens. '
  'La escriben solo las funciones rrss-conexion, rrss-oauth y rrss-programador (service role).';
insert into public.rrss_meta_cuenta (id) values (1) on conflict (id) do nothing;

-- Tokens cifrados (formato v1.<iv>.<datos>, AES-GCM con la clave de los secretos de las funciones). Sin políticas ni
-- privilegios para el panel ni la clave pública: solo service role. Fuera de la auditoría.
create table if not exists public.rrss_meta_tokens (
  id              smallint primary key default 1 check (id = 1),
  token_usuario   text check (token_usuario is null or (char_length(token_usuario) <= 20000 and token_usuario ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')),
  token_pagina    text check (token_pagina is null or (char_length(token_pagina) <= 20000 and token_pagina ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')),
  candidatos      text check (candidatos is null or (char_length(candidatos) <= 200000 and candidatos ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')),
  actualizado_en  timestamptz not null default now()
);
comment on table public.rrss_meta_tokens is
  'Tokens de Meta CIFRADOS (usuario de larga duración, página y, mientras se elige, las páginas candidatas). Solo '
  'service role: ni el panel ni la clave pública lo leen. Nunca sale en respuestas ni en la auditoría.';
insert into public.rrss_meta_tokens (id) values (1) on conflict (id) do nothing;

-- «state» del OAuth: se guarda su sha256 (el valor solo viaja en la URL), de un solo uso, 15 minutos. Solo service role.
create table if not exists public.rrss_oauth_estados (
  hash        text primary key check (hash ~ '^[0-9a-f]{64}$'),
  usuario_id  uuid not null,
  volver_a    text not null check (char_length(volver_a) <= 200 and volver_a ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{2,5})?$'),
  creado_en   timestamptz not null default now(),
  caduca_en   timestamptz not null default now() + interval '15 minutes',
  usado_en    timestamptz
);
comment on table public.rrss_oauth_estados is
  'state del «Conectar con Facebook» (sha256), ligado a quien lo pidió y al panel al que se vuelve. Un solo uso, 15 '
  'minutos. Solo service role (rrss-conexion lo crea, rrss-oauth lo gasta con rrss_oauth_usar_estado).';

-- Gasta un state: devuelve quién lo pidió y adónde volver solo si existe, no se usó y no ha caducado.
create or replace function public.rrss_oauth_usar_estado(p_hash text)
returns table (usuario_id uuid, volver_a text)
language sql volatile security definer set search_path = ''
as $$
  update public.rrss_oauth_estados e
     set usado_en = now()
   where e.hash = p_hash and e.usado_en is null and e.caduca_en > now()
  returning e.usuario_id, e.volver_a
$$;

-- ─── 5. Campañas (antes que las piezas: las piezas de una campaña la referencian) ──
create table if not exists public.rrss_campanas (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null check (char_length(btrim(titulo)) between 1 and 160),
  objetivo      text check (objetivo is null or char_length(objetivo) <= 600),
  -- Lo que pidió la persona (anonimizado por la función).
  peticion      text check (peticion is null or char_length(peticion) <= 600),
  desde         date not null,
  hasta         date not null,
  estado        text not null default 'propuesta' check (estado in ('propuesta', 'aceptada', 'descartada')),
  -- { fases: [...], piezas: [{ fecha, hora, formato, servicio, titulo, idea, caption, hashtags, porQue, fase }] }
  propuesta     jsonb not null check (jsonb_typeof(propuesta) = 'object' and pg_column_size(propuesta) <= 131072),
  modelo        text check (modelo is null or char_length(modelo) <= 80),
  creado_por    uuid default auth.uid(),
  aceptada_por  uuid,
  aceptada_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rrss_campanas_fechas check (hasta >= desde and hasta - desde <= 62)
);
comment on table public.rrss_campanas is
  'Campañas de 2 a 4 semanas que propone la IA (rrss-ia, acción campana). Al aceptarlas (rrss_aceptar_campana) sus '
  'piezas marcadas se crean como BORRADORES con fecha prevista; nada se programa ni se publica solo.';
create index if not exists rrss_campanas_created_idx on public.rrss_campanas (created_at desc);

-- ─── 6. Piezas y sus ficheros ───────────────────────────────────────────────
create table if not exists public.rrss_piezas (
  id                       uuid primary key default gen_random_uuid(),
  -- Las piezas de un mismo envío (Instagram y Facebook) comparten grupo y ficheros.
  grupo_id                 uuid not null default gen_random_uuid(),
  red                      text not null check (red in ('instagram', 'facebook')),
  formato                  text not null check (formato in ('foto', 'carrusel', 'reel', 'story')),
  -- Recorte de las fotos (todas las de un carrusel, el mismo).
  proporcion               text not null default '4:5' check (proporcion in ('4:5', '1:1', '1.91:1', '9:16')),
  titulo                   text check (titulo is null or char_length(titulo) <= 160),
  caption                  text not null default '' check (char_length(caption) <= 2200),
  -- Tipo de trabajo (los servicios de la web): para «qué funciona» y la IA.
  servicio                 text check (servicio is null or servicio in
                             ('mamparas', 'espejos', 'cerramientos', 'aluminio', 'barandillas', 'armarios', 'domino', 'otros')),
  estado                   text not null default 'borrador'
                           check (estado in ('borrador', 'lista', 'publicando', 'procesando', 'publicada', 'error')),
  origen                   text not null default 'panel' check (origen in ('panel', 'campana')),
  campana_id               uuid references public.rrss_campanas (id) on delete set null,
  fecha_prevista           date,
  -- De la campaña: qué foto o vídeo hace falta y por qué.
  idea                     text check (idea is null or char_length(idea) <= 1000),
  -- Lo que escriben las funciones (service role):
  contenedor_id            text check (contenedor_id is null or contenedor_id ~ '^[0-9_]{1,80}$'),
  hijos                    text[] not null default '{}' check (cardinality(hijos) <= 10),
  media_id                 text check (media_id is null or (char_length(media_id) <= 100 and media_id ~ '^[0-9_]+$')),
  permalink                text check (permalink is null or (char_length(permalink) <= 500 and permalink ~ '^https://')),
  publicada_at             timestamptz,
  publicacion_iniciada_at  timestamptz,
  procesando_desde         timestamptz,
  reserva_id               uuid,
  reservada_hasta          timestamptz,
  error                    text check (error is null or char_length(error) <= 2000),
  error_tipo               text check (error_tipo is null or char_length(error_tipo) <= 60),
  como_arreglarlo          text check (como_arreglarlo is null or char_length(como_arreglarlo) <= 2000),
  medios_borrados_at       timestamptz,
  creado_por               uuid default auth.uid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint rrss_piezas_publicada check ((estado = 'publicada') = (publicada_at is not null)),
  constraint rrss_piezas_reserva check ((reserva_id is null) = (reservada_hasta is null)),
  constraint rrss_piezas_facebook_sin_story check (not (red = 'facebook' and formato = 'story')),
  constraint rrss_piezas_proporcion check ((formato = 'story') = (proporcion = '9:16') or formato = 'reel')
);
comment on table public.rrss_piezas is
  'Publicaciones de RRSS, una por red (instagram | facebook; las de un mismo envío comparten grupo_id). estado: '
  'borrador → lista → publicando → (procesando) → publicada | error. El panel solo escribe en borrador, lista o error; '
  'lo demás, las funciones (rrss_pieza_reservar / _progreso / _cerrar). Se audita.';
create index if not exists rrss_piezas_estado_idx on public.rrss_piezas (estado, updated_at desc);
create index if not exists rrss_piezas_grupo_idx on public.rrss_piezas (grupo_id);
create index if not exists rrss_piezas_prevista_idx on public.rrss_piezas (fecha_prevista) where fecha_prevista is not null;
create index if not exists rrss_piezas_publicada_idx on public.rrss_piezas (publicada_at desc) where publicada_at is not null;
create index if not exists rrss_piezas_media_idx on public.rrss_piezas (media_id) where media_id is not null;
create index if not exists rrss_piezas_campana_idx on public.rrss_piezas (campana_id) where campana_id is not null;

create table if not exists public.rrss_medios (
  id           uuid primary key default gen_random_uuid(),
  pieza_id     uuid not null references public.rrss_piezas (id) on delete cascade,
  orden        smallint not null check (orden between 0 and 9),
  tipo         text not null check (tipo in ('imagen', 'video')),
  ruta         text not null check (public.rrss_ruta_valida(ruta)),
  origen       text not null default 'subida' check (origen in ('subida', 'web_fotos')),
  -- Si salió de Web › Fotos (sin FK: la foto de la web puede borrarse y la publicación sigue teniendo su copia).
  web_foto_id  uuid,
  ancho        integer check (ancho is null or ancho between 1 and 10000),
  alto         integer check (alto is null or alto between 1 and 10000),
  duracion_s   numeric(7, 2) check (duracion_s is null or duracion_s between 0 and 3600),
  bytes        bigint check (bytes is null or bytes between 1 and 52428800),
  -- Texto alternativo (Instagram lo admite en fotos y en cada foto de un carrusel).
  alt_text     text not null default '' check (char_length(alt_text) <= 1000),
  -- Vídeo: fotograma de portada (ms).
  portada_ms   integer check (portada_ms is null or portada_ms between 0 and 3600000),
  created_at   timestamptz not null default now(),
  constraint rrss_medios_orden_key unique (pieza_id, orden),
  constraint rrss_medios_tipo_ruta check ((tipo = 'imagen') = (ruta like '%.jpg'))
);
comment on table public.rrss_medios is
  'Fotos (JPEG ya recortado) y vídeos de cada pieza, en orden (la primera es la portada), en el cubo privado rrss. '
  'Las piezas de un mismo grupo apuntan a los mismos ficheros. Se audita.';
create index if not exists rrss_medios_ruta_idx on public.rrss_medios (ruta);

-- ¿Existe el fichero en el cubo? (SECURITY DEFINER: lo comprueba aunque la RLS de storage diga otra cosa).
create or replace function public.rrss_objeto_existe(p_ruta text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'rrss' and o.name = p_ruta)
$$;

-- Hay una programación publicándose ahora mismo.
create or replace function public.rrss_pieza_publicandose(p_pieza uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rrss_programaciones g where g.pieza_id = p_pieza and g.estado = 'publicando')
$$;

-- Qué le falta a una pieza para poder publicarse (vacío = lista). Lo usan rrss_programar y las pruebas; el panel y
-- rrss-publicar hacen la misma comprobación (src/lib/rrss/validacion.ts y _shared/rrss/validacion.ts).
create or replace function public.rrss_pieza_problemas(p_pieza uuid)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.rrss_piezas;
  v_n integer;
  v_img integer;
  v_vid integer;
  v_hashtags integer;
  v_menciones integer;
  v_p text[] := '{}';
begin
  select * into v from public.rrss_piezas where id = p_pieza;
  if not found then return array['No existe esa publicación']; end if;
  select count(*), count(*) filter (where tipo = 'imagen'), count(*) filter (where tipo = 'video')
    into v_n, v_img, v_vid from public.rrss_medios where pieza_id = p_pieza;
  if v.formato = 'foto' and not (v_n = 1 and v_img = 1) then v_p := v_p || 'Una foto necesita exactamente una imagen'::text; end if;
  if v.formato = 'carrusel' and not (v_n between 2 and 10) then v_p := v_p || 'Un carrusel lleva de 2 a 10 fotos o vídeos'::text; end if;
  if v.formato = 'carrusel' and v.red = 'facebook' and v_vid > 0 then
    v_p := v_p || 'En Facebook, una publicación de varias fotos no admite vídeos'::text;
  end if;
  if v.formato = 'reel' and not (v_n = 1 and v_vid = 1) then v_p := v_p || 'Un reel necesita exactamente un vídeo'::text; end if;
  if v.formato = 'story' and v_n <> 1 then v_p := v_p || 'Una historia lleva una sola foto o un solo vídeo'::text; end if;
  select count(*) into v_hashtags from regexp_matches(v.caption, '(^|[^[:alnum:]_&])#[^[:space:]#]+', 'g');
  select count(*) into v_menciones from regexp_matches(v.caption, '(^|[^[:alnum:]_])@[A-Za-z0-9._]+', 'g');
  if v.red = 'instagram' and v_hashtags > 30 then v_p := v_p || 'Instagram admite como mucho 30 hashtags'::text; end if;
  if v.red = 'instagram' and v_menciones > 20 then v_p := v_p || 'Instagram admite como mucho 20 menciones'::text; end if;
  if v.formato <> 'story' and btrim(v.caption) = '' and v.red = 'facebook' then
    v_p := v_p || 'En Facebook hace falta un texto'::text;
  end if;
  if v.medios_borrados_at is not null then v_p := v_p || 'Sus ficheros ya se borraron del panel'::text; end if;
  return v_p;
end;
$$;

-- Reglas de escritura del panel en las piezas (el servidor y las RPC no pasan por aquí).
create or replace function public.rrss_piezas_antes()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.creado_por := coalesce(auth.uid(), new.creado_por);
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.creado_por := old.creado_por;
  end if;
  new.updated_at := now();
  if not public.rrss_es_panel() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.estado not in ('borrador', 'lista', 'error') then
      raise exception 'Esta publicación se está publicando o ya está publicada: no se puede cambiar' using errcode = '55006';
    end if;
    if public.rrss_pieza_publicandose(old.id) then
      raise exception 'Se está publicando ahora mismo; espera a que termine' using errcode = '55006';
    end if;
    new.origen := old.origen;
    new.campana_id := old.campana_id;
    new.grupo_id := old.grupo_id;
  else
    new.origen := 'panel';
    new.campana_id := null;
  end if;
  if new.estado not in ('borrador', 'lista') then
    raise exception 'Desde el panel una publicación solo puede quedar en borrador o lista' using errcode = '42501';
  end if;
  -- Lo que escriben las funciones no se toca desde el panel (al corregir un error se borra el mensaje, pero se
  -- conserva el contenedor: antes de crear otro se mira si Meta ya lo publicó).
  if tg_op = 'INSERT' then
    new.contenedor_id := null; new.hijos := '{}'; new.media_id := null; new.permalink := null; new.publicada_at := null;
    new.publicacion_iniciada_at := null; new.procesando_desde := null; new.reserva_id := null; new.reservada_hasta := null;
    new.error := null; new.error_tipo := null; new.como_arreglarlo := null; new.medios_borrados_at := null;
  else
    new.contenedor_id := old.contenedor_id; new.hijos := old.hijos; new.media_id := old.media_id;
    new.permalink := old.permalink; new.publicada_at := old.publicada_at;
    new.publicacion_iniciada_at := old.publicacion_iniciada_at; new.procesando_desde := old.procesando_desde;
    new.reserva_id := old.reserva_id; new.reservada_hasta := old.reservada_hasta;
    new.medios_borrados_at := old.medios_borrados_at;
    if old.estado = 'error' then
      new.error := null; new.error_tipo := null; new.como_arreglarlo := null;
    else
      new.error := old.error; new.error_tipo := old.error_tipo; new.como_arreglarlo := old.como_arreglarlo;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists rrss_piezas_antes on public.rrss_piezas;
create trigger rrss_piezas_antes before insert or update on public.rrss_piezas
  for each row execute function public.rrss_piezas_antes();

create or replace function public.rrss_piezas_antes_de_borrar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if public.rrss_es_panel() and (old.estado not in ('borrador', 'lista', 'error') or public.rrss_pieza_publicandose(old.id)) then
    raise exception 'Una publicación que se está publicando o ya publicada no se borra' using errcode = '55006';
  end if;
  return old;
end;
$$;
drop trigger if exists rrss_piezas_antes_de_borrar on public.rrss_piezas;
create trigger rrss_piezas_antes_de_borrar before delete on public.rrss_piezas
  for each row execute function public.rrss_piezas_antes_de_borrar();

-- Ficheros: el panel solo los cambia en piezas que aún se pueden editar, y solo con ficheros que existen en el cubo.
create or replace function public.rrss_medios_antes()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_pieza uuid := case when tg_op = 'DELETE' then old.pieza_id else new.pieza_id end;
  v_estado text;
begin
  if not public.rrss_es_panel() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select estado into v_estado from public.rrss_piezas where id = v_pieza;
  -- Al borrar la pieza entera (cascada) la pieza ya no está.
  if tg_op = 'DELETE' and v_estado is null then
    return old;
  end if;
  if v_estado is null or v_estado not in ('borrador', 'lista', 'error') or public.rrss_pieza_publicandose(v_pieza) then
    raise exception 'Los ficheros de una publicación que se está publicando o ya publicada no se cambian' using errcode = '55006';
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id; new.pieza_id := old.pieza_id; new.ruta := old.ruta; new.tipo := old.tipo; new.origen := old.origen;
    new.web_foto_id := old.web_foto_id; new.created_at := old.created_at;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if not public.rrss_objeto_existe(new.ruta) then
      raise exception 'Ese fichero no está subido al cubo rrss' using errcode = '23503';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists rrss_medios_antes on public.rrss_medios;
create trigger rrss_medios_antes before insert or update or delete on public.rrss_medios
  for each row execute function public.rrss_medios_antes();

-- Fotos de Web › Fotos para elegir en RRSS (aunque no se vea Web › Fotos): las de los books de cada tipo de trabajo
-- y las sueltas, también las que la web aún no enseña. El bucket web-fotos es público: el panel las ve por su URL.
create or replace function public.rrss_fotos_web()
returns table (id uuid, ruta text, titulo text, alt text, ancho integer, alto integer, servicio text, album text,
               visible_en_web boolean, creado_en timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_read_section('rrss'), false) then
    raise exception 'Hace falta «Ver» en RRSS' using errcode = '42501';
  end if;
  return query
    select f.id, f.ruta, f.titulo, f.alt, f.ancho, f.alto, a.servicio, a.titulo,
           (f.publicado and (a.id is null or a.publicado)), f.creado_en
      from public.web_fotos f
      left join public.web_albumes a on a.id = f.album_id
     order by a.servicio nulls last, a.orden nulls last, f.orden, f.creado_en desc
     limit 3000;
end;
$$;

-- ─── 7. Programación ────────────────────────────────────────────────────────
create table if not exists public.rrss_programaciones (
  id                    uuid primary key default gen_random_uuid(),
  pieza_id              uuid not null references public.rrss_piezas (id) on delete cascade,
  red                   text not null check (red in ('instagram', 'facebook')),
  programada_para       timestamptz not null,
  estado                text not null default 'programada' check (estado in ('programada', 'publicando', 'publicada', 'error', 'cancelada')),
  intentos              smallint not null default 0 check (intentos between 0 and 3),
  siguiente_intento_at  timestamptz not null,
  ultimo_intento_at     timestamptz,
  ultimo_error          text check (ultimo_error is null or char_length(ultimo_error) <= 1000),
  bloqueo_id            uuid,
  bloqueada_hasta       timestamptz,
  media_id              text check (media_id is null or char_length(media_id) <= 100),
  permalink             text check (permalink is null or char_length(permalink) <= 500),
  publicada_at          timestamptz,
  creado_por            uuid default auth.uid(),
  cancelada_por         uuid,
  cancelada_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rrss_programaciones_bloqueo check ((estado = 'publicando') = (bloqueo_id is not null and bloqueada_hasta is not null)),
  constraint rrss_programaciones_publicada check (estado <> 'publicada' or publicada_at is not null)
);
comment on table public.rrss_programaciones is
  'Publicaciones programadas de rrss_piezas. Las publica rrss-programador (pg_cron cada 5 min). Escritura solo por RPC '
  '(rrss_programar, rrss_reprogramar, rrss_cancelar_programacion; el programador, rrss_programador_reclamar/_cerrar). Se audita.';
create unique index if not exists rrss_programaciones_activa_uq
  on public.rrss_programaciones (pieza_id) where estado in ('programada', 'publicando');
create index if not exists rrss_programaciones_pendientes_idx
  on public.rrss_programaciones (siguiente_intento_at) where estado = 'programada';
create index if not exists rrss_programaciones_fecha_idx on public.rrss_programaciones (red, programada_para);

create or replace function public.rrss_programaciones_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
    new.pieza_id := old.pieza_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists rrss_programaciones_al_editar on public.rrss_programaciones;
create trigger rrss_programaciones_al_editar before insert or update on public.rrss_programaciones
  for each row execute function public.rrss_programaciones_al_editar();

-- Como mínimo 10 minutos y como máximo 75 días desde ahora.
create or replace function public.rrss_programacion_validar_fecha(p_para timestamptz)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if p_para is null then raise exception 'Falta la fecha y la hora' using errcode = '22023'; end if;
  if p_para < now() + interval '10 minutes' then
    raise exception 'Hay que programarla con al menos 10 minutos de margen' using errcode = '22023';
  end if;
  if p_para > now() + interval '75 days' then
    raise exception 'Como mucho se puede programar a 75 días vista' using errcode = '22023';
  end if;
end;
$$;

-- Otras programadas en la misma red a ±30 min (sin contar la propia pieza).
create or replace function public.rrss_programacion_conflictos(p_red text, p_para timestamptz, p_excluir uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'piezaId', g.pieza_id, 'programadaPara', g.programada_para)
                            order by g.programada_para), '[]'::jsonb)
    from public.rrss_programaciones g
   where g.red = p_red and g.estado in ('programada', 'publicando') and g.pieza_id is distinct from p_excluir
     and g.programada_para between p_para - interval '30 minutes' and p_para + interval '30 minutes'
$$;

-- La pieza se puede programar: existe, no está publicada ni publicándose y no le falta nada. Queda «lista».
create or replace function public.rrss_programacion_pieza(p_pieza uuid)
returns public.rrss_piezas language plpgsql volatile set search_path = ''
as $$
declare
  v public.rrss_piezas;
  v_problemas text[];
begin
  select * into v from public.rrss_piezas where id = p_pieza for update;
  if not found then raise exception 'No existe esa publicación' using errcode = 'P0002'; end if;
  if v.media_id is not null or v.estado = 'publicada' then
    raise exception 'Esa publicación ya está publicada' using errcode = '22023';
  end if;
  if v.estado in ('publicando', 'procesando') then
    raise exception 'Esa publicación se está publicando ahora mismo' using errcode = '55006';
  end if;
  v_problemas := public.rrss_pieza_problemas(p_pieza);
  if cardinality(v_problemas) > 0 then
    raise exception '%', v_problemas[1] using errcode = '22023';
  end if;
  if v.estado <> 'lista' then
    update public.rrss_piezas
       set estado = 'lista', error = null, error_tipo = null, como_arreglarlo = null
     where id = p_pieza
    returning * into v;
  end if;
  return v;
end;
$$;

create or replace function public.rrss_reprogramar(p_id uuid, p_para timestamptz, p_confirmar_conflicto boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_prog public.rrss_programaciones;
  v_pieza public.rrss_piezas;
  v_conflictos jsonb;
begin
  perform public.rrss_exigir_edicion();
  perform public.rrss_programacion_validar_fecha(p_para);
  select * into v_prog from public.rrss_programaciones where id = p_id for update;
  if not found then raise exception 'No existe esa programación' using errcode = 'P0002'; end if;
  if v_prog.estado = 'publicando' then
    raise exception 'Se está publicando ahora mismo; espera a que termine' using errcode = '55006';
  end if;
  if v_prog.estado in ('publicada', 'cancelada') then
    raise exception 'Esa programación ya está %; prográmala de nuevo desde la publicación', v_prog.estado using errcode = '22023';
  end if;
  if v_prog.estado = 'error' and exists (select 1 from public.rrss_programaciones
                                          where pieza_id = v_prog.pieza_id and id <> v_prog.id and estado in ('programada', 'publicando')) then
    raise exception 'Esa publicación ya tiene otra programación pendiente' using errcode = '23505';
  end if;
  v_pieza := public.rrss_programacion_pieza(v_prog.pieza_id);
  v_conflictos := public.rrss_programacion_conflictos(v_pieza.red, p_para, v_pieza.id);
  if jsonb_array_length(v_conflictos) > 0 and not coalesce(p_confirmar_conflicto, false) then
    return jsonb_build_object('ok', false, 'requiereConfirmacion', true, 'conflictos', v_conflictos);
  end if;
  update public.rrss_programaciones
     set estado = 'programada', programada_para = p_para, siguiente_intento_at = p_para, red = v_pieza.red,
         intentos = 0, ultimo_error = null, cancelada_at = null, cancelada_por = null
   where id = v_prog.id
  returning * into v_prog;
  return jsonb_build_object('ok', true, 'accion', 'reprogramada', 'programacion', to_jsonb(v_prog), 'conflictos', v_conflictos);
end;
$$;

-- Programa una pieza; si ya tiene una programación pendiente, la mueve.
create or replace function public.rrss_programar(p_pieza_id uuid, p_para timestamptz, p_confirmar_conflicto boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pieza public.rrss_piezas;
  v_activa public.rrss_programaciones;
  v_conflictos jsonb;
  v_fila public.rrss_programaciones;
begin
  perform public.rrss_exigir_edicion();
  perform public.rrss_programacion_validar_fecha(p_para);
  select * into v_activa from public.rrss_programaciones where pieza_id = p_pieza_id and estado in ('programada', 'publicando') for update;
  if v_activa.id is not null then
    return public.rrss_reprogramar(v_activa.id, p_para, p_confirmar_conflicto);
  end if;
  v_pieza := public.rrss_programacion_pieza(p_pieza_id);
  v_conflictos := public.rrss_programacion_conflictos(v_pieza.red, p_para, v_pieza.id);
  if jsonb_array_length(v_conflictos) > 0 and not coalesce(p_confirmar_conflicto, false) then
    return jsonb_build_object('ok', false, 'requiereConfirmacion', true, 'conflictos', v_conflictos);
  end if;
  insert into public.rrss_programaciones (pieza_id, red, programada_para, siguiente_intento_at, creado_por)
  values (v_pieza.id, v_pieza.red, p_para, p_para, auth.uid())
  returning * into v_fila;
  return jsonb_build_object('ok', true, 'accion', 'programada', 'programacion', to_jsonb(v_fila), 'conflictos', v_conflictos);
end;
$$;

create or replace function public.rrss_cancelar_programacion(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.rrss_programaciones;
begin
  perform public.rrss_exigir_edicion();
  update public.rrss_programaciones
     set estado = 'cancelada', cancelada_at = now(), cancelada_por = auth.uid()
   where id = p_id and estado in ('programada', 'error')
  returning * into v;
  if v.id is null then
    if exists (select 1 from public.rrss_programaciones where id = p_id and estado = 'publicando') then
      raise exception 'Se está publicando ahora mismo; ya no se puede cancelar' using errcode = '55006';
    end if;
    raise exception 'No hay ninguna programación pendiente con ese id' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'programacion', to_jsonb(v));
end;
$$;

-- Programador (solo service role). Reclama UNA vencida con bloqueo. Antes cierra los bloqueos caducados SIN volver a
-- publicar a ciegas: publicada si la pieza ya tiene media_id; si es de Instagram y tiene su contenedor guardado, vuelve
-- a la cola (antes de crear otro se mira si Meta ya lo publicó); si no, error para que alguien lo compruebe.
create or replace function public.rrss_programador_reclamar(p_lease_seg integer default 600)
returns setof public.rrss_programaciones language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.rrss_programaciones g
     set estado          = case when pz.media_id is not null then 'publicada'
                                when pz.red = 'instagram' and pz.contenedor_id is not null and g.intentos < 2 then 'programada'
                                else 'error' end,
         media_id        = pz.media_id,
         permalink       = pz.permalink,
         publicada_at    = case when pz.media_id is not null then coalesce(pz.publicada_at, now()) end,
         intentos        = least(3, g.intentos + case when pz.media_id is null then 1 else 0 end),
         siguiente_intento_at = case when pz.media_id is null then now() else g.siguiente_intento_at end,
         ultimo_error    = case
           when pz.media_id is not null then null
           when pz.red = 'instagram' and pz.contenedor_id is not null and g.intentos < 2 then
             'La publicación se cortó a mitad; se retoma comprobando antes si Meta ya la publicó.'
           else 'La publicación se cortó a mitad y no se ha reintentado para no publicarla dos veces. '
                || 'Comprueba en la red si salió; si no, vuelve a programarla.' end,
         bloqueo_id      = null,
         bloqueada_hasta = null
    from public.rrss_piezas pz
   where pz.id = g.pieza_id and g.estado = 'publicando' and g.bloqueada_hasta < now();

  select g.id into v_id
    from public.rrss_programaciones g
   where g.estado = 'programada' and g.siguiente_intento_at <= now()
   order by g.siguiente_intento_at, g.created_at
   limit 1
   for update skip locked;
  if v_id is null then return; end if;
  return query
    update public.rrss_programaciones g
       set estado = 'publicando', bloqueo_id = gen_random_uuid(),
           bloqueada_hasta = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seg, 600), 3600))),
           ultimo_intento_at = now()
     where g.id = v_id
    returning g.*;
end;
$$;

-- Cierra lo que reclamó la pasada (exige su bloqueo):
--   publicada   media_id + permalink
--   reintentar  cuenta un intento; al 3.º queda en error; si no, vuelve a «programada» dentro de p_espera_seg
--   aplazar     cuota agotada, límites de Meta o Meta aún procesa: NO cuenta intento
--   error       definitivo
create or replace function public.rrss_programador_cerrar(
  p_id uuid, p_bloqueo uuid, p_resultado text, p_mensaje text default null,
  p_media_id text default null, p_permalink text default null, p_espera_seg integer default 0)
returns public.rrss_programaciones language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.rrss_programaciones;
  v_intentos smallint;
  v_mensaje text := left(nullif(btrim(p_mensaje), ''), 1000);
  v_siguiente timestamptz := now() + make_interval(secs => greatest(0, least(coalesce(p_espera_seg, 0), 86400)));
begin
  if p_resultado is null or p_resultado not in ('publicada', 'reintentar', 'aplazar', 'error') then
    raise exception 'Resultado no válido: %', p_resultado using errcode = '22023';
  end if;
  select * into v from public.rrss_programaciones where id = p_id and estado = 'publicando' and bloqueo_id = p_bloqueo for update;
  if not found then
    raise exception 'La programación ya no está bloqueada por esta pasada' using errcode = 'P0002';
  end if;
  if p_resultado = 'publicada' then
    update public.rrss_programaciones
       set estado = 'publicada', media_id = nullif(btrim(p_media_id), ''), permalink = p_permalink, publicada_at = now(),
           ultimo_error = v_mensaje, bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  elsif p_resultado = 'aplazar' then
    update public.rrss_programaciones
       set estado = 'programada', siguiente_intento_at = v_siguiente, ultimo_error = v_mensaje,
           bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  elsif p_resultado = 'reintentar' then
    v_intentos := least(3, v.intentos + 1);
    update public.rrss_programaciones
       set estado = case when v_intentos >= 3 then 'error' else 'programada' end,
           intentos = v_intentos,
           siguiente_intento_at = case when v_intentos >= 3 then siguiente_intento_at else v_siguiente end,
           ultimo_error = coalesce(v_mensaje, 'Error al publicar'),
           bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  else
    update public.rrss_programaciones
       set estado = 'error', intentos = least(3, v.intentos + 1), ultimo_error = coalesce(v_mensaje, 'Error al publicar'),
           bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  end if;
  return v;
end;
$$;

-- ─── 8. Publicación (solo service role: rrss-publicar y rrss-programador) ───
-- Reserva una pieza para publicarla (cerrojo con caducidad). Nunca dos a la vez: una segunda petición recibe
-- «en_curso». Una reserva caducada de Facebook sin publicación confirmada queda en error (no se repite a ciegas).
create or replace function public.rrss_pieza_reservar(p_pieza uuid, p_lease_seg integer default 180, p_programada boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.rrss_piezas;
begin
  select * into v from public.rrss_piezas where id = p_pieza for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v.media_id is not null or v.estado = 'publicada' then
    -- Meta ya la publicó (p. ej. la pasada se cortó tras guardar el media_id): queda «publicada», sin repetir nada.
    if v.estado <> 'publicada' and (v.reservada_hasta is null or v.reservada_hasta <= now()) then
      update public.rrss_piezas
         set estado = 'publicada', publicada_at = coalesce(publicada_at, now()), reserva_id = null, reservada_hasta = null,
             procesando_desde = null
       where id = p_pieza;
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'publicada', 'mediaId', v.media_id, 'permalink', v.permalink);
  end if;
  if v.reservada_hasta is not null and v.reservada_hasta > now() then
    return jsonb_build_object('ok', false, 'motivo', 'en_curso');
  end if;
  if not p_programada and exists (select 1 from public.rrss_programaciones g where g.pieza_id = p_pieza and g.estado = 'programada') then
    return jsonb_build_object('ok', false, 'motivo', 'programada');
  end if;
  if v.estado = 'publicando' and v.red = 'facebook' then
    update public.rrss_piezas
       set estado = 'error', reserva_id = null, reservada_hasta = null, error_tipo = 'cortada',
           error = 'La publicación en Facebook se cortó a mitad y no se ha repetido para no publicarla dos veces.',
           como_arreglarlo = 'Mira en la página de Facebook si salió. Si no, vuelve a publicarla.'
     where id = p_pieza;
    return jsonb_build_object('ok', false, 'motivo', 'cortada');
  end if;
  if v.estado not in ('lista', 'error', 'procesando', 'publicando') then
    return jsonb_build_object('ok', false, 'motivo', 'no_lista');
  end if;
  update public.rrss_piezas
     set estado = 'publicando', reserva_id = gen_random_uuid(),
         reservada_hasta = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seg, 180), 1800))),
         publicacion_iniciada_at = coalesce(publicacion_iniciada_at, now()),
         error = null, error_tipo = null, como_arreglarlo = null
   where id = p_pieza
  returning * into v;
  return jsonb_build_object('ok', true, 'reserva', v.reserva_id, 'pieza', to_jsonb(v));
end;
$$;

-- Guarda el avance (contenedor, hijos del carrusel, media_id en cuanto Meta confirma) sin soltar la reserva.
create or replace function public.rrss_pieza_progreso(p_pieza uuid, p_reserva uuid, p_contenedor text default null,
                                                      p_hijos text[] default null, p_media_id text default null,
                                                      p_permalink text default null, p_limpiar boolean default false)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.rrss_piezas
     set contenedor_id = case when p_limpiar then null else coalesce(p_contenedor, contenedor_id) end,
         hijos = case when p_limpiar then '{}'::text[] else coalesce(p_hijos, hijos) end,
         media_id = coalesce(media_id, nullif(btrim(p_media_id), '')),
         permalink = coalesce(p_permalink, permalink),
         procesando_desde = case when p_limpiar then null else procesando_desde end
   where id = p_pieza and reserva_id = p_reserva;
  return found;
end;
$$;

-- Cierra la reserva: publicada | procesando (Meta aún procesa: lo retoma el programador) | error | liberar (no se
-- llegó a empezar: vuelve a «lista»).
create or replace function public.rrss_pieza_cerrar(p_pieza uuid, p_reserva uuid, p_resultado text, p_datos jsonb default '{}'::jsonb)
returns public.rrss_piezas language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.rrss_piezas;
  d jsonb := coalesce(p_datos, '{}'::jsonb);
begin
  if p_resultado not in ('publicada', 'procesando', 'error', 'liberar') then
    raise exception 'Resultado no válido: %', p_resultado using errcode = '22023';
  end if;
  select * into v from public.rrss_piezas where id = p_pieza and reserva_id = p_reserva for update;
  if not found then raise exception 'La publicación ya no está reservada por esta petición' using errcode = 'P0002'; end if;
  if p_resultado = 'publicada' then
    update public.rrss_piezas
       set estado = 'publicada', publicada_at = coalesce(publicada_at, now()),
           media_id = coalesce(media_id, nullif(btrim(d->>'mediaId'), '')),
           permalink = coalesce(nullif(btrim(d->>'permalink'), ''), permalink),
           procesando_desde = null, reserva_id = null, reservada_hasta = null,
           error = left(nullif(btrim(d->>'aviso'), ''), 2000), error_tipo = null, como_arreglarlo = null
     where id = p_pieza returning * into v;
  elsif p_resultado = 'procesando' then
    update public.rrss_piezas
       set estado = 'procesando', procesando_desde = coalesce(procesando_desde, now()), reserva_id = null, reservada_hasta = null
     where id = p_pieza returning * into v;
  elsif p_resultado = 'error' then
    update public.rrss_piezas
       set estado = 'error', reserva_id = null, reservada_hasta = null, procesando_desde = null,
           error = left(coalesce(nullif(btrim(d->>'error'), ''), 'Error al publicar'), 2000),
           error_tipo = left(nullif(btrim(d->>'tipo'), ''), 60),
           como_arreglarlo = left(nullif(btrim(d->>'comoArreglarlo'), ''), 2000),
           contenedor_id = case when coalesce((d->>'limpiarContenedor')::boolean, false) then null else contenedor_id end,
           hijos = case when coalesce((d->>'limpiarContenedor')::boolean, false) then '{}'::text[] else hijos end
     where id = p_pieza returning * into v;
  else
    update public.rrss_piezas
       set estado = case when contenedor_id is not null and procesando_desde is not null then 'procesando' else 'lista' end,
           reserva_id = null, reservada_hasta = null
     where id = p_pieza returning * into v;
  end if;
  return v;
end;
$$;

-- Limpieza del cubo (rrss-programador, mantenimiento): subidas de más de p_horas que ninguna pieza usa, y ficheros cuyas
-- piezas están TODAS publicadas hace más de p_dias (Instagram y Facebook ya tienen su copia). Los borradores, las
-- listas, las programadas y las que fallaron conservan sus ficheros. Solo service role.
create or replace function public.rrss_ficheros_para_borrar(p_horas integer default 24, p_dias integer default 30, p_limite integer default 500)
returns table (ruta text, motivo text)
language sql stable security definer set search_path = ''
as $$
  (select o.name, 'huerfano'::text
     from storage.objects o
    where o.bucket_id = 'rrss' and o.created_at < now() - make_interval(hours => greatest(1, p_horas))
      and not exists (select 1 from public.rrss_medios m where m.ruta = o.name)
    order by o.created_at
    limit greatest(1, least(p_limite, 1000)))
  union all
  (select x.ruta, 'publicada'::text
     from (select distinct m.ruta from public.rrss_medios m) x
    where not exists (select 1 from public.rrss_medios m2 join public.rrss_piezas p2 on p2.id = m2.pieza_id
                       where m2.ruta = x.ruta
                         and (p2.estado <> 'publicada' or p2.publicada_at > now() - make_interval(days => greatest(1, p_dias))))
      and exists (select 1 from storage.objects o where o.bucket_id = 'rrss' and o.name = x.ruta)
    limit greatest(1, least(p_limite, 1000)))
$$;

-- Marca las piezas cuyos ficheros ya se borraron del cubo (siguen en el historial, sin miniatura propia).
create or replace function public.rrss_marcar_medios_borrados(p_rutas text[])
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare
  v integer;
begin
  update public.rrss_piezas p set medios_borrados_at = now()
   where p.medios_borrados_at is null
     and exists (select 1 from public.rrss_medios m where m.pieza_id = p.id and m.ruta = any (coalesce(p_rutas, '{}'::text[])));
  get diagnostics v = row_count;
  return v;
end;
$$;

-- ─── 9. IA: tope diario ─────────────────────────────────────────────────────
create table if not exists public.rrss_ia_peticiones (
  id          bigint generated always as identity primary key,
  creado_por  uuid not null default auth.uid(),
  accion      text not null check (accion in ('textos', 'ideas', 'campana', 'aprender')),
  modelo      text check (modelo is null or char_length(modelo) <= 80),
  ok          boolean,
  created_at  timestamptz not null default now()
);
comment on table public.rrss_ia_peticiones is
  'Cada petición a la IA de RRSS (rrss-ia): tope diario de 80 por usuario y 300 entre todos (día de Madrid). '
  'La inserta la función con el JWT del usuario antes de llamar a OpenAI (cuenta también si falla).';
create index if not exists rrss_ia_peticiones_dia_idx on public.rrss_ia_peticiones (created_at desc, creado_por);

create or replace function public.rrss_comprobar_cupo_ia()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_inicio timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
begin
  new.creado_por := coalesce(auth.uid(), new.creado_por);
  new.created_at := now();
  new.ok := null;
  perform pg_advisory_xact_lock(hashtext('rrss_cupo_ia'));
  if (select count(*) from public.rrss_ia_peticiones where creado_por = new.creado_por and created_at >= v_inicio) >= 80 then
    raise exception 'rrss_cupo_ia: tope diario por usuario' using errcode = 'P0001';
  end if;
  if (select count(*) from public.rrss_ia_peticiones where created_at >= v_inicio) >= 300 then
    raise exception 'rrss_cupo_ia: tope diario global' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists rrss_comprobar_cupo_ia on public.rrss_ia_peticiones;
create trigger rrss_comprobar_cupo_ia before insert on public.rrss_ia_peticiones
  for each row execute function public.rrss_comprobar_cupo_ia();

-- ─── 10. Fechas señaladas y campañas ────────────────────────────────────────
create table if not exists public.rrss_fechas (
  id            uuid primary key default gen_random_uuid(),
  clave         text not null default ('propia-' || gen_random_uuid()::text) check (clave ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  titulo        text not null check (char_length(btrim(titulo)) between 1 and 120),
  ambito        text not null check (ambito in ('temporada', 'local', 'comercial', 'propio')),
  desde         date not null,
  hasta         date not null,
  anual         boolean not null default true,
  -- Idea base para la IA (datos, nunca instrucciones).
  idea          text check (idea is null or char_length(idea) <= 600),
  verificacion  text not null default 'sin verificar' check (verificacion in ('verificada', 'sin verificar')),
  activo        boolean not null default true,
  actualizado_por uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rrss_fechas_clave_key unique (clave),
  -- Anuales: año 2000 de referencia y sin 29 de febrero; «hasta» antes que «desde» = cruza el año.
  constraint rrss_fechas_rango check (
    case when anual
      then extract(year from desde) = 2000 and extract(year from hasta) = 2000
           and to_char(desde, 'MM-DD') <> '02-29' and to_char(hasta, 'MM-DD') <> '02-29'
      else hasta >= desde and hasta - desde <= 366 end)
);
comment on table public.rrss_fechas is
  'Fechas señaladas para las campañas y las ideas de RRSS (temporada de la cristalería, fiestas de Elche, fechas '
  'comerciales y las propias). Anuales con el año 2000 de referencia. «sin verificar» hasta que el dueño las confirme.';

create or replace function public.rrss_fechas_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.clave := old.clave; new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.actualizado_por := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists rrss_fechas_al_editar on public.rrss_fechas;
create trigger rrss_fechas_al_editar before insert or update on public.rrss_fechas
  for each row execute function public.rrss_fechas_al_editar();

-- Siembra (no pisa lo que el dueño haya cambiado).
insert into public.rrss_fechas (clave, titulo, ambito, desde, hasta, anual, idea, verificacion) values
  ('enero-reformas', 'Año nuevo, casa nueva', 'temporada', '2000-01-07', '2000-01-31', true,
   'Propósitos de reforma: cambiar la bañera por plato de ducha con mampara, renovar ventanas.', 'verificada'),
  ('invierno-aislamiento', 'Frío en casa: ventanas que aíslan', 'temporada', '2000-11-15', '2000-02-15', true,
   'Ventanas de aluminio con rotura de puente térmico y doble acristalamiento: menos frío y menos ruido.', 'verificada'),
  ('primavera-banos', 'Primavera: reformas de baño', 'temporada', '2000-03-01', '2000-05-31', true,
   'Mamparas de ducha a medida, espejos de baño con luz, sustitución de bañera por plato.', 'verificada'),
  ('verano-terrazas', 'Verano: terrazas y piscinas', 'temporada', '2000-05-15', '2000-08-31', true,
   'Cerramientos de terraza, cortinas de cristal, barandillas de vidrio para piscina y mosquiteras.', 'verificada'),
  ('septiembre-vuelta', 'Vuelta de vacaciones', 'temporada', '2000-09-01', '2000-09-30', true,
   'Planificar la reforma antes del invierno; armarios a medida para empezar el curso ordenados.', 'verificada'),
  ('dia-madre', 'Día de la Madre', 'comercial', '2000-04-25', '2000-05-07', true,
   'Primer domingo de mayo: espejos decorativos o un baño renovado como regalo. Sin ofertas que no estén confirmadas.', 'sin verificar'),
  ('black-friday', 'Black Friday', 'comercial', '2000-11-20', '2000-11-30', true,
   'Solo si hay una promoción real del taller. Si no, contenido de consejos.', 'sin verificar'),
  ('navidad', 'Navidad', 'comercial', '2000-12-01', '2000-12-24', true,
   'Casa lista para las visitas: espejos, mamparas nuevas, felicitación del equipo del taller.', 'verificada'),
  ('misteri-elx', 'Misteri d''Elx y fiestas de agosto', 'local', '2000-08-11', '2000-08-15', true,
   'Fiestas de la Virgen de la Asunción en Elche (Nit de l''Albà el 13 de agosto, Misteri el 14 y 15). Felicitación, no venta.', 'verificada'),
  ('elche-palmeral', 'Elche y su Palmeral (Patrimonio de la Humanidad)', 'local', '2000-11-28', '2000-12-02', true,
   'Aniversario del Palmeral de Elche como Patrimonio de la Humanidad (30 de noviembre de 2000). Orgullo de barrio.', 'verificada'),
  ('semana-santa', 'Semana Santa', 'local', '2000-03-20', '2000-04-25', true,
   'Fecha variable: avisar de horario del taller si cambia y aprovechar para trabajos antes de verano.', 'sin verificar'),
  ('dia-medio-ambiente', 'Día del Medio Ambiente', 'comercial', '2000-06-01', '2000-06-05', true,
   '5 de junio: ventanas eficientes, ahorro energético y reciclaje del vidrio en el taller.', 'verificada')
on conflict (clave) do nothing;

-- Fechas señaladas que caen en [desde, hasta] (las anuales se repiten cada año; también las que cruzan el año).
create or replace function public.rrss_fechas_entre(p_desde date, p_hasta date)
returns table (clave text, titulo text, ambito text, desde date, hasta date, idea text, verificacion text)
language sql stable security invoker set search_path = ''
as $$
  with anios as (
    select generate_series(extract(year from p_desde)::int - 1, extract(year from p_hasta)::int) as a
  ),
  ocurrencias as (
    select f.clave, f.titulo, f.ambito, f.idea, f.verificacion,
           make_date(an.a, extract(month from f.desde)::int, extract(day from f.desde)::int) as d,
           case when f.hasta >= f.desde
                then make_date(an.a, extract(month from f.hasta)::int, extract(day from f.hasta)::int)
                else make_date(an.a + 1, extract(month from f.hasta)::int, extract(day from f.hasta)::int) end as h
      from public.rrss_fechas f cross join anios an
     where f.activo and f.anual
    union all
    select f.clave, f.titulo, f.ambito, f.idea, f.verificacion, f.desde, f.hasta
      from public.rrss_fechas f where f.activo and not f.anual
  )
  select distinct on (o.clave) o.clave, o.titulo, o.ambito, o.d, o.h, o.idea, o.verificacion
    from ocurrencias o
   where o.d <= p_hasta and o.h >= p_desde
   order by o.clave, o.d
$$;

create or replace function public.rrss_campanas_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    new.created_at := now();
    if public.rrss_es_panel() then
      new.estado := 'propuesta'; new.aceptada_por := null; new.aceptada_at := null;
    end if;
  else
    new.id := old.id; new.creado_por := old.creado_por; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists rrss_campanas_al_editar on public.rrss_campanas;
create trigger rrss_campanas_al_editar before insert or update on public.rrss_campanas
  for each row execute function public.rrss_campanas_al_editar();

-- Acepta una campaña: las piezas marcadas (índices de propuesta.piezas, todas si es null) se crean como BORRADORES
-- con su fecha prevista (en Instagram y, si se pide, también en Facebook). Nada se programa ni se publica.
create or replace function public.rrss_aceptar_campana(p_campana uuid, p_indices integer[] default null, p_facebook boolean default null)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.rrss_campanas;
  v_pieza jsonb;
  v_i integer := -1;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_grupo uuid;
  v_formato text;
  v_texto text;
  v_facebook boolean;
  v_servicio text;
begin
  perform public.rrss_exigir_edicion();
  select * into v from public.rrss_campanas where id = p_campana for update;
  if not found then raise exception 'No existe esa campaña' using errcode = 'P0002'; end if;
  if v.estado <> 'propuesta' then raise exception 'Esa campaña ya está %', v.estado using errcode = '22023'; end if;
  v_facebook := coalesce(p_facebook, (select facebook_por_defecto from public.rrss_ajustes where id = 1), false);
  for v_pieza in select value from jsonb_array_elements(coalesce(v.propuesta->'piezas', '[]'::jsonb)) loop
    v_i := v_i + 1;
    continue when p_indices is not null and not (v_i = any (p_indices));
    v_formato := coalesce(nullif(v_pieza->>'formato', ''), 'foto');
    if v_formato not in ('foto', 'carrusel', 'reel', 'story') then v_formato := 'foto'; end if;
    v_servicio := v_pieza->>'servicio';
    if v_servicio not in ('mamparas', 'espejos', 'cerramientos', 'aluminio', 'barandillas', 'armarios', 'domino', 'otros') then
      v_servicio := null;
    end if;
    v_texto := left(btrim(coalesce(v_pieza->>'caption', '')
                          || case when jsonb_typeof(v_pieza->'hashtags') = 'array' and jsonb_array_length(v_pieza->'hashtags') > 0
                                  then E'\n\n' || (select string_agg(h, ' ') from jsonb_array_elements_text(v_pieza->'hashtags') h)
                                  else '' end), 2200);
    v_grupo := gen_random_uuid();
    insert into public.rrss_piezas (grupo_id, red, formato, proporcion, titulo, caption, servicio, estado, origen,
                                    campana_id, fecha_prevista, idea)
    values (v_grupo, 'instagram', v_formato, case when v_formato in ('story', 'reel') then '9:16' else '4:5' end,
            left(nullif(btrim(v_pieza->>'titulo'), ''), 160), case when v_formato = 'story' then '' else v_texto end,
            v_servicio, 'borrador', 'campana', v.id,
            case when (v_pieza->>'fecha') ~ '^\d{4}-\d{2}-\d{2}$' then (v_pieza->>'fecha')::date end,
            left(nullif(btrim(concat_ws(' · ', v_pieza->>'idea', v_pieza->>'porQue')), ''), 1000))
    returning id into v_id;
    v_ids := v_ids || v_id;
    if v_facebook and v_formato <> 'story' then
      insert into public.rrss_piezas (grupo_id, red, formato, proporcion, titulo, caption, servicio, estado, origen,
                                      campana_id, fecha_prevista, idea)
      select grupo_id, 'facebook', formato, proporcion, titulo, caption, servicio, 'borrador', 'campana', campana_id,
             fecha_prevista, idea
        from public.rrss_piezas where id = v_id
      returning id into v_id;
      v_ids := v_ids || v_id;
    end if;
  end loop;
  update public.rrss_campanas set estado = 'aceptada', aceptada_por = auth.uid(), aceptada_at = now() where id = v.id;
  return jsonb_build_object('ok', true, 'piezas', to_jsonb(v_ids));
end;
$$;

create or replace function public.rrss_descartar_campana(p_campana uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.rrss_exigir_edicion();
  update public.rrss_campanas set estado = 'descartada' where id = p_campana and estado = 'propuesta';
  if not found then raise exception 'No hay ninguna propuesta con ese id' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─── 11. Métricas ───────────────────────────────────────────────────────────
create table if not exists public.rrss_metricas_cuenta (
  id                   bigint generated always as identity primary key,
  fecha                date not null,
  red                  text not null default 'instagram' check (red in ('instagram', 'facebook')),
  cuenta_id            text not null check (cuenta_id ~ '^[0-9]{1,30}$'),
  seguidores           integer check (seguidores is null or seguidores >= 0),
  alcance              integer check (alcance is null or alcance >= 0),
  visualizaciones      integer check (visualizaciones is null or visualizaciones >= 0),
  visitas_perfil       integer check (visitas_perfil is null or visitas_perfil >= 0),
  cuentas_interaccion  integer check (cuentas_interaccion is null or cuentas_interaccion >= 0),
  interacciones        integer check (interacciones is null or interacciones >= 0),
  me_gusta             integer check (me_gusta is null or me_gusta >= 0),
  comentarios          integer check (comentarios is null or comentarios >= 0),
  guardados            integer check (guardados is null or guardados >= 0),
  compartidos          integer check (compartidos is null or compartidos >= 0),
  toques_enlaces       integer check (toques_enlaces is null or toques_enlaces >= 0),
  capturado_at         timestamptz not null default now(),
  constraint rrss_metricas_cuenta_key unique (fecha, red, cuenta_id)
);
comment on table public.rrss_metricas_cuenta is
  'Métricas diarias de la cuenta (día de Europe/Madrid): Instagram (alcance, visualizaciones, interacciones…) y, de la '
  'página de Facebook, los seguidores. Solo la escribe rrss-metricas (service role). NULL = Meta no dio el dato.';
create index if not exists rrss_metricas_cuenta_idx on public.rrss_metricas_cuenta (red, cuenta_id, fecha desc);

create table if not exists public.rrss_metricas_publicacion (
  id               bigint generated always as identity primary key,
  media_id         text not null check (media_id ~ '^[0-9_]{1,60}$'),
  red              text not null default 'instagram' check (red in ('instagram', 'facebook')),
  cuenta_id        text not null check (cuenta_id ~ '^[0-9]{1,30}$'),
  fecha_captura    date not null,
  capturado_at     timestamptz not null default now(),
  pieza_id         uuid references public.rrss_piezas (id) on delete set null,
  tipo_medio       text check (tipo_medio is null or tipo_medio in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  producto         text check (producto is null or producto in ('FEED', 'REELS', 'STORY', 'AD')),
  publicado_at     timestamptz,
  publicado_local  timestamp,
  permalink        text check (permalink is null or char_length(permalink) <= 500),
  miniatura_url    text check (miniatura_url is null or char_length(miniatura_url) <= 2000),
  caption          text check (caption is null or char_length(caption) <= 2200),
  hashtags         text[] not null default '{}' check (cardinality(hashtags) <= 60),
  alcance          integer check (alcance is null or alcance >= 0),
  me_gusta         integer check (me_gusta is null or me_gusta >= 0),
  comentarios      integer check (comentarios is null or comentarios >= 0),
  guardados        integer check (guardados is null or guardados >= 0),
  compartidos      integer check (compartidos is null or compartidos >= 0),
  visualizaciones  integer check (visualizaciones is null or visualizaciones >= 0),
  interacciones    integer check (interacciones is null or interacciones >= 0),
  tiempo_medio_ms  integer check (tiempo_medio_ms is null or tiempo_medio_ms >= 0),
  tasa_salto       numeric(6, 2) check (tasa_salto is null or tasa_salto between 0 and 100),
  constraint rrss_metricas_publicacion_key unique (media_id, fecha_captura)
);
comment on table public.rrss_metricas_publicacion is
  'Métricas de cada publicación de Instagram por día de captura (acumuladas desde que se publicó). pieza_id enlaza con '
  'la pieza si salió del panel. Solo la escribe rrss-metricas (service role).';
create index if not exists rrss_metricas_publicacion_idx on public.rrss_metricas_publicacion (media_id, fecha_captura desc);
create index if not exists rrss_metricas_publicacion_fecha_idx on public.rrss_metricas_publicacion (publicado_at desc);

create or replace view public.rrss_metricas_publicacion_ultima with (security_invoker = on) as
  select distinct on (media_id) * from public.rrss_metricas_publicacion order by media_id, fecha_captura desc;
comment on view public.rrss_metricas_publicacion_ultima is
  'Última captura de cada publicación. security_invoker: aplica la RLS de rrss_metricas_publicacion.';

create table if not exists public.rrss_metricas_capturas (
  id             bigint generated always as identity primary key,
  origen         text not null check (origen in ('cron', 'panel', 'servicio')),
  inicio         timestamptz not null default now(),
  fin            timestamptz,
  ok             boolean not null default false,
  cuenta_id      text,
  dias           integer not null default 0,
  publicaciones  integer not null default 0,
  error_tipo     text check (error_tipo is null or char_length(error_tipo) <= 60),
  error          text check (error is null or char_length(error) <= 2000),
  avisos         jsonb not null default '[]'::jsonb check (jsonb_typeof(avisos) = 'array' and pg_column_size(avisos) <= 16384)
);
comment on table public.rrss_metricas_capturas is
  'Cada captura de métricas (cron diario o «Actualizar ahora»), con el error si falló (p. ej. falta '
  'instagram_manage_insights). Textos ya saneados (sin tokens).';
create index if not exists rrss_metricas_capturas_idx on public.rrss_metricas_capturas (inicio desc);

-- «Qué funciona» de los últimos p_dias por formato, tipo de trabajo, día, franja de 2 h (hora de Madrid) y hashtag.
-- Tasa de interacción = Σ interacciones ÷ Σ alcance. Con muestra mínima (p_minimo por grupo; 2 × p_minimo en total).
-- SECURITY INVOKER: manda la RLS de quien llama. La leen la pestaña Métricas y la IA.
create or replace function public.rrss_que_funciona(p_dias integer default 90, p_minimo integer default 3)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_res jsonb;
begin
  if p_dias is null or p_dias < 7 or p_dias > 365 then raise exception 'dias debe estar entre 7 y 365' using errcode = '22023'; end if;
  if p_minimo is null or p_minimo < 1 or p_minimo > 50 then raise exception 'minimo debe estar entre 1 y 50' using errcode = '22023'; end if;
  if auth.uid() is not null and not coalesce(public.can_read_section('rrss'), false) then
    raise exception 'Hace falta «Ver» en RRSS' using errcode = '42501';
  end if;
  with base as (
    select m.media_id, m.alcance::numeric as alcance,
           coalesce(m.interacciones, coalesce(m.me_gusta, 0) + coalesce(m.comentarios, 0) + coalesce(m.guardados, 0)
                    + coalesce(m.compartidos, 0))::numeric as inter,
           coalesce(m.guardados, 0)::numeric as guardados,
           case m.producto when 'STORY' then 'story' when 'REELS' then 'reel'
                else case m.tipo_medio when 'CAROUSEL_ALBUM' then 'carrusel' else coalesce(p.formato, 'foto') end end as formato,
           p.servicio,
           coalesce(m.publicado_local, m.publicado_at at time zone 'Europe/Madrid') as local,
           m.hashtags, m.caption
      from public.rrss_metricas_publicacion_ultima m
      left join lateral (
        select x.formato, x.servicio from public.rrss_piezas x
         where x.id = m.pieza_id or (x.media_id is not null and x.media_id = m.media_id)
         order by (x.id = m.pieza_id) desc nulls last limit 1) p on true
     where m.red = 'instagram' and m.publicado_at >= now() - make_interval(days => p_dias) and m.alcance > 0
  ),
  tot as (
    select count(*) as n, round(100 * sum(inter) / nullif(sum(alcance), 0), 1) as tasa,
           count(*) >= 2 * p_minimo as suficiente
      from base
  ),
  g as (
    select 'formato'::text as eje, formato as clave, 0 as orden, alcance, inter, guardados from base
    union all
    select 'servicio', servicio, 0, alcance, inter, guardados from base where servicio is not null
    union all
    select 'dia', (array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])[extract(isodow from local)::int],
           extract(isodow from local)::int, alcance, inter, guardados from base where local is not null
    union all
    select 'franja', lpad(h::text, 2, '0') || '-' || lpad((h + 2)::text, 2, '0'), h, alcance, inter, guardados
      from (select b.*, (extract(hour from b.local)::int / 2) * 2 as h from base b where b.local is not null) b2
    union all
    select 'hashtag', t.h, 0, b.alcance, b.inter, b.guardados from base b cross join lateral unnest(b.hashtags) as t(h)
  ),
  r as (
    select eje, clave, min(orden) as orden, count(*) as n, round(avg(alcance)) as alcance_medio,
           round(100 * sum(inter) / nullif(sum(alcance), 0), 1) as tasa,
           round(100 * sum(guardados) / nullif(sum(alcance), 0), 2) as gpa,
           count(*) >= p_minimo as suficiente
      from g where clave is not null group by eje, clave
  ),
  rl as (
    select r.*, row_number() over (partition by eje order by suficiente desc, tasa desc nulls last, n desc, clave) as puesto
      from r where eje <> 'hashtag' or suficiente
  ),
  ejes(eje, nombre, ord) as (
    values ('formato', 'formato', 1), ('servicio', 'tipo de trabajo', 2), ('dia', 'día de la semana', 3),
           ('franja', 'hora de publicación', 4), ('hashtag', 'hashtag', 5)
  ),
  mejor as (
    select distinct on (eje) eje, clave, n, tasa, orden from r where suficiente and tasa is not null
     order by eje, tasa desc, n desc, clave
  ),
  nsuf as (select eje, count(*) filter (where suficiente) as ns from r group by eje),
  concl as (
    select e.eje, e.nombre, e.ord, mj.clave, mj.n, mj.tasa, mj.orden, t.tasa as media,
           case when not t.suficiente or coalesce(ns.ns, 0) < 2 or mj.clave is null then 'faltan_datos'
                when t.tasa > 0 and mj.tasa >= t.tasa * 1.1 then 'mejor'
                else 'parecido' end as estado
      from ejes e cross join tot t
      left join nsuf ns on ns.eje = e.eje
      left join mejor mj on mj.eje = e.eje
  ),
  textos as (
    select c.*,
           case c.estado
             when 'mejor' then
               (case c.eje
                  when 'formato' then (case c.clave when 'reel' then 'Los reels' when 'story' then 'Las historias'
                                                    when 'carrusel' then 'Los carruseles' else 'Las fotos sueltas' end) || ' funcionan mejor'
                  when 'servicio' then 'Los trabajos de ' || c.clave || ' funcionan mejor'
                  when 'dia' then 'Los ' || (case c.clave when 'sábado' then 'sábados' when 'domingo' then 'domingos' else c.clave end)
                                  || ' funcionan mejor'
                  when 'franja' then 'Publicar entre las ' || c.orden || ' y las ' || (c.orden + 2) || ' h funciona mejor'
                  else 'Las publicaciones con ' || c.clave || ' funcionan mejor' end)
               || ': ' || regexp_replace(replace(to_char(c.tasa, 'FM999990.0'), '.', ','), ',0$', '')
               || ' % de interacción en ' || c.n || ' publicaciones, frente al '
               || regexp_replace(replace(to_char(c.media, 'FM999990.0'), '.', ','), ',0$', '') || ' % de media.'
             when 'parecido' then 'Por ' || c.nombre || ' no hay diferencias claras todavía.'
             else 'Por ' || c.nombre || ' faltan datos: hacen falta al menos ' || p_minimo || ' publicaciones en dos grupos distintos.'
           end as texto
      from concl c
  ),
  pubs as (
    select b.media_id, (b.local)::date as fecha, b.formato, b.servicio,
           nullif(left(split_part(btrim(coalesce(b.caption, '')), E'\n', 1), 120), '') as gancho,
           b.alcance::bigint as alcance, round(100 * b.inter / b.alcance, 1) as tasa,
           row_number() over (order by b.inter / b.alcance desc, b.alcance desc, b.media_id) as rn_mejor,
           row_number() over (order by b.inter / b.alcance asc, b.alcance asc, b.media_id) as rn_peor
      from base b
  )
  select jsonb_build_object(
    'periodo_dias', p_dias,
    'minimo', p_minimo,
    'publicaciones', t.n,
    'tasa_media', t.tasa,
    'suficiente', t.suficiente,
    'aviso', case when t.n = 0 then 'Todavía no hay publicaciones con datos en los últimos ' || p_dias || ' días.'
                  when not t.suficiente then 'Solo hay ' || t.n || ' publicaciones con datos en los últimos ' || p_dias
                       || ' días: hacen falta al menos ' || (2 * p_minimo) || ' para sacar conclusiones.' end,
    'por', coalesce((select jsonb_object_agg(x.eje, x.grupos) from (
              select eje, jsonb_agg(jsonb_build_object('clave', clave, 'publicaciones', n, 'alcance_medio', alcance_medio,
                       'tasa', tasa, 'guardados_por_alcance', gpa, 'suficiente', suficiente, 'orden', orden) order by puesto) as grupos
                from rl where puesto <= case when eje = 'hashtag' then 8 else 12 end group by eje) x), '{}'::jsonb),
    'conclusiones', coalesce((select jsonb_agg(jsonb_build_object('eje', eje, 'estado', estado, 'clave', clave,
                       'publicaciones', n, 'tasa', tasa, 'media', media, 'texto', texto) order by ord) from textos), '[]'::jsonb),
    'mejores', case when t.suficiente then coalesce((select jsonb_agg(jsonb_build_object('media_id', media_id, 'fecha', fecha,
                       'formato', formato, 'servicio', servicio, 'gancho', gancho, 'alcance', alcance, 'tasa', tasa) order by rn_mejor)
                       from pubs where rn_mejor <= 5), '[]'::jsonb) else '[]'::jsonb end,
    'peores', case when t.suficiente then coalesce((select jsonb_agg(jsonb_build_object('media_id', media_id, 'fecha', fecha,
                       'formato', formato, 'servicio', servicio, 'gancho', gancho, 'alcance', alcance, 'tasa', tasa) order by rn_peor)
                       from pubs where rn_peor <= 5), '[]'::jsonb) else '[]'::jsonb end)
    into v_res
    from tot t;
  return v_res;
end;
$$;

-- ─── 12. Avisos de la campana: los de RRSS los ve quien ve RRSS ─────────────
-- Misma función que Presupuestos (20261123100000), con una rama más: rrss_* → sección «rrss».
create or replace function public.seccion_aviso(p_tipo text)
returns text language sql immutable set search_path = public
as $$
  select case
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    when p_tipo like 'facturas\_%' or p_tipo = 'subida_precio' then 'facturas'
    when p_tipo like 'presupuesto\_%' then 'presupuestos'
    when p_tipo like 'rrss\_%' then 'rrss'
    else 'dashboard'
  end
$$;
-- La tabla de avisos la lee cualquiera con «Dashboard» (el panel filtra por sección); los de RRSS (caducidad de la
-- conexión, publicaciones que fallan) solo quien ve RRSS, como hacen Facturas y Presupuestos con los suyos.
drop policy if exists notificaciones_rrss_solo_seccion on public.notificaciones_dashboard;
create policy notificaciones_rrss_solo_seccion on public.notificaciones_dashboard
  as restrictive for select to authenticated
  using (tipo not like 'rrss\_%' or (select public.can_read_section('rrss')));

-- ─── 13. Tareas programadas ─────────────────────────────────────────────────
-- ¿Hay algo que hacer en el programador? (vencidas, bloqueos o reservas caducados, o vídeos que Meta procesaba).
create or replace function public.rrss_hay_trabajo()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rrss_programaciones g
                  where (g.estado = 'programada' and g.siguiente_intento_at <= now())
                     or (g.estado = 'publicando' and g.bloqueada_hasta < now()))
      or exists (select 1 from public.rrss_piezas p
                  where p.estado = 'procesando'
                     or (p.estado = 'publicando' and p.reservada_hasta < now()))
$$;

-- Llama a una Edge Function de RRSS con x-ocr-secret (Vault: project_url y ocr_trabajos_secret). Sin ellos, no llama.
--   programar / mantenimiento → rrss-programador     metricas → rrss-metricas (capturar)
create or replace function public.rrss_disparar(p_accion text default 'programar')
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secreto text;
  v_funcion text;
  v_cuerpo jsonb;
begin
  if p_accion not in ('programar', 'mantenimiento', 'metricas') then
    raise exception 'acción no válida: %', p_accion using errcode = '22023';
  end if;
  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return 'sin_vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return 'sin_vault';
  end if;
  v_funcion := case when p_accion = 'metricas' then 'rrss-metricas' else 'rrss-programador' end;
  v_cuerpo := jsonb_build_object('accion', case when p_accion = 'metricas' then 'capturar' else p_accion end);
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 150000)'
    using rtrim(v_url, '/') || '/functions/v1/' || v_funcion,
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          v_cuerpo;
  return 'llamada';
end;
$$;
comment on function public.rrss_disparar(text) is
  'pg_cron (rrss-programador cada 5 min si rrss_hay_trabajo(), rrss-metricas 05:10 UTC, rrss-mantenimiento 03:50 UTC). '
  'POST a la Edge Function con x-ocr-secret. Sin project_url u ocr_trabajos_secret en Vault devuelve sin_vault.';

create or replace function public.rrss_purgar()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_estados integer; v_ia integer; v_capturas integer; v_metricas integer; v_campanas integer; v_prog integer;
begin
  delete from public.rrss_oauth_estados where creado_en < now() - interval '1 day';
  get diagnostics v_estados = row_count;
  delete from public.rrss_ia_peticiones where created_at < now() - interval '90 days';
  get diagnostics v_ia = row_count;
  delete from public.rrss_metricas_capturas where inicio < now() - interval '13 months';
  get diagnostics v_capturas = row_count;
  -- De cada publicación se guarda la evolución 400 días; la última captura, siempre.
  delete from public.rrss_metricas_publicacion m
   where m.fecha_captura < current_date - 400
     and exists (select 1 from public.rrss_metricas_publicacion n where n.media_id = m.media_id and n.fecha_captura > m.fecha_captura);
  get diagnostics v_metricas = row_count;
  delete from public.rrss_campanas where estado = 'descartada' and updated_at < now() - interval '180 days';
  get diagnostics v_campanas = row_count;
  delete from public.rrss_programaciones where estado = 'cancelada' and updated_at < now() - interval '180 days';
  get diagnostics v_prog = row_count;
  -- Una pieza que se quedó «procesando» más de 24 h ya no se puede publicar (el contenedor de Meta caduca).
  update public.rrss_piezas
     set estado = 'error', procesando_desde = null, contenedor_id = null, hijos = '{}',
         error = 'Meta no terminó de procesar el vídeo en 24 horas y el contenedor caducó.', error_tipo = 'contenedor_caducado',
         como_arreglarlo = 'Vuelve a publicarla. Si se repite, exporta el vídeo en MP4 (H.264) y más corto.'
   where estado = 'procesando' and procesando_desde < now() - interval '24 hours' and reserva_id is null;
  return jsonb_build_object('estados', v_estados, 'ia', v_ia, 'capturas', v_capturas, 'metricas', v_metricas,
                            'campanas', v_campanas, 'programaciones', v_prog);
end;
$$;
comment on function public.rrss_purgar() is
  'pg_cron rrss-mantenimiento (03:50 UTC): states del OAuth de más de un día, peticiones a la IA de 90 días, capturas de '
  '13 meses, evolución de métricas de más de 400 días (la última se queda), campañas descartadas y programaciones '
  'canceladas de 180 días, y piezas que llevan más de 24 h procesando (pasan a error).';

-- ─── 14. Permisos: tablas ───────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['rrss_ajustes', 'rrss_meta_cuenta', 'rrss_meta_tokens', 'rrss_oauth_estados', 'rrss_campanas',
                           'rrss_piezas', 'rrss_medios', 'rrss_programaciones', 'rrss_ia_peticiones', 'rrss_fechas',
                           'rrss_metricas_cuenta', 'rrss_metricas_publicacion', 'rrss_metricas_capturas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
  -- Lo que lee el panel: «Ver» en RRSS (super admin siempre) y sesión viva. rrss_meta_tokens y rrss_oauth_estados no.
  foreach t in array array['rrss_ajustes', 'rrss_meta_cuenta', 'rrss_campanas', 'rrss_piezas', 'rrss_medios',
                           'rrss_programaciones', 'rrss_ia_peticiones', 'rrss_fechas', 'rrss_metricas_cuenta',
                           'rrss_metricas_publicacion', 'rrss_metricas_capturas'] loop
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
                      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''rrss'')))',
                   t || '_lectura', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;
revoke all on public.rrss_metricas_publicacion_ultima from public, anon, authenticated;
grant select on public.rrss_metricas_publicacion_ultima to authenticated, service_role;

-- Ajustes: «Editar» cambia el estilo (sin crear ni borrar la fila).
grant update (zona, tono, guia, hashtags_base, ctas, palabras_evitar, facebook_por_defecto, emojis, aprendido_en, aprendido_resumen)
  on public.rrss_ajustes to authenticated;
drop policy if exists rrss_ajustes_editar on public.rrss_ajustes;
create policy rrss_ajustes_editar on public.rrss_ajustes for update to authenticated
  using ((select public.can_edit_section('rrss'))) with check ((select public.can_edit_section('rrss')));

-- Piezas: «Editar» crea, cambia y borra (las reglas de estado, en rrss_piezas_antes).
grant insert (grupo_id, red, formato, proporcion, titulo, caption, servicio, estado, fecha_prevista, idea)
  on public.rrss_piezas to authenticated;
grant update (red, formato, proporcion, titulo, caption, servicio, estado, fecha_prevista, idea) on public.rrss_piezas to authenticated;
grant delete on public.rrss_piezas to authenticated;
drop policy if exists rrss_piezas_insert on public.rrss_piezas;
create policy rrss_piezas_insert on public.rrss_piezas for insert to authenticated with check ((select public.can_edit_section('rrss')));
drop policy if exists rrss_piezas_update on public.rrss_piezas;
create policy rrss_piezas_update on public.rrss_piezas for update to authenticated
  using ((select public.can_edit_section('rrss'))) with check ((select public.can_edit_section('rrss')));
drop policy if exists rrss_piezas_delete on public.rrss_piezas;
create policy rrss_piezas_delete on public.rrss_piezas for delete to authenticated using ((select public.can_edit_section('rrss')));

grant insert (pieza_id, orden, tipo, ruta, origen, web_foto_id, ancho, alto, duracion_s, bytes, alt_text, portada_ms)
  on public.rrss_medios to authenticated;
grant update (orden, alt_text, portada_ms) on public.rrss_medios to authenticated;
grant delete on public.rrss_medios to authenticated;
drop policy if exists rrss_medios_insert on public.rrss_medios;
create policy rrss_medios_insert on public.rrss_medios for insert to authenticated with check ((select public.can_edit_section('rrss')));
drop policy if exists rrss_medios_update on public.rrss_medios;
create policy rrss_medios_update on public.rrss_medios for update to authenticated
  using ((select public.can_edit_section('rrss'))) with check ((select public.can_edit_section('rrss')));
drop policy if exists rrss_medios_delete on public.rrss_medios;
create policy rrss_medios_delete on public.rrss_medios for delete to authenticated using ((select public.can_edit_section('rrss')));

-- Campañas: las inserta rrss-ia con el JWT del usuario («Editar»); aceptar y descartar, por RPC.
grant insert (titulo, objetivo, peticion, desde, hasta, propuesta, modelo) on public.rrss_campanas to authenticated;
drop policy if exists rrss_campanas_insert on public.rrss_campanas;
create policy rrss_campanas_insert on public.rrss_campanas for insert to authenticated with check ((select public.can_edit_section('rrss')));

-- Fechas señaladas: «Editar» las cambia y añade las suyas.
grant insert (titulo, ambito, desde, hasta, anual, idea, verificacion, activo) on public.rrss_fechas to authenticated;
grant update (titulo, ambito, desde, hasta, anual, idea, verificacion, activo) on public.rrss_fechas to authenticated;
drop policy if exists rrss_fechas_insert on public.rrss_fechas;
create policy rrss_fechas_insert on public.rrss_fechas for insert to authenticated with check ((select public.can_edit_section('rrss')));
drop policy if exists rrss_fechas_update on public.rrss_fechas;
create policy rrss_fechas_update on public.rrss_fechas for update to authenticated
  using ((select public.can_edit_section('rrss'))) with check ((select public.can_edit_section('rrss')));

-- Peticiones a la IA: las inserta rrss-ia con el JWT del usuario y marca si salió bien (solo la columna ok, solo las suyas).
grant insert (accion, modelo) on public.rrss_ia_peticiones to authenticated;
grant update (ok) on public.rrss_ia_peticiones to authenticated;
drop policy if exists rrss_ia_peticiones_insert on public.rrss_ia_peticiones;
create policy rrss_ia_peticiones_insert on public.rrss_ia_peticiones for insert to authenticated
  with check ((select public.can_edit_section('rrss')));
drop policy if exists rrss_ia_peticiones_update on public.rrss_ia_peticiones;
create policy rrss_ia_peticiones_update on public.rrss_ia_peticiones for update to authenticated
  using ((select public.can_edit_section('rrss')) and creado_por = (select auth.uid()))
  with check ((select public.can_edit_section('rrss')) and creado_por = (select auth.uid()));

-- ─── 15. Permisos: cubo «rrss» ──────────────────────────────────────────────
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists rrss_objetos_select on storage.objects';
    execute $p$create policy rrss_objetos_select on storage.objects for select to authenticated
      using (bucket_id = 'rrss' and (select public.can_read_section('rrss')) and (select private.sesion_panel_permitida()))$p$;
    execute 'drop policy if exists rrss_objetos_insert on storage.objects';
    execute $p$create policy rrss_objetos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'rrss' and (select public.can_edit_section('rrss')) and (select private.sesion_panel_permitida())
                  and public.rrss_ruta_valida(name) and (storage.foldername(name))[2] = (select auth.uid())::text)$p$;
    execute 'drop policy if exists rrss_objetos_delete on storage.objects';
    execute $p$create policy rrss_objetos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'rrss' and (select public.can_edit_section('rrss')) and (select private.sesion_panel_permitida())
             and not exists (select 1 from public.rrss_medios m where m.ruta = storage.objects.name))$p$;
  end if;
end;
$$;

-- ─── 16. Permisos: funciones ────────────────────────────────────────────────
revoke all on function
  public.rrss_ruta_valida(text), public.rrss_hashtags_validos(text[]), public.rrss_textos_validos(text[], integer),
  public.rrss_exigir_edicion(), public.rrss_es_panel(), public.rrss_ajustes_al_editar(), public.rrss_oauth_usar_estado(text),
  public.rrss_objeto_existe(text), public.rrss_pieza_publicandose(uuid), public.rrss_pieza_problemas(uuid),
  public.rrss_piezas_antes(), public.rrss_piezas_antes_de_borrar(), public.rrss_medios_antes(), public.rrss_fotos_web(),
  public.rrss_programaciones_al_editar(), public.rrss_programacion_validar_fecha(timestamptz),
  public.rrss_programacion_conflictos(text, timestamptz, uuid), public.rrss_programacion_pieza(uuid),
  public.rrss_reprogramar(uuid, timestamptz, boolean), public.rrss_programar(uuid, timestamptz, boolean),
  public.rrss_cancelar_programacion(uuid), public.rrss_programador_reclamar(integer),
  public.rrss_programador_cerrar(uuid, uuid, text, text, text, text, integer),
  public.rrss_pieza_reservar(uuid, integer, boolean), public.rrss_pieza_progreso(uuid, uuid, text, text[], text, text, boolean),
  public.rrss_pieza_cerrar(uuid, uuid, text, jsonb), public.rrss_ficheros_para_borrar(integer, integer, integer),
  public.rrss_marcar_medios_borrados(text[]), public.rrss_comprobar_cupo_ia(), public.rrss_fechas_al_editar(),
  public.rrss_fechas_entre(date, date), public.rrss_campanas_al_editar(), public.rrss_aceptar_campana(uuid, integer[], boolean),
  public.rrss_descartar_campana(uuid), public.rrss_que_funciona(integer, integer), public.rrss_hay_trabajo(),
  public.rrss_disparar(text), public.rrss_purgar()
from public, anon, authenticated;

-- Las que usan las políticas y los disparadores del panel.
grant execute on function
  public.rrss_ruta_valida(text), public.rrss_hashtags_validos(text[]), public.rrss_textos_validos(text[], integer),
  public.rrss_es_panel(), public.rrss_objeto_existe(text), public.rrss_pieza_publicandose(uuid)
to authenticated, service_role;
-- Las del panel (comprueban «Ver» o «Editar» dentro) y las de lectura (RLS).
grant execute on function
  public.rrss_fotos_web(), public.rrss_pieza_problemas(uuid), public.rrss_programar(uuid, timestamptz, boolean),
  public.rrss_reprogramar(uuid, timestamptz, boolean), public.rrss_cancelar_programacion(uuid),
  public.rrss_aceptar_campana(uuid, integer[], boolean), public.rrss_descartar_campana(uuid),
  public.rrss_fechas_entre(date, date), public.rrss_que_funciona(integer, integer)
to authenticated, service_role;
-- Las de las Edge Functions y pg_cron, solo service role.
grant execute on function
  public.rrss_oauth_usar_estado(text), public.rrss_programador_reclamar(integer),
  public.rrss_programador_cerrar(uuid, uuid, text, text, text, text, integer),
  public.rrss_pieza_reservar(uuid, integer, boolean), public.rrss_pieza_progreso(uuid, uuid, text, text[], text, text, boolean),
  public.rrss_pieza_cerrar(uuid, uuid, text, jsonb), public.rrss_ficheros_para_borrar(integer, integer, integer),
  public.rrss_marcar_medios_borrados(text[]), public.rrss_hay_trabajo(), public.rrss_disparar(text), public.rrss_purgar()
to service_role;

-- ─── 17. Auditoría: fuera los tokens, los states, el tope de la IA y las métricas ──
-- Como Newsletter: se añaden a la lista de exclusión de instalar_auditoria_panel() y del disparador de eventos
-- (también en una reinstalación). Ajustes, conexión (sin tokens), piezas, ficheros, programaciones, campañas y fechas
-- sí se auditan.
do $$
declare
  v_def text;
  v_extra constant text := ',''rrss_meta_tokens'',''rrss_oauth_estados'',''rrss_ia_peticiones'',''rrss_metricas_cuenta'',''rrss_metricas_publicacion'',''rrss_metricas_capturas'')';
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''rrss_meta_tokens''' in v_def) = 0 then
      if position('''email_eventos'')' in v_def) > 0 then
        execute replace(v_def, '''email_eventos'')', '''email_eventos''' || v_extra);
      elsif position('''metricas'')' in v_def) > 0 then
        execute replace(v_def, '''metricas'')', '''metricas''' || v_extra);
      end if;
    end if;
  end loop;
end;
$$;
drop trigger if exists trg_auditoria on public.rrss_meta_tokens;
drop trigger if exists trg_auditoria on public.rrss_oauth_estados;
drop trigger if exists trg_auditoria on public.rrss_ia_peticiones;
drop trigger if exists trg_auditoria on public.rrss_metricas_cuenta;
drop trigger if exists trg_auditoria on public.rrss_metricas_publicacion;
drop trigger if exists trg_auditoria on public.rrss_metricas_capturas;

-- ─── 18. IA: función con modelo elegible y consumo contabilizado ────────────
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo) values
        ('rrss-ia', 'RRSS · textos, hashtags, ideas, campañas y «aprender de lo publicado» para Instagram y Facebook.', true, 'propuesta', 970, true)
      on conflict (funcion) do nothing
    $q$;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado) values
        ('rrss-ia', 'gpt-4.1-mini, en código (RRSS_IA_MODEL)', true)
      on conflict (funcion) do nothing
    $q$;
  end if;
end;
$$;

-- ─── 19. Tareas pg_cron ─────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('rrss-programador', 'rrss-metricas', 'rrss-mantenimiento');
    perform cron.schedule('rrss-programador', '*/5 * * * *', $cron$ select public.rrss_disparar('programar') where public.rrss_hay_trabajo(); $cron$);
    perform cron.schedule('rrss-metricas', '10 5 * * *', $cron$ select public.rrss_disparar('metricas'); $cron$);
    perform cron.schedule('rrss-mantenimiento', '50 3 * * *', $cron$ select public.rrss_purgar(); select public.rrss_disparar('mantenimiento'); $cron$);
  else
    raise notice 'Sin pg_cron: las tareas rrss-programador, rrss-metricas y rrss-mantenimiento NO se han instalado.';
  end if;
end;
$$;

-- ─── 20. Comprobación final ─────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  t text;
begin
  foreach t in array array['rrss_meta_tokens', 'rrss_oauth_estados'] loop
    if has_table_privilege('authenticated', format('public.%I', t), 'SELECT') or has_table_privilege('anon', format('public.%I', t), 'SELECT') then
      v_malos := v_malos || format('%s se puede leer desde el panel o la web', t);
    end if;
  end loop;
  if has_table_privilege('anon', 'public.rrss_piezas', 'SELECT') then v_malos := v_malos || 'anon lee rrss_piezas'::text; end if;
  if has_table_privilege('authenticated', 'public.rrss_programaciones', 'INSERT')
     or has_table_privilege('authenticated', 'public.rrss_programaciones', 'UPDATE') then
    v_malos := v_malos || 'el panel escribe en rrss_programaciones sin pasar por las RPC'::text;
  end if;
  if has_function_privilege('authenticated', 'public.rrss_pieza_reservar(uuid, integer, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.rrss_programador_reclamar(integer)', 'execute')
     or has_function_privilege('anon', 'public.rrss_programar(uuid, timestamptz, boolean)', 'execute') then
    v_malos := v_malos || 'RPC del servidor ejecutables desde el panel (o del panel desde la web)'::text;
  end if;
  if exists (select 1 from storage.buckets where id = 'rrss' and public) then v_malos := v_malos || 'el cubo rrss es público'::text; end if;
  if cardinality(v_malos) > 0 then
    raise exception 'rrss: comprobación final fallida (%).', array_to_string(v_malos, '; ');
  end if;
end;
$$;
