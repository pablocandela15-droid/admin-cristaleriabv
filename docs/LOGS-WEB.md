# Super Admin › Logs: actividad de la web, errores e incidencias en Linear

Pantalla **Super Admin › Logs** (`/super-admin/logs`, solo super admin) y sección **Comportamiento de los visitantes** en [Tráfico web](TRAFICO-WEB.md). Sirve para:

- reconstruir el recorrido de una visita, desde la entrada hasta la última actividad observada;
- detectar errores solos, agruparlos y abrir o actualizar tickets en Linear (o en el destino de pruebas);
- sacar estadísticas de comportamiento (embudos de presupuesto y de contacto, calculadora, contenidos, procedencia…) con las mismas definiciones en Logs y en Tráfico web.

Viene del panel de referencia (OficiosOsIA), adaptado a la web de la cristalería: eventos de la calculadora, de la solicitud de presupuesto, de WhatsApp y teléfono y del formulario de contacto; nada de restaurante; sin informe en PDF. Todo son datos reales de la web y de sus servicios: no hay históricos anteriores al primer evento recibido.

## Cómo funciona

```
Navegador (web cristaleriabv, src/lib/actividad)
  └─ lotes text/plain cada 5 s / al ocultar la página (sendBeacon) ──►  Edge Function registrar-actividad-web
                                                                         (origen permitido, saneado, bots, HMAC de la IP)
Funciones del servidor (envoltorio audit-client: los 5xx) ───────────►  RPC web_logs_ingerir ──► web_eventos + web_sesiones
Base de datos (trigger en presupuestos con origen 'web') ────────────►        (sin duplicados, topes por sesión, IP y día)
pg_cron «procesar-logs-web» (*/5 * * * *) ──► Edge Function procesar-logs-web (x-ocr-secret = OCR_TRABAJOS_SECRET)
                        ├─ recolectores: tareas de pg_cron fallidas, sincronización de Tráfico web, despliegues de Vercel en ERROR
                        ├─ web_logs_agrupar_errores: incidencias por huella, umbrales, reapertura
                        ├─ tickets: Linear real o destino de pruebas (web_linear_prueba), con análisis de IA
                        └─ purga diaria (retención)
Panel: Super Admin › Logs y Tráfico web › Comportamiento ──► RPC web_* (RLS; el comportamiento agregado, también con «Ver» en Tráfico web)
```

Migración: [`20261124120000_logs_web.sql`](../supabase/migrations/20261124120000_logs_web.sql) (vuelta atrás en `supabase/rollbacks/`). Completa la tabla `web_logs_config` del núcleo (fila única) con la configuración de Logs y crea `web_eventos_catalogo`, `web_eventos`, `web_sesiones`, `web_incidencias`, `web_logs_estado`, `web_logs_ingesta_diaria`, `web_logs_limite_ip` y `web_resumenes_ia`; las RPC `web_*`; el trigger `web_logs_operacion_bd` en `presupuestos`; las funciones de IA en Servicios › Modelos; `logs_web_disparar()` y la tarea `procesar-logs-web`. El destino de pruebas `web_linear_prueba` (del núcleo) pasa a guardar también los tickets de Logs.

Funciones: `registrar-actividad-web` (pública, `verify_jwt = false`, con protección propia), `procesar-logs-web` (cron con el secreto o super admin: «Procesar ahora», «Probar conexión con Linear») y `resumen-logs-web` (con «Ver» en Tráfico web).

## Qué se registra

| Qué | Dónde | Ejemplo |
|---|---|---|
| **Actividad** | `web_eventos.categoria = 'actividad'` | `pagina_vista`, `pagina_salida`, `scroll`, `clic`, `contacto` (WhatsApp, teléfono, correo, mapa, redes), `calculadora` (inicio, categoría, paso, calculado), `formulario` (inicio, avance, envío, error de validación, abandono), `media` (galería de trabajos), `chat` |
| **Operaciones completadas** | `categoria = 'operacion'` | `presupuesto_solicitado` (la función respondió con el número), `presupuesto_rechazado`, `contacto_enviado` (formulario de contacto o de visita); desde la BD, `presupuesto_solicitado_bd` y `presupuesto_aceptado_bd` |
| **Técnico** | `categoria = 'tecnico'` | `carga_pagina` (TTFB, LCP, CLS), `peticion` (endpoint, código) |
| **Errores** | `categoria = 'error'` | JavaScript, promesas, recursos, peticiones fallidas, React, 404, funciones del servidor, integraciones, despliegues |
| **Incidencias agrupadas** | `web_incidencias` | Una por entorno y huella, con frecuencia, sesiones y ticket |

Pulsar «Solicitar presupuesto» es un `clic`; solo cuenta como conversión la respuesta del servidor (`presupuesto_solicitado`) o el envío del formulario de contacto (`contacto_enviado`). El catálogo completo, con lo que significa cada evento, está en **Logs › Configuración › Estado y cobertura** (tabla `web_eventos_catalogo`, espejo de `supabase/functions/_shared/logs-web/eventos.ts`; un test comprueba que dicen lo mismo).

La calculadora manda el servicio elegido, el paso y, al calcular, el importe orientativo (IVA incluido). **Nunca** medidas, opciones, nombre, teléfono ni lo que se escribe en los formularios (de los formularios solo cuántos campos hay rellenos).

## Privacidad y cobertura

- La web **no usa cookies ni guarda nada en el navegador** del visitante para medir. La sesión es un identificador aleatorio que vive solo en la pestaña (al recargar, empieza otra); no hay identificador de visitante.
- **«No rastrear» (DNT) o Global Privacy Control** desactivan la actividad: de esos navegadores solo llegan los errores (sin sesión ni recorrido). Por eso las sesiones son **una parte** de las visitas de Vercel.
- **Operaciones de la BD**: las solicitudes de presupuesto de la web (y cuándo se aceptan) quedan apuntadas para todos los visitantes, con o sin «No rastrear». Sirven de referencia para saber cuántas conversiones no se ven en las sesiones.
- **No se graba**: ni pantallas ni pulsaciones, ni el contenido de los formularios, ni la IP. Para el límite por minuto se usa un HMAC de la IP con sal diaria, que se borra a la hora.
- **Tráfico interno**: visitando la web con `?bv_interno=1` se marca ese navegador (es lo único que la web guarda, y solo si se pide así; `?bv_interno=0` lo quita). Las pruebas automáticas (`navigator.webdriver`) y los bots se marcan solos. Las estadísticas los excluyen salvo que actives «Incluir internas y pruebas»; los bots, siempre.
- **Errores del servidor**: los registra el envoltorio común de las funciones (`_shared/audit-client.ts`) en cuanto cada función se vuelve a desplegar. Se puede apagar con el secreto `LOGS_WEB_ERRORES_SERVIDOR=off`.
- **Integraciones**: tareas de pg_cron fallidas y la sincronización de Tráfico web. **Hosting**: despliegues de la web (`cristaleriabv`) en ERROR, si hay token de Vercel.
- **Fuera de alcance por ahora**: la actividad del propio panel, los logs de Postgres de Supabase y los logs de ejecución de Vercel.

## Definiciones (las mismas en todas las pantallas)

Fuente única: `src/components/trafico-web/comportamiento/definiciones.ts`. El cálculo está en la RPC `web_comportamiento`.

- **Visitas** (Vercel): páginas vistas de todos los visitantes, sin cookies, por días en UTC.
- **Sesiones**: actividad de una pestaña de un navegador que deja medir; 30 minutos sin actividad abren otra.
- **Embudo de presupuesto**: entrada (sesiones) → consulta (abre `/presupuesto` o usa la calculadora) → inicio (calcula un precio o empieza el formulario de presupuesto) → finalización (`presupuesto_solicitado`: la solicitud guardada). **Embudo de contacto**: entrada → consulta (abre `/contacto` o pulsa teléfono, WhatsApp, correo o mapa) → inicio (empieza el formulario de contacto o de visita) → finalización (`contacto_enviado`).
- **Abandono estimado**: empezó la operación y no la terminó en esa sesión (pudo llamar por teléfono u otro día).
- **Última página observada**: no es una salida confirmada.
- Días y franjas en **hora de Madrid**. El periodo anterior tiene la misma duración. Con menos de 30 sesiones se avisa de que la muestra es pequeña.

## Incidencias y Linear

- **Huella estable**: no cambia con los números, los ids, el hash de los ficheros de Next.js ni la línea. Sí cambia con el tipo, el mensaje normalizado o la función donde salta; en los 404, con la ruta.
- **Umbrales** (configurables): por defecto, 3 ocurrencias y 2 sesiones distintas en 24 h; los errores del servidor no exigen sesiones; los **críticos** abren ticket a la primera (la solicitud de presupuesto que falla con 5xx o sin respuesta). Los 404 solo si se activa, por encima de su umbral diario. Los bots nunca cuentan; con «No contar pruebas automáticas…» (por defecto) tampoco el tráfico interno.
- **Versión antigua tras publicar** («ChunkLoadError», «Failed to load chunk», ficheros `/_next/static/…` que ya no existen): quien tenía la web abierta durante una publicación. Cada ocurrencia se clasifica en `web_eventos.tras_publicar` («esperado tras publicar · sin impacto», «sin datos de después», «sin conexión», «no se arregló al recargar · revisar»); solo la última cuenta para los umbrales.
- **Sin duplicados**: `UNIQUE (entorno, huella)`, advisory lock al agrupar, arrendamiento por incidencia y el ticket se crea en Linear con un **id determinista** (`linear_uuid`).
- **Repeticiones**: se comenta el ticket con la frecuencia nueva cada 6 h, o antes si las ocurrencias se duplican. **Reaparición de una resuelta** (configurable): reabrirla y avisar en el mismo ticket (por defecto), ticket nuevo enlazado, o dejarla resuelta.
- **Estado de Linear**: cerrado allí → «resuelta» aquí; cancelado → «ignorada»; borrado → se suelta.
- **Tope diario**: como mucho `linear_max_tickets_dia` (10) tickets nuevos al día, primero los más graves.
- **Si Linear o la IA fallan**: la incidencia se queda pendiente con su próximo intento (5, 10, 20… minutos, máximo 6 h). Si la IA falla dos veces, el ticket sale sin análisis y lo dice.
- **Destino** (`web_logs_config.linear_modo`): `prueba` (por defecto: guarda en `web_linear_prueba` exactamente lo que se mandaría, visible con «Ver lo enviado al destino de pruebas»), `real` (necesita `LINEAR_API_KEY` y el equipo) o `desactivado`. Es el mismo destino que usa «Enviar a Linear» de Tickets.
- La automatización **solo detecta, analiza y crea o actualiza tickets**. Nunca ejecuta lo que digan los logs ni toca producción.

## Origen: fallo de la web, servicio externo o no depende de la web

Cada error (`web_eventos.origen`) y cada incidencia (`web_incidencias.origen`) se clasifican con reglas fijas, sin IA (`web_logs_origen_error()` en SQL; espejo en `supabase/functions/_shared/logs-web/origen.ts`, con los mismos casos en `__tests__/logs-web-origen-casos.json` para los dos):

| Color | Origen | Cuándo | Tickets |
|---|---|---|---|
| **Rojo** | Fallo de la web | JS de nuestro código, React, 404 de nuestras páginas, 5xx de nuestras funciones, despliegue fallido, versión antigua que no se arregló al recargar | Sí (umbrales) |
| **Ámbar** | Servicio externo | Google Maps, OpenStreetMap, Instagram/Meta, WhatsApp, OpenAI, Google Drive, Resend, Vercel, Telegram, Linear, Google Fonts, YouTube, Supabase saturado (pg_cron) o un recurso de otro dominio | Solo con «Los servicios externos también pueden abrir ticket» |
| **Gris** | Conexión del visitante | Sin respuesta, «Failed to fetch», «Load failed», cancelada… | Nunca |
| **Gris** | Navegador o extensión | `chrome-extension://`…, «ResizeObserver loop», «Script error.», bloqueadores (incluido `/_vercel/insights`) | Nunca |
| **Gris** | Versión antigua (se arregló sola) | `tras_publicar` sin impacto o sin datos de después | Nunca |
| **Gris** | Bots y pruebas | Solo ocurrencias de bots, pruebas automáticas o tráfico interno | Nunca |

Dominios propios (no son «externos»): `cristaleriabv.vercel.app` y sus previews, `cristaleriabaixvinalopo.es`, el panel (`admin-cristaleriabv*.vercel.app`), `*.supabase.co` y `localhost`.

## Explicación en sencillo e IA

- Cada incidencia y cada sesión empiezan con un bloque en español llano (qué hizo el cliente, qué falló, si afecta y qué hacer); lo técnico va plegado. Los errores conocidos tienen texto fijo (`causas.ts`, `sencillo.ts`); los nuevos, una explicación de la IA escrita una vez por incidencia, marcada «Explicación de la IA · sin comprobar».
- La IA solo ve la incidencia agrupada y saneada (nunca visitas sueltas) y, en el resumen del periodo, cifras agregadas: cada conclusión tiene que citar una cifra o se descarta. Caché de 6 h. Tope diario configurable (`ia_max_analisis_dia`, 20).
- Modelo: `gpt-4.1-mini` por defecto, elegible en *Super Admin › Servicios › Modelos* (funciones `procesar-logs-web` y `resumen-logs-web`). Clave: `OPENAI_API_KEY`. El coste se apunta en `ia_uso`. Sin clave, todo funciona sin explicaciones ni resúmenes.

## Configuración (Logs › Configuración)

Una sola configuración (fila única de `web_logs_config`) en subpestañas: **Recogida** (fuentes, entornos aceptados —producción y demo—, exclusiones), **Incidencias y avisos** (umbrales, entornos que abren ticket —solo producción—, reapertura, externos), **Linear** (destino, equipo, proyecto, etiquetas, estado al reabrir, tope diario), **IA y costes**, **Retención y límites** (actividad 90 días, errores 180; 50.000 eventos al día, 400 por sesión, 300 por IP y minuto) y **Estado y cobertura** («Procesar ahora», ingesta de los últimos días, catálogo). `entorno_bd` (demo o producción) lo pone la migración según el proyecto y no se puede editar. Las credenciales nunca se guardan aquí: son secretos de las funciones.

## Puesta en marcha

1. Aplicar la migración (después de la de Tráfico web) y desplegar las tres funciones: `registrar-actividad-web`, `procesar-logs-web`, `resumen-logs-web`.
2. Vault `project_url` + `ocr_trabajos_secret` y el secreto `OCR_TRABAJOS_SECRET` (los mismos de las demás tareas programadas). Sin ellos la tarea `procesar-logs-web` no llama a nada; se puede lanzar a mano con **Procesar ahora**.
3. En la web, `NEXT_PUBLIC_SUPABASE_URL` del mismo proyecto (la que ya usa la calculadora): sin ella la web no manda nada. No hace falta clave: la función es pública y se protege sola. Las previews de Vercel cuentan como «demo», `localhost` como «local» y la web publicada como «producción». Otro dominio: secreto `LOGS_WEB_ORIGENES_EXTRA` (`https://dominio=produccion,…`).
4. Opcionales: `LOGS_WEB_VERCEL_TOKEN` (despliegues en ERROR; si no, usa `VERCEL_ANALYTICS_TOKEN` o `SERVICIOS_VERCEL_TOKEN`), `LOGS_WEB_URL_PANEL` (enlace al detalle en los tickets; si no, `PANEL_URL` / `PANEL_URL_DEMO`), `OPENAI_API_KEY`, `LINEAR_API_KEY`.

**Linear real (cuando se quiera)**: en Linear, *Settings › Security & access › Personal API keys › New API key*; en Supabase, secreto `LINEAR_API_KEY` (primero en la demo); en Logs › Configuración › Linear, «Probar conexión con Linear», elegir equipo (y proyecto, etiquetas, estado al reabrir), cambiar el destino a «Linear» y **Guardar configuración**. Sin clave, todo sigue en el destino de pruebas.

## Comprobar

- `curl -X POST https://<ref>.supabase.co/functions/v1/registrar-actividad-web -H 'Origin: https://ejemplo.com' -d '{}'` → 403 (origen no permitido).
- Abrir la web publicada, usar la calculadora y pulsar WhatsApp: en unos segundos, *Logs › Sesiones* enseña la sesión con su recorrido, y *Tráfico web › Comportamiento* las cifras (tras la pasada de 5 minutos).
- *Logs › Configuración › Estado y cobertura*: la última pasada del proceso y la ingesta del día.

## Límites conocidos

- La cobertura de sesiones depende de que el navegador deje medir; recargar la página empieza otra sesión.
- Los errores que ocurren antes de cargar el JavaScript de la web no se ven.
- `sendBeacon` al cerrar la página es «lo mejor posible»: si el navegador lo descarta, se pierde el último lote. Los ids impiden duplicados en los reintentos.
- Los días de Vercel son UTC y los nuestros, hora de Madrid.

## Deshacer

`supabase/rollbacks/20261124120000_logs_web_ROLLBACK.sql`: quita la tarea, el trigger de presupuestos, las tablas y RPC de Logs y deja `web_logs_config` y `web_linear_prueba` como las tenía el núcleo. La web sigue funcionando sin tablas: la ingesta responde 503 y el navegador descarta en silencio.
