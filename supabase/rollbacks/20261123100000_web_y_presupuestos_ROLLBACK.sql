-- Vuelta atrás de 20261123100000_web_y_presupuestos.sql: borra TODO el módulo (álbumes y fotos de la web, contenido,
-- tarifas, presupuestos y sus líneas, el contador, el límite por IP, sus funciones, las políticas del bucket, los
-- avisos de solicitudes y los permisos de sus secciones) y deja el núcleo (y Facturas, si está) como estaba. Se pierden
-- los presupuestos y lo editado de la web: la web vuelve sola a los valores de su código. El bucket «web-fotos» se
-- borra solo si está vacío; si no, vacíalo antes desde Storage (Supabase no deja borrar ficheros con SQL).
begin;
do $$ begin if to_regclass('storage.objects') is not null then
  drop policy if exists web_fotos_storage_select on storage.objects;
  drop policy if exists web_fotos_storage_insert on storage.objects;
  drop policy if exists web_fotos_storage_update on storage.objects;
  drop policy if exists web_fotos_storage_delete on storage.objects;
  begin
    delete from storage.buckets b
     where b.id = 'web-fotos'
       and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
  exception when others then
    raise notice 'El bucket web-fotos no se ha podido borrar (%): bórralo desde Storage.', sqlerrm;
  end;
end if; end $$;

drop table if exists public.presupuesto_lineas cascade;
drop table if exists public.presupuestos cascade;
drop table if exists public.presupuestos_numeracion cascade;
drop table if exists public.web_solicitudes_limite cascade;
drop table if exists public.web_fotos cascade;
drop table if exists public.web_albumes cascade;
drop table if exists public.web_contenido cascade;
drop table if exists public.web_tarifas cascade;

drop function if exists public.web_solicitud_presupuesto_registrar(text, jsonb, integer) cascade;
drop function if exists public.web_nombre_categoria(text) cascade;
drop function if exists public.web_euros(numeric) cascade;
drop function if exists public.presupuesto_lineas_recalcular() cascade;
drop function if exists public.presupuesto_calcular_totales() cascade;
drop function if exists public.presupuesto_asignar_numero() cascade;
drop function if exists public.web_fotos_limpiar_referencias() cascade;
drop function if exists public.web_marcar_autor() cascade;
drop function if exists public.web_marcar_actualizado() cascade;

-- La sección de los avisos vuelve a la de antes: la de Facturas si está instalada; si no, la del núcleo.
drop policy if exists notificaciones_presupuestos_solo_seccion on public.notificaciones_dashboard;
do $$ begin
  if to_regclass('public.facturas') is not null then
    create or replace function public.seccion_aviso(p_tipo text)
    returns text language sql immutable set search_path = public
    as $f$
      select case
        when p_tipo like 'peticion\_%' then 'solo_super_admin'
        when p_tipo like 'facturas\_%' or p_tipo = 'subida_precio' then 'facturas'
        else 'dashboard'
      end
    $f$;
  else
    create or replace function public.seccion_aviso(p_tipo text)
    returns text language sql immutable set search_path = public
    as $f$
      select case
        when p_tipo like 'peticion\_%' then 'solo_super_admin'
        else 'dashboard'
      end
    $f$;
  end if;
end $$;

-- Avisos, permisos, roles preconfigurados, sección de inicio e interruptores del módulo.
delete from public.notificaciones_dashboard where tipo like 'presupuesto\_%';
delete from public.user_permissions where section_key in ('web_fotos', 'web_tarifas', 'web_contenido', 'presupuestos');
update public.user_role_presets p
   set permissions = (select coalesce(jsonb_agg(e), '[]'::jsonb)
                        from jsonb_array_elements(p.permissions) e
                       where e->>'section_key' is null
                          or e->>'section_key' not in ('web_fotos', 'web_tarifas', 'web_contenido', 'presupuestos'))
 where jsonb_typeof(p.permissions) = 'array'
   and exists (select 1 from jsonb_array_elements(p.permissions) e
                where e->>'section_key' in ('web_fotos', 'web_tarifas', 'web_contenido', 'presupuestos'));
update public.user_roles set seccion_inicio = null where seccion_inicio in ('web', 'presupuestos');
delete from public.admin_feature_toggles where section_key in ('web', 'presupuestos');
commit;
