# Puesta en marcha de un entorno (demo o producción)

Guía para montar el panel de Cristalería BV desde cero en un proyecto de Supabase y en Vercel. Primero la **demo**; producción solo cuando el dueño lo pida (ver [PROCESO-DE-CAMBIOS.md](PROCESO-DE-CAMBIOS.md)).

## 1. Proyecto de Supabase

1. Crea el proyecto (región `eu-central-1` o la más cercana) y apunta su **ref** (`https://<ref>.supabase.co`).
2. En *Database › Extensions* deja activadas `pg_cron`, `pg_net` y `supabase_vault` (la migración las crea si faltan).
3. Guarda el ref en las variables del repositorio de GitHub (*Settings › Secrets and variables › Actions › Variables*): `SUPABASE_REF_DEMO` y, cuando exista, `SUPABASE_REF_PRODUCCION`.

## 2. Esquema de la base de datos

Migraciones, en este orden (cada una con su vuelta atrás en `supabase/rollbacks/`):

1. [`20261118120000_nucleo_panel.sql`](../supabase/migrations/20261118120000_nucleo_panel.sql): el núcleo del panel (login, usuarios, permisos, auditoría, avisos, servicios, IA…).
2. [`20261121100000_facturas.sql`](../supabase/migrations/20261121100000_facturas.sql): el módulo **Facturas** (facturas de proveedores con lectura automática, catálogo de productos, proveedores, avisos de subida de precio, el bucket privado `facturas-originales` y sus tareas programadas). Ver [FACTURAS.md](FACTURAS.md).
3. [`20261123100000_web_y_presupuestos.sql`](../supabase/migrations/20261123100000_web_y_presupuestos.sql): la **web editable** (fotos de los trabajos, textos, tarifas y catálogo de la calculadora, que la web lee con su clave pública, y el bucket **público** `web-fotos`) y los **presupuestos** (con su número correlativo y las solicitudes que llegan de la web). Trae los textos y precios que tiene hoy la web: hasta que alguien los cambie en el panel, la web se ve igual. Ver [WEB.md](WEB.md).
4. [`20261124100000_presupuestos_iva_incluido.sql`](../supabase/migrations/20261124100000_presupuestos_iva_incluido.sql): el precio de la calculadora de la web **lleva IVA**: las solicitudes de la web guardan la línea sin IVA y el precio web como precio calculado (y se ajustan las solicitudes sin atender). Ver [PRESUPUESTOS.md](PRESUPUESTOS.md#iva-el-precio-de-la-web-lleva-iva).
5. [`20261124110000_trafico_web.sql`](../supabase/migrations/20261124110000_trafico_web.sql): **Tráfico web** (sección `trafico_web` del Admin Panel): las visitas que copia cada noche `sync-trafico-web` desde Vercel Web Analytics, los pesos por página y la tarea `sync-trafico-web`. Ver [TRAFICO-WEB.md](TRAFICO-WEB.md).
6. [`20261124120000_logs_web.sql`](../supabase/migrations/20261124120000_logs_web.sql): **Super Admin › Logs** (actividad de la web, errores, incidencias con Linear o el destino de pruebas, estadísticas de comportamiento), el trigger que apunta las solicitudes de presupuesto de la web y la tarea `procesar-logs-web`. Ver [LOGS-WEB.md](LOGS-WEB.md).

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

(O pega cada fichero en *SQL Editor*, en orden, y ejecútalo entero.) Antes, en local: `npm run test:nucleo:db` (prueba todas, su vuelta atrás y que se pueden volver a aplicar).

## 3. Primer super admin

1. En *Authentication › Users* crea el usuario (email y contraseña).
2. En *SQL Editor*:

```sql
insert into public.super_admins (user_id, email)
  select id, email from auth.users where email = '<email>';
```

Desde ahí, el resto de usuarios y permisos se gestionan en **Super Admin › Usuarios**. Los usuarios sin email real entran con su nombre de usuario (se guarda como `usuario@staff.local`).

## 4. Vault (tareas programadas)

Las tareas de pg_cron (avisos por Telegram, vigilante de fallos, centro de modelos de IA, costes reales de OpenAI; de Facturas, la lectura de documentos en segundo plano, la clasificación de productos y la limpieza diaria; y de la web, `sync-trafico-web` y `procesar-logs-web`) llaman a las Edge Functions con un secreto. En *SQL Editor*:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<una frase larga aleatoria>', 'ocr_trabajos_secret');
```

El mismo valor de `ocr_trabajos_secret` va en el secreto `OCR_TRABAJOS_SECRET` de las funciones (paso 5). Sin Vault las tareas no llaman a nada (no fallan); en Facturas, sin Vault **no se lee ningún documento**: la lectura va siempre por trabajos que Postgres despacha a `ocr-trabajo` con este secreto, y se quedan en cola hasta que esté.

Tareas de Facturas (las instala su migración si hay pg_cron): `reanudar-trabajos-ocr` (cada minuto: rescata lecturas paradas; sin trabajos activos no hace nada), `clasificar-productos` (cada 5 minutos: asigna las líneas nuevas a su producto, primero por lo ya conocido y, si quedan, con IA) y `limpiar-pendientes-ocr` (3:40 cada día: borra del bucket las piezas de lecturas terminadas hace más de 7 días).

Tareas de la web (las instalan sus migraciones si hay pg_cron): `sync-trafico-web` (3:30 UTC cada día: copia las visitas del día anterior desde Vercel) y `procesar-logs-web` (cada 5 minutos: agrupa los errores de la web, abre o actualiza tickets y purga lo antiguo). Para lanzarlas a mano: `select public.trafico_web_disparar();` y `select public.logs_web_disparar();` (devuelven `llamada` o `sin_vault`).

Tareas de RRSS (las instala su migración si hay pg_cron): `rrss-programador` (cada 5 minutos, solo si hay algo vencido: publica lo programado en Instagram y Facebook), `rrss-metricas` (5:10 UTC: copia las métricas; sin conexión no llama a Meta) y `rrss-mantenimiento` (3:50 UTC: purga, limpia el cubo `rrss` y avisa si la conexión con Meta va a caducar). A mano: `select public.rrss_disparar('programar');` (o `'metricas'`, `'mantenimiento'`). Ver [RRSS.md](RRSS.md#tareas-programadas).

## 5. Edge Functions

Despliega todas las de `supabase/functions/` (la configuración de `verify_jwt` está en `supabase/config.toml`):

```bash
for f in admin-create-user admin-delete-user admin-set-super-admin admin-set-user-access admin-update-user-password \
         analizar-peticion auditoria-revertir avisos-telegram cambiar-mi-contrasena clasificar-productos control-excel \
         enviar-newsletter ia-modelos-openai leer-metricas list-users newsletter-alta newsletter-baja newsletter-ia \
         newsletter-sync-resend ocr-trabajo panel-auth procesar-factura procesar-logs-web registrar-actividad-web \
         registrar-metrica resend-webhook resumen-logs-web rrss-conexion rrss-ia rrss-metricas rrss-oauth \
         rrss-programador rrss-publicar servicios-uso sincronizar-costes-openai sync-trafico-web \
         web-solicitud-presupuesto; do
  npx supabase functions deploy "$f" --project-ref <ref>
done
```

`web-solicitud-presupuesto` y `registrar-actividad-web` son las públicas (las llama la web, `verify_jwt = false`): no necesitan ningún secreto propio. Las de la newsletter (`newsletter-alta`, `newsletter-baja`, `resend-webhook`) también son públicas y se explican en [NEWSLETTER.md](NEWSLETTER.md). Usan los de Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, que además es la sal de la huella de IP de los límites) y en el bucket `web-fotos` no hay que configurar nada (lo crea la migración). `registrar-actividad-web` solo acepta la web publicada (producción), sus previews de Vercel (demo) y `localhost` (local); otro dominio, con `LOGS_WEB_ORIGENES_EXTRA`. `sync-trafico-web` y `procesar-logs-web` también llevan `verify_jwt = false`: las protege `OCR_TRABAJOS_SECRET` (y, en «Procesar ahora», la sesión de super admin). Las de RRSS con `verify_jwt = false` (`rrss-oauth`, a la que vuelve Facebook, y `rrss-programador` y `rrss-metricas`, que llama pg_cron) se explican en [RRSS.md](RRSS.md#1-migración-y-funciones).

Secretos (*Edge Functions › Secrets*). Obligatorio para el login: ninguno extra (usa los de Supabase). El resto activa cada parte:

| Secreto | Para qué | Sin él |
|---|---|---|
| `OCR_TRABAJOS_SECRET` | Que pg_cron pueda llamar a las funciones (mismo valor que en Vault) | Las tareas programadas no funcionan |
| `SUPABASE_REF_PRODUCCION`, `SUPABASE_REF_DEMO` | Saber en qué entorno corre cada función | Todo se trata como «local» |
| `PANEL_URL` (y `PANEL_URL_DEMO`) | Enlaces al panel en Telegram y en los tickets enviados a Linear | Sin enlaces |
| `OPENAI_API_KEY` | Análisis de los tickets con IA, «Crear con IA» de la newsletter, la ayuda de la IA de RRSS, explicaciones y resúmenes de Logs y Tráfico web (y, si no hay `OPENAI_API_KEY_OCR`, la lectura de facturas) | El análisis no se hace |
| `OPENAI_API_KEY_OCR` | Facturas: leer los documentos y clasificar productos (proceso «ocr»; si falta, usa `OPENAI_API_KEY`) | Facturas no lee nada: la subida falla con «falta la clave» |
| `OCR_MODELO`, `OCR_MODELO_PIEZAS`, `OCR_DETALLE` | Facturas: modelo de lectura (todo / solo las piezas de documentos largos) y `detail` de las imágenes (`high` o el de por defecto). Opcionales: manda el modelo elegido en *Super Admin › Servicios › Modelos* | `gpt-5.6-luna` con `detail` «original» |
| `CLASIFICAR_PRODUCTOS_MODELO` | Facturas: modelo de la clasificación de productos. Opcional (igual que arriba) | `gpt-5.6-luna` |
| `FACTURAS_CIF_EMPRESA` | Facturas: el CIF de Cristalería BV, que en las facturas es el del CLIENTE y nunca se toma por el del proveedor. Conviene ponerlo también en la base (`update configuracion_facturas set cif_empresa = '…'`) | Solo se reconoce a la empresa por su nombre |
| `OPENAI_ADMIN_KEY` | Costes reales de OpenAI y centro de modelos | Solo el estimado de `ia_uso` |
| `TELEGRAM_BOT_TOKEN` | Avisos por Telegram (el chat se configura en Super Admin › Servicios) | «Telegram sin configurar» |
| `LINEAR_API_KEY` | «Enviar a Linear» desde Tickets y los tickets de *Super Admin › Logs* (modo en `web_logs_config.linear_modo`: `prueba` por defecto). Se crea en Linear › *Settings › Security & access › Personal API keys* | Solo el destino de pruebas (`web_linear_prueba`) |
| `VERCEL_ANALYTICS_TOKEN` | Tráfico web: leer las visitas de Vercel Web Analytics (`sync-trafico-web`). Token personal de Vercel (*Account Settings › Tokens*) con acceso al equipo de la web. Ver [TRAFICO-WEB.md](TRAFICO-WEB.md#puesta-en-marcha) | Tráfico web sin datos (la página dice qué falta) |
| `VERCEL_ANALYTICS_PROJECT`, `VERCEL_ANALYTICS_TEAM` | Opcionales: id (`prj_…`) o nombre del proyecto de la web en Vercel, e id (`team_…`) o slug del equipo | Proyecto `cristaleriabv`; equipo `SERVICIOS_VERCEL_TEAM_ID` o `pablo1505` |
| `LOGS_WEB_VERCEL_TOKEN` | Opcional: Logs vigila los despliegues de la web en ERROR | Usa `VERCEL_ANALYTICS_TOKEN` o `SERVICIOS_VERCEL_TOKEN`; sin ninguno, no los vigila |
| `LOGS_WEB_ORIGENES_EXTRA` | Opcional: otros dominios de la web que pueden mandar actividad (`https://dominio=produccion,https://otro=demo`) | Solo los conocidos (ver arriba) |
| `LOGS_WEB_URL_PANEL` | Opcional: dirección del panel para el enlace al detalle en los tickets de Logs | `PANEL_URL` / `PANEL_URL_DEMO` |
| `LOGS_WEB_ERRORES_SERVIDOR` | Opcional: `off` para que las funciones no registren sus 5xx en Logs | Se registran |
| `SUPER_ADMIN_EMAILS` | Cuentas protegidas: no se pueden borrar ni quitar de super admin | Sin protección extra |
| `METRICS_SUPABASE_URL` y `METRICS_SUPABASE_SERVICE_ROLE_KEY` | Registrar los inicios de sesión en la base de métricas de OficiosOsIA (URL del proyecto de métricas y su clave de servicio) | No se registran |
| `SERVICIOS_VERCEL_TOKEN` + `SERVICIOS_VERCEL_TEAM_ID` | Consumo de Vercel en Servicios | La tarjeta pide el secreto |
| `SERVICIOS_SUPABASE_TOKEN` | Uso detallado de Supabase en Servicios | Solo BD, Storage y usuarios |
| `SERVICIOS_GITHUB_TOKEN` (+ `SERVICIOS_GITHUB_OWNER`, `SERVICIOS_GITHUB_REPOS`) | Minutos de GitHub Actions | La tarjeta pide el secreto |
| `RESEND_API_KEY` | Newsletter: enviar los correos (y el consumo de Resend en Servicios). Ver [NEWSLETTER.md](NEWSLETTER.md#puesta-en-marcha) | No sale ningún correo de la newsletter; la web dice que la suscripción no está disponible |
| `RESEND_WEBHOOK_SECRET` | Newsletter: firma del webhook de Resend (estadísticas y bajas por rebote o spam) | El webhook rechaza todo: sin estadísticas ni bajas automáticas |
| `RESEND_NEWSLETTER_SEGMENT_ID`, `NEWSLETTER_LIMITE_CONTACTOS`, `NEWSLETTER_IA_MODEL` | Newsletter, opcionales: Segment del canal Broadcast, contactos del plan y modelo de «Crear con IA» | Segment «Newsletter Cristalería BV», 1.000 contactos y `gpt-4.1-mini` |
| `META_APP_ID`, `META_APP_SECRET` | RRSS: la app de Meta con la que se conecta Instagram y la página de Facebook. Ver [RRSS.md](RRSS.md#puesta-en-marcha) | RRSS no publica ni mide nada («Conectar con Facebook» desactivado y explicado) |
| `META_LOGIN_CONFIG_ID`, `RRSS_CLAVE_TOKENS`, `META_API_VERSION`, `RRSS_IA_MODEL`, `RRSS_DIAS_FICHEROS` | RRSS, opcionales: configuración del inicio de sesión para empresas, clave de cifrado de los tokens (recomendada), versión de la Graph API, modelo de la IA y días que se guardan los ficheros de lo publicado | Permisos por su nombre, clave derivada de `META_APP_SECRET`, `v26.0`, `gpt-4.1-mini` y 30 días |
| `IG_ACCESS_TOKEN`, `IG_USER_ID`, `FB_PAGE_ID` | RRSS, opcionales: token de usuario del sistema de Meta (no caduca). Si están, mandan sobre la conexión del panel | Se usa la conexión del panel |
| `STRIPE_SECRET_KEY`, `SERVICIOS_HOSTINGER_TOKEN` | Consumo de esos proveedores en Servicios (si se usan) | La tarjeta pide el secreto |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `CONTROL_EXCEL_FILE_ID`, `CONTROL_EXCEL_CLIENTE` | Excel de control del Gestor Gasto ([CONTROL-EXCEL.md](CONTROL-EXCEL.md)) | La pestaña lo dice |

## 6. Vercel

1. Importa el repositorio en Vercel (framework Vite). `vercel.json` ya trae las cabeceras de seguridad, las rutas y la regla de qué ramas despliegan (`staging`, `main` y `release/*`).
2. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_SUPABASE_PUBLISHABLE_KEY` (las de *Settings › API*), en *Preview* con el proyecto de la demo y en *Production* con el de producción.
3. Crea la rama `staging` desde `main`: cada subida a `staging` publica la demo.

**En el proyecto de la web** (`cristaleriabv`, otro repositorio): *Analytics › Enable* (Web Analytics, para Tráfico web) y las variables de Supabase que ya usa la calculadora, del mismo proyecto que el panel (`NEXT_PUBLIC_SUPABASE_URL` y la clave pública). La actividad para Logs solo necesita `NEXT_PUBLIC_SUPABASE_URL`: sin ella la web no manda nada.

## 7. Comprobar

- Entra en `/auth` con el super admin: debe abrir el Dashboard; el engranaje «Super Admin» del pie del menú lleva a `/super-admin/login`.
- *Super Admin › Auditoría* debe enseñar el acceso que acabas de hacer.
- Crea un usuario de prueba en *Super Admin › Usuarios*, dale solo «Dashboard» y comprueba que no ve Usuarios.
- Envía una petición urgente desde *Nueva petición*: el super admin la ve en la campana y en *Tickets*.
- *Web*: en *Fotos* abre un tipo de trabajo (p. ej. Mamparas) y sube un par de fotos; en un minuto salen en `/trabajos` de la web (filtro «Mamparas») y en la página del servicio. En *Tarifas* cambia un precio y compruébalo en la calculadora de la web (y en «Probar»). Una solicitud enviada desde la calculadora de la web aparece en la campana de quien ve Presupuestos y en *Presupuestos › Solicitudes* (`curl -X POST https://<ref>.supabase.co/functions/v1/web-solicitud-presupuesto -H 'content-type: application/json' -d '{}'` debe responder 400).
- *Tráfico web*: al día siguiente de activar Web Analytics y poner `VERCEL_ANALYTICS_TOKEN`, salen las visitas (o `select public.trafico_web_disparar();` para no esperar). Sin token, la página lo dice.
- *Super Admin › Logs*: abre la web, usa la calculadora y pulsa WhatsApp; en unos segundos sale la sesión en *Sesiones* (`curl -X POST https://<ref>.supabase.co/functions/v1/registrar-actividad-web -H 'Origin: https://ejemplo.com' -d '{}'` debe responder 403).
- *Facturas › Cargar*: sube una factura de prueba (PDF o foto). Debe leerse sola y salir en *Compras › Documentos* con su original al lado; en *Super Admin › Servicios* aparece el coste de la lectura. Un usuario con solo «Facturas · Subida» ve únicamente *Cargar*.
- *RRSS*: sin la app de Meta, *Conexión y estilo* dice qué falta y enseña la dirección de vuelta; con `META_APP_ID` y `META_APP_SECRET`, «Conectar con Facebook» y una historia de prueba (pasos en [RRSS.md](RRSS.md#comprobar)).
