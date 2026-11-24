-- Vuelta atrás de 20261124173700_newsletter.sql: quita las tareas newsletter-sync-resend y newsletter-purgar, las
-- tablas del newsletter (ajustes, suscriptores y sus tokens, envíos, plantillas, peticiones a la IA, sincronizaciones
-- con Resend, límite de altas, eventos de correo y direcciones suprimidas), sus funciones, la función de IA
-- «newsletter-ia» y los permisos de la sección «newsletter» (permisos, roles preconfigurados, sección de inicio e
-- interruptor del módulo).
-- OJO: se pierden los suscriptores y la prueba de su consentimiento. Si hay suscriptores reales, expórtalos antes
-- (Newsletter › Suscriptores › Exportar CSV). Los enlaces de baja de los correos ya enviados dejarán de funcionar:
-- antes de deshacer, desactiva el módulo y no envíes más newsletters.
begin;
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('newsletter-sync-resend', 'newsletter-purgar');
  end if;
end $$;

drop function if exists public.newsletter_disparar_sync() cascade;
drop function if exists public.newsletter_purgar() cascade;
drop function if exists public.newsletter_estadisticas_envios(uuid[]) cascade;
drop function if exists public.newsletter_suprimir(uuid) cascade;
drop function if exists public.newsletter_baja_panel(uuid) cascade;
drop function if exists public.newsletter_importar(jsonb, text) cascade;
drop function if exists public.newsletter_alta_panel(text, text, text) cascade;
drop function if exists public.newsletter_alta_equipo(text, text, text, text) cascade;
drop function if exists public.newsletter_texto_alta_panel() cascade;
drop function if exists public.newsletter_exigir_edicion() cascade;
drop function if exists public.newsletter_marcar_sincronizados(jsonb) cascade;
drop function if exists public.newsletter_preparar_confirmaciones(uuid[], integer) cascade;
drop function if exists public.newsletter_registrar_baja(text, text, uuid) cascade;
drop function if exists public.newsletter_baja_por_token(text, text) cascade;
drop function if exists public.newsletter_estado_baja(text) cascade;
drop function if exists public.newsletter_confirmar(text) cascade;
drop function if exists public.newsletter_alta_web(text, text, text, text, text, integer) cascade;
drop function if exists public.newsletter_emitir_confirmacion(uuid) cascade;

drop table if exists public.newsletter_claves cascade;
drop table if exists public.newsletter_suscriptores cascade;
drop table if exists public.newsletter_altas_limite cascade;
drop table if exists public.newsletter_envios cascade;
drop table if exists public.newsletter_plantillas cascade;
drop table if exists public.newsletter_ia_peticiones cascade;
drop table if exists public.newsletter_sincronizaciones_resend cascade;
drop table if exists public.email_eventos cascade;
drop table if exists public.direcciones_email_suprimidas cascade;
drop table if exists public.newsletter_config cascade;

drop function if exists public.newsletter_comprobar_cupo_ia() cascade;
drop function if exists public.newsletter_plantillas_fijar_autor() cascade;
drop function if exists public.newsletter_config_autor() cascade;
drop function if exists public.newsletter_suscriptores_despues() cascade;
drop function if exists public.newsletter_suscriptores_proteger() cascade;
drop function if exists public.newsletter_normalizar_email() cascade;
drop function if exists public.newsletter_hash_token(text) cascade;
drop function if exists public.newsletter_token_aleatorio() cascade;

-- IA: la función deja de existir (el consumo ya registrado en ia_uso se conserva).
do $$ begin
  if to_regclass('public.ia_modelo_funcion') is not null then
    delete from public.ia_modelo_funcion where funcion = 'newsletter-ia';
  end if;
  if to_regclass('public.ia_funciones') is not null then
    update public.ia_funciones set activo = false, instrumentada = false where funcion = 'newsletter-ia';
  end if;
end $$;

-- Logs de la web: fuera el evento «newsletter_alta» del catálogo (los eventos ya recibidos se conservan).
do $$ begin
  if to_regclass('public.web_eventos_catalogo') is not null then
    delete from public.web_eventos_catalogo where tipo = 'newsletter_alta';
  end if;
end $$;

-- La lista de exclusión de la auditoría vuelve a la de antes.
do $$
declare
  v_def text;
  v_lista constant text := '''metricas'',''newsletter_claves'',''newsletter_altas_limite'',''newsletter_ia_peticiones'',''newsletter_sincronizaciones_resend'',''email_eventos'')';
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position(v_lista in v_def) > 0 then
      execute replace(v_def, v_lista, '''metricas'')');
    end if;
  end loop;
end $$;

-- Permisos, roles preconfigurados, sección de inicio e interruptor del módulo.
delete from public.user_permissions where section_key = 'newsletter';
update public.user_role_presets p
   set permissions = (select coalesce(jsonb_agg(e), '[]'::jsonb)
                        from jsonb_array_elements(p.permissions) e
                       where e->>'section_key' is null or e->>'section_key' <> 'newsletter')
 where jsonb_typeof(p.permissions) = 'array'
   and exists (select 1 from jsonb_array_elements(p.permissions) e where e->>'section_key' = 'newsletter');
update public.user_roles set seccion_inicio = null where seccion_inicio = 'newsletter';
delete from public.admin_feature_toggles where section_key = 'newsletter';
commit;
