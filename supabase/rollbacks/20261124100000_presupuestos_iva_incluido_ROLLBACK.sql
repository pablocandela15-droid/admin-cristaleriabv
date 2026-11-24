-- Vuelta atrás de 20261124100000_presupuestos_iva_incluido.sql: web_solicitud_presupuesto_registrar() vuelve a su
-- cuerpo de 20261123100000_web_y_presupuestos.sql (el precio de la web como precio de la línea, y el presupuesto le
-- suma el IVA) y las solicitudes sin atender que se ajustaron (o que llegaron después) vuelven a llevar el precio web
-- como precio de la línea. Los presupuestos que ya se están trabajando no se tocan.
begin;

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

comment on function public.web_solicitud_presupuesto_registrar(text, jsonb, integer) is null;

update public.presupuesto_lineas l
   set precio_unitario = l.precio_calculado
  from public.presupuestos p
 where p.id = l.presupuesto_id
   and p.estado = 'solicitud'
   and p.origen = 'web'
   and l.categoria is not null
   and l.precio_calculado is not null
   and l.precio_unitario = round(l.precio_calculado / (1 + p.iva_pct / 100), 2)
   and p.iva_pct > 0;

commit;
