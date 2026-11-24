-- ============================================================================
--  Panel de Cristalería BV · Tráfico web (24/11/2026)
-- ----------------------------------------------------------------------------
--  Visitas diarias de la web pública (proyecto `cristaleriabv` de Vercel,
--  https://cristaleriabv.vercel.app) desde Vercel Web Analytics, con medias,
--  anomalías, tendencia, páginas más vistas, desgloses (dispositivo, país,
--  procedencia) y una ESTIMACIÓN de la transferencia del mes (Fast Data
--  Transfer). Portado del panel de referencia (Tráfico web,
--  20260923200000_trafico_web.sql y sus arreglos 20261101093700/093800), sin
--  nada de restaurante: un solo proyecto, `cristaleriabv`.
--
--  Flujo:
--    pg_cron 03:30 UTC → trafico_web_disparar() (Vault: project_url +
--    ocr_trabajos_secret, el patrón de las demás tareas del panel) →
--    Edge Function sync-trafico-web (x-ocr-secret) → API de Vercel Web
--    Analytics (VERCEL_ANALYTICS_TOKEN) → trafico_web_diario /
--    trafico_web_desglose / trafico_web_sync_estado (service role).
--    Panel /trafico-web → RPC trafico_web_* (security invoker: la RLS de la
--    sección «trafico_web» decide).
--
--  Sin Vault, sin la función o sin el token, nada falla: la tarea no llama a
--  nadie (o la función responde «falta configurar») y la pantalla dice qué
--  falta. Lo que hay que configurar está en docs/TRAFICO-WEB.md.
--
--  Permisos: sección «trafico_web» (Usuarios › Permisos). «Ver» lee todo;
--  «Editar» además cambia los pesos por página de la estimación. Super admin,
--  todo. Barrera de sesión (acceso_panel_no_bloqueado) como el resto del panel.
--
--  Vuelta atrás: supabase/rollbacks/20261124110000_trafico_web_ROLLBACK.sql.
-- ============================================================================

set check_function_bodies = off;

-- ─── Tablas ─────────────────────────────────────────────────────────────────
-- Visitas por día y ruta. ruta '*' = TOTAL del día (centinela dentro de la PK, en vez de NULL, para que el upsert sea
-- simple). Las filas por ruta pueden no sumar el total si la API solo devuelve las 100 más vistas.
create table if not exists public.trafico_web_diario (
  fecha            date        not null,
  proyecto         text        not null check (proyecto in ('cristaleriabv')),
  ruta             text        not null default '*' check (length(ruta) between 1 and 2048),
  visitas          integer     not null check (visitas >= 0),
  visitantes       integer              check (visitantes >= 0),
  sincronizado_en  timestamptz not null default now(),
  primary key (fecha, proyecto, ruta)
);
comment on table public.trafico_web_diario is
  'Vercel Web Analytics por día y ruta de la web (ruta ''*'' = total del día). Solo escribe la Edge Function '
  'sync-trafico-web (service role). visitantes NULL = la API no lo devolvió (el panel dice «sin datos», nunca 0).';

-- Desgloses por dimensión. `valor` no admite NULL (PK): la función pone un literal al vacío (p. ej. «(directo)»).
create table if not exists public.trafico_web_desglose (
  fecha            date        not null,
  proyecto         text        not null check (proyecto in ('cristaleriabv')),
  dimension        text        not null check (dimension in ('device', 'country', 'referrer')),
  valor            text        not null check (length(valor) between 1 and 2048),
  visitas          integer     not null check (visitas >= 0),
  visitantes       integer              check (visitantes >= 0),
  sincronizado_en  timestamptz not null default now(),
  primary key (fecha, proyecto, dimension, valor)
);
comment on table public.trafico_web_desglose is
  'Visitas por día y dimensión (device | country | referrer). Vacía para una dimensión si la API no la ofrece.';

-- Peso medio transferido por visita (ESTIMACIÓN de la transferencia). ruta '*' = media de la web (para las rutas sin
-- peso propio y el resto de visitas que la API no desglosa por ruta).
create table if not exists public.peso_paginas (
  proyecto          text        not null check (proyecto in ('cristaleriabv')),
  ruta              text        not null default '*' check (length(ruta) between 1 and 2048),
  bytes_por_visita  bigint      not null check (bytes_por_visita > 0),
  nota              text        check (nota is null or length(nota) <= 500),
  actualizado_en    timestamptz not null default now(),
  primary key (proyecto, ruta)
);
comment on table public.peso_paginas is
  'Bytes por visita (ESTIMACIÓN) para la transferencia del mes. ruta ''*'' = media de la web. Se cambia en Tráfico web '
  '› «Pesos por página» con «Editar» en la sección trafico_web.';

-- Estado de la última sincronización (aviso de datos atrasados o de Web Analytics desactivado).
create table if not exists public.trafico_web_sync_estado (
  proyecto             text        primary key check (proyecto in ('cristaleriabv')),
  ultimo_ok_en         timestamptz,
  ultimo_intento_en    timestamptz,
  ultimo_error         text        check (ultimo_error is null or length(ultimo_error) <= 2000),
  fallos_consecutivos  integer     not null default 0 check (fallos_consecutivos >= 0),
  dias_ultimo_sync     integer              check (dias_ultimo_sync >= 0),
  -- Primer día (UTC) en que Vercel puede tener datos: con Web Analytics apagado Vercel no guarda nada y la API
  -- devolvería esos días como 0. La función lo sube al día de cada intento que lo encuentra apagado.
  datos_desde          date
);
comment on table public.trafico_web_sync_estado is
  'Una fila por proyecto. ultimo_ok_en NULL = nunca sincronizado (el primer run trae los últimos 30 días). El panel '
  'avisa si han pasado más de 48 h o si el último intento dejó ultimo_error. datos_desde: ver la columna.';
comment on column public.trafico_web_sync_estado.datos_desde is
  'Primer día (UTC) en que Vercel puede tener datos. sync-trafico-web no pide días anteriores y lo sube al día de cada '
  'intento que encuentra Web Analytics desactivado. Se puede corregir a mano.';

-- Actualizado al editar (el panel no tiene que acordarse).
create or replace function public.peso_paginas_al_editar()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
drop trigger if exists trg_peso_paginas_al_editar on public.peso_paginas;
create trigger trg_peso_paginas_al_editar before insert or update on public.peso_paginas
  for each row execute function public.peso_paginas_al_editar();

-- ─── Permisos ───────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['trafico_web_diario', 'trafico_web_desglose', 'peso_paginas', 'trafico_web_sync_estado'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_read_section(''trafico_web'')))',
                   t || '_lectura', t);
    execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
    execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
                      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
  end loop;
end;
$$;
-- Los pesos son lo único que se cambia desde el panel.
grant insert, update, delete on public.peso_paginas to authenticated;
drop policy if exists peso_paginas_insert on public.peso_paginas;
create policy peso_paginas_insert on public.peso_paginas for insert to authenticated
  with check ((select public.can_edit_section('trafico_web')));
drop policy if exists peso_paginas_update on public.peso_paginas;
create policy peso_paginas_update on public.peso_paginas for update to authenticated
  using ((select public.can_edit_section('trafico_web'))) with check ((select public.can_edit_section('trafico_web')));
drop policy if exists peso_paginas_delete on public.peso_paginas;
create policy peso_paginas_delete on public.peso_paginas for delete to authenticated
  using ((select public.can_edit_section('trafico_web')));

-- Datos derivados (los escribe la función cada noche): sin trigger de auditoría. Los pesos sí se auditan.
drop trigger if exists trg_auditoria on public.trafico_web_diario;
drop trigger if exists trg_auditoria on public.trafico_web_desglose;
drop trigger if exists trg_auditoria on public.trafico_web_sync_estado;

-- ─── Pesos de partida (provisionales) ───────────────────────────────────────
insert into public.peso_paginas (proyecto, ruta, bytes_por_visita, nota) values
  ('cristaleriabv', '*', 1200000,
   'ESTIMACIÓN PROVISIONAL (24/11/2026): ~1,2 MB por visita sin medir (la web lleva muchas fotos). Cámbiala tras medir '
   'la transferencia real de una primera visita (DevTools › Red › «transferred»).')
on conflict (proyecto, ruta) do nothing;

-- ─── Estadística (RPC, security invoker: la RLS manda) ──────────────────────
-- Serie diaria con medias móviles (7 y 30 días), banda por día de la semana (8 mismos días anteriores), z y anomalía
-- (|z| > 2; NULL con menos de 3 días o sin variación). Huecos = NULL. p_proyecto NULL = todas las webs.
create or replace function public.trafico_web_serie(
  p_proyecto text default null,
  p_desde    date default (current_date - 90),
  p_hasta    date default (current_date - 1)
)
returns table (
  fecha date, visitas bigint, visitantes bigint, media_7 numeric, media_30 numeric, desv_30 numeric, media_dow numeric,
  desv_dow numeric, n_dow integer, z_dow numeric, desviacion_pct numeric, es_anomalia boolean
)
language sql stable security invoker set search_path = ''
as $$
  with dias as (
    select (p_desde - 60) + i as dia
    from generate_series(0, greatest(p_hasta - (p_desde - 60), -1)) as i
  ),
  tot as (
    select t.fecha as dia,
           sum(t.visitas) as v,
           case when count(t.visitantes) = count(*) then sum(t.visitantes) end as vis
    from public.trafico_web_diario t
    where t.ruta = '*'
      and (p_proyecto is null or t.proyecto = p_proyecto)
      and t.fecha between p_desde - 60 and p_hasta
    group by t.fecha
  ),
  s as (
    select d.dia, tot.v::bigint as v, tot.vis::bigint as vis, extract(isodow from d.dia)::int as dow
    from dias d left join tot on tot.dia = d.dia
  ),
  w as (
    select s.dia, s.v, s.vis,
           avg(s.v)         over w7   as m7,
           avg(s.v)         over w30  as m30,
           stddev_samp(s.v) over w30  as sd30,
           avg(s.v)         over wdow as mdow,
           stddev_samp(s.v) over wdow as sddow,
           count(s.v)       over wdow as ndow
    from s
    window
      w7   as (order by s.dia rows between 6 preceding and current row),
      w30  as (order by s.dia rows between 29 preceding and current row),
      wdow as (partition by s.dow order by s.dia rows between 8 preceding and 1 preceding)
  ),
  z as (
    select w.*, case when w.v is not null and w.ndow >= 3 and w.sddow > 0 then (w.v - w.mdow) / w.sddow end as zz
    from w
  )
  select z.dia, z.v, z.vis, round(z.m7, 2), round(z.m30, 2), round(z.sd30, 2), round(z.mdow, 2), round(z.sddow, 2),
         z.ndow::int, round(z.zz, 3),
         case when z.v is not null and z.mdow > 0 then round(100 * (z.v - z.mdow) / z.mdow, 2) end,
         case when z.zz is not null then abs(z.zz) > 2 end
  from z
  where z.dia between p_desde and p_hasta
  order by z.dia;
$$;
comment on function public.trafico_web_serie(text, date, date) is
  'Serie diaria de visitas (ruta ''*'') con medias 7/30, sigma 30, media/sigma de los 8 mismos días de la semana '
  'anteriores, z y anomalía (|z|>2). Huecos = NULL. p_proyecto NULL = todas las webs.';

-- Regresión lineal de las visitas diarias (últimos p_dias cerrados; x = 0 es hoy) y proyección de 30 días.
create or replace function public.trafico_web_tendencia(p_proyecto text default null, p_dias integer default 90)
returns table (pendiente numeric, intercepto numeric, r2 numeric, n integer, fiable boolean, proyeccion jsonb, total_30d numeric)
language sql stable security invoker set search_path = ''
as $$
  with t as (
    select (d.fecha - current_date)::float8 as x, sum(d.visitas)::float8 as y
    from public.trafico_web_diario d
    where d.ruta = '*'
      and (p_proyecto is null or d.proyecto = p_proyecto)
      and d.fecha >= current_date - least(greatest(coalesce(p_dias, 90), 1), 3650)
      and d.fecha < current_date
    group by d.fecha
  ),
  r as (
    select regr_slope(t.y, t.x) as b, regr_intercept(t.y, t.x) as a, regr_r2(t.y, t.x) as r2, regr_count(t.y, t.x)::int as n
    from t
  )
  select round(r.b::numeric, 4), round(r.a::numeric, 2), round(r.r2::numeric, 4), r.n, r.n >= 14,
         case when r.b is not null then (
           select jsonb_agg(jsonb_build_object('fecha', current_date + k, 'visitas', round(greatest(0, r.a + r.b * k)::numeric, 1)) order by k)
           from generate_series(1, 30) as k) end,
         case when r.b is not null then (
           select round(sum(greatest(0, r.a + r.b * k))::numeric, 0) from generate_series(1, 30) as k) end
  from r;
$$;
comment on function public.trafico_web_tendencia(text, integer) is
  'Regresión lineal de las visitas diarias (últimos p_dias cerrados). fiable = n >= 14. proyeccion = 30 días siguientes.';

-- ESTIMACIÓN de la transferencia (Fast Data Transfer) del mes: visitas × bytes por visita (peso de la ruta o, si no
-- hay, el ''*''; el resto de visitas no desglosadas, al peso medio). Filas por proyecto y ''*'' (total). Límite de
-- referencia: 100 GB (los del plan Hobby de Vercel); alerta_80 si la proyección pasa del 80 %.
create or replace function public.trafico_web_fdt_mes(p_mes date default null)
returns table (
  proyecto text, visitas_mes bigint, bytes_acumulados numeric, dias_con_dato integer, dias_mes integer, dias_restantes integer,
  bytes_medios_por_visita numeric, bytes_proy_lineal numeric, bytes_proy_regresion numeric, limite_bytes numeric,
  pct_limite numeric, pct_proyectado numeric, alerta_80 boolean
)
language sql stable security invoker set search_path = ''
as $$
  with rango as (
    select m.ini,
           (m.ini + interval '1 month')::date as fin,
           ((m.ini + interval '1 month')::date - m.ini) as n_dias,
           least((m.ini + interval '1 month')::date, current_date) as corte
    from (select date_trunc('month', coalesce(p_mes, current_date))::date as ini) m
  ),
  proyectos as (select unnest(array['cristaleriabv']) as proyecto),
  d as (
    select t.fecha, t.proyecto, t.ruta, t.visitas
    from public.trafico_web_diario t, rango
    where t.fecha >= rango.ini and t.fecha < rango.corte
  ),
  por_dia as (
    select d.fecha, d.proyecto,
           max(d.visitas) filter (where d.ruta = '*') as v_total,
           coalesce(sum(d.visitas) filter (where d.ruta <> '*'), 0) as v_rutas,
           sum(d.visitas::numeric * coalesce(pr.bytes_por_visita, pd.bytes_por_visita)) filter (where d.ruta <> '*') as b_rutas,
           bool_and(coalesce(pr.bytes_por_visita, pd.bytes_por_visita) is not null) filter (where d.ruta <> '*') as rutas_con_peso,
           max(pd.bytes_por_visita) as w_def
    from d
    left join public.peso_paginas pr on pr.proyecto = d.proyecto and pr.ruta = d.ruta and d.ruta <> '*'
    left join public.peso_paginas pd on pd.proyecto = d.proyecto and pd.ruta = '*'
    group by d.fecha, d.proyecto
  ),
  bytes_dia as (
    select p.fecha, p.proyecto, coalesce(p.v_total, p.v_rutas) as v,
           case
             when p.rutas_con_peso is false then null
             else coalesce(p.b_rutas, 0)
                  + case when greatest(0, coalesce(p.v_total, p.v_rutas) - p.v_rutas) = 0 then 0
                         else greatest(0, coalesce(p.v_total, p.v_rutas) - p.v_rutas) * p.w_def end
           end as b
    from por_dia p
  ),
  por_proyecto as (
    select pj.proyecto,
           sum(b.v)::bigint as visitas_mes,
           sum(b.b) as acum,
           count(b.b)::int as dias_dato,
           sum(b.b) / nullif(sum(b.v) filter (where b.b is not null), 0) as bmedio
    from proyectos pj left join bytes_dia b on b.proyecto = pj.proyecto
    group by pj.proyecto
  ),
  con_proy as (
    select pp.proyecto, pp.visitas_mes, pp.acum, pp.dias_dato, pp.bmedio,
           rango.n_dias, (rango.fin - greatest(rango.ini, rango.corte)) as restantes,
           case when pp.dias_dato > 0 then pp.acum / pp.dias_dato * rango.n_dias end as proy_lineal,
           case when rango.fin <= rango.corte then pp.acum
                when tend.pendiente is null or pp.bmedio is null then null
                else coalesce(pp.acum, 0) + pp.bmedio * (
                       select sum(greatest(0, tend.intercepto + tend.pendiente * ((greatest(rango.ini, rango.corte) + i) - current_date)))
                       from generate_series(0, rango.fin - greatest(rango.ini, rango.corte) - 1) as i)
           end as proy_regresion
    from por_proyecto pp
    cross join rango
    left join lateral public.trafico_web_tendencia(pp.proyecto, 90) tend on true
  ),
  filas as (
    select c.proyecto, c.visitas_mes, c.acum, c.dias_dato, c.n_dias, c.restantes, c.bmedio, c.proy_lineal, c.proy_regresion
    from con_proy c
    union all
    select '*', sum(c.visitas_mes)::bigint, sum(c.acum), max(c.dias_dato), max(c.n_dias), max(c.restantes),
           sum(c.acum) / nullif(sum(c.visitas_mes) filter (where c.acum is not null), 0),
           sum(c.proy_lineal), sum(c.proy_regresion)
    from con_proy c
  )
  select f.proyecto, f.visitas_mes, round(f.acum, 0), f.dias_dato, f.n_dias, f.restantes, round(f.bmedio, 0),
         round(f.proy_lineal, 0), round(f.proy_regresion, 0), 100e9::numeric, round(100 * f.acum / 100e9, 2),
         round(100 * greatest(f.proy_lineal, f.proy_regresion) / 100e9, 2),
         coalesce(greatest(f.proy_lineal, f.proy_regresion) > 80e9, false)
  from filas f
  order by (f.proyecto = '*') desc, f.proyecto;
$$;
comment on function public.trafico_web_fdt_mes(date) is
  'ESTIMACIÓN de la transferencia del mes (visitas × bytes por visita). Filas por proyecto y ''*'' (total). Límite de '
  'referencia 100e9 bytes; alerta_80 si max(proy_lineal, proy_regresion) > 80e9.';

-- Páginas más vistas del periodo con la transferencia estimada. p_orden visitas | bytes. Límite 1..100.
create or replace function public.trafico_web_top_paginas(
  p_proyecto text default null, p_desde date default (current_date - 30), p_hasta date default (current_date - 1),
  p_limite integer default 20, p_orden text default 'visitas'
)
returns table (proyecto text, ruta text, visitas bigint, bytes_estimados numeric, pct_visitas numeric, pct_bytes numeric)
language sql stable security invoker set search_path = ''
as $$
  with d as (
    select t.proyecto, t.ruta, t.visitas
    from public.trafico_web_diario t
    where t.fecha between p_desde and p_hasta and (p_proyecto is null or t.proyecto = p_proyecto)
  ),
  tot as (
    select coalesce(sum(d.visitas) filter (where d.ruta = '*'), sum(d.visitas) filter (where d.ruta <> '*')) as v_total from d
  ),
  r as (
    select d.proyecto, d.ruta, sum(d.visitas)::bigint as v,
           case when bool_and(coalesce(pr.bytes_por_visita, pd.bytes_por_visita) is not null)
                then sum(d.visitas::numeric * coalesce(pr.bytes_por_visita, pd.bytes_por_visita)) end as b
    from d
    left join public.peso_paginas pr on pr.proyecto = d.proyecto and pr.ruta = d.ruta
    left join public.peso_paginas pd on pd.proyecto = d.proyecto and pd.ruta = '*'
    where d.ruta <> '*'
    group by d.proyecto, d.ruta
  ),
  tb as (select sum(r.b) as b_total from r)
  select r.proyecto, r.ruta, r.v, round(r.b, 0), round(100.0 * r.v / nullif(tot.v_total, 0), 2), round(100.0 * r.b / nullif(tb.b_total, 0), 2)
  from r, tot, tb
  order by case when p_orden = 'bytes' then r.b end desc nulls last, r.v desc, r.proyecto, r.ruta
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;
comment on function public.trafico_web_top_paginas(text, date, date, integer, text) is
  'Páginas más vistas del periodo con la transferencia ESTIMADA. p_orden visitas | bytes. Límite 1..100.';

-- Reparto de visitas por valor de una dimensión (device | country | referrer) en el periodo.
create or replace function public.trafico_web_desglose_resumen(
  p_proyecto text default null, p_dimension text default 'device', p_desde date default (current_date - 30),
  p_hasta date default (current_date - 1), p_limite integer default 10
)
returns table (valor text, visitas bigint, visitantes bigint, pct numeric)
language sql stable security invoker set search_path = ''
as $$
  with g as (
    select t.valor, sum(t.visitas)::bigint as v,
           case when count(t.visitantes) = count(*) then sum(t.visitantes)::bigint end as vis
    from public.trafico_web_desglose t
    where t.dimension = p_dimension and t.fecha between p_desde and p_hasta and (p_proyecto is null or t.proyecto = p_proyecto)
    group by t.valor
  ),
  tot as (select sum(g.v) as s from g)
  select g.valor, g.v, g.vis, round(100.0 * g.v / nullif(tot.s, 0), 2)
  from g, tot
  order by g.v desc, g.valor
  limit least(greatest(coalesce(p_limite, 10), 1), 100);
$$;
comment on function public.trafico_web_desglose_resumen(text, text, date, date, integer) is
  'Reparto de visitas por valor de una dimensión (device | country | referrer) en el periodo.';

-- ─── Tarea nocturna: llamar a sync-trafico-web ──────────────────────────────
-- Igual que las demás tareas del panel (avisos_telegram_disparar, ocr_despachar): la URL y el secreto salen de Vault
-- en cada ejecución (project_url y ocr_trabajos_secret = OCR_TRABAJOS_SECRET de las funciones). Sin Vault no llama a
-- nadie y lo dice («sin_vault»); nunca falla.
create or replace function public.trafico_web_disparar()
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
  -- 55 s: la primera vez trae 30 días (seis consultas a Vercel).
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    using rtrim(v_url, '/') || '/functions/v1/sync-trafico-web',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          jsonb_build_object('origen', 'cron');
  return 'llamada';
end;
$$;
comment on function public.trafico_web_disparar() is
  'Lo llama pg_cron (sync-trafico-web, 03:30 UTC): POST a la Edge Function sync-trafico-web con x-ocr-secret. '
  'Necesita en Vault project_url y ocr_trabajos_secret; sin ellos devuelve sin_vault y no llama a nadie.';

revoke all on function public.trafico_web_serie(text, date, date), public.trafico_web_tendencia(text, integer),
  public.trafico_web_fdt_mes(date), public.trafico_web_top_paginas(text, date, date, integer, text),
  public.trafico_web_desglose_resumen(text, text, date, date, integer), public.peso_paginas_al_editar(),
  public.trafico_web_disparar() from public, anon;
grant execute on function public.trafico_web_serie(text, date, date), public.trafico_web_tendencia(text, integer),
  public.trafico_web_fdt_mes(date), public.trafico_web_top_paginas(text, date, date, integer, text),
  public.trafico_web_desglose_resumen(text, text, date, date, integer), public.peso_paginas_al_editar()
to authenticated, service_role;
revoke all on function public.trafico_web_disparar() from authenticated;
grant execute on function public.trafico_web_disparar() to service_role;

-- 03:30 UTC: el día anterior ya está cerrado en UTC y en Madrid.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'sync-trafico-web';
    perform cron.schedule('sync-trafico-web', '30 3 * * *', $cron$ select public.trafico_web_disparar(); $cron$);
  else
    raise notice 'Sin pg_cron: la tarea sync-trafico-web NO se ha instalado.';
  end if;
end;
$$;
