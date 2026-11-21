-- Vuelta atrás de 20261121100000_facturas.sql: borra TODO el módulo Facturas (tablas, funciones, tareas programadas,
-- políticas del bucket y filas de IA) y deja el núcleo como estaba. Se pierden las facturas y su catálogo. El bucket
-- «facturas-originales» se borra solo si está vacío; si no, vacíalo antes desde Storage (Supabase no deja borrar
-- ficheros con SQL).
begin;
do $$ begin if exists (select 1 from pg_extension where extname = 'pg_cron') then
  perform cron.unschedule(jobname) from cron.job where jobname in ('reanudar-trabajos-ocr', 'clasificar-productos', 'limpiar-pendientes-ocr');
end if; end $$;

do $$ begin if to_regclass('storage.objects') is not null then
  drop policy if exists facturas_originales_select on storage.objects;
  drop policy if exists facturas_originales_select_subida on storage.objects;
  drop policy if exists facturas_originales_pendientes_insert on storage.objects;
  begin
    delete from storage.buckets b
     where b.id = 'facturas-originales'
       and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
  exception when others then
    raise notice 'El bucket facturas-originales no se ha podido borrar (%): bórralo desde Storage.', sqlerrm;
  end;
end if; end $$;

drop table if exists public.avisos_subida_precio cascade;
drop table if exists public.facturas_sustituciones cascade;
drop table if exists public.ocr_trabajo_paginas cascade;
drop table if exists public.productos_factura cascade;
drop table if exists public.facturas cascade;
drop table if exists public.ocr_trabajos cascade;
drop table if exists public.productos_alias cascade;
drop table if exists public.productos_catalogo cascade;
drop table if exists public.categorias_producto cascade;
drop table if exists public.proveedores_alias cascade;
drop table if exists public.proveedores cascade;
drop table if exists public.configuracion_facturas cascade;

drop function if exists public.normalizar_texto(text) cascade;
drop function if exists public.normalizar_nombre_producto(text) cascade;
drop function if exists public.texto_busqueda_compras(text) cascade;
drop function if exists public.normalizar_cif(text) cascade;
drop function if exists public.normalizar_proveedor_base(text) cascade;
drop function if exists public.proveedor_clave(text) cascade;
drop function if exists public.normalizar_unidad_factura(text) cascade;
drop function if exists public.unidad_comparable(text) cascade;
drop function if exists public.es_servicio_compras(text) cascade;
drop function if exists public.precio_es(numeric,integer) cascade;
drop function if exists public.cif_distancia(text,text) cascade;
drop function if exists public.cif_control_valido(text) cascade;
drop function if exists public.normalizar_proveedor(text) cascade;
drop function if exists public.facturas_puede_subir_usuario(uuid) cascade;
drop function if exists public.facturas_puede_subir() cascade;
drop function if exists public.factura_subida_por_mi(bigint) cascade;
drop function if exists public.productos_puede_editar() cascade;
drop function if exists public.proveedores_puede_editar() cascade;
drop function if exists public.proveedores_mantener_alias() cascade;
drop function if exists public.facturas_asignar_proveedor() cascade;
drop function if exists public.proveedores_fusionar(bigint[],bigint) cascade;
drop function if exists public.proveedores_notas_ia_guardar(bigint,text) cascade;
drop function if exists public.facturas_rellenar_subido_por() cascade;
drop function if exists public.facturas_origen_verificacion() cascade;
drop function if exists public.facturas_subida_solo_lo_leido() cascade;
drop function if exists public.recalcular_alertas_factura(bigint) cascade;
drop function if exists public.productos_factura_recalcular_alertas() cascade;
drop function if exists public.productos_factura_recalcular_alertas_lote() cascade;
drop function if exists public.categorias_producto_validar() cascade;
drop function if exists public.productos_factura_asignar_producto() cascade;
drop function if exists public.trg_productos_factura_normalizar_unidad() cascade;
drop function if exists public.productos_factura_aviso_precio() cascade;
drop function if exists public.productos_borrar(bigint) cascade;
drop function if exists public.productos_recategorizar(bigint[],bigint) cascade;
drop function if exists public.productos_renombrar(bigint,text) cascade;
drop function if exists public.productos_fusionar(bigint[],bigint) cascade;
drop function if exists public.productos_asignar_lineas(bigint[],bigint,text,bigint) cascade;
drop function if exists public.productos_aplicar_clasificacion_ia(jsonb) cascade;
drop function if exists public.productos_asignar_por_alias(text[],integer,integer) cascade;
drop function if exists public.productos_despachar_clasificacion() cascade;
drop function if exists public.buscar_documentos_compras(text) cascade;
drop function if exists public.ocr_sumar_gasto(uuid,numeric,integer) cascade;
drop function if exists public.ocr_despachar_cola() cascade;
drop function if exists public.ocr_reclamar_pagina(bigint,integer) cascade;
drop function if exists public.ocr_reclamar_consolidacion(uuid,integer) cascade;
drop function if exists public.ocr_resumen_factura(bigint) cascade;
drop function if exists public.ocr_terminar_trabajo(uuid,text,jsonb,bigint,text,jsonb) cascade;
drop function if exists public.ocr_pedir_relectura(uuid,jsonb) cascade;
drop function if exists public.ocr_fallo_pagina(bigint,text) cascade;
drop function if exists public.ocr_cerrar_pagina(bigint,jsonb,jsonb,jsonb,jsonb,integer,integer,integer,integer,integer,integer,numeric,jsonb,text) cascade;
drop function if exists public.ocr_descartar_trabajo(uuid) cascade;
drop function if exists public.ocr_reintentar_trabajo(uuid) cascade;
drop function if exists public.ocr_despachar(uuid) cascade;
drop function if exists public.reanudar_trabajos_ocr() cascade;
drop function if exists public.estadisticas_lectura(integer) cascade;
drop function if exists public.verificar_duplicado_factura(character varying,character varying,date,numeric) cascade;
drop function if exists public.configuracion_facturas_tocar() cascade;
drop function if exists public.validar_cordura_factura(bigint) cascade;
drop function if exists public.factura_cumple_autoverificacion(bigint) cascade;
drop function if exists public.facturas_autoverificar() cascade;
drop function if exists public.proveedor_resolver(text,text,boolean) cascade;
drop function if exists public.proveedores_editar(bigint,text,text,text) cascade;
drop function if exists public.ocr_factura_existente(text,text,text,date,numeric) cascade;
drop function if exists public.ocr_resumen_factura_datos(bigint) cascade;
drop function if exists public.ocr_sustituir_factura(bigint,uuid,uuid,jsonb,jsonb,jsonb,text) cascade;
drop function if exists public.ocr_anadir_pagina(bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb,text) cascade;
drop function if exists public.productos_resumen(date,date) cascade;
drop function if exists public.productos_gasto_por_categoria(date,date) cascade;
drop function if exists public.proveedores_listado() cascade;
drop function if exists public.meses_compras_incompletos() cascade;
drop function if exists public.documentos_lista() cascade;
drop function if exists public.documento_compras(bigint) cascade;
drop function if exists public.lineas_precio_producto(bigint,bigint[]) cascade;
drop function if exists public.precio_referencia_producto(bigint,text,date,bigint) cascade;
drop function if exists public.productos_avisar_subidas(bigint[]) cascade;
drop function if exists public.proveedor_es_cliente(text,text) cascade;
drop function if exists public.ocr_trabajo_es_mio(uuid) cascade;
drop function if exists public.factura_original_es_mio(text) cascade;
drop function if exists public.ocr_trabajos_por_limpiar(integer) cascade;
drop function if exists public.ocr_marcar_limpiado(uuid) cascade;
drop function if exists public.ocr_despachar_limpieza() cascade;

-- La sección de los avisos vuelve a la del núcleo (sin Facturas).
drop policy if exists notificaciones_facturas_solo_seccion on public.notificaciones_dashboard;
create or replace function public.seccion_aviso(p_tipo text)
returns text language sql immutable set search_path = public
as $$
  select case
    when p_tipo like 'peticion\_%' then 'solo_super_admin'
    else 'dashboard'
  end
$$;

-- Funciones de IA y avisos del módulo.
delete from public.ia_coste_estimado where funcion in ('procesar-factura', 'ocr-trabajo', 'clasificar-productos');
delete from public.ia_modelo_funcion where funcion in ('procesar-factura', 'ocr-trabajo', 'clasificar-productos');
delete from public.ia_funciones where funcion in ('procesar-factura', 'ocr-trabajo', 'clasificar-productos');
delete from public.notificaciones_dashboard where tipo like 'facturas\_%' or tipo = 'subida_precio';
delete from public.admin_feature_toggles where section_key in ('facturas', 'facturas_subida');

drop extension if exists unaccent;
commit;
