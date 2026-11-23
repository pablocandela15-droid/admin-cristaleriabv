# Puesta en marcha de un entorno (demo o producción)

Guía para montar el panel de Cristalería BV desde cero en un proyecto de Supabase y en Vercel. Primero la **demo**; producción solo cuando el dueño lo pida (ver [PROCESO-DE-CAMBIOS.md](PROCESO-DE-CAMBIOS.md)).

## 1. Proyecto de Supabase

1. Crea el proyecto (región `eu-central-1` o la más cercana) y apunta su **ref** (`https://<ref>.supabase.co`).
2. En *Database › Extensions* deja activadas `pg_cron`, `pg_net` y `supabase_vault` (la migración las crea si faltan).
3. Guarda el ref en las variables del repositorio de GitHub (*Settings › Secrets and variables › Actions › Variables*): `SUPABASE_REF_DEMO` y, cuando exista, `SUPABASE_REF_PRODUCCION`.

## 2. Esquema de la base de datos

Tres migraciones, en este orden (cada una con su vuelta atrás en `supabase/rollbacks/`):

1. [`20261118120000_nucleo_panel.sql`](../supabase/migrations/20261118120000_nucleo_panel.sql): el núcleo del panel (login, usuarios, permisos, auditoría, avisos, servicios, IA…).
2. [`20261121100000_facturas.sql`](../supabase/migrations/20261121100000_facturas.sql): el módulo **Facturas** (facturas de proveedores con lectura automática, catálogo de productos, proveedores, avisos de subida de precio, el bucket privado `facturas-originales` y sus tareas programadas). Ver [FACTURAS.md](FACTURAS.md).
3. [`20261123100000_web_y_presupuestos.sql`](../supabase/migrations/20261123100000_web_y_presupuestos.sql): la **web editable** (books de fotos, textos, tarifas y catálogo de la calculadora, que la web lee con su clave pública, y el bucket **público** `web-fotos`) y los **presupuestos** (con su número correlativo y las solicitudes que llegan de la web). Trae los textos y precios que tiene hoy la web: hasta que alguien los cambie en el panel, la web se ve igual. Ver [WEB.md](WEB.md).

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

(O pega cada fichero en *SQL Editor*, en orden, y ejecútalo entero.) Antes, en local: `npm run test:nucleo:db` (prueba las tres, su vuelta atrás y que se pueden volver a aplicar).

## 3. Primer super admin

1. En *Authentication › Users* crea el usuario (email y contraseña).
2. En *SQL Editor*:

```sql
insert into public.super_admins (user_id, email)
  select id, email from auth.users where email = '<email>';
```

Desde ahí, el resto de usuarios y permisos se gestionan en **Super Admin › Usuarios**. Los usuarios sin email real entran con su nombre de usuario (se guarda como `usuario@staff.local`).

## 4. Vault (tareas programadas)

Las tareas de pg_cron (avisos por Telegram, vigilante de fallos, centro de modelos de IA, costes reales de OpenAI y, de Facturas, la lectura de documentos en segundo plano, la clasificación de productos y la limpieza diaria) llaman a las Edge Functions con un secreto. En *SQL Editor*:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<una frase larga aleatoria>', 'ocr_trabajos_secret');
```

El mismo valor de `ocr_trabajos_secret` va en el secreto `OCR_TRABAJOS_SECRET` de las funciones (paso 5). Sin Vault las tareas no llaman a nada (no fallan); en Facturas, sin Vault **no se lee ningún documento**: la lectura va siempre por trabajos que Postgres despacha a `ocr-trabajo` con este secreto, y se quedan en cola hasta que esté.

Tareas de Facturas (las instala su migración si hay pg_cron): `reanudar-trabajos-ocr` (cada minuto: rescata lecturas paradas; sin trabajos activos no hace nada), `clasificar-productos` (cada 5 minutos: asigna las líneas nuevas a su producto, primero por lo ya conocido y, si quedan, con IA) y `limpiar-pendientes-ocr` (3:40 cada día: borra del bucket las piezas de lecturas terminadas hace más de 7 días).

## 5. Edge Functions

Despliega todas las de `supabase/functions/` (la configuración de `verify_jwt` está en `supabase/config.toml`):

```bash
for f in admin-create-user admin-delete-user admin-set-super-admin admin-set-user-access admin-update-user-password \
         analizar-peticion auditoria-revertir avisos-telegram cambiar-mi-contrasena clasificar-productos control-excel \
         ia-modelos-openai leer-metricas list-users ocr-trabajo panel-auth procesar-factura registrar-metrica servicios-uso \
         sincronizar-costes-openai web-solicitud-presupuesto; do
  npx supabase functions deploy "$f" --project-ref <ref>
done
```

`web-solicitud-presupuesto` es la única pública (la llama la calculadora de la web, `verify_jwt = false`): no necesita ningún secreto propio. Usa los de Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, que además es la sal de la huella de IP del límite por hora) y en el bucket `web-fotos` no hay que configurar nada (lo crea la migración).

Secretos (*Edge Functions › Secrets*). Obligatorio para el login: ninguno extra (usa los de Supabase). El resto activa cada parte:

| Secreto | Para qué | Sin él |
|---|---|---|
| `OCR_TRABAJOS_SECRET` | Que pg_cron pueda llamar a las funciones (mismo valor que en Vault) | Las tareas programadas no funcionan |
| `SUPABASE_REF_PRODUCCION`, `SUPABASE_REF_DEMO` | Saber en qué entorno corre cada función | Todo se trata como «local» |
| `PANEL_URL` (y `PANEL_URL_DEMO`) | Enlaces al panel en Telegram y en los tickets enviados a Linear | Sin enlaces |
| `OPENAI_API_KEY` | Análisis de los tickets con IA (y, si no hay `OPENAI_API_KEY_OCR`, la lectura de facturas) | El análisis no se hace |
| `OPENAI_API_KEY_OCR` | Facturas: leer los documentos y clasificar productos (proceso «ocr»; si falta, usa `OPENAI_API_KEY`) | Facturas no lee nada: la subida falla con «falta la clave» |
| `OCR_MODELO`, `OCR_MODELO_PIEZAS`, `OCR_DETALLE` | Facturas: modelo de lectura (todo / solo las piezas de documentos largos) y `detail` de las imágenes (`high` o el de por defecto). Opcionales: manda el modelo elegido en *Super Admin › Servicios › Modelos* | `gpt-5.6-luna` con `detail` «original» |
| `CLASIFICAR_PRODUCTOS_MODELO` | Facturas: modelo de la clasificación de productos. Opcional (igual que arriba) | `gpt-5.6-luna` |
| `FACTURAS_CIF_EMPRESA` | Facturas: el CIF de Cristalería BV, que en las facturas es el del CLIENTE y nunca se toma por el del proveedor. Conviene ponerlo también en la base (`update configuracion_facturas set cif_empresa = '…'`) | Solo se reconoce a la empresa por su nombre |
| `OPENAI_ADMIN_KEY` | Costes reales de OpenAI y centro de modelos | Solo el estimado de `ia_uso` |
| `TELEGRAM_BOT_TOKEN` | Avisos por Telegram (el chat se configura en Super Admin › Servicios) | «Telegram sin configurar» |
| `LINEAR_API_KEY` | «Enviar a Linear» desde Tickets (modo en `web_logs_config.linear_modo`: `prueba` por defecto) | Solo modo prueba |
| `SUPER_ADMIN_EMAILS` | Cuentas protegidas: no se pueden borrar ni quitar de super admin | Sin protección extra |
| `METRICS_SUPABASE_URL` y `METRICS_SUPABASE_SERVICE_ROLE_KEY` | Registrar los inicios de sesión en la base de métricas de OficiosOsIA (URL del proyecto de métricas y su clave de servicio) | No se registran |
| `SERVICIOS_VERCEL_TOKEN` + `SERVICIOS_VERCEL_TEAM_ID` | Consumo de Vercel en Servicios | La tarjeta pide el secreto |
| `SERVICIOS_SUPABASE_TOKEN` | Uso detallado de Supabase en Servicios | Solo BD, Storage y usuarios |
| `SERVICIOS_GITHUB_TOKEN` (+ `SERVICIOS_GITHUB_OWNER`, `SERVICIOS_GITHUB_REPOS`) | Minutos de GitHub Actions | La tarjeta pide el secreto |
| `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `SERVICIOS_HOSTINGER_TOKEN` | Consumo de esos proveedores en Servicios (si se usan) | La tarjeta pide el secreto |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `CONTROL_EXCEL_FILE_ID`, `CONTROL_EXCEL_CLIENTE` | Excel de control del Gestor Gasto ([CONTROL-EXCEL.md](CONTROL-EXCEL.md)) | La pestaña lo dice |

## 6. Vercel

1. Importa el repositorio en Vercel (framework Vite). `vercel.json` ya trae las cabeceras de seguridad, las rutas y la regla de qué ramas despliegan (`staging`, `main` y `release/*`).
2. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_SUPABASE_PUBLISHABLE_KEY` (las de *Settings › API*), en *Preview* con el proyecto de la demo y en *Production* con el de producción.
3. Crea la rama `staging` desde `main`: cada subida a `staging` publica la demo.

## 7. Comprobar

- Entra en `/auth` con el super admin: debe abrir el Dashboard; el engranaje «Super Admin» del pie del menú lleva a `/super-admin/login`.
- *Super Admin › Auditoría* debe enseñar el acceso que acabas de hacer.
- Crea un usuario de prueba en *Super Admin › Usuarios*, dale solo «Dashboard» y comprueba que no ve Usuarios.
- Envía una petición urgente desde *Nueva petición*: el super admin la ve en la campana y en *Tickets*.
- *Web*: en *Fotos* crea un book, sube un par de fotos y publícalo; en un minuto sale en `/trabajos` de la web. En *Tarifas* cambia un precio y compruébalo en la calculadora de la web (y en «Probar»). Una solicitud enviada desde la calculadora de la web aparece en la campana de quien ve Presupuestos y en *Presupuestos › Solicitudes* (`curl -X POST https://<ref>.supabase.co/functions/v1/web-solicitud-presupuesto -H 'content-type: application/json' -d '{}'` debe responder 400).
- *Facturas › Cargar*: sube una factura de prueba (PDF o foto). Debe leerse sola y salir en *Compras › Documentos* con su original al lado; en *Super Admin › Servicios* aparece el coste de la lectura. Un usuario con solo «Facturas · Subida» ve únicamente *Cargar*.
