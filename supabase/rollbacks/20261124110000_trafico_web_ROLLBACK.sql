-- Vuelta atrás de 20261124110000_trafico_web.sql: quita la tarea nocturna sync-trafico-web, las tablas de Tráfico web
-- (visitas, desgloses, pesos y estado), sus funciones y los permisos de la sección «trafico_web» (permisos, roles
-- preconfigurados, sección de inicio e interruptor del módulo). Se pierden las visitas copiadas de Vercel (Vercel
-- solo guarda 31 días en el plan Hobby: lo anterior no se puede volver a traer). Logs web
-- (20261124120000_logs_web.sql) lee trafico_web_diario si existe: deshaz antes esa migración si quieres quitar las dos.
begin;
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'sync-trafico-web';
  end if;
end $$;

drop function if exists public.trafico_web_disparar() cascade;
drop function if exists public.trafico_web_desglose_resumen(text, text, date, date, integer) cascade;
drop function if exists public.trafico_web_top_paginas(text, date, date, integer, text) cascade;
drop function if exists public.trafico_web_fdt_mes(date) cascade;
drop function if exists public.trafico_web_tendencia(text, integer) cascade;
drop function if exists public.trafico_web_serie(text, date, date) cascade;

drop table if exists public.trafico_web_sync_estado cascade;
drop table if exists public.peso_paginas cascade;
drop table if exists public.trafico_web_desglose cascade;
drop table if exists public.trafico_web_diario cascade;
drop function if exists public.peso_paginas_al_editar() cascade;

-- Avisos de la sincronización, permisos, roles preconfigurados, sección de inicio e interruptor del módulo.
delete from public.notificaciones_dashboard where tipo = 'sistema' and titulo like 'Tráfico web:%';
delete from public.user_permissions where section_key = 'trafico_web';
update public.user_role_presets p
   set permissions = (select coalesce(jsonb_agg(e), '[]'::jsonb)
                        from jsonb_array_elements(p.permissions) e
                       where e->>'section_key' is null or e->>'section_key' <> 'trafico_web')
 where jsonb_typeof(p.permissions) = 'array'
   and exists (select 1 from jsonb_array_elements(p.permissions) e where e->>'section_key' = 'trafico_web');
update public.user_roles set seccion_inicio = null where seccion_inicio = 'trafico_web';
delete from public.admin_feature_toggles where section_key = 'trafico_web';
commit;
