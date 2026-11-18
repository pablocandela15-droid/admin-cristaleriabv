# Puesta en marcha de un entorno (demo o producción)

Guía para montar el panel de Cristalería BV desde cero en un proyecto de Supabase y en Vercel. Primero la **demo**; producción solo cuando el dueño lo pida (ver [PROCESO-DE-CAMBIOS.md](PROCESO-DE-CAMBIOS.md)).

## 1. Proyecto de Supabase

1. Crea el proyecto (región `eu-central-1` o la más cercana) y apunta su **ref** (`https://<ref>.supabase.co`).
2. En *Database › Extensions* deja activadas `pg_cron`, `pg_net` y `supabase_vault` (la migración las crea si faltan).
3. Guarda el ref en las variables del repositorio de GitHub (*Settings › Secrets and variables › Actions › Variables*): `SUPABASE_REF_DEMO` y, cuando exista, `SUPABASE_REF_PRODUCCION`.

## 2. Esquema de la base de datos

Una sola migración inicial con todo el núcleo: [`supabase/migrations/20261118120000_nucleo_panel.sql`](../supabase/migrations/20261118120000_nucleo_panel.sql) (vuelta atrás en `supabase/rollbacks/`).

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

(O pega el fichero en *SQL Editor* y ejecútalo entero.) Antes, en local: `npm run test:nucleo:db`.

## 3. Primer super admin

1. En *Authentication › Users* crea el usuario (email y contraseña).
2. En *SQL Editor*:

```sql
insert into public.super_admins (user_id, email)
  select id, email from auth.users where email = '<email>';
```

Desde ahí, el resto de usuarios y permisos se gestionan en **Super Admin › Usuarios**. Los usuarios sin email real entran con su nombre de usuario (se guarda como `usuario@staff.local`).

## 4. Vault (tareas programadas)

Las tareas de pg_cron (avisos por Telegram, vigilante de fallos, centro de modelos de IA y costes reales de OpenAI) llaman a las Edge Functions con un secreto. En *SQL Editor*:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<una frase larga aleatoria>', 'ocr_trabajos_secret');
```

El mismo valor de `ocr_trabajos_secret` va en el secreto `OCR_TRABAJOS_SECRET` de las funciones (paso 5). Sin Vault las tareas no llaman a nada (no fallan).

## 5. Edge Functions

Despliega todas las de `supabase/functions/` (la configuración de `verify_jwt` está en `supabase/config.toml`):

```bash
for f in admin-create-user admin-delete-user admin-set-super-admin admin-set-user-access admin-update-user-password \
         analizar-peticion auditoria-revertir avisos-telegram cambiar-mi-contrasena control-excel ia-modelos-openai \
         leer-metricas list-users panel-auth registrar-metrica servicios-uso sincronizar-costes-openai; do
  npx supabase functions deploy "$f" --project-ref <ref>
done
```

Secretos (*Edge Functions › Secrets*). Obligatorio para el login: ninguno extra (usa los de Supabase). El resto activa cada parte:

| Secreto | Para qué | Sin él |
|---|---|---|
| `OCR_TRABAJOS_SECRET` | Que pg_cron pueda llamar a las funciones (mismo valor que en Vault) | Las tareas programadas no funcionan |
| `SUPABASE_REF_PRODUCCION`, `SUPABASE_REF_DEMO` | Saber en qué entorno corre cada función | Todo se trata como «local» |
| `PANEL_URL` (y `PANEL_URL_DEMO`) | Enlaces al panel en Telegram y en los tickets enviados a Linear | Sin enlaces |
| `OPENAI_API_KEY` | Análisis de los tickets con IA | El análisis no se hace |
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
