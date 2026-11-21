-- ============================================================================
--  Panel de Cristalería BV · módulo Facturas (21/11/2026)
-- ----------------------------------------------------------------------------
--  Facturas de proveedor con lectura automática (OCR con IA), sacado del panel
--  de referencia de OficiosOsIA. Va ENCIMA del núcleo
--  (20261118120000_nucleo_panel.sql): usa sus permisos por sección
--  (can_read_section / can_write_section / has_section_permission), su
--  auditoría (el disparador de eventos audit_panel_nuevas_tablas pone el
--  trigger de auditoría en cada tabla nueva), sus avisos
--  (notificaciones_dashboard), url_funcion_edge() y los secretos de Vault
--  «project_url» y «ocr_trabajos_secret».
--
--  Qué trae:
--    · facturas y sus líneas (productos_factura), con alertas de cuadre y
--      verificación automática;
--    · proveedores unificados (proveedores + proveedores_alias: nombres y CIF
--      con los que llega cada uno);
--    · catálogo de productos (productos_catalogo + productos_alias),
--      categorías (categorias_producto, semilla de cristalería) y la
--      clasificación con IA (clasificar-productos, cron cada 5 min);
--    · avisos de subida de precio por producto (avisos_subida_precio, campana);
--    · el OCR por trabajos (ocr_trabajos + ocr_trabajo_paginas): el panel sube
--      las piezas a Storage, Postgres las despacha a la Edge Function
--      ocr-trabajo (pg_net) y el cron «reanudar-trabajos-ocr» rescata lo que
--      se quede a medias; duplicados con «Sustituir» o «Añadir como página»
--      (facturas_sustituciones guarda la copia de antes);
--    · el bucket privado «facturas-originales» (originales y piezas del OCR).
--
--  Permisos: sección «facturas» («Ver» consulta, «Editar» todo: las escrituras
--  piden can_edit_section, no basta «Ver») y el interruptor «facturas_subida»
--  (subir y corregir SOLO lo que sube uno). Cada tabla lleva además la política
--  restrictiva acceso_panel_no_bloqueado.
--
--  Fuera (no son de una cristalería o no se han pedido): notas de entrega y su
--  cotejo, varios locales, copias en Google Drive, chat sobre las compras,
--  embeddings, contenido por envase, abreviaturas de marcas e importación
--  histórica.
--
--  Vuelta atrás: supabase/rollbacks/20261121100000_facturas_ROLLBACK.sql.
-- ============================================================================

create extension if not exists unaccent with schema extensions;

set check_function_bodies = off;

-- ─── Normalización de textos (columnas generadas y búsquedas) ───────────────
create or replace function public.normalizar_texto(p_texto text)
returns text language sql immutable strict set search_path = public, extensions
as $$
  select regexp_replace(btrim(lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_texto))), '\s+', ' ', 'g')
$$;
comment on function public.normalizar_texto(text) is
  'Minúsculas, sin tildes y con los espacios colapsados. Base del nombre normalizado de productos y categorías.';

-- Texto de una línea para reconocerla (productos_alias). Sin recortes: en
-- cristalería «extra claro», «templado» o «8 mm» distinguen productos.
create or replace function public.normalizar_nombre_producto(p_nombre text)
returns text language sql immutable strict set search_path = public, extensions
as $$ select public.normalizar_texto(p_nombre) $$;

create or replace function public.texto_busqueda_compras(p_texto text)
returns text language sql immutable parallel safe set search_path = public, extensions
as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_texto, ''))), '\s+', ' ', 'g'))
$$;

create or replace function public.normalizar_cif(p_cif text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select case when t.s ~ '^ES[0-9A-Z]{9}$' then substr(t.s, 3) else nullif(t.s, '') end
    from (select upper(regexp_replace(coalesce(p_cif, ''), '[^0-9A-Za-z]', '', 'g')) as s) t
$$;

create or replace function public.normalizar_proveedor_base(p_proveedor text)
returns text language plpgsql immutable strict set search_path = public, extensions
as $$
declare
  v_texto text;
begin
  -- trim + minúsculas + sin tildes
  v_texto := btrim(lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_proveedor)));
  -- 1) Fuera los nombres comerciales entre paréntesis.
  v_texto := regexp_replace(v_texto, '\s*\([^)]*\)', '', 'g');
  -- 2) Fuera la forma jurídica al FINAL (de la más larga a la más corta).
  v_texto := regexp_replace(v_texto,
    '[,\s]+(sociedad\s+limitada\s+unipersonal|sociedad\s+anonima\s+unipersonal|sociedad\s+cooperativa|sociedad\s+limitada|sociedad\s+anonima|s\.l\.u\.|s\.a\.u\.|s\.l\.|s\.a\.|s\.c\.p\.|s\.c\.l\.|s\.c\.|s\.coop\.?|slu|sau|sl|sa|cb|sc)\s*$',
    '', 'gi');
  -- 3) Comas, puntos y espacios sobrantes al final; 4) espacios colapsados.
  v_texto := regexp_replace(v_texto, '[,.\s]+$', '');
  return regexp_replace(btrim(v_texto), '\s+', ' ', 'g');
end;
$$;

-- «PERFILES DEL VINALOPÓ, S.L.» = «Perfiles del Vinalopó SL» = «Vinalopó Perfiles» (palabras ordenadas,
-- sin forma jurídica, puntos ni tildes). normalizar_proveedor_base no se toca: sus valores van en columnas.
create or replace function public.proveedor_clave(p_nombre text)
returns text language sql immutable parallel safe set search_path = public, extensions
as $$
  select nullif(array_to_string(array(
           select distinct w
             from regexp_split_to_table(
                    regexp_replace(
                      replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                        regexp_replace(coalesce(p_nombre, ''), '\([^)]*\)', ' ', 'g'))), '.', ''),
                      '[^a-z0-9]+', ' ', 'g'),
                    ' ') as w
            where length(w) >= 2
              and w not in ('sl', 'slu', 'sa', 'sau', 'srl', 'sll', 'scoop', 'coop', 'vl', 'cb', 'sc', 'scl', 'scp',
                            'sociedad', 'limitada', 'anonima', 'unipersonal', 'cooperativa', 'valenciana',
                            'de', 'del', 'la', 'las', 'los', 'el', 'en')
            order by w), ' '), '')
$$;

-- Unidad de una línea tal como se guarda: «uds.», «Kgs», «M2», «m²», «ML»… → ud, kg, l, m2, ml.
create or replace function public.normalizar_unidad_factura(u text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select case
           when t.s = '' then 'ud'
           when t.s ~ '^(u|un|ud|uds|und|unds|uni|unid|unids|unidad|unidades|pza|pzas|pieza|piezas)$' then 'ud'
           when t.s ~ '^(kg|kgs|kgr|kgrs|kilo|kilos|kilogramo|kilogramos)$' then 'kg'
           when t.s ~ '^(l|lt|lts|ltr|ltrs|litro|litros)$' then 'l'
           when t.s ~ '^(m2|m²|mt2|mts2|metro2|metros2|metrocuadrado|metroscuadrados)$' then 'm2'
           when t.s ~ '^(ml|mtl|mlin|metrolineal|metroslineales)$' then 'ml'
           else t.o
         end
    from (
      select a.o,
             regexp_replace(
               translate(a.o, 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                              'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
               '[.[:space:]]', '', 'g') as s
        from (select lower(regexp_replace(translate(coalesce(u, ''), chr(160), ' '),
                                          '^[[:space:]]+|[[:space:]]+$', '', 'g')) as o) a
    ) t
$$;

-- Unidad comparable para los precios (kg, ud, caja, l, m, m2, ml): la de los avisos de subida.
create or replace function public.unidad_comparable(p text)
returns text language sql immutable set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    when lower(btrim(p)) ~ '^(kg|kgs|kilo|kilos|kilogramos?)$' then 'kg'
    when lower(btrim(p)) ~ '^(ud|uds|u|un|und|unid|unidad|unidades|pieza|piezas)$' then 'ud'
    when lower(btrim(p)) ~ '^(ca|caj|cj|caja|cajas)$' then 'caja'
    when lower(btrim(p)) ~ '^(l|lt|lts|litro|litros)$' then 'l'
    when lower(btrim(p)) ~ '^(m|metro|metros)$' then 'm'
    when lower(btrim(p)) ~ '^(m2|m²|metros? cuadrados?)$' then 'm2'
    when lower(btrim(p)) ~ '^(ml|metros? lineales?)$' then 'ml'
    else lower(btrim(p)) end
$$;

-- Portes, envíos, recargos, fianzas… : cargos sin producto (no cuentan como precio atípico).
create or replace function public.es_servicio_compras(p_normalizado text)
returns boolean language sql immutable parallel safe set search_path = public
as $$
  select coalesce(p_normalizado, '') ~
    '\y(portes?|transportes?|envios?|gastos? de (envio|gestion|transporte)|gestion y logistica|logistica|punto verde|ecoembes|canon|recargos?|fianzas?|depositos?)\y'
$$;

-- Precio en formato español («12,50»).
create or replace function public.precio_es(p numeric, p_decimales integer default 2)
returns text language sql immutable set search_path = public
as $$
  select replace(case when p_decimales = 1 then trim_scale(round(p, 1))::text
                      else to_char(round(p, p_decimales), 'FM999999990.' || repeat('0', p_decimales)) end, '.', ',')
$$;

-- ─── Tablas ─────────────────────────────────────────────────────────────────
create table if not exists public.configuracion_facturas (
  id                       boolean primary key default true check (id),
  umbral_subida_precio_pct numeric(6,2) not null default 10 check (umbral_subida_precio_pct > 0 and umbral_subida_precio_pct <= 500),
  avisos_subida_precio     boolean not null default true,
  cif_empresa              text check (cif_empresa is null or length(cif_empresa) <= 20),
  updated_at               timestamptz not null default now(),
  updated_by               uuid
);
comment on table public.configuracion_facturas is
  'Configuración de Facturas (una sola fila, id = true). umbral_subida_precio_pct: aviso en la campana si un producto '
  'llega más de ese % por encima de su precio de referencia. cif_empresa: el CIF de Cristalería BV, que en las facturas '
  'es el del CLIENTE y nunca puede tomarse por el de un proveedor.';
insert into public.configuracion_facturas (id) values (true) on conflict (id) do nothing;

create table if not exists public.proveedores (
  id                 bigint generated by default as identity primary key,
  nombre             varchar(255) not null unique,
  cif                varchar(50) unique,
  direccion          text,
  telefono           varchar(50),
  email              varchar(255),
  categoria          varchar(100),
  notas              text,
  activo             boolean default true,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  nombre_comercial   text,
  origen             text default 'manual' check (origen is null or origen in ('automatico', 'manual')),
  cif_normalizado    text generated always as (public.normalizar_cif(cif)) stored,
  nombre_normalizado text generated always as (public.normalizar_proveedor_base(nombre)) stored,
  notas_ia           text,
  constraint proveedores_nombre_util check (coalesce(public.normalizar_proveedor_base(nombre), '') <> ''
    and (nombre_comercial is null or length(btrim(nombre_comercial)) between 1 and 120)),
  constraint proveedores_notas_ia_largo check (notas_ia is null or length(notas_ia) <= 500)
);
comment on table public.proveedores is 'Proveedores de Cristalería BV. Los crea solo el OCR (origen automatico) o una persona (manual).';
comment on column public.proveedores.notas_ia is
  'Indicaciones para la IA al leer las facturas de este proveedor (máx. 500): se añaden al prompt de extracción.';
create index if not exists idx_proveedores_nombre on public.proveedores (nombre);
create unique index if not exists uq_proveedores_cif_normalizado on public.proveedores (cif_normalizado) where cif_normalizado is not null;

create table if not exists public.proveedores_alias (
  id                bigint generated always as identity primary key,
  proveedor_id      bigint not null references public.proveedores(id) on delete cascade,
  alias_normalizado text unique check (alias_normalizado is null or alias_normalizado <> ''),
  cif_normalizado   text unique check (cif_normalizado is null or cif_normalizado <> ''),
  texto_original    text,
  origen            text not null default 'manual' check (origen in ('automatico', 'nombre', 'manual', 'fusion')),
  created_at        timestamptz not null default now(),
  constraint proveedores_alias_uno check (num_nonnulls(alias_normalizado, cif_normalizado) = 1)
);
comment on table public.proveedores_alias is
  'Formas de un proveedor: nombre normalizado (normalizar_proveedor_base del texto del documento) o CIF extra → proveedor. '
  'El trigger de facturas las usa para asignar proveedor_id.';
create index if not exists idx_proveedores_alias_proveedor on public.proveedores_alias (proveedor_id);

create table if not exists public.categorias_producto (
  id          bigint generated always as identity primary key,
  clave       text unique check (clave is null or clave ~ '^[a-z0-9_]+(\.[a-z0-9_]+)?$'),
  nombre      text not null check (length(btrim(nombre)) between 1 and 80),
  descripcion text check (descripcion is null or length(descripcion) <= 300),
  padre_id    bigint references public.categorias_producto(id) on delete restrict,
  orden       integer not null default 0,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categorias_producto_no_es_su_padre check (padre_id is null or padre_id <> id)
);
comment on table public.categorias_producto is
  'Categorías de lo que se compra: categoría › subcategoría opcional (dos niveles). clave estable para las de la semilla '
  '(vidrio.templado…); las creadas en el panel van sin clave. No se borran: activa = false.';
create index if not exists idx_categorias_producto_padre on public.categorias_producto (padre_id);
create unique index if not exists uq_categorias_producto_nombre on public.categorias_producto (coalesce(padre_id, 0), lower(btrim(nombre)));

create table if not exists public.productos_catalogo (
  id                 bigint generated always as identity primary key,
  nombre             text not null check (length(btrim(nombre)) between 1 and 200),
  nombre_normalizado text generated always as (public.normalizar_texto(nombre)) stored,
  categoria_id       bigint references public.categorias_producto(id) on delete set null,
  unidad_habitual    text check (unidad_habitual is null or length(unidad_habitual) <= 20),
  origen             text not null default 'manual' check (origen in ('ia', 'manual')),
  creado_por         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.productos_catalogo is
  'Producto canónico de compra: varias líneas de factura con distinto texto (erratas del OCR, formatos) apuntan al mismo. '
  'origen ia = lo propuso la IA y nadie lo ha tocado; manual = creado o corregido por una persona.';
create unique index if not exists uq_productos_catalogo_nombre_normalizado on public.productos_catalogo (nombre_normalizado);
create index if not exists idx_productos_catalogo_categoria on public.productos_catalogo (categoria_id);

create table if not exists public.productos_alias (
  texto_normalizado text primary key check (length(texto_normalizado) between 1 and 500),
  producto_id       bigint not null references public.productos_catalogo(id) on delete cascade,
  origen            text not null default 'manual' check (origen in ('ia', 'manual')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.productos_alias is
  'Texto de línea normalizado (= productos_factura.nombre_normalizado) → producto del catálogo. Una línea nueva con ese '
  'texto se asigna sola (trigger trg_productos_factura_asignar_producto).';
create index if not exists idx_productos_alias_producto on public.productos_alias (producto_id);

create table if not exists public.ocr_trabajos (
  id                       uuid primary key,
  creado_por               uuid not null references auth.users(id),
  estado                   text not null default 'pendiente'
                           check (estado in ('pendiente', 'pagina1', 'paginas', 'consolidando', 'completado', 'duplicado', 'fallido', 'cancelado')),
  num_paginas              smallint not null check (num_paginas between 1 and 40),
  paginas_documento        smallint not null default 1 check (paginas_documento between 1 and 20),
  origen                   text not null check (origen in ('pdf', 'imagen', 'fotos', 'sincrono')),
  nombre_original          text not null,
  original_path            text,
  original_mime            text,
  contexto_p1              jsonb,
  modelo                   text,
  ronda_relectura          smallint not null default 0 check (ronda_relectura between 0 and 1),
  intentos_consolidacion   smallint not null default 0,
  lease_hasta              timestamptz,
  consolidar_despachado_at timestamptz,
  resultado                jsonb,
  documento_pendiente      jsonb,
  factura_id               bigint,
  error                    text,
  coste_usd                numeric(10,5) not null default 0,
  llamadas                 integer not null default 0 check (llamadas >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  terminado_at             timestamptz,
  limite_at                timestamptz not null default (now() + interval '15 minutes')
);
comment on table public.ocr_trabajos is
  'Lectura en segundo plano de cada documento subido (todas sus piezas) y documentos duplicados pendientes de decidir. '
  'Escribe solo el service role (procesar-factura, ocr-trabajo y las RPC ocr_*).';
create index if not exists ocr_trabajos_activos_idx on public.ocr_trabajos (estado, updated_at)
  where estado in ('pendiente', 'pagina1', 'paginas', 'consolidando');
create index if not exists ocr_trabajos_creador_idx on public.ocr_trabajos (creado_por, created_at desc);

create table if not exists public.facturas (
  id                    bigint generated by default as identity primary key,
  proveedor             varchar(255),
  cif                   varchar(50),
  numero_documento      varchar(100) not null,
  fecha                 date not null,
  subtotal              numeric(12,2),
  iva                   numeric(12,2),
  total                 numeric(12,2),
  observaciones         text,
  procesado_en          timestamptz default now(),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  proveedor_normalizado text,
  verificada            boolean default false,
  verificacion_origen   text check (verificacion_origen is null or verificacion_origen in ('auto', 'manual')),
  archivo_path          text,
  alertas_validacion    jsonb,
  total_origen          text check (total_origen is null or total_origen in ('leido', 'deducido')),
  paginas               smallint not null default 1 check (paginas between 1 and 20),
  ocr_trabajo_id        uuid unique references public.ocr_trabajos(id) on delete set null,
  proveedor_id          bigint references public.proveedores(id) on delete set null,
  coste_lectura_usd     numeric(10,6) check (coste_lectura_usd is null or coste_lectura_usd >= 0),
  lectura_llamadas      integer check (lectura_llamadas is null or lectura_llamadas >= 0),
  lectura_modelo        text,
  retencion_irpf        numeric(12,2) check (retencion_irpf is null or retencion_irpf <> 0),
  retencion_irpf_pct    numeric(5,2) check (retencion_irpf_pct is null or (retencion_irpf_pct > 0 and retencion_irpf_pct <= 50)),
  subido_por            uuid default auth.uid() references auth.users(id) on delete set null,
  constraint unique_documento unique (numero_documento, proveedor),
  constraint facturas_total_deducido_exige_total check (total_origen is distinct from 'deducido' or total is not null),
  constraint facturas_verificacion_origen_coherente check (
    (coalesce(verificada, false) and verificacion_origen is not null) or (not coalesce(verificada, false) and verificacion_origen is null))
);
comment on table public.facturas is
  'Facturas de proveedor (y abonos, con total negativo). Las crea el OCR (procesar-factura / ocr-trabajo); se corrigen en '
  'el panel. archivo_path = el original en el bucket facturas-originales.';
comment on column public.facturas.total_origen is 'leido = el total impreso; deducido = suma de las líneas (el pie no se leyó).';
comment on column public.facturas.subido_por is 'Quién subió el documento (lo rellena el trigger desde ocr_trabajos.creado_por).';
create index if not exists idx_facturas_fecha on public.facturas (fecha desc);
create index if not exists idx_facturas_procesado on public.facturas (procesado_en desc);
create index if not exists idx_facturas_proveedor on public.facturas (proveedor);
create index if not exists idx_facturas_proveedor_id on public.facturas (proveedor_id);
create index if not exists idx_facturas_proveedor_normalizado on public.facturas (proveedor_normalizado);
create index if not exists idx_facturas_subido_por on public.facturas (subido_por) where subido_por is not null;
create index if not exists idx_facturas_alertas_pendientes on public.facturas (fecha desc)
  where alertas_validacion is not null and jsonb_array_length(alertas_validacion) > 0;
alter table public.ocr_trabajos drop constraint if exists ocr_trabajos_factura_id_fkey;
alter table public.ocr_trabajos add constraint ocr_trabajos_factura_id_fkey
  foreign key (factura_id) references public.facturas(id) on delete set null;

create table if not exists public.productos_factura (
  id                     bigint generated by default as identity primary key,
  factura_id             bigint not null references public.facturas(id) on delete cascade,
  nombre                 varchar(500) not null,
  cantidad               numeric(10,3) not null default 1,
  unidad                 varchar(50) default 'ud',
  precio_unitario        numeric(10,2),
  total                  numeric(12,2),
  created_at             timestamptz default now(),
  nombre_normalizado     text generated always as (public.normalizar_nombre_producto(nombre::text)) stored,
  pagina                 smallint check (pagina between 1 and 20),
  orden                  integer check (orden >= 0),
  bultos                 numeric,
  iva_pct                numeric check (iva_pct is null or (iva_pct >= 0 and iva_pct <= 30)),
  producto_id            bigint references public.productos_catalogo(id) on delete set null,
  descuento_pct          numeric,
  importe_bruto          numeric,
  importe_bruto_estimado boolean not null default false,
  nombre_busqueda        text generated always as (public.texto_busqueda_compras(nombre::text)) stored
);
comment on table public.productos_factura is 'Líneas de cada factura (lo leído por el OCR o corregido en el panel).';
create index if not exists idx_productos_factura_id on public.productos_factura (factura_id);
create index if not exists productos_factura_factura_orden_idx on public.productos_factura (factura_id, orden);
create index if not exists idx_productos_factura_producto on public.productos_factura (producto_id);
create index if not exists idx_productos_factura_sin_producto on public.productos_factura (created_at) where producto_id is null;
create index if not exists idx_productos_factura_nombre_normalizado on public.productos_factura (nombre_normalizado);

create table if not exists public.ocr_trabajo_paginas (
  id                bigint generated by default as identity primary key,
  trabajo_id        uuid not null references public.ocr_trabajos(id) on delete cascade,
  numero            smallint not null check (numero between 1 and 40),
  pieza             text not null default 'pagina' check (pieza in ('pagina', 'franja')),
  pagina_doc        smallint not null default 1 check (pagina_doc between 1 and 20),
  franja            smallint check (franja between 1 and 40),
  franjas_pagina    smallint check (franjas_pagina between 1 and 40),
  storage_path      text not null,
  mime              text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  bytes             integer not null check (bytes between 1 and 10485760),
  estado            text not null default 'pendiente' check (estado in ('pendiente', 'procesando', 'completada', 'fallida')),
  intentos          smallint not null default 0,
  relecturas        smallint not null default 0 check (relecturas between 0 and 1),
  motivo_relectura  jsonb,
  no_antes_de       timestamptz not null default now(),
  despachada_at     timestamptz,
  lease_hasta       timestamptz,
  resultado         jsonb,
  recuento          jsonb,
  verificacion_pie  jsonb,
  motivos           jsonb,
  filas_extraidas   smallint,
  filas_contadas    smallint,
  duracion_ms       integer,
  tokens_entrada    integer,
  tokens_salida     integer,
  coste_usd         numeric(10,5),
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ocr_paginas_unica unique (trabajo_id, numero)
);
comment on table public.ocr_trabajo_paginas is
  'Cada pieza (página de un PDF o franja de una foto alta) de un trabajo de OCR, con su lectura. Escribe solo el service role.';
create index if not exists ocr_paginas_trabajo_estado_idx on public.ocr_trabajo_paginas (trabajo_id, estado);

create table if not exists public.facturas_sustituciones (
  id              bigint generated always as identity primary key,
  factura_id      bigint not null,
  trabajo_id      uuid references public.ocr_trabajos(id) on delete set null,
  sustituida_por  uuid references auth.users(id),
  sustituida_at   timestamptz not null default now(),
  factura_antes   jsonb not null,
  productos_antes jsonb not null,
  resumen_antes   jsonb not null,
  resumen_despues jsonb
);
comment on table public.facturas_sustituciones is
  'Copia de seguridad de cada sustitución en sitio de una factura (ocr_sustituir_factura) o página añadida (ocr_anadir_pagina). '
  'Solo lectura para el panel.';
create index if not exists facturas_sustituciones_factura_idx on public.facturas_sustituciones (factura_id);

create table if not exists public.avisos_subida_precio (
  factura_id       bigint not null references public.facturas(id) on delete cascade,
  producto_id      bigint not null references public.productos_catalogo(id) on delete cascade,
  unidad           text not null,
  precio           numeric not null,
  precio_ref       numeric not null,
  variacion_pct    numeric not null,
  proveedor        text,
  proveedor_ref    text,
  cambio_proveedor boolean not null default false,
  notificacion_id  uuid references public.notificaciones_dashboard(id) on delete set null,
  revisado_en      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  primary key (factura_id, producto_id, unidad)
);
comment on table public.avisos_subida_precio is
  'Subidas de precio ya avisadas en la campana (documento, producto, unidad, precio). Si el documento se sustituye con el '
  'mismo precio no se repite el aviso. La escribe solo el trigger de productos_factura.';
create index if not exists idx_avisos_subida_precio_producto on public.avisos_subida_precio (producto_id);
create index if not exists idx_avisos_subida_precio_notificacion on public.avisos_subida_precio (notificacion_id);

-- ─── Funciones (proveedores, catálogo, OCR, validación) ─────────────────────
create or replace function public.cif_distancia(a text, b text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $$
-- «B06805246» frente a «B08605246»
-- (dos cifras traspuestas) = 2. Solo para textos cortos (CIF).
declare
  la   int := length(a);
  lb   int := length(b);
  prev int[];
  cur  int[];
  i    int;
  j    int;
begin
  if a is null or b is null then
    return null;
  end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1,
                          prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end;
$$;

create or replace function public.cif_control_valido(p_cif text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $$
-- CIF (letra + 7 cifras + control),
-- NIF (8 cifras + letra) y NIE (X/Y/Z + 7 cifras + letra). Misma regla que
-- cifControlValido (procesar-factura/calidad.ts).
declare
  c      text := public.normalizar_cif(p_cif);
  letras constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  s      int := 0;
  d      int;
  i      int;
  ctl    int;
begin
  if c is null then
    return false;
  end if;
  if c ~ '^[0-9]{8}[A-Z]$' then
    return substr(letras, (substr(c, 1, 8)::bigint % 23)::int + 1, 1) = substr(c, 9, 1);
  end if;
  if c ~ '^[XYZ][0-9]{7}[A-Z]$' then
    return substr(letras, (((strpos('XYZ', substr(c, 1, 1)) - 1)::text || substr(c, 2, 7))::bigint % 23)::int + 1, 1)
           = substr(c, 9, 1);
  end if;
  if c !~ '^[ABCDEFGHJKLMNPQRSUVW][0-9]{7}[0-9A-J]$' then
    return false;
  end if;
  for i in 1..7 loop
    d := substr(c, i + 1, 1)::int;
    if i % 2 = 0 then
      s := s + d;
    else
      d := d * 2;
      s := s + d / 10 + d % 10;
    end if;
  end loop;
  ctl := (10 - s % 10) % 10;
  if substr(c, 1, 1) in ('P', 'Q', 'R', 'S', 'N', 'W', 'K', 'L', 'M') then
    return substr(c, 9, 1) = substr('JABCDEFGHI', ctl + 1, 1);
  elsif substr(c, 1, 1) in ('A', 'B', 'E', 'H') then
    return substr(c, 9, 1) = ctl::text;
  end if;
  return substr(c, 9, 1) in (ctl::text, substr('JABCDEFGHI', ctl + 1, 1));
end;
$$;

create or replace function public.normalizar_proveedor(p_proveedor text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $$
declare
  v_base      text := public.normalizar_proveedor_base(p_proveedor);
  v_canonico  text;
begin
  -- Sin permiso de lectura sobre las tablas (anon), lo de siempre en vez de un error.
  if has_table_privilege('public.proveedores_alias', 'select')
     and has_table_privilege('public.proveedores', 'select') then
    select p.nombre_normalizado into v_canonico
      from public.proveedores_alias a
      join public.proveedores p on p.id = a.proveedor_id
     where a.alias_normalizado = v_base;
  end if;
  return coalesce(v_canonico, v_base);
end;
$$;

create or replace function public.facturas_puede_subir_usuario(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  -- Super admin: has_section_permission ya da true.
  select _user_id is not null and (
       coalesce(public.has_section_permission(_user_id, 'facturas', 'edit'), false)
    or coalesce(public.has_section_permission(_user_id, 'facturas_subida', 'view'), false)
    or coalesce(public.has_section_permission(_user_id, 'facturas_subida', 'edit'), false))
$$;

create or replace function public.facturas_puede_subir()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select public.facturas_puede_subir_usuario((select auth.uid()))
$$;

create or replace function public.factura_subida_por_mi(p_factura_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.facturas f where f.id = p_factura_id and f.subido_por = (select auth.uid()))
$$;

create or replace function public.productos_puede_editar()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((select auth.role()) = 'service_role', false)
      or coalesce(public.can_edit_section('facturas'), false)
$$;

create or replace function public.proveedores_puede_editar()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select coalesce((select auth.role()) = 'service_role', false)
      or coalesce(public.can_edit_section('facturas'), false)
$$;

create or replace function public.proveedores_mantener_alias()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_alias text;
  v_otro  bigint;
begin
  foreach v_alias in array array[new.nombre_normalizado,
                                 public.normalizar_proveedor_base(nullif(btrim(coalesce(new.nombre_comercial, '')), ''))] loop
    continue when coalesce(v_alias, '') = '';
    select proveedor_id into v_otro from public.proveedores_alias where alias_normalizado = v_alias;
    if v_otro is null then
      insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
      values (new.id, v_alias, case when v_alias = new.nombre_normalizado then new.nombre else new.nombre_comercial end, 'nombre');
    elsif v_otro <> new.id then
      raise exception '«%» ya es otro proveedor (id %): fusiónalos en vez de repetir el nombre', v_alias, v_otro
        using errcode = '23505';
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.nombre_normalizado is distinct from old.nombre_normalizado then
    update public.facturas set proveedor_normalizado = new.nombre_normalizado where proveedor_id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public.facturas_asignar_proveedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_resolver boolean;
begin
  if tg_op = 'INSERT' then
    v_resolver := new.proveedor_id is null;
  else
    -- Un cambio explícito de proveedor_id (fusión, panel, ON DELETE SET NULL) se respeta.
    v_resolver := new.proveedor_id is not distinct from old.proveedor_id
                  and (old.proveedor_id is null
                       or new.proveedor is distinct from old.proveedor
                       or new.cif is distinct from old.cif);
  end if;
  if v_resolver then
    new.proveedor_id := public.proveedor_resolver(new.proveedor, new.cif, true);
  end if;
  new.proveedor_normalizado := coalesce(
    (select p.nombre_normalizado from public.proveedores p where p.id = new.proveedor_id),
    public.normalizar_proveedor_base(new.proveedor));
  return new;
end;
$$;

create or replace function public.proveedores_fusionar(p_origen_ids bigint[], p_destino_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_dest     public.proveedores%rowtype;
  v_origen   bigint[];
  v_cifs     text[];
  v_com      text;
  v_cif      text;
  v_docs     integer;
  v_alias    integer;
  v_borrados integer;
  r          record;
begin
  if not public.proveedores_puede_editar() then
    raise exception 'Fusionar proveedores exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select * into v_dest from public.proveedores where id = p_destino_id for update;
  if not found then
    raise exception 'No existe el proveedor %', p_destino_id using errcode = 'P0002';
  end if;
  v_origen := array(select distinct x from unnest(coalesce(p_origen_ids, '{}')) as x
                     where x is not null and x <> p_destino_id order by x);
  if cardinality(v_origen) = 0 then
    raise exception 'Elige al menos otro proveedor que fusionar con «%»', v_dest.nombre using errcode = '22023';
  end if;
  perform 1 from public.proveedores where id = any(v_origen) order by id for update;
  if (select count(*) from public.proveedores where id = any(v_origen)) <> cardinality(v_origen) then
    raise exception 'Alguno de los proveedores que se iban a fusionar ya no existe. Recarga y vuelve a intentarlo.' using errcode = 'P0002';
  end if;

  select array_agg(cif_normalizado order by array_position(p_origen_ids, id)) filter (where cif_normalizado is not null),
         (array_agg(nombre_comercial order by array_position(p_origen_ids, id)) filter (where nombre_comercial is not null))[1]
    into v_cifs, v_com
    from public.proveedores where id = any(v_origen);

  -- Documentos (el trigger les pone el nombre canónico del que queda).
  update public.facturas set proveedor_id = p_destino_id where proveedor_id = any(v_origen);
  get diagnostics v_docs = row_count;
  -- Alias (incluidos los nombres de los que se van: siguen reconociéndose).
  update public.proveedores_alias set proveedor_id = p_destino_id, origen = 'fusion' where proveedor_id = any(v_origen);
  get diagnostics v_alias = row_count;
  -- Cualquier otra tabla que apunte a proveedores (p. ej. el catálogo antiguo).
  for r in select c.conrelid::regclass as tabla, a.attname as columna
             from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.proveedores'::regclass
              and cardinality(c.conkey) = 1
              and c.conrelid not in ('public.facturas'::regclass, 'public.proveedores_alias'::regclass) loop
    execute format('update %s set %I = $1 where %I = any($2)', r.tabla, r.columna, r.columna) using p_destino_id, v_origen;
  end loop;
  delete from public.proveedores where id = any(v_origen);
  get diagnostics v_borrados = row_count;

  -- El CIF de los que se van: si el que queda no tenía, hereda el primero; los demás, CIF extra.
  foreach v_cif in array coalesce(v_cifs, '{}') loop
    if v_dest.cif_normalizado is null then
      update public.proveedores set cif = v_cif where id = p_destino_id;
      v_dest.cif_normalizado := v_cif;
    elsif v_cif <> v_dest.cif_normalizado then
      insert into public.proveedores_alias (proveedor_id, cif_normalizado, origen)
      values (p_destino_id, v_cif, 'fusion')
      on conflict do nothing;
    end if;
  end loop;
  if v_dest.nombre_comercial is null and v_com is not null then
    update public.proveedores set nombre_comercial = v_com where id = p_destino_id;
  end if;
  update public.proveedores set origen = 'manual' where id = p_destino_id;

  return jsonb_build_object('proveedor_id', p_destino_id, 'documentos_movidos', v_docs,
                            'alias_movidos', v_alias, 'proveedores_borrados', v_borrados);
end;
$$;

create or replace function public.proveedores_notas_ia_guardar(p_id bigint, p_notas text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_notas text := nullif(btrim(regexp_replace(coalesce(p_notas, ''), '\s+', ' ', 'g')), '');
begin
  if not public.proveedores_puede_editar() then
    raise exception 'Cambiar proveedores exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'Las indicaciones no pueden pasar de 500 caracteres' using errcode = '22023';
  end if;
  update public.proveedores set notas_ia = v_notas where id = p_id;
  if not found then
    raise exception 'No existe el proveedor %', p_id using errcode = 'P0002';
  end if;
  return v_notas;
end;
$$;

create or replace function public.facturas_rellenar_subido_por()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  if new.subido_por is null and new.ocr_trabajo_id is not null then
    select t.creado_por into new.subido_por from public.ocr_trabajos t where t.id = new.ocr_trabajo_id;
  end if;
  return new;
end;
$$;

create or replace function public.facturas_origen_verificacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
declare
  v_old_ver boolean := case when tg_op = 'UPDATE' then coalesce(old.verificada, false) else false end;
  v_old_ori text    := case when tg_op = 'UPDATE' then old.verificacion_origen else null end;
begin
  if not coalesce(new.verificada, false) then
    new.verificacion_origen := null;
  elsif not v_old_ver and new.verificacion_origen is not distinct from v_old_ori then
    new.verificacion_origen := 'manual';
  elsif new.verificacion_origen is null then
    new.verificacion_origen := coalesce(v_old_ori, 'manual');
  end if;
  return new;
end;
$$;

create or replace function public.facturas_subida_solo_lo_leido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
declare
  c_cabecera constant text[] := array['proveedor', 'cif', 'numero_documento', 'fecha', 'subtotal', 'iva', 'total',
                                       'total_origen', 'observaciones', 'retencion_irpf', 'retencion_irpf_pct', 'updated_at'];
  c_lineas constant text[] := array['nombre', 'cantidad', 'unidad', 'precio_unitario', 'total', 'bultos', 'iva_pct',
                                     'descuento_pct'];
  v_libres text[];
  v_generadas text[];
begin
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if coalesce(public.can_edit_section('facturas'), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Añadir una línea a un documento propio (la RLS ya mira que sea suyo):
    -- sin clasificarla, eso es de «Editar» (el producto lo asigna el trigger).
    if tg_table_name = 'productos_factura' and (to_jsonb(new) ->> 'producto_id') is not null then
      raise exception 'Clasificar una línea exige «Editar» en Facturas.' using errcode = '42501';
    end if;
    return new;
  end if;

  v_libres := case when tg_table_name = 'facturas' then c_cabecera else c_lineas end;
  -- Las columnas generadas no se comparan: en un BEFORE aún no están calculadas.
  select coalesce(array_agg(a.attname::text), '{}') into v_generadas
    from pg_attribute a
   where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  if (to_jsonb(new) - v_libres - v_generadas) is distinct from (to_jsonb(old) - v_libres - v_generadas) then
    raise exception 'Con «Facturas · Subida» solo puedes corregir los datos leídos (proveedor, número, fecha, importes y líneas) de lo que has subido tú. Verificar, clasificar y lo demás exige «Editar» en Facturas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.recalcular_alertas_factura(p_factura_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  f          record;
  v_sql      jsonb;
  v_previas  jsonb;
  v_alertas  jsonb;
  v_ok       boolean;
  v_codigos_sql constant text[] := array[
    'descuadre_cabecera', 'descuadre_linea', 'iva_incoherente',
    'precio_atipico_historico', 'precio_unitario_extremo',
    'subtotal_ausente', 'total_ausente',
    'total_documento_extremo', 'total_documento_irrisorio'];
begin
  select id, alertas_validacion, verificada, verificacion_origen
    into f from public.facturas where id = p_factura_id;
  if not found then
    return;
  end if;

  v_sql := coalesce(public.validar_cordura_factura(p_factura_id), '[]'::jsonb);
  select coalesce(jsonb_agg(a), '[]'::jsonb) into v_previas
    from jsonb_array_elements(
           case when jsonb_typeof(f.alertas_validacion) = 'array'
                then f.alertas_validacion else '[]'::jsonb end) a
   where not ((a->>'codigo') = any (v_codigos_sql));
  v_alertas := v_sql || v_previas;

  update public.facturas
     set alertas_validacion = case when jsonb_array_length(v_alertas) > 0 then v_alertas end
   where id = p_factura_id
     and alertas_validacion is distinct from
         (case when jsonb_array_length(v_alertas) > 0 then v_alertas end);

  -- La regla se aplica aquí también: cuando esto corre desde el trigger de
  -- productos_factura, el trigger de facturas va a profundidad 2 y no actúa.
  if f.verificacion_origen = 'manual' then
    return;
  end if;
  v_ok := public.factura_cumple_autoverificacion(p_factura_id);
  if not coalesce(f.verificada, false) and v_ok then
    update public.facturas set verificada = true, verificacion_origen = 'auto' where id = p_factura_id;
  elsif f.verificacion_origen = 'auto' and not v_ok then
    update public.facturas set verificada = false, verificacion_origen = null where id = p_factura_id;
  end if;
end;
$$;

create or replace function public.productos_factura_recalcular_alertas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  perform public.recalcular_alertas_factura(new.factura_id);
  if old.factura_id is distinct from new.factura_id then
    perform public.recalcular_alertas_factura(old.factura_id);
  end if;
  return null;
end;
$$;

create or replace function public.productos_factura_recalcular_alertas_lote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  r record;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return null;
  end if;
  -- `filas` es la tabla de transición: las nuevas (INSERT) o las borradas (DELETE).
  for r in select distinct factura_id from filas where factura_id is not null loop
    perform public.recalcular_alertas_factura(r.factura_id);
  end loop;
  return null;
end;
$$;

create or replace function public.categorias_producto_validar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  if new.padre_id is not null then
    if exists (select 1 from public.categorias_producto where id = new.padre_id and padre_id is not null) then
      raise exception 'Solo hay dos niveles: la categoría madre ya es una subcategoría' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.categorias_producto where padre_id = new.id) then
      raise exception '«%» tiene subcategorías: no puede pasar a ser subcategoría', new.nombre using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.productos_factura_asignar_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  if new.producto_id is null and new.nombre is not null then
    select a.producto_id into new.producto_id
      from public.productos_alias a
     where a.texto_normalizado = public.normalizar_nombre_producto(new.nombre);
  end if;
  return new;
end;
$$;

create or replace function public.trg_productos_factura_normalizar_unidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
begin
  new.unidad := public.normalizar_unidad_factura(new.unidad);
  return new;
end;
$$;

create or replace function public.productos_factura_aviso_precio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_ids bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(n.id) into v_ids from nuevas n where n.producto_id is not null;
  else
    select array_agg(n.id) into v_ids
      from nuevas n join viejas o on o.id = n.id
     where o.producto_id is null and n.producto_id is not null;
  end if;
  if v_ids is null then
    return null;
  end if;
  begin
    perform productos_avisar_subidas(v_ids);
  exception when others then
    -- Un fallo del aviso nunca impide guardar la factura.
    raise warning 'productos_factura_aviso_precio: no se pudo comprobar la subida de precio: %', sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.productos_borrar(p_producto_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  n integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Borrar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select count(*) into n from public.productos_factura where producto_id = p_producto_id;
  if n > 0 then
    raise exception 'El producto tiene % línea(s): fusiónalo con otro o mueve sus líneas antes de borrarlo', n using errcode = '23503';
  end if;
  delete from public.productos_catalogo where id = p_producto_id;
  if not found then
    raise exception 'No existe el producto %', p_producto_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.productos_recategorizar(p_producto_ids bigint[], p_categoria_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  n integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Cambiar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if p_categoria_id is not null
     and not exists (select 1 from public.categorias_producto where id = p_categoria_id and activa) then
    raise exception 'No existe la categoría % (o está desactivada)', p_categoria_id using errcode = 'P0002';
  end if;
  update public.productos_catalogo
     set categoria_id = p_categoria_id, origen = 'manual'
   where id = any(coalesce(p_producto_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.productos_renombrar(p_producto_id bigint, p_nombre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_otro   public.productos_catalogo%rowtype;
  v_prod   public.productos_catalogo%rowtype;
  v_alias  text;
begin
  if not public.productos_puede_editar() then
    raise exception 'Cambiar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if length(v_nombre) not between 1 and 200 then
    raise exception 'El nombre tiene que tener entre 1 y 200 caracteres' using errcode = '22023';
  end if;
  select * into v_prod from public.productos_catalogo where id = p_producto_id for update;
  if not found then
    raise exception 'No existe el producto %', p_producto_id using errcode = 'P0002';
  end if;
  select * into v_otro from public.productos_catalogo
   where nombre_normalizado = public.normalizar_texto(v_nombre) and id <> p_producto_id;
  if found then
    raise exception 'Ya existe «%» (producto %). Si son el mismo, fusiónalos.', v_otro.nombre, v_otro.id using errcode = '23505';
  end if;
  update public.productos_catalogo set nombre = v_nombre, origen = 'manual'
   where id = p_producto_id returning * into v_prod;
  v_alias := public.normalizar_nombre_producto(v_nombre);
  if length(coalesce(v_alias, '')) between 1 and 500 then
    insert into public.productos_alias (texto_normalizado, producto_id, origen)
    values (v_alias, p_producto_id, 'manual')
    on conflict (texto_normalizado) do nothing;
  end if;
  return to_jsonb(v_prod);
end;
$$;

create or replace function public.productos_fusionar(p_origen_ids bigint[], p_destino_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_dest     public.productos_catalogo%rowtype;
  v_origen   bigint[];
  v_lineas   integer;
  v_alias    integer;
  v_borrados integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Fusionar productos exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  select * into v_dest from public.productos_catalogo where id = p_destino_id for update;
  if not found then
    raise exception 'No existe el producto %', p_destino_id using errcode = 'P0002';
  end if;
  v_origen := array(select distinct x from unnest(coalesce(p_origen_ids, '{}')) as x
                     where x is not null and x <> p_destino_id order by x);
  if cardinality(v_origen) = 0 then
    raise exception 'Elige al menos otro producto que fusionar con «%»', v_dest.nombre using errcode = '22023';
  end if;
  perform 1 from public.productos_catalogo where id = any(v_origen) order by id for update;
  if (select count(*) from public.productos_catalogo where id = any(v_origen)) <> cardinality(v_origen) then
    raise exception 'Alguno de los productos que se iban a fusionar ya no existe. Recarga y vuelve a intentarlo.' using errcode = 'P0002';
  end if;

  update public.productos_factura set producto_id = p_destino_id where producto_id = any(v_origen);
  get diagnostics v_lineas = row_count;
  update public.productos_alias set producto_id = p_destino_id, origen = 'manual' where producto_id = any(v_origen);
  get diagnostics v_alias = row_count;
  -- El nombre de los fusionados sigue sirviendo para reconocer líneas.
  insert into public.productos_alias (texto_normalizado, producto_id, origen)
  select distinct public.normalizar_nombre_producto(nombre), p_destino_id, 'manual'
    from public.productos_catalogo
   where id = any(v_origen) and length(coalesce(public.normalizar_nombre_producto(nombre), '')) between 1 and 500
  on conflict (texto_normalizado) do nothing;
  -- Si el que queda no tenía categoría, hereda la del primero que la tenga.
  if v_dest.categoria_id is null then
    update public.productos_catalogo
       set categoria_id = (select categoria_id from public.productos_catalogo
                            where id = any(v_origen) and categoria_id is not null
                            order by array_position(p_origen_ids, id) limit 1)
     where id = p_destino_id;
  end if;
  delete from public.productos_catalogo where id = any(v_origen);
  get diagnostics v_borrados = row_count;
  update public.productos_catalogo set origen = 'manual' where id = p_destino_id;
  return jsonb_build_object('producto_id', p_destino_id, 'lineas_movidas', v_lineas,
                            'alias_movidos', v_alias, 'productos_borrados', v_borrados);
end;
$$;

create or replace function public.productos_asignar_lineas(p_linea_ids bigint[], p_producto_id bigint DEFAULT NULL::bigint, p_nombre_nuevo text DEFAULT NULL::text, p_categoria_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_ids     bigint[] := array(select distinct x from unnest(coalesce(p_linea_ids, '{}')) as x where x is not null);
  v_nombre  text := btrim(regexp_replace(coalesce(p_nombre_nuevo, ''), '\s+', ' ', 'g'));
  v_destino bigint;
  v_creado  boolean := false;
  v_unidad  text;
  v_lineas  integer;
  v_alias   integer;
begin
  if not public.productos_puede_editar() then
    raise exception 'Clasificar líneas exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'No hay líneas que asignar' using errcode = '22023';
  end if;
  if (p_producto_id is null) = (v_nombre = '') then
    raise exception 'Indica un producto existente o el nombre de uno nuevo (solo una de las dos cosas)' using errcode = '22023';
  end if;
  if (select count(*) from public.productos_factura where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'Alguna de las líneas ya no existe. Recarga y vuelve a intentarlo.' using errcode = 'P0002';
  end if;

  if p_producto_id is not null then
    select id into v_destino from public.productos_catalogo where id = p_producto_id;
    if v_destino is null then
      raise exception 'No existe el producto %', p_producto_id using errcode = 'P0002';
    end if;
  else
    if length(v_nombre) > 200 then
      raise exception 'El nombre tiene que tener entre 1 y 200 caracteres' using errcode = '22023';
    end if;
    if p_categoria_id is not null
       and not exists (select 1 from public.categorias_producto where id = p_categoria_id and activa) then
      raise exception 'No existe la categoría % (o está desactivada)', p_categoria_id using errcode = 'P0002';
    end if;
    select id into v_destino from public.productos_catalogo where nombre_normalizado = public.normalizar_texto(v_nombre);
    if v_destino is null then
      select unidad into v_unidad from public.productos_factura
       where id = any(v_ids) and unidad is not null
       group by unidad order by count(*) desc, unidad limit 1;
      insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen, creado_por)
      values (v_nombre, p_categoria_id, v_unidad, 'manual', auth.uid())
      returning id into v_destino;
      v_creado := true;
    end if;
  end if;

  update public.productos_factura set producto_id = v_destino where id = any(v_ids);
  get diagnostics v_lineas = row_count;
  -- Lo que corrige una persona manda: el texto de esas líneas pasa a ser de
  -- este producto también para lo que llegue después.
  insert into public.productos_alias (texto_normalizado, producto_id, origen)
  select distinct pf.nombre_normalizado, v_destino, 'manual'
    from public.productos_factura pf
   where pf.id = any(v_ids) and length(coalesce(pf.nombre_normalizado, '')) between 1 and 500
  on conflict (texto_normalizado) do update set producto_id = excluded.producto_id, origen = 'manual';
  get diagnostics v_alias = row_count;
  return jsonb_build_object('producto_id', v_destino, 'creado', v_creado, 'lineas', v_lineas, 'alias', v_alias);
end;
$$;

create or replace function public.productos_aplicar_clasificacion_ia(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  it        jsonb;
  v_textos  text[];
  v_todos   text[] := '{}';
  v_dest    bigint;
  v_cat     bigint;
  v_nombre  text;
  v_creados integer := 0;
  v_alias   integer := 0;
  v_asig    jsonb;
  n         integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items tiene que ser una lista' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    -- Todos los textos de la llamada (tengan ya alias o no): son los que se asignan al final.
    v_todos := v_todos || array(select distinct t from jsonb_array_elements_text(
                        case when jsonb_typeof(it->'textos') = 'array' then it->'textos' else '[]'::jsonb end) as t
                       where length(t) between 1 and 500);
    v_textos := array(select distinct t from jsonb_array_elements_text(
                        case when jsonb_typeof(it->'textos') = 'array' then it->'textos' else '[]'::jsonb end) as t
                       where length(t) between 1 and 500
                         and not exists (select 1 from public.productos_alias a where a.texto_normalizado = t));
    -- Textos que ya tienen alias: manda el alias (no se crea nada).
    continue when cardinality(v_textos) = 0;
    v_dest := null;
    if jsonb_typeof(it->'producto_id') = 'number' then
      select id into v_dest from public.productos_catalogo where id = (it->>'producto_id')::bigint;
    end if;
    if v_dest is null then
      v_nombre := btrim(regexp_replace(coalesce(it->>'nombre', ''), '\s+', ' ', 'g'));
      continue when length(v_nombre) not between 1 and 200;
      select id into v_dest from public.productos_catalogo where nombre_normalizado = public.normalizar_texto(v_nombre);
      if v_dest is null then
        v_cat := null;
        if jsonb_typeof(it->'categoria_id') = 'number' then
          select id into v_cat from public.categorias_producto where id = (it->>'categoria_id')::bigint and activa;
        end if;
        insert into public.productos_catalogo (nombre, categoria_id, unidad_habitual, origen)
        values (v_nombre, v_cat, nullif(left(btrim(coalesce(it->>'unidad', '')), 20), ''), 'ia')
        returning id into v_dest;
        v_creados := v_creados + 1;
      end if;
    end if;
    insert into public.productos_alias (texto_normalizado, producto_id, origen)
    select t, v_dest, 'ia' from unnest(v_textos) as t
    on conflict (texto_normalizado) do nothing;
    get diagnostics n = row_count;
    v_alias := v_alias + n;
  end loop;
  -- Antes: un UPDATE sin límite de TODAS las líneas con alias (se cortaba a los 8 s y se perdía
  -- todo lo anterior). Ahora: las de esta llamada, por tandas y con tope; el resto, el cron.
  if cardinality(v_todos) > 0 then
    v_asig := public.productos_asignar_por_alias(v_todos, 4000);
  end if;
  return jsonb_build_object(
    'productos_creados', v_creados,
    'alias_creados', v_alias,
    'lineas_asignadas', coalesce((v_asig->>'lineas_asignadas')::integer, 0),
    'lineas_pendientes', coalesce((v_asig->>'quedan')::boolean, false));
end;
$$;

create or replace function public.productos_asignar_por_alias(p_textos text[] DEFAULT NULL::text[], p_max_ms integer DEFAULT 4000, p_lote integer DEFAULT 150)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_inicio timestamptz := clock_timestamp();
  v_lote   integer := greatest(1, least(coalesce(p_lote, 150), 1000));
  v_max_ms integer := greatest(0, least(coalesce(p_max_ms, 4000), 60000));
  v_total  integer := 0;
  v_n      integer;
  v_quedan boolean;
begin
  loop
    with objetivo as (
      select pf.id, a.producto_id
        from public.productos_factura pf
        join public.productos_alias a on a.texto_normalizado = pf.nombre_normalizado
       where pf.producto_id is null
         and (p_textos is null or pf.nombre_normalizado = any (p_textos))
       order by pf.id
       limit v_lote
         for update of pf skip locked
    )
    update public.productos_factura pf
       set producto_id = o.producto_id
      from objetivo o
     where pf.id = o.id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    -- Tanda incompleta: no queda nada (o lo que queda lo tiene bloqueado otro).
    exit when v_n < v_lote;
    exit when extract(epoch from clock_timestamp() - v_inicio) * 1000 >= v_max_ms;
  end loop;
  select exists (
    select 1
      from public.productos_factura pf
      join public.productos_alias a on a.texto_normalizado = pf.nombre_normalizado
     where pf.producto_id is null
       and (p_textos is null or pf.nombre_normalizado = any (p_textos))
  ) into v_quedan;
  return jsonb_build_object('lineas_asignadas', v_total, 'quedan', v_quedan);
end;
$$;

create or replace function public.productos_despachar_clasificacion()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
-- la URL sale de Vault («project_url»).
-- antes de llamar a la función, lo que ya tiene alias se asigna aquí (sin IA).
declare
  v_url     text;
  v_secreto text;
begin
  perform public.productos_asignar_por_alias(null, 15000);
  if not exists (select 1 from public.productos_factura
                  where producto_id is null
                    and created_at > now() - interval '7 days'
                    and created_at < now() - interval '1 minute') then
    return 0;
  end if;
  v_url := public.url_funcion_edge('clasificar-productos');
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
$$;

create or replace function public.buscar_documentos_compras(p_texto text)
 RETURNS bigint[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  -- Una palabra no tiene espacios, así que para saber si está DENTRO de un texto
  -- basta con quitarle tildes y mayúsculas (colapsar espacios no cambia nada).
  with palabras as (
    select coalesce(array_agg(distinct w), '{}'::text[]) as ws
      from unnest(string_to_array(public.texto_busqueda_compras(left(p_texto, 200)), ' ')) w
     where w <> ''
  ),
  catalogo as (
    select pc.id, lower(extensions.unaccent('extensions.unaccent'::regdictionary, pc.nombre)) as t
      from productos_catalogo pc
  ),
  coincidencias as (
    -- Cabecera: número, proveedor, CIF y observaciones.
    select f.id, w
      from facturas f, palabras p, unnest(p.ws) w
     where position(w in lower(extensions.unaccent('extensions.unaccent'::regdictionary,
             concat_ws(' ', f.numero_documento, f.proveedor, f.cif, f.observaciones)))) > 0
    union
    -- Líneas: su nombre o el de su producto del catálogo.
    select pf.factura_id, w
      from productos_factura pf
      left join catalogo c on c.id = pf.producto_id
      cross join palabras p
      cross join unnest(p.ws) w
     where position(w in pf.nombre_busqueda) > 0
        or position(w in coalesce(c.t, '')) > 0
  )
  select coalesce(array_agg(x.id order by x.id), '{}'::bigint[])
    from (
      select c.id
        from coincidencias c
       group by c.id
      having count(distinct c.w) = (select cardinality(ws) from palabras)
    ) x
$$;

create or replace function public.ocr_sumar_gasto(p_trabajo_id uuid, p_coste numeric, p_llamadas integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  update public.ocr_trabajos
     set coste_usd = coste_usd + greatest(coalesce(p_coste, 0), 0),
         llamadas = llamadas + greatest(coalesce(p_llamadas, 0), 0)
   where id = p_trabajo_id;
$$;

create or replace function public.ocr_despachar_cola()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- da paso, por orden de llegada, a los
-- trabajos que esperan hueco (ocr_despachar aplica los topes). SKIP LOCKED:
-- nunca espera a otro worker.
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.ocr_trabajos
     where estado in ('pendiente', 'pagina1', 'paginas')
     order by created_at
     limit 30
     for update skip locked
  loop
    n := n + public.ocr_despachar(r.id);
  end loop;
  return n;
end;
$$;

create or replace function public.ocr_reclamar_pagina(p_pagina_id bigint, p_lease_seg integer DEFAULT 180)
 RETURNS SETOF ocr_trabajo_paginas
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  update public.ocr_trabajo_paginas pg
     set estado = 'procesando', intentos = pg.intentos + 1,
         lease_hasta = now() + make_interval(secs => greatest(30, least(p_lease_seg, 600)))
    from public.ocr_trabajos t
   where pg.id = p_pagina_id and pg.estado = 'pendiente' and pg.no_antes_de <= now()
     and t.id = pg.trabajo_id
     and (t.estado = 'paginas' or (t.estado = 'pagina1' and pg.numero = 1))
  returning pg.*;
$$;

create or replace function public.ocr_reclamar_consolidacion(p_trabajo_id uuid, p_lease_seg integer DEFAULT 180)
 RETURNS SETOF ocr_trabajos
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  update public.ocr_trabajos t
     set estado = 'consolidando', intentos_consolidacion = t.intentos_consolidacion + 1,
         lease_hasta = now() + make_interval(secs => greatest(30, least(p_lease_seg, 600)))
   where t.id = p_trabajo_id
     and ((t.estado = 'paginas'
           and not exists (select 1 from public.ocr_trabajo_paginas pg
                            where pg.trabajo_id = t.id and pg.estado in ('pendiente', 'procesando')))
          or (t.estado = 'consolidando' and t.lease_hasta < now()))
  returning t.*;
$$;

create or replace function public.ocr_resumen_factura(p_factura_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- lo que relee el panel al abrir
-- «Sustituir la existente» / «Añadir como página» (no la foto vieja).
-- con «Ver», o con «Facturas · Subida»
-- si el documento es suyo.
begin
  if not (coalesce(public.can_read_section('facturas'), false)
          or (coalesce(public.facturas_puede_subir(), false) and public.factura_subida_por_mi(p_factura_id))) then
    raise exception 'Sin permiso para ver facturas' using errcode = '42501';
  end if;
  return public.ocr_resumen_factura_datos(p_factura_id) - 'totales_lineas';
end;
$$;

create or replace function public.ocr_terminar_trabajo(p_trabajo_id uuid, p_estado text, p_resultado jsonb, p_factura_id bigint, p_error text, p_documento_pendiente jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- al terminar (libera una
-- consolidación), da paso a la cola.
declare
  v_ok boolean;
begin
  if p_estado not in ('completado', 'duplicado', 'fallido') then
    raise exception 'ocr_terminar_trabajo: estado % no permitido', p_estado;
  end if;
  update public.ocr_trabajos
     set estado = p_estado, resultado = p_resultado, factura_id = p_factura_id,
         error = left(p_error, 2000), documento_pendiente = p_documento_pendiente,
         terminado_at = now(), lease_hasta = null
   where id = p_trabajo_id and estado not in ('completado', 'duplicado', 'fallido', 'cancelado');
  v_ok := found;
  if v_ok then
    perform public.ocr_despachar_cola();
  end if;
  return v_ok;
end;
$$;

create or replace function public.ocr_pedir_relectura(p_trabajo_id uuid, p_paginas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  n integer := 0;
  r jsonb;
begin
  if not exists (select 1 from public.ocr_trabajos
                  where id = p_trabajo_id and estado = 'consolidando' and ronda_relectura = 0) then
    return 0;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_paginas, '[]'::jsonb)) loop
    update public.ocr_trabajo_paginas
       set estado = 'pendiente', relecturas = 1, motivo_relectura = r->'motivo', despachada_at = null,
           no_antes_de = now(), lease_hasta = null
     where id = (r->>'pagina_id')::bigint and trabajo_id = p_trabajo_id
       and estado = 'completada' and relecturas = 0;
    if found then n := n + 1; end if;
  end loop;
  if n = 0 then
    return 0;
  end if;
  update public.ocr_trabajos
     set estado = 'paginas', ronda_relectura = 1, lease_hasta = null, consolidar_despachado_at = null
   where id = p_trabajo_id;
  perform public.ocr_despachar(p_trabajo_id);
  return n;
end;
$$;

create or replace function public.ocr_fallo_pagina(p_pagina_id bigint, p_error text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- al fallar, da paso a la cola.
declare
  pg public.ocr_trabajo_paginas%rowtype;
  v_estado text;
begin
  select * into pg from public.ocr_trabajo_paginas where id = p_pagina_id for update;
  if not found or pg.estado not in ('procesando', 'pendiente') then
    return null;
  end if;
  v_estado := case when pg.intentos >= 3 then 'fallida' else 'pendiente' end;
  update public.ocr_trabajo_paginas
     set estado = v_estado, lease_hasta = null, despachada_at = null,
         no_antes_de = now() + make_interval(secs => 30 * greatest(pg.intentos, 1)),
         error = left(coalesce(p_error, 'error desconocido'), 2000)
   where id = p_pagina_id;
  if v_estado = 'fallida' and pg.numero = 1 then
    update public.ocr_trabajos set estado = 'paginas' where id = pg.trabajo_id and estado = 'pagina1';
  end if;
  perform public.ocr_despachar(pg.trabajo_id);
  perform public.ocr_despachar_cola();
  return v_estado;
end;
$$;

create or replace function public.ocr_cerrar_pagina(p_pagina_id bigint, p_resultado jsonb, p_recuento jsonb, p_verificacion jsonb, p_motivos jsonb, p_filas_extraidas integer, p_filas_contadas integer, p_relecturas integer, p_duracion_ms integer, p_tokens_entrada integer, p_tokens_salida integer, p_coste numeric, p_contexto jsonb, p_modelo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- al cerrar, da paso a la cola.
declare
  pg public.ocr_trabajo_paginas%rowtype;
begin
  update public.ocr_trabajo_paginas
     set estado = 'completada', lease_hasta = null, resultado = p_resultado, recuento = p_recuento,
         verificacion_pie = p_verificacion, motivos = p_motivos,
         filas_extraidas = least(p_filas_extraidas, 32767), filas_contadas = least(p_filas_contadas, 32767),
         relecturas = greatest(relecturas, least(coalesce(p_relecturas, 0), 1)),
         duracion_ms = p_duracion_ms, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
         coste_usd = p_coste, error = null
   where id = p_pagina_id and estado = 'procesando'
  returning * into pg;
  if not found then
    return false;
  end if;

  update public.ocr_trabajos
     set coste_usd = coste_usd + coalesce(p_coste, 0),
         modelo = coalesce(p_modelo, modelo),
         contexto_p1 = case when pg.numero = 1 and p_contexto is not null then p_contexto else contexto_p1 end,
         estado = case when estado = 'pagina1' and pg.numero = 1 then 'paginas' else estado end
   where id = pg.trabajo_id;

  perform public.ocr_despachar(pg.trabajo_id);
  perform public.ocr_despachar_cola();
  return true;
end;
$$;

create or replace function public.ocr_descartar_trabajo(p_trabajo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  t public.ocr_trabajos%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'Tu sesión ha caducado: vuelve a entrar en el panel.');
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Ese documento ya no está en el servidor.');
  end if;
  if t.creado_por is distinct from v_uid and not public.can_edit_section('facturas') then
    return jsonb_build_object('ok', false, 'motivo', 'No tienes permiso para descartar documentos de otra persona.');
  end if;
  if t.estado = 'cancelado' then
    return jsonb_build_object('ok', true, 'estado', 'cancelado');
  end if;
  if t.estado = 'consolidando' then
    return jsonb_build_object('ok', false, 'estado', t.estado,
      'motivo', 'Se está guardando ahora mismo: espera unos segundos y mira si ha quedado guardado.');
  end if;
  if t.estado = 'completado' then
    return jsonb_build_object('ok', false, 'estado', t.estado, 'factura_id', t.factura_id,
      'motivo', 'Ese documento ya está guardado: si sobra, bórralo desde la lista de documentos.');
  end if;
  -- duplicado, pendiente, pagina1, paginas, fallido → cancelado. Los workers
  -- no tocan un trabajo cancelado (ocr_despachar y ocr_terminar_trabajo lo
  -- excluyen) y la limpieza diaria (ocr_despachar_limpieza) borra sus ficheros
  -- de pendientes/ (salvo que sean el original de una factura).
  update public.ocr_trabajos
     set estado = 'cancelado',
         error = coalesce(nullif(error, ''), case when t.estado = 'duplicado'
                                                  then 'Descartado: se deja la factura que ya había'
                                                  else 'Cancelado desde el panel' end),
         terminado_at = coalesce(terminado_at, now()),
         lease_hasta = null
   where id = t.id;
  return jsonb_build_object('ok', true, 'estado', 'cancelado', 'antes', t.estado);
end;
$$;

create or replace function public.ocr_reintentar_trabajo(p_trabajo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  t public.ocr_trabajos%rowtype;
  v_faltan integer;
  v_p1 text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'Tu sesión ha caducado: vuelve a entrar en el panel.');
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null,
      'motivo', 'Ese documento ya no está en el servidor: vuelve a subirlo.');
  end if;
  if t.creado_por is distinct from v_uid and not public.can_edit_section('facturas') then
    return jsonb_build_object('ok', false, 'estado', t.estado, 'motivo', 'No tienes permiso para reintentar documentos de otra persona.');
  end if;
  if t.estado in ('pendiente', 'pagina1', 'paginas', 'consolidando') then
    -- Sigue en marcha: nada que reintentar (y nada que volver a pagar).
    return jsonb_build_object('ok', true, 'estado', t.estado);
  end if;
  if t.estado in ('completado', 'duplicado') then
    return jsonb_build_object('ok', true, 'estado', t.estado, 'factura_id', t.factura_id);
  end if;
  if t.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'estado', t.estado, 'motivo', 'Ese documento se descartó: vuelve a subirlo.');
  end if;

  -- fallido: ¿siguen sus ficheros en Storage?
  select count(*) into v_faltan
    from (select t.original_path as ruta where t.original_path is not null
          union all
          select storage_path from public.ocr_trabajo_paginas where trabajo_id = t.id) r
   where not exists (select 1 from storage.objects o where o.bucket_id = 'facturas-originales' and o.name = r.ruta);
  if v_faltan > 0 or not exists (select 1 from public.ocr_trabajo_paginas where trabajo_id = t.id) then
    return jsonb_build_object('ok', false, 'estado', t.estado,
      'motivo', 'Los ficheros de este documento ya no están en el servidor: vuelve a subirlo.');
  end if;

  -- Las piezas ya leídas se conservan (no se vuelven a pagar); las demás, a la cola.
  update public.ocr_trabajo_paginas
     set estado = 'pendiente', intentos = 0, error = null, lease_hasta = null,
         despachada_at = null, no_antes_de = now()
   where trabajo_id = t.id and estado <> 'completada';
  select estado into v_p1 from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
  update public.ocr_trabajos
     set estado = case when v_p1 = 'completada' then 'paginas' else 'pagina1' end,
         error = null, resultado = null, terminado_at = null, lease_hasta = null,
         consolidar_despachado_at = null, intentos_consolidacion = 0,
         limite_at = now() + interval '15 minutes'
   where id = t.id;
  perform public.ocr_despachar(t.id);
  return jsonb_build_object('ok', true, 'estado', 'reanudado');
end;
$$;

create or replace function public.ocr_despachar(p_trabajo_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
-- topes de 3 consolidaciones y 12
-- piezas en todo el sistema. 20261106200000: la URL sale de Vault
-- («project_url»), ya no va fija la del proyecto viejo.
declare
  c_max_consolidaciones constant integer := 3;
  c_max_piezas          constant integer := 12;
  v_url     text;
  v_secreto text;
  t        public.ocr_trabajos%rowtype;
  p        public.ocr_trabajo_paginas%rowtype;
  v_vuelo  integer;
  v_hueco  integer;
  v_consol integer;
  n        integer := 0;
begin
  v_url := public.url_funcion_edge('ocr-trabajo');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;

  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found or t.estado not in ('pendiente', 'pagina1', 'paginas') then
    return 0;
  end if;

  if t.estado = 'pendiente' then
    update public.ocr_trabajos set estado = 'pagina1' where id = t.id;
    t.estado := 'pagina1';
  end if;

  -- Piezas que aún caben en todo el sistema (leyéndose o recién despachadas).
  select count(*) into v_hueco
    from public.ocr_trabajo_paginas
   where (estado = 'procesando' and lease_hasta > now())
      or (estado = 'pendiente' and despachada_at > now() - interval '30 seconds');
  v_hueco := greatest(0, c_max_piezas - v_hueco);

  if t.estado = 'pagina1' then
    select * into p from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
    if not found or p.estado in ('completada', 'fallida') then
      update public.ocr_trabajos set estado = 'paginas' where id = t.id;
      t.estado := 'paginas';
    elsif p.estado = 'pendiente' and p.no_antes_de <= now() and v_hueco > 0
          and (p.despachada_at is null or p.despachada_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      v_hueco := v_hueco - 1;
      n := n + 1;
    end if;
  end if;

  if t.estado = 'paginas' then
    select count(*) into v_vuelo from public.ocr_trabajo_paginas
     where trabajo_id = t.id and estado = 'procesando';
    for p in
      select * from public.ocr_trabajo_paginas
       where trabajo_id = t.id and estado = 'pendiente' and no_antes_de <= now()
         and (despachada_at is null or despachada_at < now() - interval '30 seconds')
       order by numero
       limit least(greatest(0, 4 - v_vuelo), v_hueco)
    loop
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      n := n + 1;
    end loop;

    if not exists (select 1 from public.ocr_trabajo_paginas
                    where trabajo_id = t.id and estado in ('pendiente', 'procesando'))
       and (t.consolidar_despachado_at is null or t.consolidar_despachado_at < now() - interval '30 seconds') then
      select count(*) into v_consol
        from public.ocr_trabajos
       where id <> t.id
         and ((estado = 'consolidando' and lease_hasta > now())
              or (estado = 'paginas' and consolidar_despachado_at > now() - interval '30 seconds'));
      if v_consol < c_max_consolidaciones then
        perform net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          body := jsonb_build_object('modo', 'consolidar', 'trabajo_id', t.id),
          timeout_milliseconds := 10000);
        update public.ocr_trabajos set consolidar_despachado_at = now() where id = t.id;
        n := n + 1;
      end if;
    end if;
  end if;
  return n;
end;
$$;

create or replace function public.reanudar_trabajos_ocr()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  r record;
  n integer := 0;
begin
  -- 1. Piezas con el lease caducado (el worker murió): fallo técnico → reintento.
  for r in select id from public.ocr_trabajo_paginas where estado = 'procesando' and lease_hasta < now() loop
    perform public.ocr_fallo_pagina(r.id, 'lease caducado (el worker no cerró la pieza)');
    n := n + 1;
  end loop;

  -- 2. Trabajos que pasan del límite → fallido.
  update public.ocr_trabajos
     set estado = 'fallido', error = coalesce(error, 'tiempo agotado (15 min) sin terminar'),
         terminado_at = now(), lease_hasta = null
   where estado in ('pendiente', 'pagina1', 'paginas', 'consolidando') and limite_at < now();

  -- 3. Consolidación con el lease caducado: reintento (máx. 3) o fallido.
  update public.ocr_trabajos
     set estado = 'fallido', error = coalesce(error, 'la consolidación falló 3 veces'),
         terminado_at = now(), lease_hasta = null
   where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion >= 3;
  update public.ocr_trabajos
     set estado = 'paginas', lease_hasta = null, consolidar_despachado_at = null
   where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion < 3;

  -- 4. Trabajos activos sin movimiento en 60 s → volver a despachar.
  for r in select id from public.ocr_trabajos
            where estado in ('pendiente', 'pagina1', 'paginas') and updated_at < now() - interval '60 seconds' loop
    n := n + public.ocr_despachar(r.id);
  end loop;
  return n;
end;
$$;

create or replace function public.estadisticas_lectura(p_dias integer DEFAULT 30)
 RETURNS TABLE(documentos integer, total_usd numeric, media_usd numeric, mediana_usd numeric, llamadas_media numeric, mas_cara_id bigint, mas_cara_proveedor text, mas_cara_numero text, mas_cara_usd numeric, por_paginas jsonb, por_lineas jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
#variable_conflict use_column
declare
  v_dias  integer := least(greatest(coalesce(p_dias, 30), 1), 365);
  v_desde timestamptz;
begin
  if not (public.can_read_section('facturas') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception 'estadisticas_lectura: sin permiso para ver Facturas' using errcode = '42501';
  end if;
  v_desde := (((now() at time zone 'Europe/Madrid')::date - (v_dias - 1))::timestamp) at time zone 'Europe/Madrid';

  return query
  with base as (
    select f.id, f.proveedor, f.numero_documento, f.paginas, f.coste_lectura_usd as usd, f.lectura_llamadas,
           (select count(*) from public.productos_factura p where p.factura_id = f.id)::integer as lineas
      from public.facturas f
     where f.coste_lectura_usd is not null
       and coalesce(f.procesado_en, f.created_at) >= v_desde
  ),
  resumen as (
    select count(*)::integer as n,
           coalesce(sum(b.usd), 0) as total,
           avg(b.usd) as media,
           (percentile_cont(0.5) within group (order by b.usd))::numeric as mediana,
           avg(b.lectura_llamadas) as llamadas_media
      from base b
  ),
  cara as (
    select b.id, b.proveedor::text as proveedor, b.numero_documento::text as numero_documento, b.usd
      from base b
     order by b.usd desc, b.id desc
     limit 1
  ),
  pag as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tramo', x.tramo, 'documentos', x.n, 'media_usd', x.media, 'total_usd', x.total) order by x.orden), '[]'::jsonb) as j
      from (
        select least(b.paginas, 3) as orden,
               case when b.paginas >= 3 then '3 o más páginas' when b.paginas = 2 then '2 páginas' else '1 página' end as tramo,
               count(*)::integer as n, avg(b.usd) as media, sum(b.usd) as total
          from base b
         group by 1, 2
      ) x
  ),
  lin as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tramo', x.tramo, 'documentos', x.n, 'media_usd', x.media, 'total_usd', x.total) order by x.orden), '[]'::jsonb) as j
      from (
        select case when b.lineas <= 10 then 1 when b.lineas <= 25 then 2 when b.lineas <= 50 then 3 else 4 end as orden,
               case when b.lineas <= 10 then '1-10 líneas' when b.lineas <= 25 then '11-25 líneas'
                    when b.lineas <= 50 then '26-50 líneas' else 'más de 50 líneas' end as tramo,
               count(*)::integer as n, avg(b.usd) as media, sum(b.usd) as total
          from base b
         group by 1, 2
      ) x
  )
  select r.n, r.total, r.media, r.mediana, r.llamadas_media,
         c.id, c.proveedor, c.numero_documento, c.usd,
         pag.j, lin.j
    from resumen r
    left join cara c on true
    cross join pag
    cross join lin;
end;
$$;

create or replace function public.verificar_duplicado_factura(p_numero_documento character varying, p_proveedor character varying, p_fecha date, p_total numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- El número solo NO basta (dos proveedores pueden usar la misma numeración):
-- mismo número + mismo proveedor (proveedor_id resuelto sin crear nada) o, si
-- no hay proveedor, mismo total y fecha.
declare
  factura_existente record;
  v_pid bigint := public.proveedor_resolver(p_proveedor, null, false);
  v_prov text := lower(btrim(coalesce(p_proveedor, '')));
  v_sin_proveedor boolean;
begin
  v_sin_proveedor := v_pid is null and v_prov = '';

  -- 1. Número + proveedor (o, sin proveedor, total y fecha).
  select * into factura_existente
    from facturas fa
   where lower(btrim(fa.numero_documento)) = lower(btrim(p_numero_documento))
     and ((v_pid is not null and fa.proveedor_id = v_pid)
          or ((v_sin_proveedor or fa.proveedor_id is null)
              and fa.fecha is not distinct from p_fecha
              and fa.total is not null and p_total is not null and abs(fa.total - p_total) < 0.01))
   order by fa.id
   limit 1;
  if found then
    return json_build_object('es_duplicado', true, 'motivo', 'numero_documento',
                             'factura_existente', row_to_json(factura_existente));
  end if;

  -- 2. Mismo proveedor + fecha + total (con total distinto de 0).
  if v_prov <> '' and coalesce(p_total, 0) <> 0 then
    select * into factura_existente
      from facturas fa
     where ((v_pid is not null and fa.proveedor_id = v_pid)
            or (coalesce(fa.proveedor, '') <> ''
                and (lower(fa.proveedor) like '%' || v_prov || '%' or v_prov like '%' || lower(fa.proveedor) || '%')))
       and fa.fecha = p_fecha
       and abs(fa.total - p_total) < 0.01
     order by fa.id
     limit 1;
    if found then
      return json_build_object('es_duplicado', true, 'motivo', 'datos_coincidentes',
                               'factura_existente', row_to_json(factura_existente));
    end if;
  end if;

  return json_build_object('es_duplicado', false, 'motivo', null, 'factura_existente', null);
end;
$$;

create or replace function public.configuracion_facturas_tocar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.validar_cordura_factura(p_factura_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
-- el cuadre base + IVA = total resta la retención IRPF.
declare
  f              record;
  alertas        jsonb := '[]'::jsonb;
  v_suma         numeric;
  v_ref          numeric;
  v_tol          numeric;
  v_n_lineas     integer;
  v_n_con_total  integer;
  v_n_con_precio integer;
  v_n_cero       integer;
  v_n_sin_total  integer;
  v_sin_importes boolean;
  r              record;
  v_cif_doc      text;
  v_cif_ficha    text;
begin
  select * into f from facturas where id = p_factura_id;
  if not found then
    return '[]'::jsonb;
  end if;

  select count(*),
         count(*) filter (where pf.total is not null),
         count(*) filter (where pf.precio_unitario is not null and pf.precio_unitario <> 0),
         count(*) filter (where pf.total = 0),
         count(*) filter (where pf.total is null),
         sum(pf.total)
    into v_n_lineas, v_n_con_total, v_n_con_precio, v_n_cero, v_n_sin_total, v_suma
  from productos_factura pf
  where pf.factura_id = p_factura_id;

  -- Documento sin un solo importe impreso: hay lineas, pero ni una lleva
  -- precio o total, y la cabecera tampoco tiene importes. No hay nada que cuadrar.
  v_sin_importes := v_n_lineas > 0
                    and v_n_con_total = 0
                    and v_n_con_precio = 0
                    and f.subtotal is null
                    and f.iva is null
                    and f.total is null;

  ---------------------------------------------------------------------------
  -- 0) NUEVO · Importes de cabecera que faltan.
  ---------------------------------------------------------------------------
  if f.total is null and not v_sin_importes then
    alertas := alertas || jsonb_build_object(
      'codigo',    'total_ausente',
      'severidad', 'alta',
      'mensaje',   case
                     when v_n_lineas = 0 then
                       'El documento no tiene total ni ninguna linea: no hay ningun importe que se pueda usar. Vuelve a subirlo o completa los datos en "Editar".'
                     else
                       format('El documento no tiene total guardado%s, aunque sus %s lineas suman %s €. Sin total no se puede comprobar que la lectura este completa: mira el original y completa los importes en "Editar".',
                              case when f.subtotal is null then ' (ni base imponible)' else '' end,
                              v_n_lineas, coalesce(round(v_suma, 2), 0))
                   end,
      'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                      'suma_lineas', round(v_suma, 2), 'num_lineas', v_n_lineas)
    );
  elsif f.subtotal is null and v_n_con_total > 0 then
    alertas := alertas || jsonb_build_object(
      'codigo',    'subtotal_ausente',
      'severidad', 'media',
      'mensaje',   format('El documento tiene total (%s €) pero no base imponible, asi que las lineas (que suman %s €) solo se pueden cuadrar contra el total con IVA. Comprueba la base en el original.',
                          f.total, round(v_suma, 2)),
      'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                      'suma_lineas', round(v_suma, 2), 'num_lineas', v_n_lineas)
    );
  end if;

  ---------------------------------------------------------------------------
  -- 1) Descuadre de linea: precio_unitario x cantidad frente al total.
  --    OJO CON LOS FALSOS POSITIVOS: casi todos los proveedores aplican
  --    descuento por linea, asi que `total` < `precio x cantidad` es la norma,
  --    no la excepcion. Verificado con los datos reales: las facturas 35 y 37
  --    llevan un 15 % de descuento en casi todas sus lineas. Una regla de
  --    "difiere mas de un 2 %" marcaria 10 lineas legitimas y el aviso se
  --    volveria ruido que nadie mira.
  --    Por eso se usa la RAZON y no la diferencia, y solo se avisa de lo que un
  --    descuento no puede explicar:
  --      > 1.02  -> cobran MAS de lo que suman las unidades (imposible)
  --      < 0.40  -> mas de un 60 % de descuento, o un x10 de decimales
  --    Las lineas a 0 € (bonificadas) se saltan aqui: su descuadre es el
  --    comportamiento correcto. Siguen contando en el bloque 2.
  ---------------------------------------------------------------------------
  for r in
    select pf.nombre, pf.cantidad, pf.precio_unitario, pf.total,
           round((pf.precio_unitario * pf.cantidad)::numeric, 2) as esperado,
           round((pf.total / (pf.precio_unitario * pf.cantidad))::numeric, 3) as razon
    from productos_factura pf
    where pf.factura_id = p_factura_id
      and pf.precio_unitario > 0
      and pf.cantidad > 0
      and pf.total > 0
      and abs(pf.precio_unitario * pf.cantidad - pf.total) > 0.05
      and (pf.total / (pf.precio_unitario * pf.cantidad) > 1.02
        or pf.total / (pf.precio_unitario * pf.cantidad) < 0.40)
    order by abs(pf.precio_unitario * pf.cantidad - pf.total) desc
    limit 5
  loop
    alertas := alertas || jsonb_build_object(
      'codigo',    'descuadre_linea',
      'severidad', 'media',
      'mensaje',   format('La linea "%s" no cuadra: %s x %s = %s, pero el total leido es %s. La diferencia no se explica por un descuento normal.',
                          left(r.nombre, 60), r.precio_unitario, r.cantidad, r.esperado, r.total),
      'detalle',   jsonb_build_object('producto', r.nombre, 'cantidad', r.cantidad,
                                      'precio_unitario', r.precio_unitario,
                                      'total_leido', r.total, 'total_esperado', r.esperado,
                                      'razon', r.razon)
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 2) Descuadre de cabecera: suma de lineas frente a subtotal (o total).
  --    Se compara contra `subtotal` cuando existe, porque las lineas suelen ir
  --    sin el IVA prorrateado. Tolerancia = `toleranciaCabecera()` de
  --    procesar-factura/esquema.ts: 0,5 % con suelo de 0,50 € y techo de 15 €
  --    (suelo bajado de 2 € en 20261010160000_ocr_calidad_extraccion: el
  --    embalaje de 1,82, los portes de 1,60 y la RGA de 1,97 pasaban sin aviso).
  --    Las lineas a 0 € suman 0 (no se excluyen); las de total NULL no
  --    suman, y si eso abre un hueco, este bloque lo ve.
  ---------------------------------------------------------------------------
  v_ref := coalesce(f.subtotal, f.total);
  if v_suma is not null and v_ref is not null and v_ref <> 0 then
    v_tol := least(15.00, greatest(0.50, abs(v_ref) * 0.005));
    if abs(v_suma - v_ref) > v_tol then
      alertas := alertas || jsonb_build_object(
        'codigo',    'descuadre_cabecera',
        'severidad', 'media',
        'mensaje',   format('Las lineas suman %s pero el documento declara %s (%s %s €, tolerancia %s €). Revisa si falta alguna linea o si el OCR ha leido mal un importe.%s',
                            round(v_suma, 2), round(v_ref, 2),
                            case when v_suma < v_ref then 'faltan' else 'sobran' end,
                            round(abs(v_suma - v_ref), 2), round(v_tol, 2),
                            case
                              when v_n_cero > 0 and v_n_sin_total > 0 then
                                format(' Hay %s linea(s) a 0 € y %s sin importe: si alguna no es una bonificacion, puede ser lo que falta.', v_n_cero, v_n_sin_total)
                              when v_n_cero > 0 then
                                format(' Hay %s linea(s) a 0 €: si alguna no es una bonificacion, puede ser lo que falta.', v_n_cero)
                              when v_n_sin_total > 0 then
                                format(' Hay %s linea(s) sin importe.', v_n_sin_total)
                              else ''
                            end),
        'detalle',   jsonb_build_object('suma_lineas', round(v_suma, 2),
                                        'referencia', round(v_ref, 2),
                                        'campo_referencia', case when f.subtotal is not null then 'subtotal' else 'total' end,
                                        'diferencia', round(v_suma - v_ref, 2),
                                        'tolerancia', round(v_tol, 2),
                                        'num_lineas', v_n_lineas,
                                        'lineas_total_cero', v_n_cero,
                                        'lineas_sin_total', v_n_sin_total)
      );
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 3) IVA incoherente: subtotal + iva frente al total.
  --    Tolerancia del validador TS: un centimo por linea (el redondeo que de
  --    verdad se acumula), con suelo de 5 centimos.
  ---------------------------------------------------------------------------
  if f.subtotal is not null and f.iva is not null and f.total is not null then
    v_tol := greatest(0.05, greatest(v_n_lineas, 1) * 0.01);
    if abs((f.subtotal + f.iva - coalesce(f.retencion_irpf, 0)) - f.total) > v_tol then
      alertas := alertas || jsonb_build_object(
        'codigo',    'iva_incoherente',
        'severidad', 'media',
        'mensaje',   format('Subtotal (%s) + IVA (%s)%s = %s, que no coincide con el total leido (%s).',
                            f.subtotal, f.iva,
                            case when f.retencion_irpf is not null then format(' - retencion IRPF (%s)', f.retencion_irpf) else '' end,
                            round(f.subtotal + f.iva - coalesce(f.retencion_irpf, 0), 2), f.total),
        'detalle',   jsonb_build_object('subtotal', f.subtotal, 'iva', f.iva, 'total', f.total,
                                        'retencion_irpf', f.retencion_irpf,
                                        'esperado', round(f.subtotal + f.iva - coalesce(f.retencion_irpf, 0), 2),
                                        'diferencia', round((f.subtotal + f.iva - coalesce(f.retencion_irpf, 0)) - f.total, 2),
                                        'tolerancia', round(v_tol, 2))
      );
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 4) Precio unitario extremo en terminos absolutos.
  --    Es la red para un producto NUEVO, sin historico con el que comparar,
  --    leido a un precio imposible (miles de euros la unidad).
  ---------------------------------------------------------------------------
  for r in
    select pf.nombre, pf.precio_unitario, pf.cantidad, pf.unidad
    from productos_factura pf
    where pf.factura_id = p_factura_id
      and pf.precio_unitario is not null
      and pf.precio_unitario > 1000
    order by pf.precio_unitario desc
    limit 5
  loop
    alertas := alertas || jsonb_build_object(
      'codigo',    'precio_unitario_extremo',
      'severidad', 'alta',
      'mensaje',   format('Precio unitario muy alto: "%s" a %s €/%s. Comprueba que el OCR no haya desplazado los decimales.',
                          left(r.nombre, 60), r.precio_unitario, coalesce(r.unidad, 'ud')),
      'detalle',   jsonb_build_object('producto', r.nombre, 'precio_unitario', r.precio_unitario,
                                      'cantidad', r.cantidad, 'umbral', 1000)
    );
  end loop;

  ---------------------------------------------------------------------------
  -- 5) Total del documento desproporcionado (demasiado GRANDE).
  ---------------------------------------------------------------------------
  if f.total is not null and f.total > 25000 then
    alertas := alertas || jsonb_build_object(
      'codigo',    'total_documento_extremo',
      'severidad', 'alta',
      'mensaje',   format('El documento suma %s €, muy por encima de lo habitual. Revisa los importes antes de darlo por bueno.', f.total),
      'detalle',   jsonb_build_object('total', f.total, 'umbral', 25000)
    );
  end if;

  ---------------------------------------------------------------------------
  -- 5b) Total del documento sospechosamente PEQUEÑO. Se excluye el 0 exacto:
  --     un documento enteramente bonificado declara total 0 de forma legitima.
  ---------------------------------------------------------------------------
  if f.total is not null and f.total > 0 and f.total < 3 then
    alertas := alertas || jsonb_build_object(
      'codigo',    'total_documento_irrisorio',
      'severidad', 'alta',
      'mensaje',   format('El documento suma solo %s €, muy por debajo de lo habitual para un proveedor. Comprueba que el OCR no haya desplazado los decimales o perdido una cifra (p. ej. un importe real de %s € leido como %s €).', f.total, f.total * 1000, f.total),
      'detalle',   jsonb_build_object('total', f.total, 'umbral', 3)
    );
  end if;

  ---------------------------------------------------------------------------
  -- 6) Precio atipico frente al historico del MISMO producto en OTROS
  --    documentos. Exige al menos 2 observaciones previas para no disparar por
  --    una sola compra anterior. Simetrico (barato Y caro).
  ---------------------------------------------------------------------------
  for r in
    select pf.nombre, pf.precio_unitario, h.media, h.n
    from productos_factura pf
    join lateral (
      select avg(pf2.precio_unitario) as media, count(*) as n
      from productos_factura pf2
      where pf2.factura_id <> p_factura_id
        and pf2.precio_unitario is not null
        and pf2.precio_unitario > 0
        and pf2.nombre_normalizado = pf.nombre_normalizado
    ) h on true
    where pf.factura_id = p_factura_id
      and pf.precio_unitario is not null
      and pf.precio_unitario > 0
      and h.n >= 2
      and (pf.precio_unitario >= h.media * 5 or pf.precio_unitario <= h.media / 5)
    order by abs(pf.precio_unitario - h.media) desc
    limit 5
  loop
    alertas := alertas || jsonb_build_object(
      'codigo',    'precio_atipico_historico',
      'severidad', 'alta',
      'mensaje',   format('"%s" a %s €, cuando el precio medio historico de este producto es %s € (%s compras previas).',
                          left(r.nombre, 60), r.precio_unitario, round(r.media, 4), r.n),
      'detalle',   jsonb_build_object('producto', r.nombre, 'precio_unitario', r.precio_unitario,
                                      'precio_medio_historico', round(r.media, 4), 'observaciones', r.n)
    );
  end loop;

  ---------------------------------------------------------------------------
  -- CIF del documento que no supera
  -- el dígito de control. Si la ficha del proveedor tiene uno válido a ≤ 2
  -- caracteres, se dice cuál se ha usado; si no, que hay que mirarlo.
  ---------------------------------------------------------------------------
  v_cif_doc := normalizar_cif(f.cif);
  if v_cif_doc is not null and not cif_control_valido(v_cif_doc) then
    select p.cif_normalizado into v_cif_ficha from proveedores p where p.id = f.proveedor_id;
    if v_cif_ficha is not null and cif_control_valido(v_cif_ficha)
       and cif_distancia(v_cif_ficha, v_cif_doc) <= 2 then
      alertas := alertas || jsonb_build_object(
        'codigo',    'cif_corregido',
        'severidad', 'media',
        'mensaje',   format('CIF leído %s, corregido a %s: el leído no supera el dígito de control y el de la ficha del proveedor sí.',
                            v_cif_doc, v_cif_ficha),
        'detalle',   jsonb_build_object('cif_leido', v_cif_doc, 'cif_ficha', v_cif_ficha, 'proveedor_id', f.proveedor_id));
    else
      alertas := alertas || jsonb_build_object(
        'codigo',    'cif_invalido',
        'severidad', 'media',
        'mensaje',   format('El CIF leído %s no supera el dígito de control: compruébalo en el papel (suele ser un dígito mal leído o dos traspuestos).',
                            v_cif_doc),
        'detalle',   jsonb_build_object('cif_leido', v_cif_doc, 'cif_ficha', v_cif_ficha, 'proveedor_id', f.proveedor_id));
    end if;
  end if;

  return alertas;
end;
$$;

create or replace function public.factura_cumple_autoverificacion(p_factura_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select exists (
    select 1
      from public.facturas f
     where f.id = p_factura_id
       and (f.alertas_validacion is null
            or (jsonb_typeof(f.alertas_validacion) = 'array' and jsonb_array_length(f.alertas_validacion) = 0))
       and f.total is not null
       and f.subtotal is not null
       and f.proveedor_id is not null
       -- proveedor conocido: algún documento anterior suyo
       and exists (select 1 from public.facturas p
                    where p.proveedor_id = f.proveedor_id and p.id < f.id)
       -- no duplicado
       and not exists (
         select 1 from public.facturas d
          where d.id <> f.id
            and d.proveedor_id = f.proveedor_id
            and (
              (coalesce(f.numero_documento, '') <> ''
               and upper(regexp_replace(d.numero_documento, '[^A-Za-z0-9]', '', 'g'))
                 = upper(regexp_replace(f.numero_documento, '[^A-Za-z0-9]', '', 'g')))
              or (d.fecha = f.fecha and d.total = f.total)
            )
       )
  );
$$;

create or replace function public.facturas_autoverificar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_sql      jsonb;
  v_previas  jsonb;
  v_alertas  jsonb;
  v_codigos_sql constant text[] := array[
    'descuadre_cabecera', 'descuadre_linea', 'iva_incoherente',
    'precio_atipico_historico', 'precio_unitario_extremo',
    'subtotal_ausente', 'total_ausente',
    'total_documento_extremo', 'total_documento_irrisorio'];
  v_ok       boolean;
begin
  -- Las escrituras que hace este propio trigger no vuelven a evaluarse.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Una persona ha cambiado importes: las alertas guardadas ya no valen.
  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.iva is distinct from old.iva then
    v_sql := coalesce(public.validar_cordura_factura(new.id), '[]'::jsonb);
    select coalesce(jsonb_agg(a), '[]'::jsonb) into v_previas
      from jsonb_array_elements(
             case when jsonb_typeof(new.alertas_validacion) = 'array'
                  then new.alertas_validacion else '[]'::jsonb end) a
     where not ((a->>'codigo') = any (v_codigos_sql));
    v_alertas := v_sql || v_previas;
    update public.facturas
       set alertas_validacion = case when jsonb_array_length(v_alertas) > 0 then v_alertas end
     where id = new.id;
  end if;

  -- Si en este mismo UPDATE una persona ha tocado la verificación, manda ella.
  if new.verificada is distinct from old.verificada then
    return null;
  end if;

  v_ok := public.factura_cumple_autoverificacion(new.id);

  if not coalesce(new.verificada, false) and v_ok then
    update public.facturas
       set verificada = true, verificacion_origen = 'auto'
     where id = new.id;
  elsif new.verificacion_origen = 'auto' and not v_ok then
    update public.facturas
       set verificada = false, verificacion_origen = null
     where id = new.id;
  end if;

  return null;
end;
$$;

create or replace function public.proveedor_resolver(p_nombre text, p_cif text, p_crear boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
--  · un CIF que no supera el dígito de control casa con la ficha cuyo CIF
--    está a ≤ 2 caracteres (B08605246 ~ B06805246); dos CIF VÁLIDOS distintos
--    nunca se casan (son dos empresas). Si la lectura es válida y la ficha no,
--    la ficha se corrige y el CIF viejo queda como alias;
--  · por nombre, además del alias exacto, la clave proveedor_clave (sin
--    «S.R.L.», «S. Coop. V.L.», puntos, tildes ni orden de palabras);
--  · nunca se crea una ficha con un CIF que no supera el control (se crea
--    sin CIF).
declare
  v_base      text := nullif(public.normalizar_proveedor_base(coalesce(p_nombre, '')), '');
  v_clave     text := public.proveedor_clave(p_nombre);
  v_cif       text := public.normalizar_cif(p_cif);
  v_cif_ok    boolean;
  v_nombre    text := left(btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')), 255);
  v_id        bigint;
  v_cif_ficha text;
begin
  if public.proveedor_es_cliente(v_base, null) then
    return null;                       -- el cliente no es proveedor
  end if;
  if public.proveedor_es_cliente(null, v_cif) then
    v_cif := null;                     -- el CIF del cliente no identifica al proveedor
  end if;
  v_cif_ok := public.cif_control_valido(v_cif);

  -- 1) CIF exacto (ficha o alias de CIF).
  if v_cif is not null then
    select id into v_id from public.proveedores where cif_normalizado = v_cif;
    if v_id is null then
      select proveedor_id into v_id from public.proveedores_alias where cif_normalizado = v_cif;
    end if;
  end if;

  -- 2) CIF a ≤ 2 caracteres, si uno de los dos no supera el control.
  if v_id is null and v_cif is not null then
    select p.id, p.cif_normalizado into v_id, v_cif_ficha
      from public.proveedores p
     where p.cif_normalizado is not null
       and abs(length(p.cif_normalizado) - length(v_cif)) <= 2
       and public.cif_distancia(p.cif_normalizado, v_cif) <= 2
       and not (v_cif_ok and public.cif_control_valido(p.cif_normalizado))
     order by (v_clave is not null and public.proveedor_clave(p.nombre) = v_clave) desc,
              public.cif_control_valido(p.cif_normalizado) desc,
              public.cif_distancia(p.cif_normalizado, v_cif),
              (select count(*) from public.facturas f where f.proveedor_id = p.id) desc,
              p.id
     limit 1;
    if v_id is not null and p_crear and v_cif_ok and not public.cif_control_valido(v_cif_ficha) then
      update public.proveedores set cif = v_cif where id = v_id;
      insert into public.proveedores_alias (proveedor_id, cif_normalizado, texto_original, origen)
      values (v_id, v_cif_ficha, 'CIF mal leído (corregido a ' || v_cif || ')', 'automatico')
      on conflict do nothing;
    end if;
  end if;

  if v_id is not null and p_crear and v_base is not null then
    insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
    values (v_id, v_base, v_nombre, 'automatico')
    on conflict do nothing;
  end if;

  -- 3) Por nombre: alias exacto y, si no, la clave.
  if v_id is null and v_base is not null then
    select proveedor_id into v_id from public.proveedores_alias where alias_normalizado = v_base;
    if v_id is null and v_clave is not null then
      select p.id into v_id
        from public.proveedores p
       where public.proveedor_clave(p.nombre) = v_clave
          or public.proveedor_clave(p.nombre_comercial) = v_clave
          or exists (select 1 from public.proveedores_alias a
                      where a.proveedor_id = p.id and public.proveedor_clave(a.texto_original) = v_clave)
       order by (select count(*) from public.facturas f where f.proveedor_id = p.id) desc, p.id
       limit 1;
      if v_id is not null and p_crear then
        insert into public.proveedores_alias (proveedor_id, alias_normalizado, texto_original, origen)
        values (v_id, v_base, v_nombre, 'automatico')
        on conflict do nothing;
      end if;
    end if;
    -- Una lectura VÁLIDA completa la ficha sin CIF o corrige una con CIF que
    -- no supera el control (el viejo queda como alias).
    if v_id is not null and p_crear and v_cif_ok
       and not exists (select 1 from public.proveedores_alias where cif_normalizado = v_cif)
       and not exists (select 1 from public.proveedores where cif_normalizado = v_cif) then
      select cif_normalizado into v_cif_ficha from public.proveedores where id = v_id;
      if v_cif_ficha is null or not public.cif_control_valido(v_cif_ficha) then
        update public.proveedores set cif = v_cif where id = v_id;
        if v_cif_ficha is not null then
          insert into public.proveedores_alias (proveedor_id, cif_normalizado, texto_original, origen)
          values (v_id, v_cif_ficha, 'CIF mal leído (corregido a ' || v_cif || ')', 'automatico')
          on conflict do nothing;
        end if;
      end if;
    end if;
  end if;

  -- 4) Ficha nueva, con CIF solo si supera el control.
  if v_id is null and p_crear and v_base is not null then
    insert into public.proveedores (nombre, cif, origen)
    values (v_nombre, case when v_cif_ok then v_cif end, 'automatico')
    on conflict do nothing
    returning id into v_id;
    if v_id is null then               -- otro lo acaba de crear, o ya había uno con ese nombre exacto
      select proveedor_id into v_id from public.proveedores_alias where alias_normalizado = v_base;
      if v_id is null then
        select id into v_id from public.proveedores where nombre = v_nombre;
      end if;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.proveedores_editar(p_id bigint, p_nombre text, p_nombre_comercial text DEFAULT NULL::text, p_cif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_com    text := nullif(btrim(regexp_replace(coalesce(p_nombre_comercial, ''), '\s+', ' ', 'g')), '');
  v_cif    text := public.normalizar_cif(p_cif);
  v_otro   bigint;
  v_fila   public.proveedores%rowtype;
begin
  if not public.proveedores_puede_editar() then
    raise exception 'Cambiar proveedores exige permiso de edición en Facturas' using errcode = '42501';
  end if;
  perform 1 from public.proveedores where id = p_id for update;
  if not found then
    raise exception 'No existe el proveedor %', p_id using errcode = 'P0002';
  end if;
  if coalesce(public.normalizar_proveedor_base(v_nombre), '') = '' or length(v_nombre) > 255 then
    raise exception 'Escribe un nombre de proveedor (máximo 255 caracteres)' using errcode = '22023';
  end if;
  if v_com is not null and length(v_com) > 120 then
    raise exception 'El nombre comercial no puede pasar de 120 caracteres' using errcode = '22023';
  end if;
  if public.proveedor_es_cliente(public.normalizar_proveedor_base(v_nombre), v_cif) then
    raise exception 'Ese nombre o CIF es el de la propia Cristalería Baix Vinalopó: no puede ser un proveedor' using errcode = '22023';
  end if;
  if v_cif is not null then
    if length(v_cif) > 20 then
      raise exception 'El CIF no parece válido: %', v_cif using errcode = '22023';
    end if;
    select id into v_otro from public.proveedores where cif_normalizado = v_cif and id <> p_id;
    if v_otro is null then
      select proveedor_id into v_otro from public.proveedores_alias where cif_normalizado = v_cif and proveedor_id <> p_id;
    end if;
    if v_otro is not null then
      raise exception 'El CIF % ya es de otro proveedor (id %): fusiónalos', v_cif, v_otro using errcode = '23505';
    end if;
    delete from public.proveedores_alias where proveedor_id = p_id and cif_normalizado = v_cif;
  end if;
  select id into v_otro from public.proveedores where nombre = v_nombre and id <> p_id;
  if v_otro is not null then
    raise exception 'Ya hay otro proveedor que se llama «%» (id %): fusiónalos', v_nombre, v_otro using errcode = '23505';
  end if;

  update public.proveedores
     set nombre = v_nombre, nombre_comercial = v_com, cif = v_cif, origen = 'manual'
   where id = p_id
  returning * into v_fila;
  return jsonb_build_object('id', v_fila.id, 'nombre', v_fila.nombre, 'nombre_comercial', v_fila.nombre_comercial,
                            'cif', v_fila.cif_normalizado, 'nombre_normalizado', v_fila.nombre_normalizado);
end;
$$;

create or replace function public.ocr_factura_existente(p_numero text, p_proveedor text, p_cif text, p_fecha date, p_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- número normalizado + MISMO proveedor
-- (proveedor_id resuelto sin crear nada, o CIF normalizado que no sea el de
-- la propia empresa) o, si no hay proveedor, mismo total y fecha. Devuelve además lo
-- que hace falta para no ofrecer «Sustituir» entre páginas distintas.
declare
  v_num text := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  v_cif text := public.normalizar_cif(p_cif);
  v_pid bigint;
  v_sin_proveedor boolean;
  v_id bigint;
  v_motivo text;
begin
  if public.proveedor_es_cliente(null, v_cif) then
    v_cif := null;                     -- el CIF del cliente no identifica al proveedor
  end if;
  v_pid := public.proveedor_resolver(p_proveedor, v_cif, false);
  v_sin_proveedor := v_pid is null and v_cif is null and btrim(coalesce(p_proveedor, '')) = '';

  if v_num <> '' then
    select fa.id into v_id
      from public.facturas fa
     where upper(regexp_replace(coalesce(fa.numero_documento, ''), '[^A-Za-z0-9]', '', 'g')) = v_num
       and ((v_pid is not null and fa.proveedor_id = v_pid)
            or (v_cif is not null and public.normalizar_cif(fa.cif) = v_cif)
            or ((v_sin_proveedor or fa.proveedor_id is null)
                and fa.fecha is not distinct from p_fecha
                and fa.total is not null and p_total is not null and abs(fa.total - p_total) < 0.01))
     order by (fa.proveedor_id is not distinct from v_pid) desc, fa.id
     limit 1;
    v_motivo := 'numero_proveedor';
  end if;

  -- Sin número coincidente: mismo proveedor + fecha + total (≠ 0).
  if v_id is null and coalesce(p_total, 0) <> 0 and p_fecha is not null and (v_pid is not null or v_cif is not null) then
    select fa.id into v_id
      from public.facturas fa
     where fa.fecha = p_fecha
       and abs(fa.total - p_total) < 0.01
       and ((v_pid is not null and fa.proveedor_id = v_pid)
            or (v_cif is not null and public.normalizar_cif(fa.cif) = v_cif))
     order by fa.id
     limit 1;
    v_motivo := 'datos_coincidentes';
  end if;

  if v_id is null then
    return null;
  end if;
  return public.ocr_resumen_factura_datos(v_id) || jsonb_build_object('motivo', v_motivo);
end;
$$;

create or replace function public.ocr_resumen_factura_datos(p_factura_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select jsonb_build_object(
    'id', fa.id, 'numero_documento', fa.numero_documento, 'proveedor', fa.proveedor,
    'proveedor_id', fa.proveedor_id, 'cif', fa.cif,
    'fecha', fa.fecha, 'total', fa.total, 'total_origen', fa.total_origen,
    'lineas', (select count(*) from public.productos_factura p where p.factura_id = fa.id),
    'alertas', coalesce(jsonb_array_length(case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion end), 0),
    'alertas_graves', (select count(*) from jsonb_array_elements(
                         case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end) a
                        where a->>'severidad' = 'alta'),
    'archivo_path', fa.archivo_path, 'paginas', fa.paginas,
    'updated_at', fa.updated_at, 'created_at', fa.created_at,
    'paginas_lineas', coalesce((select jsonb_agg(distinct p.pagina order by p.pagina)
                                  from public.productos_factura p
                                 where p.factura_id = fa.id and p.pagina is not null), '[]'::jsonb),
    'totales_lineas', coalesce((select jsonb_agg(x.total order by x.pagina, x.orden, x.id)
                                  from (select p.total, p.pagina, p.orden, p.id from public.productos_factura p
                                         where p.factura_id = fa.id order by p.pagina, p.orden, p.id limit 500) x), '[]'::jsonb),
    'trabajo_pendiente', exists (select 1 from public.ocr_trabajos t
                                  where t.id = fa.ocr_trabajo_id
                                    and t.estado not in ('completado', 'duplicado', 'fallido', 'cancelado'))
  )
  from public.facturas fa
  where fa.id = p_factura_id
$$;

create or replace function public.ocr_sustituir_factura(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- Sustituye EN SITIO (mismo id) la factura duplicada por el documento nuevo ya leído.
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_insertadas integer;
  v_sust_id bigint;
begin
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'SUSTITUCIÓN ABORTADA: el trabajo % está «%», no «duplicado».', p_trabajo_id, t.estado;
  end if;
  if jsonb_typeof(t.documento_pendiente->'pagina') = 'object' then
    raise exception 'SUSTITUCIÓN ABORTADA: el documento nuevo es la página % de % de la factura %: se añade como página, no se sustituye.',
      t.documento_pendiente->'pagina'->>'actual', t.documento_pendiente->'pagina'->>'total', p_factura_id;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*) into v_lineas_antes from public.productos_factura where factura_id = p_factura_id;
  if v_lineas_antes = 0 then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % no tiene líneas (puede que aún se esté guardando). Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamptz then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'SUSTITUCIÓN ABORTADA: p_lineas no es una lista';
  end if;
  if coalesce(p_cabecera->>'numero_documento', '') = '' then
    raise exception 'SUSTITUCIÓN ABORTADA: la cabecera nueva no trae número de documento';
  end if;

  -- 1. Copia de auditoría.
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    jsonb_build_object('total', fa.total, 'lineas', v_lineas_antes, 'alertas', fa.alertas_validacion,
                       'esperado', p_esperado))
  returning id into v_sust_id;

  -- 2. Líneas viejas.
  delete from public.productos_factura where factura_id = p_factura_id;

  -- 3. Cabecera nueva, mismo id (antes que las líneas: los avisos de precio leen proveedor y fecha).
  update public.facturas
     set proveedor = p_cabecera->>'proveedor',
         cif = p_cabecera->>'cif',
         numero_documento = p_cabecera->>'numero_documento',
         fecha = (p_cabecera->>'fecha')::date,
         subtotal = (p_cabecera->>'subtotal')::numeric,
         iva = (p_cabecera->>'iva')::numeric,
         total = (p_cabecera->>'total')::numeric,
         total_origen = p_cabecera->>'total_origen',
         retencion_irpf = nullif((p_cabecera->>'retencion_irpf')::numeric, 0),
         retencion_irpf_pct = case when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                   then (p_cabecera->>'retencion_irpf_pct')::numeric end,
         observaciones = p_cabecera->>'observaciones',
         alertas_validacion = null,
         verificada = false,
         procesado_en = now(),
         paginas = coalesce((p_cabecera->>'paginas')::smallint, 1),
         ocr_trabajo_id = p_trabajo_id,
         archivo_path = coalesce(p_archivo_path, archivo_path)
   where id = p_factura_id;

  -- 4. Líneas nuevas.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, pagina, orden, bultos, iva_pct)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         coalesce((l->>'pagina')::smallint, 1),
         coalesce((l->>'orden')::int, (ord - 1)::int),
         (l->>'bultos')::numeric,
         (l->>'iva_pct')::numeric
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;

  -- 5. Trabajo cerrado.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', p_cabecera->'total', 'lineas', v_insertadas)
   where id = v_sust_id;

  return jsonb_build_object('factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
                            'lineas_antes', v_lineas_antes, 'lineas', v_insertadas);
end;
$$;

create or replace function public.ocr_anadir_pagina(p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_pagina integer, p_paginas_total integer, p_cabecera jsonb, p_lineas jsonb, p_esperado jsonb, p_archivo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
-- AÑADE el documento nuevo como otra página de una factura que ya existe (sin borrar nada).
-- La retención IRPF sigue al pie impreso, como el total.
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_orden integer;
  v_insertadas integer;
  v_sust_id bigint;
  v_total numeric := (p_cabecera->>'total')::numeric;
  v_origen text := nullif(p_cabecera->>'total_origen', '');
  v_impreso boolean;
  v_existente_impreso boolean;
  v_usar_nuevo boolean;
  v_sumar boolean;
  fb public.facturas%rowtype;
begin
  if p_pagina is null or p_paginas_total is null or p_paginas_total < 2 or p_paginas_total > 20
     or p_pagina < 1 or p_pagina > p_paginas_total then
    raise exception 'AÑADIDO ABORTADO: página % de % no válida', p_pagina, p_paginas_total;
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'AÑADIDO ABORTADO: ese documento ya no está pendiente (está «%»).', t.estado;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'AÑADIDO ABORTADO: no existe la factura %', p_factura_id; end if;
  if exists (select 1 from public.ocr_trabajos tx
              where tx.id = fa.ocr_trabajo_id and tx.estado not in ('completado', 'duplicado', 'fallido', 'cancelado')) then
    raise exception 'AÑADIDO ABORTADO: la factura % aún se está leyendo o guardando. Espera a que termine, revisa y confirma de nuevo.', p_factura_id;
  end if;

  select count(*), coalesce(max(orden), -1) into v_lineas_antes, v_orden
    from public.productos_factura where factura_id = p_factura_id;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste (ahora tiene % líneas; tú viste %). Revisa y confirma de nuevo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamptz then
    raise exception 'AÑADIDO ABORTADO: la factura % ha cambiado desde que la viste. Revisa y confirma de nuevo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'AÑADIDO ABORTADO: p_lineas no es una lista';
  end if;

  -- 1. Copia de auditoría (las líneas de antes no se tocan, pero la cabecera sí).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    jsonb_build_object('operacion', 'anadir_pagina', 'pagina', p_pagina, 'paginas_total', p_paginas_total,
                       'total', fa.total, 'total_origen', fa.total_origen, 'lineas', v_lineas_antes,
                       'alertas', fa.alertas_validacion, 'esperado', p_esperado, 'archivo_pagina', p_archivo_path))
  returning id into v_sust_id;

  -- 2. Cabecera. El pie IMPRESO manda: el de la página nueva si la existente
  --    no lo tiene o si la nueva es la última; dos totales deducidos se suman
  --    (cada uno es la suma de sus líneas); sin total en la existente, el nuevo.
  v_impreso := v_total is not null and coalesce(v_origen, '') <> 'deducido';
  v_existente_impreso := fa.total is not null and coalesce(fa.total_origen, '') <> 'deducido';
  v_usar_nuevo := v_total is not null
                  and (fa.total is null or (v_impreso and (not v_existente_impreso or p_pagina = p_paginas_total)));
  v_sumar := not v_usar_nuevo and v_total is not null and not v_impreso and not v_existente_impreso;
  update public.facturas
     set subtotal = case when v_usar_nuevo then (p_cabecera->>'subtotal')::numeric
                         when v_sumar and (subtotal is not null or p_cabecera->>'subtotal' is not null)
                           then coalesce(subtotal, 0) + coalesce((p_cabecera->>'subtotal')::numeric, 0)
                         else subtotal end,
         iva = case when v_usar_nuevo then (p_cabecera->>'iva')::numeric
                    when v_sumar and (iva is not null or p_cabecera->>'iva' is not null)
                      then coalesce(iva, 0) + coalesce((p_cabecera->>'iva')::numeric, 0)
                    else iva end,
         total = case when v_usar_nuevo then v_total when v_sumar then total + v_total else total end,
         total_origen = case when v_usar_nuevo then v_origen when v_sumar then 'deducido' else total_origen end,
         retencion_irpf = case when v_usar_nuevo and p_cabecera ? 'retencion_irpf'
                                 then nullif((p_cabecera->>'retencion_irpf')::numeric, 0)
                               else coalesce(retencion_irpf, nullif((p_cabecera->>'retencion_irpf')::numeric, 0)) end,
         retencion_irpf_pct = case when v_usar_nuevo and p_cabecera ? 'retencion_irpf'
                                     then case when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                               then (p_cabecera->>'retencion_irpf_pct')::numeric end
                                   when retencion_irpf is not null then retencion_irpf_pct
                                   when nullif((p_cabecera->>'retencion_irpf')::numeric, 0) is not null
                                     then (p_cabecera->>'retencion_irpf_pct')::numeric
                                   else retencion_irpf_pct end,
         fecha = coalesce(fecha, (p_cabecera->>'fecha')::date),
         cif = coalesce(nullif(cif, ''), p_cabecera->>'cif'),
         proveedor = coalesce(nullif(proveedor, ''), p_cabecera->>'proveedor'),
         paginas = greatest(coalesce(paginas, 1), p_paginas_total)::smallint,
         archivo_path = coalesce(archivo_path, p_archivo_path),
         verificada = false,
         procesado_en = now()
   where id = p_factura_id;

  -- 3. Líneas de la página, a continuación de las que ya hay.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, pagina, orden, bultos, iva_pct)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         p_pagina::smallint,
         v_orden + ord::int,
         (l->>'bultos')::numeric,
         (l->>'iva_pct')::numeric
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;

  -- 4. Trabajo cerrado: su documento ya está dentro de la factura.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  select * into fb from public.facturas where id = p_factura_id;
  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', fb.total, 'total_origen', fb.total_origen,
                                              'lineas', v_lineas_antes + v_insertadas, 'lineas_anadidas', v_insertadas)
   where id = v_sust_id;

  return jsonb_build_object(
    'factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
    'lineas_antes', v_lineas_antes, 'lineas_anadidas', v_insertadas, 'lineas', v_lineas_antes + v_insertadas,
    'total', fb.total, 'total_origen', fb.total_origen, 'paginas', fb.paginas,
    'paginas_lineas', coalesce((select jsonb_agg(distinct p.pagina order by p.pagina)
                                  from public.productos_factura p
                                 where p.factura_id = p_factura_id and p.pagina is not null), '[]'::jsonb),
    'alertas_antes', case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end);
end;
$$;

-- ─── Compras: listas y fichas del panel ─────────────────────────────────────
create or replace function public.productos_resumen(p_desde date default null, p_hasta date default null)
returns table(producto_id bigint, nombre text, categoria_id bigint, origen text, unidad_habitual text, compras integer,
              documentos integer, cantidades jsonb, gasto numeric, lineas_sin_importe integer, ultimo_precio numeric,
              ultima_fecha date, proveedores text[])
language sql stable set search_path = public
as $$
  with l as (
    select pf.id, pf.producto_id, pf.factura_id, pf.cantidad, coalesce(nullif(btrim(pf.unidad), ''), '') as unidad,
           pf.total, pf.precio_unitario, f.fecha, f.proveedor
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
       and (p_desde is null or f.fecha >= p_desde)
       and (p_hasta is null or f.fecha <= p_hasta)
  ),
  cant as (
    select x.producto_id, jsonb_object_agg(x.unidad, x.suma order by x.unidad) as c
      from (select producto_id, unidad, round(sum(cantidad), 3) as suma from l group by producto_id, unidad) as x
     group by x.producto_id
  ),
  ult as (
    select distinct on (producto_id) producto_id, precio_unitario, fecha
      from l where precio_unitario is not null
     order by producto_id, fecha desc nulls last, id desc
  )
  select p.id, p.nombre, p.categoria_id, p.origen, p.unidad_habitual,
         count(l.id)::integer,
         count(distinct l.factura_id)::integer,
         coalesce(cant.c, '{}'::jsonb),
         round(coalesce(sum(l.total), 0), 2),
         (count(l.id) filter (where l.total is null))::integer,
         ult.precio_unitario,
         max(l.fecha),
         coalesce(array_agg(distinct l.proveedor) filter (where l.proveedor is not null), '{}'::text[])
    from public.productos_catalogo p
    left join l    on l.producto_id = p.id
    left join cant on cant.producto_id = p.id
    left join ult  on ult.producto_id = p.id
   group by p.id, cant.c, ult.precio_unitario
   order by round(coalesce(sum(l.total), 0), 2) desc, p.nombre;
$$;

create or replace function public.productos_gasto_por_categoria(p_desde date default null, p_hasta date default null)
returns table(categoria_id bigint, categoria text, padre_id bigint, padre text, sin_clasificar boolean, gasto numeric,
              lineas integer, productos integer, lineas_sin_importe integer)
language sql stable set search_path = public
as $$
  select c.id,
         coalesce(c.nombre, case when pf.producto_id is null then 'Sin clasificar' else 'Sin categoría' end),
         c.padre_id,
         pc.nombre,
         pf.producto_id is null,
         round(coalesce(sum(pf.total), 0), 2),
         count(*)::integer,
         count(distinct pf.producto_id)::integer,
         (count(*) filter (where pf.total is null))::integer
    from public.productos_factura pf
    join public.facturas f on f.id = pf.factura_id
    left join public.productos_catalogo p   on p.id = pf.producto_id
    left join public.categorias_producto c  on c.id = p.categoria_id
    left join public.categorias_producto pc on pc.id = c.padre_id
   where (p_desde is null or f.fecha >= p_desde)
     and (p_hasta is null or f.fecha <= p_hasta)
   group by c.id, c.nombre, c.padre_id, pc.nombre, pf.producto_id is null
   order by round(coalesce(sum(pf.total), 0), 2) desc;
$$;

create or replace function public.proveedores_listado()
returns table(id bigint, nombre text, nombre_comercial text, cif text, activo boolean, origen text, documentos integer,
              total numeric, ultima_fecha date, variantes text[], alias text[], cifs_extra text[])
language sql stable set search_path = public
as $$
  select p.id, p.nombre::text, p.nombre_comercial, p.cif_normalizado, coalesce(p.activo, true), p.origen,
         coalesce(d.documentos, 0), coalesce(d.total, 0), d.ultima_fecha,
         coalesce(d.variantes, '{}'::text[]), coalesce(a.alias, '{}'::text[]), coalesce(a.cifs, '{}'::text[])
    from public.proveedores p
    left join lateral (
      select count(*)::int as documentos,
             sum(f.total)  as total,
             max(f.fecha)  as ultima_fecha,
             array_agg(distinct f.proveedor::text) filter (where f.proveedor is not null) as variantes
        from public.facturas f
       where f.proveedor_id = p.id) d on true
    left join lateral (
      select array_agg(x.alias_normalizado order by x.alias_normalizado) filter (where x.alias_normalizado is not null) as alias,
             array_agg(x.cif_normalizado order by x.cif_normalizado) filter (where x.cif_normalizado is not null)         as cifs
        from public.proveedores_alias x
       where x.proveedor_id = p.id) a on true
   order by lower(p.nombre::text)
$$;

-- Meses con muchos menos documentos que lo normal (mediana de los últimos 12): o se empezó a subir a medias o
-- faltan facturas por subir. «reciente» = de los dos últimos meses; «inicio» = los primeros meses con datos.
create or replace function public.meses_compras_incompletos()
returns table(mes date, documentos integer, referencia numeric, motivo text)
language sql stable set search_path = public
as $$
  with d as (
    select date_trunc('month', f.fecha)::date as mes, count(*)::int as n
      from public.facturas f
     where f.fecha is not null
     group by 1
  ),
  ref as (
    select percentile_cont(0.5) within group (order by r.n) as mediana, count(*) as meses
      from (select d.n from d order by d.mes desc limit 12) r
  ),
  lim as (
    select (date_trunc('month', greatest(current_date, (select max(d.mes) from d))) - interval '2 months')::date as desde_ult
  ),
  marc as (
    select d.mes, d.n, ref.mediana, d.n < 0.4 * ref.mediana as bajo
      from d cross join ref
     where ref.meses >= 3
  )
  select m.mes, m.n, round(m.mediana::numeric, 1),
         case when m.mes >= (select desde_ult from lim) then 'reciente' else 'inicio' end
    from marc m
   where m.bajo
     and (m.mes >= (select desde_ult from lim)
          or not exists (select 1 from marc x where x.mes < m.mes and not x.bajo))
   order by m.mes
$$;

-- La lista de Compras en UNA petición: solo cabeceras (las líneas llegan al abrir la ficha). Cada documento es un
-- array posicional (pesa la mitad que un objeto):
--   [0] id, [1] numero_documento, [2] proveedor, [3] proveedor_id, [4] cif, [5] fecha, [6] subtotal, [7] total,
--   [8] total_origen, [9] archivo_path, [10] verificada, [11] verificacion_origen, [12] nº de líneas,
--   [13] alertas [[codigo, severidad]…], [14] regalado [importe, estimado, nº de regalos], [15] precio atípico,
--   [16] retencion_irpf.
create or replace function public.documentos_lista()
returns json language sql stable set search_path = public
as $$
  with lineas as (
    select pf.factura_id,
           pf.importe_bruto,
           pf.importe_bruto_estimado,
           -- Solo pf.total: una línea sin importe leído no es «regalado».
           pf.importe_bruto - pf.total as diferencia,
           pf.total as importe
      from public.productos_factura pf
  ),
  por_doc as (
    select factura_id,
           count(*) as n,
           sum(diferencia) filter (where diferencia > 0.005) as regalado,
           coalesce(bool_or(importe_bruto_estimado) filter (where diferencia > 0.005), false) as estimado,
           count(*) filter (where diferencia > 0.005 and importe_bruto > 0.005 and abs(importe) < 0.005) as regalos
      from lineas
     group by factura_id
  ),
  precios as (
    select pf.factura_id, f.proveedor_normalizado as prov, pf.nombre_busqueda as nom, pf.precio_unitario as p
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
     where coalesce(f.proveedor_normalizado, '') <> ''
       and pf.precio_unitario > 0
  ),
  medias as (
    select prov, nom, sum(p) as suma, count(*) as n
      from precios
     group by prov, nom
    having count(*) > 1
  ),
  candidatos as materialized (
    -- Más del doble de la media de ese producto en ese proveedor (sin contar esta línea).
    select pr.factura_id, pr.nom
      from precios pr
      join medias m using (prov, nom)
     where pr.p > 2 * (m.suma - pr.p) / (m.n - 1)
  ),
  atipicos as (
    -- Los portes y cargos no cuentan (se mira solo en los pocos candidatos).
    select distinct c.factura_id from candidatos c where not public.es_servicio_compras(c.nom)
  )
  select json_build_object(
    'v', 1,
    'meses_incompletos', coalesce((
      select json_agg(json_build_object('mes', to_char(i.mes, 'YYYY-MM'), 'documentos', i.documentos,
                                        'referencia', i.referencia, 'motivo', i.motivo) order by i.mes)
        from public.meses_compras_incompletos() i
    ), '[]'::json),
    'proveedores', coalesce((
      select json_object_agg(p.id, p.nombre)
        from public.proveedores p
       where p.id in (select f.proveedor_id from public.facturas f where f.proveedor_id is not null)
    ), '{}'::json),
    'docs', coalesce((
      select json_agg(json_build_array(
               f.id, f.numero_documento, f.proveedor, f.proveedor_id, f.cif,
               f.fecha, f.subtotal, f.total,
               f.total_origen, f.archivo_path, coalesce(f.verificada, false), f.verificacion_origen,
               coalesce(d.n, 0),
               case when jsonb_typeof(f.alertas_validacion) = 'array' and jsonb_array_length(f.alertas_validacion) > 0 then
                 (select json_agg(json_build_array(a ->> 'codigo', a ->> 'severidad'))
                    from jsonb_array_elements(f.alertas_validacion) a)
               end,
               case when d.regalado > 0 then json_build_array(round(d.regalado, 2), d.estimado, d.regalos) end,
               a.factura_id is not null,
               f.retencion_irpf
             ) order by f.fecha desc nulls last, f.id desc)
        from public.facturas f
        left join por_doc d on d.factura_id = f.id
        left join atipicos a on a.factura_id = f.id
    ), '[]'::json)
  )
$$;

-- Ficha de un documento: cabecera, líneas con su producto y categoría, y la media de cada línea en ese proveedor.
create or replace function public.documento_compras(p_id bigint)
returns json language sql stable set search_path = public
as $$
  with doc as (
    select f.id, f.numero_documento, f.proveedor, f.proveedor_normalizado, f.proveedor_id, f.cif, f.fecha,
           f.subtotal, f.iva, f.total, f.total_origen, f.observaciones,
           f.archivo_path, f.alertas_validacion, f.procesado_en, f.created_at, f.verificada, f.verificacion_origen,
           f.retencion_irpf, f.retencion_irpf_pct
      from public.facturas f
     where f.id = p_id
  ),
  referencia as (
    select pf.nombre_busqueda as nom, sum(pf.precio_unitario) as suma, count(*) as n
      from doc
      join public.facturas f2 on f2.proveedor_normalizado = doc.proveedor_normalizado
      join public.productos_factura pf on pf.factura_id = f2.id
     where coalesce(doc.proveedor_normalizado, '') <> ''
       and pf.precio_unitario > 0
     group by 1
  ),
  lineas as (
    select pf.id, pf.nombre, pf.precio_unitario, pf.cantidad, pf.unidad, pf.total, pf.bultos,
           pf.descuento_pct, pf.importe_bruto, pf.importe_bruto_estimado, pf.producto_id,
           pc.nombre as canonico, c.nombre as categoria, cp.nombre as categoria_padre,
           pf.nombre_busqueda as nom
      from public.productos_factura pf
      left join public.productos_catalogo pc on pc.id = pf.producto_id
      left join public.categorias_producto c on c.id = pc.categoria_id
      left join public.categorias_producto cp on cp.id = c.padre_id
     where pf.factura_id = p_id
  )
  select json_build_object(
    'id', d.id, 'numero_documento', d.numero_documento, 'proveedor', d.proveedor,
    'proveedor_normalizado', d.proveedor_normalizado, 'proveedor_id', d.proveedor_id, 'cif', d.cif, 'fecha', d.fecha,
    'subtotal', d.subtotal, 'iva', d.iva, 'total', d.total,
    'total_origen', d.total_origen, 'observaciones', d.observaciones,
    'archivo_path', d.archivo_path, 'alertas_validacion', d.alertas_validacion, 'procesado_en', d.procesado_en,
    'created_at', d.created_at, 'verificada', d.verificada, 'verificacion_origen', d.verificacion_origen,
    'retencion_irpf', d.retencion_irpf, 'retencion_irpf_pct', d.retencion_irpf_pct,
    'productos', coalesce((
      select json_agg(json_build_object(
               'id', l.id, 'nombre', l.nombre, 'precio_unitario', l.precio_unitario, 'cantidad', l.cantidad,
               'unidad', l.unidad, 'total', l.total, 'bultos', l.bultos, 'descuento_pct', l.descuento_pct,
               'importe_bruto', l.importe_bruto, 'importe_bruto_estimado', l.importe_bruto_estimado,
               'producto_id', l.producto_id, 'producto_canonico', l.canonico,
               'categoria', case when l.categoria is null then null else json_build_object(
                 'nombre', l.categoria,
                 'ruta', case when l.categoria_padre is null then l.categoria else l.categoria_padre || ' › ' || l.categoria end) end,
               'media_referencia', case
                 when coalesce(d.proveedor_normalizado, '') = '' or public.es_servicio_compras(l.nom) then null
                 else (r.suma - case when l.precio_unitario > 0 then l.precio_unitario else 0 end)
                      / nullif(r.n - case when l.precio_unitario > 0 then 1 else 0 end, 0)
               end
             ) order by l.id)
        from lineas l
        left join referencia r on r.nom = l.nom
    ), '[]'::json)
  )
  from doc d
$$;

-- ─── Avisos de subida de precio ─────────────────────────────────────────────
-- Líneas con producto y precio (el leído o total / cantidad), con su proveedor normalizado.
create or replace function public.lineas_precio_producto(p_producto_id bigint default null, p_ids bigint[] default null)
returns table(id bigint, factura_id bigint, producto_id bigint, unidad text, cantidad numeric, precio numeric, fecha date,
              numero text, proveedor text, prov_n text, created_at timestamptz)
language sql stable set search_path = public
as $$
  select pf.id, pf.factura_id, pf.producto_id,
         coalesce(nullif(btrim(pf.unidad::text), ''), 'ud'),
         pf.cantidad,
         coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)),
         f.fecha, f.numero_documento::text, f.proveedor::text,
         coalesce(nullif(f.proveedor_normalizado::text, ''), nullif(public.normalizar_proveedor(f.proveedor), ''), '?'),
         pf.created_at
    from public.productos_factura pf
    join public.facturas f on f.id = pf.factura_id
   where pf.producto_id is not null
     and (p_producto_id is null or pf.producto_id = p_producto_id)
     and (p_ids is null or pf.id = any(p_ids))
     and coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) > 0
$$;

-- Precio de referencia de un producto en una unidad, ANTES de una factura: la media ponderada de los últimos 90 días
-- si hay al menos dos documentos; si no, la de las tres últimas compras.
create or replace function public.precio_referencia_producto(p_producto_id bigint, p_unidad text, p_fecha date, p_factura_id bigint)
returns table(precio numeric, compras integer, desde date, hasta date, proveedor text, proveedores_n text[], metodo text)
language sql stable set search_path = public
as $$
  with ant as (
    select l.* from public.lineas_precio_producto(p_producto_id, null) l
     where l.unidad = p_unidad
       and l.factura_id <> p_factura_id
       and (l.fecha < p_fecha or (l.fecha = p_fecha and l.factura_id < p_factura_id))
  ),
  docs as (
    select a.factura_id, max(a.fecha) as fecha,
           row_number() over (order by max(a.fecha) desc, a.factura_id desc) as rn
      from ant a group by a.factura_id
  ),
  m as (
    select case when (select count(*) from docs where docs.fecha >= p_fecha - 90) >= 2
                then 'media_90_dias' else 'ultimas_compras' end as metodo
  ),
  ref as (
    select a.* from ant a join docs d using (factura_id) cross join m
     where case when m.metodo = 'media_90_dias' then d.fecha >= p_fecha - 90 else d.rn <= 3 end
  )
  select coalesce(sum(r.precio * r.cantidad) filter (where r.cantidad > 0)
                    / nullif(sum(r.cantidad) filter (where r.cantidad > 0), 0),
                  avg(r.precio)),
         count(distinct r.factura_id)::integer,
         min(r.fecha),
         max(r.fecha),
         (select r2.proveedor from ref r2 group by r2.proveedor
           order by sum(r2.precio * coalesce(nullif(r2.cantidad, 0), 1)) desc, r2.proveedor limit 1),
         array_agg(distinct r.prov_n),
         (select m.metodo from m)
    from ref r
  having count(*) > 0
$$;

-- Comprueba si las líneas recién clasificadas llegan más caras que su referencia (umbral de configuracion_facturas)
-- y deja UNA notificación por documento en la campana (si hay una sin leer de ese documento, la amplía).
create or replace function public.productos_avisar_subidas(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_umbral  numeric;
  v_activo  boolean;
  v_t       timestamptz := clock_timestamp();
  v_docs    bigint[] := '{}';
  v_doc     bigint;
  v_notif   uuid;
  v_n       int;
  v_titulo  text;
  v_msg     text;
  v_creadas int := 0;
  d         record;
  r         record;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  select umbral_subida_precio_pct, avisos_subida_precio into v_umbral, v_activo
    from public.configuracion_facturas where id;
  if not found then
    v_umbral := 10;
    v_activo := true;
  end if;
  if not v_activo then
    return 0;
  end if;

  for r in
    with cand as (
      select l.factura_id, l.producto_id, l.unidad, l.fecha, l.proveedor, l.prov_n,
             sum(l.cantidad) as cantidad,
             coalesce(sum(l.precio * l.cantidad) filter (where l.cantidad > 0)
                        / nullif(sum(l.cantidad) filter (where l.cantidad > 0), 0), avg(l.precio)) as precio
        from public.lineas_precio_producto(null, p_ids) l
       where l.created_at > now() - interval '7 days'
       group by l.factura_id, l.producto_id, l.unidad, l.fecha, l.proveedor, l.prov_n
    )
    select c.*, p.nombre as producto, ref.precio as ref_precio, ref.proveedor as ref_proveedor,
           not (c.prov_n = any(ref.proveedores_n)) as cambio,
           round((c.precio / ref.precio - 1) * 100, 1) as var
      from cand c
      join public.productos_catalogo p on p.id = c.producto_id
      left join public.categorias_producto cat on cat.id = p.categoria_id
      left join public.categorias_producto mad on mad.id = cat.padre_id
      cross join lateral public.precio_referencia_producto(c.producto_id, c.unidad, c.fecha, c.factura_id) ref
     where coalesce(mad.clave, cat.clave, '') <> 'servicios'
       and ref.precio > 0
       and c.precio > ref.precio * (1 + v_umbral / 100)
       -- Solo la compra MÁS RECIENTE de ese producto y unidad.
       and not exists (
             select 1 from public.productos_factura x join public.facturas fx on fx.id = x.factura_id
              where x.producto_id = c.producto_id
                and coalesce(nullif(btrim(x.unidad::text), ''), 'ud') = c.unidad
                and x.factura_id <> c.factura_id
                and (fx.fecha > c.fecha or (fx.fecha = c.fecha and fx.id > c.factura_id)))
  loop
    insert into public.avisos_subida_precio as a
           (factura_id, producto_id, unidad, precio, precio_ref, variacion_pct, proveedor, proveedor_ref,
            cambio_proveedor, revisado_en)
    values (r.factura_id, r.producto_id, r.unidad, r.precio, r.ref_precio, r.var, r.proveedor, r.ref_proveedor,
            coalesce(r.cambio, false), v_t)
    on conflict (factura_id, producto_id, unidad) do update
       set precio = excluded.precio, precio_ref = excluded.precio_ref, variacion_pct = excluded.variacion_pct,
           proveedor = excluded.proveedor, proveedor_ref = excluded.proveedor_ref,
           cambio_proveedor = excluded.cambio_proveedor, revisado_en = excluded.revisado_en
     where abs(a.precio - excluded.precio) >= 0.005;   -- mismo precio: ya se avisó
    get diagnostics v_n = row_count;
    if v_n > 0 and not (r.factura_id = any(v_docs)) then
      v_docs := v_docs || r.factura_id;
    end if;
  end loop;

  foreach v_doc in array v_docs loop
    select a.notificacion_id into v_notif
      from public.avisos_subida_precio a
      join public.notificaciones_dashboard n on n.id = a.notificacion_id and not n.leida
     where a.factura_id = v_doc
     order by a.revisado_en desc limit 1;

    select f.numero_documento, f.fecha, f.proveedor into d from public.facturas f where f.id = v_doc;
    select count(*),
           string_agg(format('%s %s%s %% (%s → %s €/%s, %s%s)',
                        p.nombre, case when a.variacion_pct >= 0 then '+' else '' end,
                        public.precio_es(a.variacion_pct, 1), public.precio_es(a.precio_ref), public.precio_es(a.precio),
                        a.unidad, coalesce(a.proveedor, '?'),
                        case when a.cambio_proveedor then '; antes ' || coalesce(a.proveedor_ref, '?') else '' end),
                      '; ' order by a.variacion_pct desc, p.nombre),
           max(p.nombre || ' +' || public.precio_es(a.variacion_pct, 1) || ' %')
      into v_n, v_msg, v_titulo
      from public.avisos_subida_precio a
      join public.productos_catalogo p on p.id = a.producto_id
     where a.factura_id = v_doc
       and (a.revisado_en = v_t or (v_notif is not null and a.notificacion_id = v_notif));

    v_titulo := left(case when v_n = 1 then 'Subida de precio: ' || v_titulo
                          else format('Subidas de precio: %s productos (%s)', v_n, coalesce(d.proveedor, '?')) end, 150);
    v_msg := v_msg || format(' · Factura %s del %s. Precios sin IVA.',
                             coalesce(d.numero_documento, '?'), to_char(d.fecha, 'DD/MM/YYYY'));

    if v_notif is null then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad, datos)
      values ('subida_precio', v_titulo, v_msg, 'facturas_productos', 'normal',
              jsonb_build_object('enlace', '/facturas?tab=compras&modo=documentos&doc=' || v_doc, 'factura_id', v_doc))
      returning id into v_notif;
      v_creadas := v_creadas + 1;
    else
      update public.notificaciones_dashboard set titulo = v_titulo, mensaje = v_msg where id = v_notif;
    end if;
    update public.avisos_subida_precio set notificacion_id = v_notif
     where factura_id = v_doc and revisado_en = v_t;
  end loop;
  return v_creadas;
end;
$$;

-- Productos cuya ÚLTIMA compra (en alguna unidad) llegó con aviso de subida de precio: el filtro «Subieron de
-- precio» de Compras › Productos. Lee avisos_subida_precio (lo escribe el disparador de productos_factura).
create or replace function public.productos_con_subida()
returns table(producto_id bigint, nombre text, unidad text, variacion_pct numeric, fecha date, factura_id bigint)
language sql stable set search_path = public
as $$
  with ultima as (
    select distinct on (pf.producto_id, coalesce(nullif(btrim(pf.unidad::text), ''), 'ud'))
           pf.producto_id, coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           pf.factura_id, f.fecha
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
     where pf.producto_id is not null
     order by pf.producto_id, coalesce(nullif(btrim(pf.unidad::text), ''), 'ud'), f.fecha desc nulls last, pf.factura_id desc
  )
  select a.producto_id, p.nombre, a.unidad, a.variacion_pct, u.fecha, a.factura_id
    from ultima u
    join public.avisos_subida_precio a
      on a.producto_id = u.producto_id and a.unidad = u.unidad and a.factura_id = u.factura_id
    join public.productos_catalogo p on p.id = a.producto_id
   order by a.variacion_pct desc
$$;

-- Ficha de un proveedor en Compras › Proveedores: documentos, primero y último, cada cuánto se le compra, gasto
-- (con IVA) y los productos que más se le compran con su último precio. NULL si no existe.
create or replace function public.ficha_proveedor(p_proveedor_id bigint)
returns json language sql stable set search_path = public
as $$
  with prov as (
    select p.id, p.nombre::text as nombre from public.proveedores p where p.id = p_proveedor_id
  ),
  docs as (
    select f.id, f.fecha, f.total from public.facturas f where f.proveedor_id = p_proveedor_id
  ),
  fechas as (
    select distinct d.fecha from docs d where d.fecha is not null
  ),
  lineas as (
    select coalesce(pc.nombre, pf.nombre) as producto,
           coalesce(nullif(btrim(pf.unidad::text), ''), 'ud') as unidad,
           coalesce(pf.precio_unitario, round(pf.total / nullif(pf.cantidad, 0), 4)) as precio,
           f.fecha, f.id as factura_id, pf.id, pf.total
      from public.productos_factura pf
      join public.facturas f on f.id = pf.factura_id
      left join public.productos_catalogo pc on pc.id = pf.producto_id
     where f.proveedor_id = p_proveedor_id
       and not public.es_servicio_compras(pf.nombre_busqueda)
  ),
  top as (
    select l.producto, l.unidad, count(*) as n, sum(coalesce(l.total, 0)) as gasto,
           (array_agg(l.precio order by l.fecha desc nulls last, l.factura_id desc, l.id desc)
              filter (where l.precio is not null))[1] as ultimo_precio,
           max(l.fecha) as ultima_fecha
      from lineas l
     group by l.producto, l.unidad
     order by count(*) desc, sum(coalesce(l.total, 0)) desc, l.producto
     limit 12
  )
  select json_build_object(
    'proveedor', prov.nombre,
    'otros_parecidos', '[]'::json,
    'docs', (select count(*) from docs),
    'primera', (select min(d.fecha) from docs d),
    'ultima', (select max(d.fecha) from docs d),
    'intervalo_medio_dias', (select case when count(*) > 1
                                         then round((max(x.fecha) - min(x.fecha))::numeric / (count(*) - 1), 1) end
                               from fechas x),
    'gasto', (select round(sum(d.total), 2) from docs d),
    'sin_total', (select count(*) from docs d where d.total is null),
    'top_productos', coalesce((select json_agg(json_build_object('producto', t.producto, 'unidad', t.unidad,
                                                                 'ultimo_precio', t.ultimo_precio,
                                                                 'ultima_fecha', t.ultima_fecha)
                                               order by t.n desc, t.gasto desc, t.producto)
                                 from top t), '[]'::json)
  )
  from prov
$$;

-- ─── Quién es el cliente, y qué es «suyo» ───────────────────────────────────
-- En las facturas de proveedor Cristalería BV es el CLIENTE: su nombre o su CIF (configuracion_facturas.cif_empresa)
-- nunca identifican a un proveedor.
create or replace function public.proveedor_es_cliente(p_base text, p_cif text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(p_base ~ '^cristaleria baix vinalopo( |,|$)', false)
      or coalesce(p_cif is not null and p_cif = (select public.normalizar_cif(c.cif_empresa)
                                                   from public.configuracion_facturas c where c.id), false)
$$;

create or replace function public.ocr_trabajo_es_mio(p_trabajo_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.ocr_trabajos t where t.id = p_trabajo_id and t.creado_por = (select auth.uid()))
$$;

-- Un fichero del bucket es «suyo» si está en su carpeta de subidas o es el original de una factura que subió él.
create or replace function public.factura_original_es_mio(p_nombre text)
returns boolean language sql stable security definer set search_path = public
as $$
  select (select auth.uid()) is not null and p_nombre is not null and (
       p_nombre like 'pendientes/' || (select auth.uid())::text || '/%'
    or exists (select 1 from public.facturas f where f.archivo_path = p_nombre and f.subido_por = (select auth.uid())))
$$;

-- ─── Limpieza de las piezas del OCR ─────────────────────────────────────────
-- Trabajos terminados hace más de 7 días con ficheros en pendientes/ por borrar (los completados se limpian al
-- guardar; esto recoge los cancelados, los fallidos y lo que se quedó a medias). La Edge Function ocr-trabajo
-- (modo «limpiar») borra los ficheros con la API de Storage y marca limpiado_at.
alter table public.ocr_trabajos add column if not exists limpiado_at timestamptz;
comment on column public.ocr_trabajos.limpiado_at is 'Cuándo se borraron sus ficheros de pendientes/ (limpieza diaria).';

create or replace function public.ocr_trabajos_por_limpiar(p_limite integer default 50)
returns setof uuid language sql stable security definer set search_path = public
as $$
  select t.id
    from public.ocr_trabajos t
   where t.estado in ('completado', 'fallido', 'cancelado')
     and t.limpiado_at is null
     and coalesce(t.terminado_at, t.updated_at) < now() - interval '7 days'
   order by coalesce(t.terminado_at, t.updated_at)
   limit greatest(1, least(coalesce(p_limite, 50), 200))
$$;

create or replace function public.ocr_marcar_limpiado(p_trabajo_id uuid)
returns void language sql security definer set search_path = public
as $$ update public.ocr_trabajos set limpiado_at = now() where id = p_trabajo_id $$;

create or replace function public.ocr_despachar_limpieza()
returns integer language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_url     text;
  v_secreto text;
begin
  if not exists (select 1 from public.ocr_trabajos_por_limpiar(1)) then
    return 0;
  end if;
  v_url := public.url_funcion_edge('ocr-trabajo');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'limpiar'),
    timeout_milliseconds := 10000);
  return 1;
end;
$$;

-- ─── Avisos de Facturas en la campana: los ve quien ve Facturas ─────────────
create or replace function public.seccion_aviso(p_tipo text)
returns text language sql immutable set search_path = public
as $$
  select case
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    when p_tipo like 'facturas\_%' or p_tipo = 'subida_precio' then 'facturas'
    else 'dashboard'
  end
$$;
-- La tabla de avisos la lee cualquiera con «Dashboard» (el panel filtra por sección); los de Facturas llevan
-- proveedores y precios, así que solo los lee quien ve Facturas.
drop policy if exists notificaciones_facturas_solo_seccion on public.notificaciones_dashboard;
create policy notificaciones_facturas_solo_seccion on public.notificaciones_dashboard
  as restrictive for select to authenticated
  using ((tipo not like 'facturas\_%' and tipo <> 'subida_precio') or (select public.can_read_section('facturas')));

-- ─── Disparadores ───────────────────────────────────────────────────────────
drop trigger if exists trigger_proveedores_updated on public.proveedores;
create trigger trigger_proveedores_updated before update on public.proveedores
  for each row execute function public.update_updated_at_column();
drop trigger if exists trg_proveedores_mantener_alias on public.proveedores;
create trigger trg_proveedores_mantener_alias after insert or update of nombre, nombre_comercial on public.proveedores
  for each row execute function public.proveedores_mantener_alias();

drop trigger if exists trg_categorias_producto_validar on public.categorias_producto;
create trigger trg_categorias_producto_validar before insert or update on public.categorias_producto
  for each row execute function public.categorias_producto_validar();
drop trigger if exists trg_productos_catalogo_updated_at on public.productos_catalogo;
create trigger trg_productos_catalogo_updated_at before update on public.productos_catalogo
  for each row execute function public.update_updated_at_column();
drop trigger if exists trg_productos_alias_updated_at on public.productos_alias;
create trigger trg_productos_alias_updated_at before update on public.productos_alias
  for each row execute function public.update_updated_at_column();
drop trigger if exists trg_configuracion_facturas_tocar on public.configuracion_facturas;
create trigger trg_configuracion_facturas_tocar before update on public.configuracion_facturas
  for each row execute function public.configuracion_facturas_tocar();

drop trigger if exists trigger_ocr_trabajos_updated on public.ocr_trabajos;
create trigger trigger_ocr_trabajos_updated before update on public.ocr_trabajos
  for each row execute function public.update_updated_at_column();
drop trigger if exists trigger_ocr_paginas_updated on public.ocr_trabajo_paginas;
create trigger trigger_ocr_paginas_updated before update on public.ocr_trabajo_paginas
  for each row execute function public.update_updated_at_column();

-- Facturas: «00» delante para que corran antes que el resto (orden alfabético).
drop trigger if exists trg_00_facturas_subido_por on public.facturas;
create trigger trg_00_facturas_subido_por before insert on public.facturas
  for each row execute function public.facturas_rellenar_subido_por();
drop trigger if exists trg_00_facturas_subida_solo_lo_leido on public.facturas;
create trigger trg_00_facturas_subida_solo_lo_leido before update on public.facturas
  for each row execute function public.facturas_subida_solo_lo_leido();
drop trigger if exists trigger_facturas_updated on public.facturas;
create trigger trigger_facturas_updated before update on public.facturas
  for each row execute function public.update_updated_at_column();
drop trigger if exists trg_facturas_asignar_proveedor on public.facturas;
create trigger trg_facturas_asignar_proveedor
  before insert or update of proveedor, cif, proveedor_id, proveedor_normalizado on public.facturas
  for each row execute function public.facturas_asignar_proveedor();
drop trigger if exists trg_facturas_origen_verificacion on public.facturas;
create trigger trg_facturas_origen_verificacion before insert or update of verificada, verificacion_origen on public.facturas
  for each row execute function public.facturas_origen_verificacion();
drop trigger if exists trg_facturas_autoverificar on public.facturas;
create trigger trg_facturas_autoverificar
  after update of alertas_validacion, total, subtotal, iva, proveedor_id, numero_documento, fecha on public.facturas
  for each row execute function public.facturas_autoverificar();

-- Líneas.
drop trigger if exists trg_00_productos_factura_subida_solo_lo_leido on public.productos_factura;
create trigger trg_00_productos_factura_subida_solo_lo_leido before insert or update on public.productos_factura
  for each row execute function public.facturas_subida_solo_lo_leido();
drop trigger if exists trg_productos_factura_normalizar_unidad on public.productos_factura;
create trigger trg_productos_factura_normalizar_unidad before insert or update of unidad on public.productos_factura
  for each row execute function public.trg_productos_factura_normalizar_unidad();
drop trigger if exists trg_productos_factura_asignar_producto on public.productos_factura;
create trigger trg_productos_factura_asignar_producto before insert or update of nombre on public.productos_factura
  for each row execute function public.productos_factura_asignar_producto();
drop trigger if exists trg_productos_factura_aviso_precio_ins on public.productos_factura;
create trigger trg_productos_factura_aviso_precio_ins after insert on public.productos_factura
  referencing new table as nuevas for each statement execute function public.productos_factura_aviso_precio();
drop trigger if exists trg_productos_factura_aviso_precio_upd on public.productos_factura;
create trigger trg_productos_factura_aviso_precio_upd after update on public.productos_factura
  referencing old table as viejas new table as nuevas for each statement execute function public.productos_factura_aviso_precio();
drop trigger if exists trg_productos_factura_recalcular_alertas on public.productos_factura;
create trigger trg_productos_factura_recalcular_alertas
  after update of cantidad, precio_unitario, total, factura_id on public.productos_factura
  for each row
  when (old.cantidad is distinct from new.cantidad or old.precio_unitario is distinct from new.precio_unitario
        or old.total is distinct from new.total or old.factura_id is distinct from new.factura_id)
  execute function public.productos_factura_recalcular_alertas();
drop trigger if exists trg_productos_factura_alertas_insert on public.productos_factura;
create trigger trg_productos_factura_alertas_insert after insert on public.productos_factura
  referencing new table as filas for each statement execute function public.productos_factura_recalcular_alertas_lote();
drop trigger if exists trg_productos_factura_alertas_delete on public.productos_factura;
create trigger trg_productos_factura_alertas_delete after delete on public.productos_factura
  referencing old table as filas for each statement execute function public.productos_factura_recalcular_alertas_lote();

-- ─── Permisos: tablas ───────────────────────────────────────────────────────
-- Lectura con «Ver» o «Editar» en Facturas; escritura con «Editar». «Facturas · Subida» lee y corrige SOLO lo que
-- subió él (y el trigger facturas_subida_solo_lo_leido limita qué columnas). Lo que escribe el OCR va con el
-- service role. Cada tabla, además, con la barrera de sesión bloqueada (acceso_panel_no_bloqueado).
do $$
declare
  t text;
begin
  foreach t in array array['configuracion_facturas', 'proveedores', 'proveedores_alias', 'categorias_producto',
                           'productos_catalogo', 'productos_alias', 'ocr_trabajos', 'facturas', 'productos_factura',
                           'ocr_trabajo_paginas', 'facturas_sustituciones', 'avisos_subida_precio'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_service_role', t);
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
                      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
  end loop;
end;
$$;

-- Solo lectura desde el panel (escriben las RPC SECURITY DEFINER o el service role).
grant select on public.proveedores_alias, public.productos_catalogo, public.productos_alias, public.ocr_trabajos,
  public.ocr_trabajo_paginas, public.facturas_sustituciones, public.avisos_subida_precio to authenticated;
revoke insert, update, delete, truncate on public.proveedores_alias, public.productos_catalogo, public.productos_alias,
  public.ocr_trabajos, public.ocr_trabajo_paginas, public.facturas_sustituciones, public.avisos_subida_precio
  from authenticated;
grant select, insert, update, delete on public.facturas, public.productos_factura, public.proveedores to authenticated;
grant select, insert, update on public.categorias_producto to authenticated;
revoke delete, truncate on public.categorias_producto from authenticated;
grant select, update on public.configuracion_facturas to authenticated;
revoke insert, delete, truncate on public.configuracion_facturas from authenticated;

create policy configuracion_facturas_select on public.configuracion_facturas for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy configuracion_facturas_update on public.configuracion_facturas for update to authenticated
  using ((select public.can_edit_section('facturas'))) with check ((select public.can_edit_section('facturas')));

create policy proveedores_select_seccion on public.proveedores for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy proveedores_insert_seccion on public.proveedores for insert to authenticated
  with check ((select public.can_edit_section('facturas')));
create policy proveedores_update_seccion on public.proveedores for update to authenticated
  using ((select public.can_edit_section('facturas'))) with check ((select public.can_edit_section('facturas')));
create policy proveedores_delete_seccion on public.proveedores for delete to authenticated
  using ((select public.can_edit_section('facturas')));
create policy proveedores_alias_select_seccion on public.proveedores_alias for select to authenticated
  using ((select public.can_read_section('facturas')));

create policy categorias_producto_select_seccion on public.categorias_producto for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy categorias_producto_insert_seccion on public.categorias_producto for insert to authenticated
  with check ((select public.can_edit_section('facturas')));
create policy categorias_producto_update_seccion on public.categorias_producto for update to authenticated
  using ((select public.can_edit_section('facturas'))) with check ((select public.can_edit_section('facturas')));
create policy productos_catalogo_select_seccion on public.productos_catalogo for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy productos_alias_select_seccion on public.productos_alias for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy avisos_subida_precio_select on public.avisos_subida_precio for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy facturas_sustituciones_select on public.facturas_sustituciones for select to authenticated
  using ((select public.can_read_section('facturas')));

create policy ocr_trabajos_select on public.ocr_trabajos for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy ocr_trabajos_select_subida on public.ocr_trabajos for select to authenticated
  using ((select public.facturas_puede_subir()) and creado_por = (select auth.uid()));
create policy ocr_paginas_select on public.ocr_trabajo_paginas for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy ocr_paginas_select_subida on public.ocr_trabajo_paginas for select to authenticated
  using ((select public.facturas_puede_subir()) and public.ocr_trabajo_es_mio(trabajo_id));

create policy facturas_select_seccion on public.facturas for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy facturas_insert_seccion on public.facturas for insert to authenticated
  with check ((select public.can_edit_section('facturas')));
create policy facturas_update_seccion on public.facturas for update to authenticated
  using ((select public.can_edit_section('facturas'))) with check ((select public.can_edit_section('facturas')));
create policy facturas_delete_seccion on public.facturas for delete to authenticated
  using ((select public.can_edit_section('facturas')));
create policy facturas_select_subida on public.facturas for select to authenticated
  using ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()));
create policy facturas_update_subida on public.facturas for update to authenticated
  using ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()))
  with check ((select public.facturas_puede_subir()) and subido_por = (select auth.uid()));

create policy productos_factura_select_seccion on public.productos_factura for select to authenticated
  using ((select public.can_read_section('facturas')));
create policy productos_factura_insert_seccion on public.productos_factura for insert to authenticated
  with check ((select public.can_edit_section('facturas')));
create policy productos_factura_update_seccion on public.productos_factura for update to authenticated
  using ((select public.can_edit_section('facturas'))) with check ((select public.can_edit_section('facturas')));
create policy productos_factura_delete_seccion on public.productos_factura for delete to authenticated
  using ((select public.can_edit_section('facturas')));
create policy productos_factura_select_subida on public.productos_factura for select to authenticated
  using ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));
create policy productos_factura_insert_subida on public.productos_factura for insert to authenticated
  with check ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));
create policy productos_factura_update_subida on public.productos_factura for update to authenticated
  using ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id))
  with check ((select public.facturas_puede_subir()) and public.factura_subida_por_mi(factura_id));

-- ─── Permisos: funciones ────────────────────────────────────────────────────
-- Todo cerrado a anon. Las del OCR, la limpieza y los despachos, solo service role (las llaman las Edge Functions y
-- pg_cron); las del panel comprueban dentro el permiso (can_read/can_write_section, facturas_puede_subir).
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'normalizar_texto', 'normalizar_nombre_producto', 'texto_busqueda_compras', 'normalizar_cif',
         'normalizar_proveedor_base', 'proveedor_clave', 'normalizar_unidad_factura', 'unidad_comparable',
         'es_servicio_compras', 'precio_es', 'cif_distancia', 'cif_control_valido', 'normalizar_proveedor',
         'facturas_puede_subir_usuario', 'facturas_puede_subir', 'factura_subida_por_mi', 'productos_puede_editar',
         'proveedores_puede_editar', 'proveedores_mantener_alias', 'facturas_asignar_proveedor', 'proveedores_fusionar',
         'proveedores_notas_ia_guardar', 'facturas_rellenar_subido_por', 'facturas_origen_verificacion',
         'facturas_subida_solo_lo_leido', 'recalcular_alertas_factura', 'productos_factura_recalcular_alertas',
         'productos_factura_recalcular_alertas_lote', 'categorias_producto_validar', 'productos_factura_asignar_producto',
         'trg_productos_factura_normalizar_unidad', 'productos_factura_aviso_precio', 'productos_borrar',
         'productos_recategorizar', 'productos_renombrar', 'productos_fusionar', 'productos_asignar_lineas',
         'productos_aplicar_clasificacion_ia', 'productos_asignar_por_alias', 'productos_despachar_clasificacion',
         'buscar_documentos_compras', 'ocr_sumar_gasto', 'ocr_despachar_cola', 'ocr_reclamar_pagina',
         'ocr_reclamar_consolidacion', 'ocr_resumen_factura', 'ocr_terminar_trabajo', 'ocr_pedir_relectura',
         'ocr_fallo_pagina', 'ocr_cerrar_pagina', 'ocr_descartar_trabajo', 'ocr_reintentar_trabajo', 'ocr_despachar',
         'reanudar_trabajos_ocr', 'estadisticas_lectura', 'verificar_duplicado_factura', 'configuracion_facturas_tocar',
         'validar_cordura_factura', 'factura_cumple_autoverificacion', 'facturas_autoverificar', 'proveedor_resolver',
         'proveedores_editar', 'ocr_factura_existente', 'ocr_resumen_factura_datos', 'ocr_sustituir_factura',
         'ocr_anadir_pagina', 'productos_resumen', 'productos_gasto_por_categoria', 'proveedores_listado',
         'meses_compras_incompletos', 'documentos_lista', 'documento_compras', 'lineas_precio_producto',
         'precio_referencia_producto', 'productos_avisar_subidas', 'proveedor_es_cliente', 'ocr_trabajo_es_mio',
         'factura_original_es_mio', 'ocr_trabajos_por_limpiar', 'ocr_marcar_limpiado', 'ocr_despachar_limpieza',
         'productos_con_subida', 'ficha_proveedor')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Las que llama el panel (o que usan sus políticas, columnas generadas y disparadores).
grant execute on function
  public.normalizar_texto(text), public.normalizar_nombre_producto(text), public.texto_busqueda_compras(text),
  public.normalizar_cif(text), public.normalizar_proveedor_base(text), public.proveedor_clave(text),
  public.normalizar_unidad_factura(text), public.unidad_comparable(text), public.es_servicio_compras(text),
  public.precio_es(numeric, integer), public.cif_distancia(text, text), public.cif_control_valido(text),
  public.normalizar_proveedor(text), public.facturas_puede_subir(), public.factura_subida_por_mi(bigint),
  public.productos_puede_editar(), public.proveedores_puede_editar(), public.ocr_trabajo_es_mio(uuid),
  public.factura_original_es_mio(text), public.proveedor_es_cliente(text, text),
  public.proveedores_fusionar(bigint[], bigint), public.proveedores_notas_ia_guardar(bigint, text),
  public.proveedores_editar(bigint, text, text, text), public.proveedores_listado(),
  public.productos_borrar(bigint), public.productos_recategorizar(bigint[], bigint), public.productos_renombrar(bigint, text),
  public.productos_fusionar(bigint[], bigint), public.productos_asignar_lineas(bigint[], bigint, text, bigint),
  public.productos_resumen(date, date), public.productos_gasto_por_categoria(date, date),
  public.buscar_documentos_compras(text), public.documentos_lista(), public.documento_compras(bigint),
  public.meses_compras_incompletos(), public.ocr_resumen_factura(bigint), public.ocr_descartar_trabajo(uuid),
  public.ocr_reintentar_trabajo(uuid), public.estadisticas_lectura(integer), public.validar_cordura_factura(bigint),
  public.factura_cumple_autoverificacion(bigint), public.recalcular_alertas_factura(bigint),
  public.productos_con_subida(), public.ficha_proveedor(bigint)
to authenticated;
-- Funciones de disparador (las ejecuta el propio disparador, como el usuario que escribe).
grant execute on function
  public.facturas_rellenar_subido_por(), public.facturas_origen_verificacion(), public.facturas_subida_solo_lo_leido(),
  public.facturas_asignar_proveedor(), public.facturas_autoverificar(), public.proveedores_mantener_alias(),
  public.categorias_producto_validar(), public.configuracion_facturas_tocar(), public.productos_factura_asignar_producto(),
  public.trg_productos_factura_normalizar_unidad(), public.productos_factura_aviso_precio(),
  public.productos_factura_recalcular_alertas(), public.productos_factura_recalcular_alertas_lote()
to authenticated;

-- ─── Bucket privado de originales ───────────────────────────────────────────
--   pendientes/{uid}/{trabajo}/…    lo que sube el panel para el OCR (piezas y original). Las piezas se borran al
--                                    guardar la factura; lo demás, la limpieza diaria (7 días).
--   originales/AAAA/MM/{factura}-…  el original de cada factura (facturas.archivo_path), para siempre.
-- Leer: con «Ver» en Facturas, o con «Facturas · Subida» lo suyo. Subir: «Subida» o «Editar», solo a su carpeta
-- de pendientes/. Mover, archivar y borrar: solo el service role (Edge Functions).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('facturas-originales', 'facturas-originales', false, 20971520,
            array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists facturas_originales_select on storage.objects';
    execute $p$create policy facturas_originales_select on storage.objects for select to authenticated
      using (bucket_id = 'facturas-originales' and (select public.can_read_section('facturas')))$p$;
    execute 'drop policy if exists facturas_originales_select_subida on storage.objects';
    execute $p$create policy facturas_originales_select_subida on storage.objects for select to authenticated
      using (bucket_id = 'facturas-originales' and (select public.facturas_puede_subir()) and public.factura_original_es_mio(name))$p$;
    execute 'drop policy if exists facturas_originales_pendientes_insert on storage.objects';
    execute $p$create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'facturas-originales'
                  and (storage.foldername(name))[1] = 'pendientes'
                  and (storage.foldername(name))[2] = (select auth.uid())::text
                  and (select public.facturas_puede_subir()))$p$;
  end if;
end;
$$;

-- ─── Datos de partida ───────────────────────────────────────────────────────
-- Categorías de lo que compra una cristalería (se pueden cambiar y ampliar en Facturas › Compras › Productos).
insert into public.categorias_producto (clave, nombre, descripcion, orden) values
  ('vidrio',      'Vidrio',                  'Vidrio plano en planchas o a medida.', 10),
  ('espejos',     'Espejos',                 'Espejo plata, de seguridad, biselado o envejecido.', 20),
  ('perfileria',  'Perfilería',              'Perfiles para ventanas, cerramientos y mamparas.', 30),
  ('herrajes',    'Herrajes y accesorios',   'Bisagras, pinzas, tiradores, cerraduras, ruedas y guías.', 40),
  ('consumibles', 'Consumibles',             'Siliconas, juntas, cintas, tornillería y material de colocación.', 50),
  ('maquinaria',  'Maquinaria y herramienta', 'Máquinas, herramientas, ventosas, discos y su mantenimiento.', 60),
  ('vehiculos',   'Vehículos',               'Combustible, mantenimiento, seguros y peajes de las furgonetas.', 70),
  ('oficina',     'Oficina y generales',     'Material de oficina, limpieza, ropa de trabajo y suministros del taller.', 80),
  ('servicios',   'Servicios',               'Portes, instalaciones subcontratadas, reparaciones, alquileres, asesoría y otros cargos sin producto.', 90)
on conflict (clave) do nothing;
insert into public.categorias_producto (clave, nombre, descripcion, padre_id, orden)
select v.clave, v.nombre, v.descripcion, p.id, v.orden
  from (values
    ('vidrio',      'vidrio.flotado',       'Flotado e incoloro',     'Vidrio monolítico incoloro, extraclaro o de color.', 1),
    ('vidrio',      'vidrio.templado',      'Templado',               'Vidrio templado de seguridad (mamparas, puertas, barandillas).', 2),
    ('vidrio',      'vidrio.laminado',      'Laminado',               'Laminado de seguridad (3+3, 4+4, 5+5…), también acústico.', 3),
    ('vidrio',      'vidrio.camara',        'Doble acristalamiento',  'Unidades de vidrio con cámara y bajo emisivo.', 4),
    ('vidrio',      'vidrio.decorativo',    'Impreso y decorativo',   'Impreso, mateado, al ácido, lacado o serigrafiado.', 5),
    ('perfileria',  'perfileria.aluminio',  'Aluminio',               'Perfiles de aluminio para carpintería, mamparas y cerramientos.', 1),
    ('perfileria',  'perfileria.pvc',       'PVC',                    'Perfiles y accesorios de PVC.', 2),
    ('perfileria',  'perfileria.inox',      'Acero inoxidable',       'Tubos, pletinas y perfiles de acero inoxidable.', 3),
    ('herrajes',    'herrajes.mamparas',    'Herrajes de mampara',    'Bisagras, pinzas, tiradores y kits de mampara.', 1),
    ('herrajes',    'herrajes.puertas',     'Puertas y ventanas',     'Cerraduras, manillas, correderas y herrajes de carpintería.', 2),
    ('consumibles', 'consumibles.sellado',  'Siliconas y selladores', 'Siliconas, masillas, espumas y adhesivos.', 1),
    ('consumibles', 'consumibles.juntas',   'Juntas y burletes',      'Juntas de EPDM, burletes, cepillos y perfiles de goma.', 2),
    ('consumibles', 'consumibles.fijacion', 'Tornillería y fijación', 'Tornillos, tacos, anclajes y remaches.', 3)
  ) as v(padre, clave, nombre, descripcion, orden)
  join public.categorias_producto p on p.clave = v.padre
on conflict (clave) do nothing;

-- Funciones de IA del módulo (el núcleo dejó solo las suyas): catálogo, modelo y coste estimado.
insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo) values
  ('procesar-factura', 'Lectura de una factura (camino de una página y al sustituir un duplicado). Registra cada llamada (lectura, relectura, pie y contador) en ia_uso.', true, 'documento', 20, true),
  ('ocr-trabajo', 'Lectura en segundo plano de las facturas subidas (cada página o franja y su consolidación). Registra cada llamada en ia_uso con disparador trabajo:<uuid>.', true, 'documento', 25, true),
  ('clasificar-productos', 'Clasifica las líneas de factura nuevas sin producto (catálogo y categoría). Una llamada barata por tanda; la lanza el cron cada 5 min si hay líneas recientes sin clasificar, o el botón de Facturas › Productos.', true, 'tanda', 80, true)
on conflict (funcion) do update set descripcion = excluded.descripcion, instrumentada = excluded.instrumentada,
                                    unidad = excluded.unidad, orden = excluded.orden, activo = excluded.activo;
insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado, cambiado_por_email) values
  ('procesar-factura', 'gpt-5.6-luna (secreto OCR_MODELO; también trabajos de una página)', true, 'sistema'),
  ('ocr-trabajo', 'gpt-5.6-luna (secreto OCR_MODELO_PIEZAS u OCR_MODELO; piezas)', true, 'sistema'),
  ('clasificar-productos', 'gpt-5.6-luna (secreto CLASIFICAR_PRODUCTOS_MODELO)', true, 'sistema')
on conflict (funcion) do nothing;
insert into public.ia_coste_estimado (funcion, unidad, usd_por_unidad, unidades_mes_estimadas, modelo, medido_en, nota) values
  ('procesar-factura', 'documento', 0.0075, 60, 'gpt-5-mini', '2026-09-28',
   'Hipótesis: 60 facturas de proveedor al mes. Coste medido por documento en el panel de referencia.')
on conflict (funcion) do nothing;

-- ─── Tareas programadas ─────────────────────────────────────────────────────
--   reanudar-trabajos-ocr (cada minuto): piezas con el lease caducado, trabajos pasados de tiempo y despachos
--                                        perdidos. Sin trabajos activos no hace nada.
--   clasificar-productos (cada 5 min):   asigna por alias lo que ya se conoce y llama a la IA si quedan líneas.
--   limpiar-pendientes-ocr (diaria):     borra las piezas de los trabajos terminados hace más de 7 días.
-- Como las del núcleo, necesitan en Vault «project_url» y «ocr_trabajos_secret».
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j
     where j.jobname in ('reanudar-trabajos-ocr', 'clasificar-productos', 'limpiar-pendientes-ocr');
    perform cron.schedule('reanudar-trabajos-ocr', '* * * * *', $cron$ select public.reanudar_trabajos_ocr(); $cron$);
    perform cron.schedule('clasificar-productos', '*/5 * * * *', $cron$ select public.productos_despachar_clasificacion(); $cron$);
    perform cron.schedule('limpiar-pendientes-ocr', '40 3 * * *', $cron$ select public.ocr_despachar_limpieza(); $cron$);
  else
    raise notice 'Sin pg_cron: las tareas programadas de Facturas NO se han instalado.';
  end if;
end;
$$;
