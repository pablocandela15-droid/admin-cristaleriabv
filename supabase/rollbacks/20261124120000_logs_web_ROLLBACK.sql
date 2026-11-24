-- Vuelta atrás de 20261124120000_logs_web.sql: quita la tarea procesar-logs-web, el disparador de presupuestos, las
-- tablas de Logs web (eventos, sesiones, incidencias, contadores, estado, resúmenes de IA y catálogo), sus funciones y
-- las funciones de IA procesar-logs-web y resumen-logs-web. web_logs_config y web_linear_prueba (del núcleo, las usa
-- Tickets) vuelven a como estaban: solo las columnas de Linear, y el destino de pruebas solo con lo de Tickets. Se
-- pierden los eventos y las incidencias guardados. La web sigue funcionando: sin las tablas, registrar-actividad-web
-- responde 503 y el navegador descarta en silencio.
begin;
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'procesar-logs-web';
  end if;
  if to_regclass('public.presupuestos') is not null then
    execute 'drop trigger if exists web_logs_operacion_bd on public.presupuestos';
  end if;
end $$;

drop function if exists public.logs_web_disparar() cascade;
drop function if exists public.web_logs_operacion_bd() cascade;
drop function if exists public.web_logs_fallos_cron(timestamptz) cascade;
drop function if exists public.web_incidencia_pedir_ticket(bigint) cascade;
drop function if exists public.web_comportamiento(date, date, text, boolean) cascade;
drop function if exists public.web_comportamiento_resumen(date, date, text, boolean) cascade;
drop function if exists public.web_logs_estado_recogida(text) cascade;
drop function if exists public.web_contexto_evento(bigint, integer, integer) cascade;
drop function if exists public.web_buscar_eventos(timestamptz, timestamptz, text, text, text, text, text, text, text, text, boolean, boolean, integer, integer) cascade;
drop function if exists public.web_buscar_sesiones(timestamptz, timestamptz, text, text, text, text, text, text, boolean, boolean, boolean, boolean, integer, integer) cascade;
drop function if exists public.web_logs_purgar(integer) cascade;
drop function if exists public.web_logs_agrupar_errores(integer) cascade;
drop function if exists public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) cascade;
drop function if exists public.web_logs_proveedor_externo(text, text, text, text, text) cascade;
drop function if exists public.web_logs_clasificar_tras_publicar(timestamptz) cascade;
drop function if exists public.web_logs_es_version_antigua(text, text, text, text) cascade;
drop function if exists public.web_logs_recalcular_sesiones(uuid[]) cascade;
drop function if exists public.web_logs_ingerir(jsonb, jsonb) cascade;
drop function if exists public.web_logs_entorno() cascade;
drop function if exists public.web_logs_puede_ver_estadisticas() cascade;
drop function if exists public.web_incidencias_al_editar() cascade;

-- El destino de pruebas se queda (lo usa Tickets): sin lo de Logs.
alter table public.web_linear_prueba drop constraint if exists web_linear_prueba_incidencia_fk;
delete from public.web_linear_prueba where incidencia_id is not null;
drop policy if exists "acceso_panel_no_bloqueado" on public.web_linear_prueba;
-- En el núcleo se auditaba (la migración se lo quitó como dato derivado).
do $$ begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.web_linear_prueba';
    execute 'create trigger trg_auditoria after insert or update or delete on public.web_linear_prueba
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end $$;

drop table if exists public.web_resumenes_ia cascade;
drop table if exists public.web_logs_limite_ip cascade;
drop table if exists public.web_logs_ingesta_diaria cascade;
drop table if exists public.web_logs_estado cascade;
drop table if exists public.web_sesiones cascade;
drop table if exists public.web_eventos cascade;
drop table if exists public.web_incidencias cascade;
drop table if exists public.web_eventos_catalogo cascade;

-- La configuración vuelve a la del núcleo: solo Linear, editable entera por el super admin.
drop trigger if exists web_logs_config_al_editar on public.web_logs_config;
drop function if exists public.web_logs_config_al_editar() cascade;
drop policy if exists "acceso_panel_no_bloqueado" on public.web_logs_config;
alter table public.web_logs_config drop constraint if exists web_logs_config_logs_chk;
alter table public.web_logs_config
  drop column if exists recoger_actividad, drop column if exists recoger_errores_navegador, drop column if exists recoger_peticiones,
  drop column if exists recoger_errores_servidor, drop column if exists recoger_integraciones, drop column if exists recoger_hosting,
  drop column if exists entornos_aceptados, drop column if exists entornos_ticket, drop column if exists rutas_excluidas,
  drop column if exists mensajes_ignorados, drop column if exists umbral_ocurrencias, drop column if exists umbral_sesiones,
  drop column if exists umbral_ventana_horas, drop column if exists tickets_404, drop column if exists umbral_404_diario,
  drop column if exists excluir_pruebas_tickets, drop column if exists reapertura, drop column if exists retencion_actividad_dias,
  drop column if exists retencion_errores_dias, drop column if exists limite_eventos_dia, drop column if exists limite_eventos_sesion,
  drop column if exists limite_eventos_ip_minuto, drop column if exists linear_estado_reabrir_id, drop column if exists linear_max_tickets_dia,
  drop column if exists linear_tickets_externos, drop column if exists ia_activada, drop column if exists ia_max_analisis_dia,
  drop column if exists entorno_bd;
comment on table public.web_logs_config is
  'Configuración de Linear para los tickets (fila única). Solo super admin la lee y la cambia.';
grant select, update on public.web_logs_config to authenticated;

-- Funciones de IA de Logs (su consumo ya contado en ia_uso se queda).
delete from public.ia_modelo_funcion where funcion in ('procesar-logs-web', 'resumen-logs-web');
delete from public.ia_funciones where funcion in ('procesar-logs-web', 'resumen-logs-web');

-- La lista de exclusión de la auditoría vuelve a la del núcleo.
do $$
declare
  v_def text;
  v_lista constant text := '''ia_uso'',''web_eventos'',''web_sesiones'',''web_incidencias'',''web_logs_estado'',''web_logs_ingesta_diaria'',''web_logs_limite_ip'',''web_linear_prueba'',''web_resumenes_ia'',''web_eventos_catalogo'',''trafico_web_diario'',''trafico_web_desglose'',''trafico_web_sync_estado'',';
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position(v_lista in v_def) > 0 then
      execute replace(v_def, v_lista, '''ia_uso'',');
    end if;
  end loop;
end $$;
commit;
