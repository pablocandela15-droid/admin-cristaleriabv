-- ============================================================================
--  Panel de Cristalería BV · web editable y presupuestos (23/11/2026)
-- ----------------------------------------------------------------------------
--  Petición del dueño: «Añade al admin panel un gestor web para gestionar las
--  fotos, luego un gestor de presupuestos donde aplicar la lógica, quiero que
--  la web sea lo más editable posible, desde el admin modificar precios, formas
--  y demás y los books de fotos».
--
--  Va ENCIMA del núcleo (20261118120000_nucleo_panel.sql): usa sus permisos por
--  sección (can_read_section / can_edit_section), su barrera de sesión
--  (private.sesion_panel_permitida), su auditoría (el disparador de eventos
--  audit_panel_nuevas_tablas pone el trigger de auditoría en cada tabla nueva) y
--  sus avisos (notificaciones_dashboard, seccion_aviso). No necesita Facturas.
--
--  Qué trae:
--    · web_albumes y web_fotos: los «books» de fotos de la web y las fotos
--      sueltas, con el bucket público «web-fotos»
--      (albumes/<album_id>/<uuid>.webp y sueltas/<uuid>.webp);
--    · web_contenido: bloques de texto de la web (negocio, servicios, faq,
--      imagenes) que la web mezcla sobre los valores de su código;
--    · web_tarifas: precios (config) y catálogo de la calculadora (textos,
--      opciones nuevas u ocultas, campos y categorías ocultos), una sola fila;
--    · presupuestos y presupuesto_lineas: el gestor de presupuestos, con número
--      correlativo por año (P-2026-0001) y totales que mantiene la base;
--    · web_solicitud_presupuesto_registrar(): la usa la Edge Function pública
--      web-solicitud-presupuesto (service role) para guardar una solicitud de la
--      web como presupuesto «solicitud», con límite por IP (huella con sal en
--      web_solicitudes_limite) y un aviso en la campana.
--
--  La web lee con la clave pública (anon): web_tarifas, web_contenido, los
--  álbumes publicados y sus fotos publicadas. Presupuestos no son públicos.
--
--  Permisos (secciones del panel): «web_fotos» (álbumes, fotos y el bucket),
--  «web_tarifas», «web_contenido» y «presupuestos». «Ver» consulta; «Editar»
--  cambia (las escrituras piden can_edit_section). Quien edita Contenido puede
--  además subir fotos sueltas (las imágenes de la web). Super admin, todo. Las
--  tablas del panel llevan la política restrictiva acceso_panel_no_bloqueado.
--
--  Vuelta atrás: supabase/rollbacks/20261123100000_web_y_presupuestos_ROLLBACK.sql.
-- ============================================================================

set check_function_bodies = off;

-- ─── Tablas: web ────────────────────────────────────────────────────────────
create table if not exists public.web_albumes (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (char_length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  titulo          text not null check (char_length(btrim(titulo)) between 1 and 120),
  descripcion     text check (descripcion is null or char_length(descripcion) <= 2000),
  servicio        text check (servicio is null or servicio in
                    ('mamparas', 'espejos', 'cerramientos', 'aluminio', 'barandillas', 'armarios', 'domino', 'otros')),
  -- SIN foreign key a propósito: con dos relaciones entre las tablas, PostgREST no sabría cuál embeber.
  portada_foto_id uuid,
  orden           integer not null default 0,
  publicado       boolean not null default false,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
comment on table public.web_albumes is
  'Books de fotos de la web (Web › Fotos del panel). servicio = slug del servicio de la web en cuya galería salen sus '
  'fotos (null = solo en /trabajos). portada_foto_id = una foto del álbum (sin FK para no confundir a PostgREST). '
  'La web solo ve los publicados.';
create index if not exists web_albumes_orden_idx on public.web_albumes (orden, creado_en);

create table if not exists public.web_fotos (
  id             uuid primary key default gen_random_uuid(),
  album_id       uuid references public.web_albumes(id) on delete cascade,
  ruta           text not null unique
                 check (char_length(ruta) <= 200 and ruta ~ '^(albumes/[0-9a-f-]{36}|sueltas)/[A-Za-z0-9][A-Za-z0-9._-]*$'),
  titulo         text check (titulo is null or char_length(titulo) <= 200),
  alt            text not null default '' check (char_length(alt) <= 300),
  ancho          integer check (ancho is null or ancho > 0),
  alto           integer check (alto is null or alto > 0),
  orden          integer not null default 0,
  publicado      boolean not null default true,
  destacada      boolean not null default false,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.web_fotos is
  'Fotos de la web en el bucket público web-fotos (ruta dentro del bucket). album_id null = foto suelta (imágenes de '
  'la web). destacada = sale en la portada de la web. La web solo ve las publicadas de álbumes publicados (o sueltas).';
create index if not exists web_fotos_album_orden_idx on public.web_fotos (album_id, orden, creado_en);
create index if not exists web_fotos_destacadas_idx on public.web_fotos (orden) where destacada;

create table if not exists public.web_contenido (
  clave           text primary key check (clave in ('negocio', 'servicios', 'faq', 'imagenes')),
  valor           jsonb not null default '{}'::jsonb check (octet_length(valor::text) <= 200000),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  -- faq es una lista; los demás, objetos.
  constraint web_contenido_forma check (jsonb_typeof(valor) = case when clave = 'faq' then 'array' else 'object' end)
);
comment on table public.web_contenido is
  'Bloques editables de la web (Web › Contenido del panel). La web mezcla valor sobre lo de su código: negocio '
  '(parcial de site), servicios ({slug: parcial de Service}), faq (lista completa; vacía = la del código) e imagenes '
  '({hero, heroHouse, about, aboutHands, contact}: {ruta, alt} en web-fotos).';

create table if not exists public.web_tarifas (
  id              smallint primary key default 1 check (id = 1),
  config          jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 200000),
  catalogo        jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(catalogo) = 'object' and octet_length(catalogo::text) <= 200000),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);
comment on table public.web_tarifas is
  'Tarifas de la calculadora de la web y del gestor de presupuestos (una sola fila, id = 1). config = precios (forma '
  'de DEFAULT_PRICING, src/lib/web/pricing/config.ts; lo que falte sale del código), catalogo = textos y opciones '
  '(src/lib/web/pricing/tarifas.ts › Catalogo). Se edita en Web › Tarifas.';

-- ─── Tablas: presupuestos ───────────────────────────────────────────────────
create table if not exists public.presupuestos (
  id                uuid primary key default gen_random_uuid(),
  -- Lo pone presupuesto_asignar_numero() al crearlo (P-AAAA-NNNN, correlativo por año) y no cambia.
  numero            text not null unique check (char_length(numero) between 1 and 40),
  estado            text not null default 'borrador'
                    check (estado in ('solicitud', 'borrador', 'enviado', 'aceptado', 'rechazado')),
  origen            text not null default 'panel' check (origen in ('panel', 'web')),
  cliente_nombre    text not null check (char_length(btrim(cliente_nombre)) between 1 and 200),
  cliente_telefono  text check (cliente_telefono is null or char_length(cliente_telefono) <= 40),
  cliente_email     text check (cliente_email is null or char_length(cliente_email) <= 200),
  cliente_direccion text check (cliente_direccion is null or char_length(cliente_direccion) <= 300),
  cliente_poblacion text check (cliente_poblacion is null or char_length(cliente_poblacion) <= 120),
  notas_cliente     text check (notas_cliente is null or char_length(notas_cliente) <= 2000),
  notas_internas    text check (notas_internas is null or char_length(notas_internas) <= 5000),
  condiciones       text check (condiciones is null or char_length(condiciones) <= 5000),
  fecha             date not null default current_date,
  validez_dias      integer not null default 30 check (validez_dias between 1 and 3650),
  descuento_pct     numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  iva_pct           numeric(5,2) not null default 21 check (iva_pct between 0 and 100),
  -- Los mantiene la base (presupuesto_calcular_totales): lo que se escriba aquí se ignora.
  subtotal          numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  enviado_en        timestamptz,
  respondido_en     timestamptz,
  creado_por        uuid,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);
comment on table public.presupuestos is
  'Presupuestos a clientes (gestor de presupuestos del panel). estado solicitud = llegó de la web (origen web, Edge '
  'Function web-solicitud-presupuesto). subtotal = suma de importes de las líneas; total = subtotal × (1 − '
  'descuento_pct/100) × (1 + iva_pct/100), redondeado a céntimos: los mantiene la base.';
create index if not exists presupuestos_estado_fecha_idx on public.presupuestos (estado, fecha desc, creado_en desc);
create index if not exists presupuestos_creado_idx on public.presupuestos (creado_en desc);

create table if not exists public.presupuesto_lineas (
  id               uuid primary key default gen_random_uuid(),
  presupuesto_id   uuid not null references public.presupuestos(id) on delete cascade,
  orden            integer not null default 0,
  -- Id de categoría de la calculadora (src/lib/web/pricing/categories.ts); null = línea manual.
  categoria        text check (categoria is null or categoria in
                     ('mamparas', 'domino', 'espejos', 'cerramientos', 'aluminio', 'barandillas', 'armarios', 'otros')),
  -- Valores introducidos en la calculadora (para volver a calcular).
  valores          jsonb check (valores is null or (jsonb_typeof(valores) = 'object' and octet_length(valores::text) <= 20480)),
  descripcion      text not null check (char_length(btrim(descripcion)) between 1 and 500),
  detalle          text check (detalle is null or char_length(detalle) <= 5000),
  cantidad         numeric(10,2) not null default 1 check (cantidad >= 0),
  precio_unitario  numeric(12,2) not null default 0,
  importe          numeric(12,2) generated always as (round(cantidad * precio_unitario, 2)) stored,
  -- Lo que dio la calculadora al añadirla (referencia; el precio que vale es precio_unitario).
  precio_calculado numeric(12,2),
  creado_en        timestamptz not null default now()
);
comment on table public.presupuesto_lineas is
  'Líneas de un presupuesto. categoria + valores = línea de la calculadora (se puede recalcular); categoria null = '
  'línea manual. importe = cantidad × precio_unitario (columna generada). Cada cambio recalcula el presupuesto.';
create index if not exists presupuesto_lineas_presupuesto_idx on public.presupuesto_lineas (presupuesto_id, orden, creado_en);

-- Último número usado por año. Solo lo toca presupuesto_asignar_numero() (SECURITY DEFINER): sin políticas.
create table if not exists public.presupuestos_numeracion (
  anio   smallint primary key check (anio between 2000 and 2999),
  ultimo integer not null default 0 check (ultimo >= 0)
);
comment on table public.presupuestos_numeracion is
  'Contador de la numeración de presupuestos por año (P-AAAA-NNNN). Nunca se reutiliza un número, aunque se borre el presupuesto.';

-- Límite de solicitudes de la web por IP. Solo huellas (HMAC-SHA256 de la IP con sal), nunca la IP. Sin políticas:
-- solo escribe web_solicitud_presupuesto_registrar() (service role). Se purga sola (más de un día).
create table if not exists public.web_solicitudes_limite (
  id        bigint generated always as identity primary key,
  ip_hash   text not null check (char_length(ip_hash) between 16 and 128),
  creado_en timestamptz not null default now()
);
comment on table public.web_solicitudes_limite is
  'Solicitudes de presupuesto de la web por huella de IP (HMAC con sal, nunca la IP) para el límite por hora de la '
  'Edge Function web-solicitud-presupuesto. Se borran solas al cabo de un día.';
create index if not exists web_solicitudes_limite_ip_idx on public.web_solicitudes_limite (ip_hash, creado_en desc);

-- ─── Funciones ──────────────────────────────────────────────────────────────
-- actualizado_en (las tablas de este módulo usan ese nombre; update_updated_at_column escribe updated_at).
create or replace function public.web_marcar_actualizado()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- Y quién (web_contenido, web_tarifas): el usuario del panel; null si escribe el servidor.
create or replace function public.web_marcar_autor()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

-- Al borrar una foto: si era la portada, el álbum se queda sin portada (portada_foto_id no tiene FK), y las imágenes
-- de la web que la usaban (web_contenido 'imagenes', {ruta, alt} o la ruta sola) vuelven a las del código de la web.
create or replace function public.web_fotos_limpiar_referencias()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.web_albumes set portada_foto_id = null where portada_foto_id = old.id;
  update public.web_contenido c
     set valor = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                    from jsonb_each(c.valor) e
                   where coalesce(e.value->>'ruta', e.value #>> '{}') is distinct from old.ruta)
   where c.clave = 'imagenes'
     and jsonb_typeof(c.valor) = 'object'
     and exists (select 1 from jsonb_each(c.valor) e where coalesce(e.value->>'ruta', e.value #>> '{}') = old.ruta);
  return null;
end;
$$;

-- Número del presupuesto: P-AAAA-NNNN con el año de su fecha, correlativo y sin huecos reutilizados. Se pone al
-- crearlo (lo que mande el cliente se ignora) y no cambia después.
create or replace function public.presupuesto_asignar_numero()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_anio integer;
  v_n integer;
begin
  if tg_op = 'UPDATE' then
    new.numero := old.numero;
    return new;
  end if;
  v_anio := extract(year from coalesce(new.fecha, current_date))::integer;
  insert into public.presupuestos_numeracion as c (anio, ultimo) values (v_anio, 1)
  on conflict (anio) do update set ultimo = c.ultimo + 1
  returning ultimo into v_n;
  new.numero := 'P-' || v_anio::text || '-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
  return new;
end;
$$;

-- Totales: subtotal = suma de los importes de las líneas; total con descuento e IVA, redondeado a céntimos.
create or replace function public.presupuesto_calcular_totales()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.subtotal := 0;
  else
    select coalesce(sum(l.importe), 0) into new.subtotal
      from public.presupuesto_lineas l
     where l.presupuesto_id = new.id;
  end if;
  new.total := round(new.subtotal * (1 - new.descuento_pct / 100) * (1 + new.iva_pct / 100), 2);
  return new;
end;
$$;

-- Cualquier cambio en las líneas vuelve a calcular su presupuesto (y el de origen si la línea cambia de presupuesto).
create or replace function public.presupuesto_lineas_recalcular()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.presupuestos set actualizado_en = now() where id = new.presupuesto_id;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.presupuesto_id is distinct from new.presupuesto_id) then
    update public.presupuestos set actualizado_en = now() where id = old.presupuesto_id;
  end if;
  return null;
end;
$$;

-- Nombre de una categoría de la calculadora: el del catálogo (web_tarifas) o el del código de la web.
create or replace function public.web_nombre_categoria(p_categoria text)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(
    nullif(btrim((select t.catalogo #>> array['categorias', p_categoria, 'nombre'] from public.web_tarifas t where t.id = 1)), ''),
    case p_categoria
      when 'mamparas' then 'Mampara a medida'
      when 'domino' then 'Cristal Dominó'
      when 'espejos' then 'Espejo a medida'
      when 'cerramientos' then 'Cerramiento'
      when 'aluminio' then 'Carpintería de aluminio'
      when 'barandillas' then 'Barandilla'
      when 'armarios' then 'Puertas de armario'
      when 'otros' then 'Cristal a medida'
    end,
    p_categoria)
$$;

-- Solicitud de presupuesto desde la web (solo la Edge Function web-solicitud-presupuesto, con el service role y la
-- cabecera x-audit-source). La función ya ha validado el cuerpo; aquí se vuelve a acotar y se aplica el límite por
-- huella de IP: como mucho p_max_hora solicitudes por hora. Devuelve {ok: true, numero, id} o {ok: false, motivo:
-- 'limite'}. Crea el presupuesto (estado solicitud, origen web), su línea y un aviso para quien ve Presupuestos.
create or replace function public.web_solicitud_presupuesto_registrar(p_ip_hash text, p_datos jsonb, p_max_hora integer default 5)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
  v_id uuid;
  v_numero text;
  v_categoria text := p_datos->>'categoria';
  v_nombre_categoria text;
  v_total numeric(12,2);
  v_nombre text := btrim(coalesce(p_datos->>'nombre', ''));
  v_valores jsonb := p_datos->'valores';
begin
  if p_ip_hash is null or char_length(p_ip_hash) not between 16 and 128 then
    raise exception 'Falta la huella de la IP' using errcode = '22023';
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    raise exception 'Solicitud no válida' using errcode = '22023';
  end if;
  if v_valores is not null and jsonb_typeof(v_valores) <> 'object' then
    raise exception 'Valores no válidos' using errcode = '22023';
  end if;
  v_total := round(coalesce(nullif(p_datos->>'total', '')::numeric, 0), 2);
  if v_total < 0 or v_total > 1000000 then
    raise exception 'Total fuera de rango' using errcode = '22023';
  end if;

  -- Una a una por huella: dos peticiones a la vez no se saltan el límite.
  perform pg_advisory_xact_lock(hashtext('web_solicitud_presupuesto:' || p_ip_hash));
  delete from public.web_solicitudes_limite where creado_en < now() - interval '1 day';
  select count(*) into v_n
    from public.web_solicitudes_limite
   where ip_hash = p_ip_hash and creado_en > now() - interval '1 hour';
  if v_n >= greatest(coalesce(p_max_hora, 5), 1) then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  insert into public.web_solicitudes_limite (ip_hash) values (p_ip_hash);

  v_nombre_categoria := public.web_nombre_categoria(v_categoria);
  insert into public.presupuestos (estado, origen, cliente_nombre, cliente_telefono, cliente_email,
                                   cliente_poblacion, cliente_direccion, notas_cliente)
  values ('solicitud', 'web', v_nombre,
          nullif(btrim(coalesce(p_datos->>'telefono', '')), ''),
          nullif(btrim(coalesce(p_datos->>'email', '')), ''),
          nullif(btrim(coalesce(p_datos->>'poblacion', '')), ''),
          nullif(btrim(coalesce(p_datos->>'direccion', '')), ''),
          nullif(btrim(coalesce(p_datos->>'notas', '')), ''))
  returning id, numero into v_id, v_numero;

  insert into public.presupuesto_lineas (presupuesto_id, orden, categoria, valores, descripcion, detalle,
                                         cantidad, precio_unitario, precio_calculado)
  values (v_id, 0, v_categoria, v_valores, left('Solicitud web · ' || v_nombre_categoria, 500),
          nullif(btrim(coalesce(p_datos->>'resumen', '')), ''), 1, v_total, v_total);

  insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, origen, datos)
  values ('presupuesto_solicitud', 'Nueva solicitud de presupuesto',
          left(v_numero || ' · ' || v_nombre || ' · ' || v_nombre_categoria
               || case when v_total > 0 then ' · ' || public.web_euros(v_total) else '' end, 500),
          v_id, 'presupuesto', 'web-solicitud-presupuesto',
          jsonb_build_object('numero', v_numero, 'categoria', v_categoria, 'total', v_total));

  return jsonb_build_object('ok', true, 'numero', v_numero, 'id', v_id);
end;
$$;

-- Importe en formato español para los avisos («1.234,50 €»).
create or replace function public.web_euros(p numeric)
returns text language sql immutable set search_path = public
as $$
  select translate(to_char(round(p, 2), 'FM999,999,990.00'), ',.', '.,') || ' €'
$$;

-- ─── Avisos de solicitudes: los ve quien ve Presupuestos ───────────────────
-- Misma función que el núcleo (y Facturas), con una rama más: presupuesto_* → sección «presupuestos».
create or replace function public.seccion_aviso(p_tipo text)
returns text language sql immutable set search_path = public
as $$
  select case
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    when p_tipo like 'facturas\_%' or p_tipo = 'subida_precio' then 'facturas'
    when p_tipo like 'presupuesto\_%' then 'presupuestos'
    else 'dashboard'
  end
$$;
-- La tabla de avisos la lee cualquiera con «Dashboard» (el panel filtra por sección); los de solicitudes llevan el
-- nombre del cliente y su presupuesto, así que solo los lee quien ve Presupuestos (como hace Facturas con los suyos).
drop policy if exists notificaciones_presupuestos_solo_seccion on public.notificaciones_dashboard;
create policy notificaciones_presupuestos_solo_seccion on public.notificaciones_dashboard
  as restrictive for select to authenticated
  using (tipo not like 'presupuesto\_%' or (select public.can_read_section('presupuestos')));

-- ─── Disparadores ───────────────────────────────────────────────────────────
drop trigger if exists trg_web_albumes_actualizado on public.web_albumes;
create trigger trg_web_albumes_actualizado before update on public.web_albumes
  for each row execute function public.web_marcar_actualizado();
drop trigger if exists trg_web_fotos_actualizado on public.web_fotos;
create trigger trg_web_fotos_actualizado before update on public.web_fotos
  for each row execute function public.web_marcar_actualizado();
drop trigger if exists trg_web_fotos_limpiar_referencias on public.web_fotos;
create trigger trg_web_fotos_limpiar_referencias after delete on public.web_fotos
  for each row execute function public.web_fotos_limpiar_referencias();
drop trigger if exists trg_web_contenido_autor on public.web_contenido;
create trigger trg_web_contenido_autor before insert or update on public.web_contenido
  for each row execute function public.web_marcar_autor();
drop trigger if exists trg_web_tarifas_autor on public.web_tarifas;
create trigger trg_web_tarifas_autor before insert or update on public.web_tarifas
  for each row execute function public.web_marcar_autor();

-- Presupuestos: «00» delante para que el número vaya antes que el resto (orden alfabético).
drop trigger if exists trg_00_presupuestos_numero on public.presupuestos;
create trigger trg_00_presupuestos_numero before insert or update of numero on public.presupuestos
  for each row execute function public.presupuesto_asignar_numero();
drop trigger if exists trg_presupuestos_actualizado on public.presupuestos;
create trigger trg_presupuestos_actualizado before update on public.presupuestos
  for each row execute function public.web_marcar_actualizado();
drop trigger if exists trg_presupuestos_totales on public.presupuestos;
create trigger trg_presupuestos_totales before insert or update on public.presupuestos
  for each row execute function public.presupuesto_calcular_totales();
drop trigger if exists trg_presupuesto_lineas_recalcular on public.presupuesto_lineas;
create trigger trg_presupuesto_lineas_recalcular after insert or update or delete on public.presupuesto_lineas
  for each row execute function public.presupuesto_lineas_recalcular();

-- ─── Permisos: tablas ───────────────────────────────────────────────────────
-- Todas con RLS. Las del panel, además, con la barrera de sesión bloqueada (acceso_panel_no_bloqueado). El contador
-- y el límite por IP, sin políticas: solo las funciones SECURITY DEFINER y el service role.
do $$
declare
  t text;
begin
  foreach t in array array['web_albumes', 'web_fotos', 'web_contenido', 'web_tarifas', 'presupuestos',
                           'presupuesto_lineas', 'presupuestos_numeracion', 'web_solicitudes_limite'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
  foreach t in array array['web_albumes', 'web_fotos', 'web_contenido', 'web_tarifas', 'presupuestos',
                           'presupuesto_lineas'] loop
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
                      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
  end loop;
end;
$$;

-- Lo que lee la web (anon) y el panel.
grant select on public.web_albumes, public.web_fotos, public.web_contenido, public.web_tarifas to anon, authenticated;
grant insert, update, delete on public.web_albumes, public.web_fotos to authenticated;
grant insert, update on public.web_contenido, public.web_tarifas to authenticated;
grant select, insert, update, delete on public.presupuestos, public.presupuesto_lineas to authenticated;

-- Álbumes: la web, los publicados; el panel (Fotos o Contenido), todos. Cambiar: «Editar» en Web · Fotos.
drop policy if exists web_albumes_lectura_publica on public.web_albumes;
create policy web_albumes_lectura_publica on public.web_albumes for select to anon, authenticated
  using (publicado);
drop policy if exists web_albumes_lectura_panel on public.web_albumes;
create policy web_albumes_lectura_panel on public.web_albumes for select to authenticated
  using ((select public.can_read_section('web_fotos')) or (select public.can_read_section('web_contenido')));
drop policy if exists web_albumes_insert on public.web_albumes;
create policy web_albumes_insert on public.web_albumes for insert to authenticated
  with check ((select public.can_edit_section('web_fotos')));
drop policy if exists web_albumes_update on public.web_albumes;
create policy web_albumes_update on public.web_albumes for update to authenticated
  using ((select public.can_edit_section('web_fotos'))) with check ((select public.can_edit_section('web_fotos')));
drop policy if exists web_albumes_delete on public.web_albumes;
create policy web_albumes_delete on public.web_albumes for delete to authenticated
  using ((select public.can_edit_section('web_fotos')));

-- Fotos: la web, las publicadas de álbumes publicados (o sueltas). Crear: Web · Fotos, o Web · Contenido solo
-- sueltas (las imágenes de la web). Cambiar y borrar: Web · Fotos.
drop policy if exists web_fotos_lectura_publica on public.web_fotos;
create policy web_fotos_lectura_publica on public.web_fotos for select to anon, authenticated
  using (publicado and (album_id is null
                        or exists (select 1 from public.web_albumes a where a.id = web_fotos.album_id and a.publicado)));
drop policy if exists web_fotos_lectura_panel on public.web_fotos;
create policy web_fotos_lectura_panel on public.web_fotos for select to authenticated
  using ((select public.can_read_section('web_fotos')) or (select public.can_read_section('web_contenido')));
drop policy if exists web_fotos_insert on public.web_fotos;
create policy web_fotos_insert on public.web_fotos for insert to authenticated
  with check ((select public.can_edit_section('web_fotos'))
              or (album_id is null and (select public.can_edit_section('web_contenido'))));
drop policy if exists web_fotos_update on public.web_fotos;
create policy web_fotos_update on public.web_fotos for update to authenticated
  using ((select public.can_edit_section('web_fotos'))) with check ((select public.can_edit_section('web_fotos')));
drop policy if exists web_fotos_delete on public.web_fotos;
create policy web_fotos_delete on public.web_fotos for delete to authenticated
  using ((select public.can_edit_section('web_fotos')));

-- Contenido y tarifas: los lee todo el mundo (la web); los cambia quien tiene «Editar» en su sección.
drop policy if exists web_contenido_lectura_publica on public.web_contenido;
create policy web_contenido_lectura_publica on public.web_contenido for select to anon, authenticated using (true);
drop policy if exists web_contenido_insert on public.web_contenido;
create policy web_contenido_insert on public.web_contenido for insert to authenticated
  with check ((select public.can_edit_section('web_contenido')));
drop policy if exists web_contenido_update on public.web_contenido;
create policy web_contenido_update on public.web_contenido for update to authenticated
  using ((select public.can_edit_section('web_contenido'))) with check ((select public.can_edit_section('web_contenido')));

drop policy if exists web_tarifas_lectura_publica on public.web_tarifas;
create policy web_tarifas_lectura_publica on public.web_tarifas for select to anon, authenticated using (true);
drop policy if exists web_tarifas_insert on public.web_tarifas;
create policy web_tarifas_insert on public.web_tarifas for insert to authenticated
  with check ((select public.can_edit_section('web_tarifas')));
drop policy if exists web_tarifas_update on public.web_tarifas;
create policy web_tarifas_update on public.web_tarifas for update to authenticated
  using ((select public.can_edit_section('web_tarifas'))) with check ((select public.can_edit_section('web_tarifas')));

-- Presupuestos y líneas: NO son públicos. «Ver» consulta, «Editar» cambia.
drop policy if exists presupuestos_select on public.presupuestos;
create policy presupuestos_select on public.presupuestos for select to authenticated
  using ((select public.can_read_section('presupuestos')));
drop policy if exists presupuestos_insert on public.presupuestos;
create policy presupuestos_insert on public.presupuestos for insert to authenticated
  with check ((select public.can_edit_section('presupuestos')));
drop policy if exists presupuestos_update on public.presupuestos;
create policy presupuestos_update on public.presupuestos for update to authenticated
  using ((select public.can_edit_section('presupuestos'))) with check ((select public.can_edit_section('presupuestos')));
drop policy if exists presupuestos_delete on public.presupuestos;
create policy presupuestos_delete on public.presupuestos for delete to authenticated
  using ((select public.can_edit_section('presupuestos')));

drop policy if exists presupuesto_lineas_select on public.presupuesto_lineas;
create policy presupuesto_lineas_select on public.presupuesto_lineas for select to authenticated
  using ((select public.can_read_section('presupuestos')));
drop policy if exists presupuesto_lineas_insert on public.presupuesto_lineas;
create policy presupuesto_lineas_insert on public.presupuesto_lineas for insert to authenticated
  with check ((select public.can_edit_section('presupuestos')));
drop policy if exists presupuesto_lineas_update on public.presupuesto_lineas;
create policy presupuesto_lineas_update on public.presupuesto_lineas for update to authenticated
  using ((select public.can_edit_section('presupuestos'))) with check ((select public.can_edit_section('presupuestos')));
drop policy if exists presupuesto_lineas_delete on public.presupuesto_lineas;
create policy presupuesto_lineas_delete on public.presupuesto_lineas for delete to authenticated
  using ((select public.can_edit_section('presupuestos')));

-- ─── Permisos: funciones ────────────────────────────────────────────────────
-- Todo cerrado a anon. La de la Edge Function, solo service role. Las de disparador, para quien escribe.
revoke all on function public.web_marcar_actualizado(), public.web_marcar_autor(), public.web_fotos_limpiar_referencias(),
  public.presupuesto_asignar_numero(), public.presupuesto_calcular_totales(), public.presupuesto_lineas_recalcular(),
  public.web_nombre_categoria(text), public.web_euros(numeric),
  public.web_solicitud_presupuesto_registrar(text, jsonb, integer) from public, anon;
revoke all on function public.web_solicitud_presupuesto_registrar(text, jsonb, integer) from authenticated;
grant execute on function public.web_solicitud_presupuesto_registrar(text, jsonb, integer) to service_role;
grant execute on function public.web_marcar_actualizado(), public.web_marcar_autor(), public.web_fotos_limpiar_referencias(),
  public.presupuesto_asignar_numero(), public.presupuesto_calcular_totales(), public.presupuesto_lineas_recalcular(),
  public.web_nombre_categoria(text), public.web_euros(numeric)
to authenticated, service_role;
revoke all on function public.seccion_aviso(text) from public, anon;
grant execute on function public.seccion_aviso(text) to authenticated, service_role;

-- ─── Bucket público de las fotos de la web ──────────────────────────────────
--   albumes/{album_id}/{uuid}.webp   fotos de un book (Web › Fotos)
--   sueltas/{uuid}.webp              imágenes de la web (Web › Contenido) y fotos sin álbum
-- Público: la web enseña /storage/v1/object/public/web-fotos/<ruta> sin permisos. Listar (select) solo el panel,
-- para que nadie enumere las fotos aún sin publicar. Subir y cambiar: «Editar» en Web · Fotos (en sueltas/ también
-- en Web · Contenido). Borrar: Web · Fotos.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('web-fotos', 'web-fotos', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists web_fotos_storage_select on storage.objects';
    execute $p$create policy web_fotos_storage_select on storage.objects for select to authenticated
      using (bucket_id = 'web-fotos'
             and ((select public.can_read_section('web_fotos')) or (select public.can_read_section('web_contenido'))))$p$;
    execute 'drop policy if exists web_fotos_storage_insert on storage.objects';
    execute $p$create policy web_fotos_storage_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'web-fotos'
                  and (((storage.foldername(name))[1] = 'albumes' and (select public.can_edit_section('web_fotos')))
                       or ((storage.foldername(name))[1] = 'sueltas'
                           and ((select public.can_edit_section('web_fotos')) or (select public.can_edit_section('web_contenido'))))))$p$;
    execute 'drop policy if exists web_fotos_storage_update on storage.objects';
    execute $p$create policy web_fotos_storage_update on storage.objects for update to authenticated
      using (bucket_id = 'web-fotos' and (select public.can_edit_section('web_fotos')))
      with check (bucket_id = 'web-fotos' and (select public.can_edit_section('web_fotos')))$p$;
    execute 'drop policy if exists web_fotos_storage_delete on storage.objects';
    execute $p$create policy web_fotos_storage_delete on storage.objects for delete to authenticated
      using (bucket_id = 'web-fotos' and (select public.can_edit_section('web_fotos')))$p$;
  end if;
end;
$$;

-- ─── Sin auditoría: el contador y el límite por IP ──────────────────────────
-- El disparador de eventos del núcleo les pone la auditoría al crearlas; son datos derivados (como
-- openai_uso_diario en el núcleo): el cambio que importa ya se audita en presupuestos.
drop trigger if exists trg_auditoria on public.presupuestos_numeracion;
drop trigger if exists trg_auditoria on public.web_solicitudes_limite;

-- ─── Datos de partida ───────────────────────────────────────────────────────
-- Los valores que tiene hoy el código de la web (cristaleriabv): tarifas = DEFAULT_PRICING, catálogo vacío (todo
-- como en el código), y los textos de negocio, servicios y preguntas frecuentes. imagenes vacío = las de la web.
insert into public.web_tarifas (id, config, catalogo) values (1, $json${"version":1,"priceNote":"Precio orientativo, sujeto a confirmación tras la visita técnica.","mamparas":{"base":200,"perCmWidth":3,"tallOverCm":200,"tallSurcharge":50,"cristal":{"templado-6mm":0,"templado-8mm":0,"templado-10mm":100},"extraclaro":80,"perfileria":{"sin-perfil":0,"minima":0,"completa":60},"acabadoPerfil":{"cromo":0,"blanco":0,"negro":40,"oro-cepillado":40},"acabadoCristal":{"serigrafia":0,"acido":0,"antical":30}},"domino":{"basePerM2":85,"factors":{"espesor":{"6":1.2,"8":1.4,"10":1.6,"12":1.8},"tipoCristal":{"templado":1.5,"laminado":1.7,"extraclaro":1.5},"acabado":{"transparente":1,"satinado":1,"serigrafado":1}},"extras":{"extraclaro":80,"antical":30,"tirador":0,"freno":0,"caset":0,"varillaMl":0}},"espejos":{"basePerM2":65,"factors":{"espesor":{"4":1,"5":1.1,"6":1.2},"canto":{"pulido":1.15,"biselado":1.25},"forma":{"rectangular":1,"redondo":1,"ovalado":1,"irregular":1}},"extras":{"iluminacion":0,"antivaho":0}},"cerramientos":{"basePerM2":150,"factors":{"tipoVidrio":{"simple":1,"doble":1.33,"bajo-emisivo":1.47},"material":{"aluminio":1,"pvc":1,"madera":1},"tipoCerramiento":{"terraza":1,"balcon":1,"porche":1,"cortina-cristal":1},"acabado":{"lacado-blanco":1,"lacado-gris":1,"lacado-negro":1,"anodizado":1,"imitacion-madera":1}},"extras":{}},"aluminio":{"basePerM2":180,"factors":{"vidrio":{"simple":1,"doble":1.33,"bajo-emisivo":1.47},"tipoApertura":{"corredera":1,"abatible":1,"oscilobatiente":1,"fija":1},"tipoTrabajo":{"ventana":1,"puerta":1,"mosquitera":1,"persiana":1},"acabado":{"lacado-blanco":1,"lacado-gris":1,"lacado-negro":1,"anodizado":1,"imitacion-madera":1}},"extras":{}},"barandillas":{"basePerM2":200,"factors":{"material":{"acero-inoxidable":1,"aluminio":1,"hierro":1},"relleno":{"cristal":1,"barrotes":1,"cable":1,"chapa":1},"tipoBarandilla":{"escalera":1,"balcon":1,"terraza":1,"piscina":1},"acabado":{"pulido":1,"satinado":1,"lacado":1,"negro-mate":1}},"extras":{}},"otros":{"basePerM2":75,"factors":{"grosor":{"4":1,"6":1.2,"8":1.4,"10":1.6,"12":1.8},"tipoCristal":{"float":1,"templado":1.5,"laminado":1.7,"climalit":2,"acustico":2.2},"cantos":{"recto":1,"pulido":1.15,"bisel":1.25}},"extras":{"taladro":12},"hardware":{"none":0,"basic":80,"premium":150}},"armarios":{"casacaMl":5.2,"tubo4040Ml":6,"tubo6040Ml":7.5,"guiaSuperiorMl":4,"guiaInferiorMl":4,"tapeta":1.2,"rueda":2.5,"tirador":5,"cristalM2":{"transparente-6":40,"mate-6":45,"bronce-6":48,"transparente-8":50,"mate-8":55},"maderaM2":{"melamina":55,"mdf":48,"contrachapado":65,"pino":70,"roble":95},"acabadoM2":{"normal":0,"pintado":25,"vinilado":20}},"entrega":{"envio":50,"montajeMin":100,"montajeMax":300}}$json$::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.web_contenido (clave, valor) values
  ('negocio', $json${"tagline":"Especialistas en cristalería y aluminio","description":"Especialistas en cristalería, mamparas, espejos, cerramientos y aluminio en el Baix Vinalopó. Más de 30 años de experiencia. Calcula tu presupuesto orientativo online.","yearsExperience":30,"phones":[{"label":"Oficina","display":"650 06 63 23","tel":"+34650066323"},{"label":"Jose Antonio","display":"649 99 40 07","tel":"+34649994007"}],"whatsapp":"34650066323","email":"info@cristaleriabaixvinalopo.es","address":{"street":"C/ Pío XII, 5","postalCode":"03330","city":"Crevillente","province":"Alicante","country":"España","lat":38.24504,"lon":-0.80694},"hours":[{"days":"Lunes a viernes","time":"9:00 – 13:30 y 16:00 – 19:30"},{"days":"Sábados y domingos","time":"Cerrado"}],"serviceArea":"Baix Vinalopó: Crevillente, Elche, Santa Pola y alrededores. También trabajamos en otras zonas de la provincia de Alicante."}$json$::jsonb),
  ('servicios', $json${"mamparas":{"name":"Mamparas","short":"Mamparas de baño y ducha a medida","headline":"Mamparas de baño y ducha hechas a tu medida","intro":"Diseñamos, fabricamos e instalamos mamparas para plato de ducha y bañera ajustadas al milímetro a tu baño. Frontales, angulares, correderas, abatibles o paneles fijos tipo walk-in, siempre con cristal templado de seguridad.","features":["Cristal templado de seguridad de 6, 8 o 10 mm","Perfilería completa, mínima o sin perfil","Acabados cromo, blanco, negro y más","Opciones de cristal extraclaro, al ácido o serigrafiado","Tratamiento antical para facilitar la limpieza","Modelos estándar con entrega más rápida"],"ideas":["Plato de ducha","Sobre bañera","Esquina en L","Walk-in con panel fijo"],"seoTitle":"Mamparas de baño y ducha a medida","seoDescription":"Mamparas de ducha y bañera a medida en Crevillente y el Baix Vinalopó. Cristal templado, perfilería a elegir e instalación profesional. Calcula tu presupuesto."},"espejos":{"name":"Espejos","short":"Espejos decorativos y funcionales","headline":"Espejos a medida que amplían y llenan de luz","intro":"Cortamos y colocamos espejos a medida para baños, recibidores, dormitorios, gimnasios y comercios. Cantos pulidos o biselados, taladros para apliques y la forma que necesites.","features":["Corte a medida y formas especiales","Canto pulido o biselado","Taladros para enchufes, apliques o tornillería","Espejos de baño, de cuerpo entero y paredes de espejo","Colocación con adhesivo o soportes ocultos"],"ideas":["Baño","Recibidor","Pared de gimnasio","Comercio"],"seoTitle":"Espejos a medida","seoDescription":"Espejos a medida en el Baix Vinalopó: baños, recibidores, paredes de espejo y gimnasios. Canto pulido o biselado y colocación profesional."},"cerramientos":{"name":"Cerramientos","short":"Cerramientos de terrazas y balcones","headline":"Cerramientos para disfrutar tu terraza todo el año","intro":"Convertimos terrazas, balcones y porches en espacios aprovechables durante todo el año. Cerramientos de cristal y aluminio que protegen del viento, la lluvia y el ruido sin renunciar a la luz.","features":["Terrazas, balcones, porches y áticos","Sistemas correderos y fijos","Cristal templado, laminado o con cámara (Climalit)","Mejor aislamiento térmico y acústico","Estudio previo de medidas en tu vivienda"],"ideas":["Terraza","Balcón","Porche","Ático"],"seoTitle":"Cerramientos de terrazas y balcones","seoDescription":"Cerramientos de cristal y aluminio para terrazas, balcones y porches en Crevillente, Elche y el Baix Vinalopó. Presupuesto orientativo online."},"aluminio":{"name":"Aluminio","short":"Carpintería de aluminio y ventanas","headline":"Carpintería de aluminio y ventanas que aíslan","intro":"Fabricamos ventanas, puertas y correderas de aluminio a medida, con el acristalamiento adecuado para cada caso: desde cristal simple hasta doble acristalamiento con cámara y cristal acústico.","features":["Ventanas abatibles, oscilobatientes y correderas","Puertas de aluminio y balconeras","Doble acristalamiento con cámara y cristal acústico","Variedad de colores y acabados","Sustitución de cristales en carpintería existente"],"ideas":["Ventanas","Correderas","Puertas","Balconeras"],"seoTitle":"Carpintería de aluminio y ventanas","seoDescription":"Ventanas, puertas y correderas de aluminio a medida en el Baix Vinalopó. Doble acristalamiento y cristal acústico. Calcula tu presupuesto orientativo."},"barandillas":{"name":"Barandillas","short":"Barandillas de vidrio y aluminio","headline":"Barandillas de vidrio: seguridad sin perder vistas","intro":"Instalamos barandillas de vidrio y aluminio para escaleras, balcones, terrazas y piscinas. El vidrio laminado de seguridad protege sin cortar la luz ni las vistas.","features":["Vidrio laminado de seguridad","Escaleras, balcones, terrazas y piscinas","Sistemas con perfil inferior, pinzas o pasamanos","Acabados en aluminio y acero","Interior y exterior"],"ideas":["Escalera","Balcón","Piscina","Terraza"],"seoTitle":"Barandillas de vidrio y aluminio","seoDescription":"Barandillas de vidrio laminado y aluminio para escaleras, balcones y piscinas en Crevillente y el Baix Vinalopó. Presupuesto orientativo online."},"armarios":{"name":"Armarios","short":"Puertas de armario en cristal","headline":"Puertas de armario en cristal y espejo","intro":"Renovamos tus armarios con puertas de cristal lacado, espejo o cristal decorativo, correderas o abatibles. Una forma sencilla de dar un aire nuevo al dormitorio o al vestidor.","features":["Puertas correderas y abatibles","Cristal lacado, espejo, ahumado o al ácido","Herrajes básicos o premium","Medidas a tu hueco","Vestidores y armarios empotrados"],"ideas":["Dormitorio","Vestidor","Empotrado","Recibidor"],"seoTitle":"Puertas de armario de cristal","seoDescription":"Puertas de armario en cristal lacado, espejo o ahumado, correderas o abatibles, a medida en el Baix Vinalopó."},"domino":{"name":"Dominó","short":"Paneles de vidrio decorativos y divisores","headline":"Paneles de vidrio decorativos y divisores","intro":"Separa ambientes sin perder luz con paneles y divisores de vidrio. Ideales para cocinas abiertas, despachos, duchas de obra o cualquier espacio que necesite privacidad sin muros.","features":["Divisores de ambientes y separadores","Cristal transparente, al ácido o decorativo","Con o sin perfilería","Combinables en módulos","Para vivienda, oficina y comercio"],"ideas":["Cocina abierta","Despacho","Oficina","Ducha de obra"],"seoTitle":"Paneles de vidrio decorativos y divisores","seoDescription":"Paneles y divisores de vidrio decorativo para separar ambientes con luz en Crevillente y el Baix Vinalopó."},"otros":{"name":"Otros trabajos","short":"Cristales sueltos y trabajos especiales","headline":"Cristales sueltos y trabajos especiales","intro":"Cortamos cristal a medida para cualquier uso: sobremesas, estanterías, vitrinas, cuadros, sustitución de cristales rotos y encargos especiales. Si es de vidrio, cuéntanos qué necesitas.","features":["Cristal a medida para sobremesas y estanterías","Sustitución de cristales rotos","Vitrinas y cuadros","Cantos, taladros y formas especiales","Encargos para comercios y profesionales"],"ideas":["Sobremesa","Estantería","Vitrina","Reposición"],"seoTitle":"Cristales a medida y trabajos especiales","seoDescription":"Cristales a medida, sobremesas, estanterías, vitrinas y sustitución de cristales rotos en el Baix Vinalopó."}}$json$::jsonb),
  ('faq', $json$[{"q":"¿Cuánto tiempo tarda un proyecto de principio a fin?","a":"Los plazos varían según el tipo y complejidad del proyecto. Generalmente, desde la toma de medidas hasta la instalación final pueden transcurrir entre 7 y 15 días laborables. En proyectos más complejos o a medida, el plazo puede extenderse.","tags":["plazo","tiempo","tarda","cuanto tarda","semanas","dias","pedido personalizado"]},{"q":"¿Qué tipos de cristal ofrecéis?","a":"Trabajamos con cristal float (básico), templado, laminado, Climalit (doble acristalamiento), acústico y decorativo. Cada tipo tiene características específicas de seguridad, aislamiento y resistencia. Te asesoraremos sobre la mejor opción para tu proyecto.","tags":["tipos","cristal","vidrio","float","climalit","acustico","ventanas","decorativo"]},{"q":"¿El cristal templado es más seguro?","a":"Sí, el cristal templado es hasta 5 veces más resistente que el cristal normal. Además, en caso de rotura, se fragmenta en pequeños trozos no cortantes, reduciendo significativamente el riesgo de lesiones. Es obligatorio en mamparas de baño y recomendable en muchas aplicaciones.","tags":["templado","seguro","seguridad","romper","resistente"]},{"q":"¿Ofrecéis garantía en vuestros trabajos?","a":"Sí, todos nuestros trabajos incluyen garantía. La duración varía según el tipo de instalación, pero generalmente ofrecemos 2 años en instalaciones y 5 años en defectos de fabricación. Los detalles específicos se especifican en cada presupuesto.","tags":["garantia","garantias"]},{"q":"¿Cómo se limpia y mantiene el cristal?","a":"Para el mantenimiento diario, recomendamos usar agua con jabón neutro y una bayeta suave. Evita productos abrasivos o estropajos. Para cristales especiales (antical, mate, decorado), te proporcionaremos instrucciones específicas tras la instalación.","tags":["limpiar","limpia","limpieza","mantener","mantenimiento","cal","antical"]},{"q":"¿Cuándo recibiré el presupuesto final?","a":"Tras la visita técnica, elaboramos un presupuesto detallado que recibirás en un plazo máximo de 48 horas. El presupuesto incluye todos los costes: materiales, fabricación, transporte e instalación, sin sorpresas.","tags":["presupuesto final","definitivo","cuando","sin compromiso","48"]},{"q":"¿Qué diferencia hay entre cristal laminado y templado?","a":"El cristal laminado tiene una lámina de PVB entre dos hojas de vidrio, lo que lo hace muy seguro (los fragmentos quedan adheridos). El templado es más resistente a impactos y cambios de temperatura. Según la aplicación, uno u otro es más adecuado.","tags":["laminado","diferencia","pvb"]},{"q":"¿Trabajáis fuera del Baix Vinalopó?","a":"Nuestra zona principal de actuación es el Baix Vinalopó, pero podemos valorar proyectos en zonas cercanas. Contacta con nosotros para consultar disponibilidad en tu ubicación. El desplazamiento para la visita técnica se calcula a razón de 10 € por cada 10 km desde Crevillente.","tags":["fuera","zona","elche","alicante","santa pola","provincia","murcia","torrevieja"]},{"q":"¿Qué formas de pago aceptáis?","a":"Aceptamos transferencia bancaria, efectivo y tarjeta. Habitualmente se solicita un anticipo del 40-50% al confirmar el pedido y el resto al finalizar la instalación. Las condiciones específicas se detallan en cada presupuesto.","tags":["pago","pagar","tarjeta","transferencia","efectivo","anticipo"]},{"q":"¿La visita técnica tiene coste?","a":"La visita técnica para toma de medidas y asesoramiento es gratuita dentro de Crevillente. Fuera de Crevillente cobramos el desplazamiento a razón de 10 € por cada 10 km (o fracción) desde nuestras instalaciones; puedes calcularlo al momento en la calculadora de presupuestos. Sin compromiso: solo si decides contratar procedemos con la fabricación e instalación.","tags":["visita","tecnica","coste","gratis","gratuita","medidas","desplazamiento"]}]$json$::jsonb),
  ('imagenes', '{}'::jsonb)
on conflict (clave) do nothing;
