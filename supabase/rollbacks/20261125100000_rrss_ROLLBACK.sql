-- Vuelta atrás de 20261125100000_rrss.sql: quita las tareas rrss-programador, rrss-metricas y rrss-mantenimiento, las
-- tablas de RRSS (ajustes y estilo, conexión con Meta y sus tokens cifrados, states del OAuth, piezas, ficheros,
-- programaciones, campañas, fechas señaladas, tope de la IA y métricas), sus funciones, las políticas del cubo «rrss»,
-- la función de IA «rrss-ia», la rama rrss_* de los avisos y los permisos de la sección «rrss» (permisos, roles
-- preconfigurados, sección de inicio e interruptor del módulo).
-- OJO: se pierden las publicaciones programadas (no saldrán), el historial y las métricas guardadas. Lo ya publicado
-- en Instagram y Facebook se queda allí. Antes de deshacer, desactiva el módulo y quita la app de Meta si no se va a
-- volver a usar (Meta › Configuración › Integraciones comerciales).
-- El cubo «rrss» y sus ficheros NO se borran aquí (Storage no deja borrar un cubo con ficheros por SQL): vacíalo y
-- bórralo desde el Dashboard de Supabase (Storage › rrss) si ya no se necesita.
begin;
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('rrss-programador', 'rrss-metricas', 'rrss-mantenimiento');
  end if;
end $$;

do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists rrss_objetos_select on storage.objects';
    execute 'drop policy if exists rrss_objetos_insert on storage.objects';
    execute 'drop policy if exists rrss_objetos_delete on storage.objects';
  end if;
end $$;

drop view if exists public.rrss_metricas_publicacion_ultima cascade;
drop table if exists public.rrss_metricas_publicacion cascade;
drop table if exists public.rrss_metricas_cuenta cascade;
drop table if exists public.rrss_metricas_capturas cascade;
drop table if exists public.rrss_programaciones cascade;
drop table if exists public.rrss_medios cascade;
drop table if exists public.rrss_piezas cascade;
drop table if exists public.rrss_campanas cascade;
drop table if exists public.rrss_fechas cascade;
drop table if exists public.rrss_ia_peticiones cascade;
drop table if exists public.rrss_oauth_estados cascade;
drop table if exists public.rrss_meta_tokens cascade;
drop table if exists public.rrss_meta_cuenta cascade;
drop table if exists public.rrss_ajustes cascade;

drop function if exists public.rrss_purgar() cascade;
drop function if exists public.rrss_disparar(text) cascade;
drop function if exists public.rrss_hay_trabajo() cascade;
drop function if exists public.rrss_que_funciona(integer, integer) cascade;
drop function if exists public.rrss_descartar_campana(uuid) cascade;
drop function if exists public.rrss_aceptar_campana(uuid, integer[], boolean) cascade;
drop function if exists public.rrss_campanas_al_editar() cascade;
drop function if exists public.rrss_fechas_entre(date, date) cascade;
drop function if exists public.rrss_fechas_al_editar() cascade;
drop function if exists public.rrss_marcar_medios_borrados(text[]) cascade;
drop function if exists public.rrss_ficheros_para_borrar(integer, integer, integer) cascade;
drop function if exists public.rrss_comprobar_cupo_ia() cascade;
drop function if exists public.rrss_pieza_cerrar(uuid, uuid, text, jsonb) cascade;
drop function if exists public.rrss_pieza_progreso(uuid, uuid, text, text[], text, text, boolean) cascade;
drop function if exists public.rrss_pieza_reservar(uuid, integer, boolean) cascade;
drop function if exists public.rrss_programador_cerrar(uuid, uuid, text, text, text, text, integer) cascade;
drop function if exists public.rrss_programador_reclamar(integer) cascade;
drop function if exists public.rrss_cancelar_programacion(uuid) cascade;
drop function if exists public.rrss_programar(uuid, timestamptz, boolean) cascade;
drop function if exists public.rrss_reprogramar(uuid, timestamptz, boolean) cascade;
drop function if exists public.rrss_programacion_pieza(uuid) cascade;
drop function if exists public.rrss_programacion_conflictos(text, timestamptz, uuid) cascade;
drop function if exists public.rrss_programacion_validar_fecha(timestamptz) cascade;
drop function if exists public.rrss_programaciones_al_editar() cascade;
drop function if exists public.rrss_fotos_web() cascade;
drop function if exists public.rrss_medios_antes() cascade;
drop function if exists public.rrss_piezas_antes_de_borrar() cascade;
drop function if exists public.rrss_piezas_antes() cascade;
drop function if exists public.rrss_pieza_problemas(uuid) cascade;
drop function if exists public.rrss_pieza_publicandose(uuid) cascade;
drop function if exists public.rrss_objeto_existe(text) cascade;
drop function if exists public.rrss_oauth_usar_estado(text) cascade;
drop function if exists public.rrss_ajustes_al_editar() cascade;
drop function if exists public.rrss_es_panel() cascade;
drop function if exists public.rrss_exigir_edicion() cascade;
drop function if exists public.rrss_textos_validos(text[], integer) cascade;
drop function if exists public.rrss_hashtags_validos(text[]) cascade;
drop function if exists public.rrss_ruta_valida(text) cascade;

-- Avisos: la función vuelve a la de Presupuestos (20261123100000); los avisos rrss_* que queden pasan a verse con
-- «Dashboard».
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
drop policy if exists notificaciones_rrss_solo_seccion on public.notificaciones_dashboard;
delete from public.notificaciones_dashboard where tipo like 'rrss\_%';

-- IA: la función deja de existir (el consumo ya registrado en ia_uso se conserva).
do $$ begin
  if to_regclass('public.ia_modelo_funcion') is not null then
    delete from public.ia_modelo_funcion where funcion = 'rrss-ia';
  end if;
  if to_regclass('public.ia_funciones') is not null then
    update public.ia_funciones set activo = false, instrumentada = false where funcion = 'rrss-ia';
  end if;
end $$;

-- La lista de exclusión de la auditoría vuelve a la de antes.
do $$
declare
  v_def text;
  v_extra constant text := ',''rrss_meta_tokens'',''rrss_oauth_estados'',''rrss_ia_peticiones'',''rrss_metricas_cuenta'',''rrss_metricas_publicacion'',''rrss_metricas_capturas'')';
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position(v_extra in v_def) > 0 then
      execute replace(v_def, v_extra, ')');
    end if;
  end loop;
end $$;

-- Permisos, roles preconfigurados, sección de inicio e interruptor del módulo.
delete from public.user_permissions where section_key = 'rrss';
update public.user_role_presets p
   set permissions = (select coalesce(jsonb_agg(e), '[]'::jsonb)
                        from jsonb_array_elements(p.permissions) e
                       where e->>'section_key' is null or e->>'section_key' <> 'rrss')
 where jsonb_typeof(p.permissions) = 'array'
   and exists (select 1 from jsonb_array_elements(p.permissions) e where e->>'section_key' = 'rrss');
update public.user_roles set seccion_inicio = null where seccion_inicio = 'rrss';
delete from public.admin_feature_toggles where section_key = 'rrss';
commit;
