# Tráfico web: visitas de la web y lo que hacen los visitantes

Sección **Tráfico web** del Admin Panel (`/trafico-web`, permiso «trafico_web»). Enseña las visitas de la web de la cristalería (proyecto `cristaleriabv` de Vercel, https://cristaleriabv.vercel.app) y, debajo, lo que hacen los visitantes: calculadora, solicitudes de presupuesto, WhatsApp, teléfono, formulario de contacto, trabajos y servicios que miran.

Viene del panel de referencia (OficiosOsIA), adaptado: una sola web (sin selector de web), sin nada de restaurante y sin el informe mensual en PDF.

## Qué se ve

- **Periodo**: 30, 90, 180 o 365 días (días cerrados: hasta ayer). Todo lo de la página cambia con él.
- **Cifras**: visitas y visitantes del periodo con el Δ % frente al periodo anterior de la misma duración, y la tendencia (regresión lineal; con pocos días sale «poco fiable»).
- **Gráfica día a día** con las medias de 7 y 30 días, la tendencia y los **días raros** (anomalías): |z| > 2 frente a los 8 mismos días de la semana anteriores (hacen falta al menos 3 con dato; si no, el día queda sin marcar).
- **Transferencia del mes** (estimación): visitas × peso medio por página, proyectada a fin de mes (lineal y por regresión) frente al límite del plan Hobby de Vercel (**100 GB**). Avisa si la proyección pasa del 80 %. Es una ESTIMACIÓN: el dato real está en Vercel › Usage (enlace en la tarjeta).
- **Páginas más vistas** y **desgloses**: procedencia (referente), país, dispositivo, navegador y sistema operativo.
- **Comportamiento de los visitantes**: las mismas cifras que *Super Admin › Logs › Estadísticas* (una sola RPC, `web_comportamiento`, con las mismas definiciones): embudos de presupuesto y de contacto, calculadora, contactos (WhatsApp, teléfono, correo, mapa), contenidos (servicios, trabajos, calculadora) y procedencia. Con IA (si hay clave), un resumen del periodo que siempre cita cifras. El enlace «Ver recorridos y errores en Logs» solo sale al super admin.
- **Pesos por página** (botón arriba a la derecha): peso medio en bytes de cada página al abrirla, para la estimación. La fila `*` es el valor por defecto (1.200.000 bytes, sembrado por la migración). Con «Ver» se consultan; con «Editar» en la sección se cambian (cada cambio queda en la auditoría).

Sin datos, la página dice cuándo llega la primera sincronización y, si nunca se ha intentado, qué falta configurar. Si falta el token de Vercel, el aviso de arriba lo dice con los pasos.

## De dónde salen los datos

```
Web (cristaleriabv, <Analytics /> de @vercel/analytics, sin cookies)
  └─► Vercel Web Analytics
         │  pg_cron «sync-trafico-web» (30 3 * * * UTC)
         ▼
Edge Function sync-trafico-web (x-ocr-secret = OCR_TRABAJOS_SECRET)
  └─► trafico_web_diario (por día y ruta; '*' = total) · trafico_web_desglose · trafico_web_sync_estado
Panel: /trafico-web ──► RPC trafico_web_serie / _tendencia / _fdt_mes / _top_paginas / _desglose_resumen (RLS: «Ver» en trafico_web)
```

- La función pide a la API de Vercel (`/v1/query/web-analytics/visits/aggregate`) los **últimos 3 días cerrados** en cada pasada (Vercel corrige los días recientes) y, la primera vez o tras un hueco, hasta **30 días** (el plan Hobby solo guarda 31). Nunca pide días anteriores al 24/11/2026, cuando la web empezó a llevar Vercel Web Analytics: antes no hay datos y saldrían como «0 visitas».
- Si el proyecto de Vercel no tiene Web Analytics activado, lo apunta con un texto que dice cómo activarlo (sin contar como caída).
- Si falla, deja un aviso en la campana (`Tráfico web: …`, como mucho uno al día UTC) y lo reintenta en la pasada siguiente.
- Los fallos de la sincronización salen además en *Super Admin › Logs* como incidencia de integración.

Migración: [`20261124110000_trafico_web.sql`](../supabase/migrations/20261124110000_trafico_web.sql) (vuelta atrás en `supabase/rollbacks/`). Tablas `trafico_web_diario`, `trafico_web_desglose`, `peso_paginas`, `trafico_web_sync_estado`; RPC `trafico_web_*`; `trafico_web_disparar()` y la tarea `sync-trafico-web`. El comportamiento necesita además la migración de Logs ([LOGS-WEB.md](LOGS-WEB.md)); sin ella, la sección lo dice y el resto funciona.

## Puesta en marcha

1. **Vercel (web)**: en el proyecto `cristaleriabv`, *Analytics › Enable* (Web Analytics, gratis en Hobby) y desplegar la web con `@vercel/analytics` (ya está en el repositorio de la web).
2. **Token de Vercel**: *Vercel › Account Settings › Tokens › Create* (ámbito: el equipo de la web, `pablo1505`). En Supabase › *Edge Functions › Secrets*: `VERCEL_ANALYTICS_TOKEN`.
3. Opcionales (solo si cambian): `VERCEL_ANALYTICS_PROJECT` (id `prj_…` o nombre del proyecto; por defecto `cristaleriabv`) y `VERCEL_ANALYTICS_TEAM` (id `team_…` o slug; por defecto `SERVICIOS_VERCEL_TEAM_ID` y, si no, `pablo1505`).
4. **Vault**: `project_url` y `ocr_trabajos_secret` (los mismos de las demás tareas programadas, [DESPLIEGUE.md](DESPLIEGUE.md#4-vault-tareas-programadas)), y `OCR_TRABAJOS_SECRET` con el mismo valor en los secretos de las funciones.
5. Desplegar la función: `npx supabase functions deploy sync-trafico-web --project-ref <ref>` (`verify_jwt = false`: se protege con el secreto).
6. Para no esperar a la noche, en *SQL Editor*: `select public.trafico_web_disparar();` (devuelve `llamada` o `sin_vault`).

Sin Vault la tarea no llama a nada; sin token, la función apunta «Falta configurar el token de Vercel…» y la página lo enseña.

## Permisos

- «Ver» en Tráfico web: toda la página, incluido el comportamiento agregado (la RPC comprueba el permiso). Las sesiones sueltas, los errores y la configuración de Logs son solo del super admin.
- «Editar»: además, los pesos por página.
- El módulo se puede apagar en *Super Admin › Control del Panel* (grupo «Web y clientes»).

## Límites conocidos

- Vercel cuenta páginas vistas sin cookies y por días en UTC; el comportamiento lo cuenta la propia web en hora de Madrid y sin quien tenga «No rastrear» o Global Privacy Control. Las cifras se parecen, pero no coinciden exactamente.
- Lo de hoy aparece mañana (días cerrados). El comportamiento sí se pone al día cada 5 minutos.
- La transferencia es una estimación con los pesos que se pongan; la cifra buena es la de Vercel › Usage.
- Lo anterior a 31 días que no se haya copiado no se puede recuperar (límite del plan Hobby).

## Deshacer

`supabase/rollbacks/20261124110000_trafico_web_ROLLBACK.sql` (antes, si se quiere quitar también, el de Logs). Quita la tarea, las tablas, las funciones y la sección «trafico_web» de permisos, plantillas, sección de inicio e interruptor.
