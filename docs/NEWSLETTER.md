# Newsletter

Marketing › **Newsletter** del panel (`/newsletter`): una lista de suscriptores con **doble opt-in** (nadie recibe nada hasta confirmar su email), un creador de correos por bloques con plantillas de cristalería y «Crear con IA», prueba antes de enviar, envío a todos los confirmados, historial y estadísticas (entregas, aperturas, clics, rebotes y quejas). Los correos salen por **Resend**. En la web (`cristaleriabv`), el bloque de suscripción del pie y las páginas `/newsletter/confirmada` y `/newsletter/baja`.

Portado del panel de referencia y adaptado: nada de restaurante; plantillas de novedades, ofertas, temporada, trabajos realizados, consejos y avisos.

**Mientras falten la clave de Resend o el remitente no sale ningún correo y nada se rompe**: el panel dice qué falta (Newsletter › Configuración), «Enviar» y «Enviar prueba» salen desactivados, y la web no enseña el bloque de suscripción del pie ni la casilla del presupuesto (el servidor de la web pregunta a `newsletter-alta` si se puede apuntar alguien y lo guarda un minuto; si la función no está desplegada, tampoco). Si aun así llega un alta, la función responde que no está disponible y no guarda nada. Sin la clave de OpenAI, «Crear con IA» sale desactivado y lo explica.

## Puesta en marcha

Primero en la **demo** (proyecto `SUPABASE_REF_DEMO`), y en producción solo después de publicar la release que lo lleve.

1. **Migración** `supabase/migrations/20261124173700_newsletter.sql` (vuelta atrás: `supabase/rollbacks/20261124173700_newsletter_ROLLBACK.sql`).
2. **Funciones**: `enviar-newsletter`, `newsletter-alta`, `newsletter-baja`, `newsletter-ia`, `newsletter-sync-resend` y `resend-webhook` (la configuración de `verify_jwt` está en `supabase/config.toml`):

   ```bash
   for f in enviar-newsletter newsletter-alta newsletter-baja newsletter-ia newsletter-sync-resend resend-webhook; do
     npx supabase functions deploy "$f" --project-ref <ref>
   done
   ```

3. **Cuenta de Resend** ([resend.com](https://resend.com)): el plan gratuito sirve para empezar (100 correos al día y 3.000 al mes uno a uno; 1.000 contactos en marketing).
4. **Dominio verificado** en Resend › *Domains* › *Add domain*: Resend da unos registros DNS (SPF, DKIM y, recomendado, DMARC) que se añaden en el proveedor del dominio. Hasta que salga «Verified» no se puede enviar desde él. Para ver aperturas y clics en Estadísticas, activa *Open tracking* y *Click tracking* en la configuración del dominio. **Hace falta un dominio propio**: `cristaleriabv.vercel.app` no sirve (no se pueden poner registros DNS en un dominio de Vercel). Conviene un subdominio para los envíos (p. ej. `novedades.tudominio.es`) para no mezclar la reputación con el correo del día a día.
5. **Clave de Resend** en *API Keys* › *Create API key*: «Sending access» basta con el canal «uno a uno»; con el canal Broadcast hace falta «Full access» (gestiona contactos y Segments). Se guarda en Supabase › *Edge Functions › Secrets* como `RESEND_API_KEY`.
6. **Webhook** en Resend › *Webhooks* › *Add webhook*:
   - Dirección: `https://<ref>.supabase.co/functions/v1/resend-webhook` (el panel la enseña y la copia en Newsletter › Configuración).
   - Eventos: todos los `email.*` (`sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `failed`) y `contact.updated` y `contact.deleted`.
   - Su **Signing secret** (`whsec_…`) se guarda como `RESEND_WEBHOOK_SECRET`. Sin él la función rechaza todo (no se fía de nada sin firma) y no hay estadísticas ni bajas automáticas por rebote o spam.
7. **Remitente** en el panel, Newsletter › Configuración: una dirección del dominio verificado (p. ej. `novedades@tudominio.es`), el nombre que se ve («Cristalería Baix Vinalopó»), y si se quiere «Responder a» y una dirección de pruebas.
8. Comprobar: Newsletter › Configuración tiene que decir «Todo listo para enviar». Después, **Enviar prueba a mi correo** desde «Crear y enviar».

Las tareas programadas usan lo de siempre del panel (Vault `project_url` y `ocr_trabajos_secret`, y el secreto `OCR_TRABAJOS_SECRET`; ver [DESPLIEGUE.md](DESPLIEGUE.md#4-vault-tareas-programadas)).

### Secretos y ajustes

| Nombre | Dónde se consigue | Dónde va | Sin él |
|---|---|---|---|
| `RESEND_API_KEY` | Resend › API Keys (Sending access; Full access con el canal Broadcast) | Supabase › Edge Functions › Secrets | No sale ningún correo; la web dice «no disponible» y no guarda altas |
| `RESEND_WEBHOOK_SECRET` | Resend › Webhooks › el webhook › Signing secret | Supabase › Edge Functions › Secrets | Sin estadísticas ni bajas automáticas (el webhook rechaza todo) |
| Remitente (email y nombre) | Una dirección del dominio verificado en Resend | Panel › Newsletter › Configuración (tabla `newsletter_config`) | No sale ningún correo |
| `OPENAI_API_KEY` | La misma del resto del panel | Supabase › Edge Functions › Secrets | «Crear con IA» desactivado |
| `NEWSLETTER_IA_MODEL` | Opcional. Manda el modelo elegido en Super Admin › Servicios › Modelos (`newsletter-ia`) | Supabase › Edge Functions › Secrets | `gpt-4.1-mini` |
| `RESEND_NEWSLETTER_SEGMENT_ID` | Opcional, canal Broadcast: Resend › Audience › Segments | Supabase › Edge Functions › Secrets | Se busca o se crea el Segment «Newsletter Cristalería BV» |
| `NEWSLETTER_LIMITE_CONTACTOS` | Opcional: contactos del plan de marketing de Resend | Supabase › Edge Functions › Secrets | 1.000 (plan gratuito) |
| `OCR_TRABAJOS_SECRET` + Vault | Los de siempre del panel | Supabase (Secrets y Vault) | No se limpian solas las altas sin confirmar ni se actualiza la lista de envío cada mañana |
| `LOGS_WEB_ORIGENES_EXTRA` | Opcional: otro dominio de la web (`https://dominio=produccion`) | Supabase › Edge Functions › Secrets | Solo la web publicada, sus previews de Vercel y `localhost` pueden apuntar a alguien |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase › Project Settings › API Keys (los mismos que ya usa la web para la calculadora; en producción ya están puestos) | Vercel, proyecto de la web | La web no enseña el bloque de suscripción ni la casilla del presupuesto, y las páginas de confirmar y de baja dicen que no está disponible. Con ellos, el bloque sale solo cuando la newsletter está lista (ver arriba) |

Ningún valor de un secreto sale nunca en el panel: Configuración solo dice si está o falta.

## Permisos

Sección `newsletter` (Usuarios › Permisos, grupo Marketing), módulo `newsletter` (se puede apagar en Control del Panel). La base lo hace cumplir (RLS con `can_read_section` / `can_edit_section`; el super admin siempre) y las funciones también (`exigirPermiso`).

| Permiso | Qué puede hacer |
|---|---|
| **Ver** | Suscriptores (y exportarlos), estadísticas, historial y la configuración en lectura. Sale «Solo lectura» y no aparece «Crear y enviar» |
| **Editar** | Además: crear, probar y enviar newsletters, plantillas, «Crear con IA», añadir e importar suscriptores, reenviar confirmaciones, dar de baja, borrar datos (RGPD) y cambiar los ajustes |

Los visitantes de la web (anónimos) no pueden leer nada: solo apuntarse por `newsletter-alta`, que usa funciones de la base reservadas a la clave de servicio.

## Doble opt-in y bajas

Estados de un suscriptor: **pendiente** → **activo** → **baja**.

- Toda alta (web, presupuesto, panel o importación) entra **pendiente**, con el consentimiento apuntado: fecha, origen, texto aceptado y, desde el panel, cómo lo dio y quién lo registró.
- Se le manda un correo con el enlace **Confirmar mi suscripción** (`<web>/newsletter/confirmada?t=…`). El token es aleatorio (256 bits), se guarda solo su hash y caduca a los 7 días. Solo ese enlace activa a alguien: ni el panel ni una importación pueden.
- Reenviar la confirmación: una vez al día y cinco veces como mucho por persona. Los pendientes de más de 30 días se borran solos.
- **Baja**: cada correo lleva su enlace personal (`<web>/newsletter/baja?t=…`) y la cabecera `List-Unsubscribe` de un clic (RFC 8058: el botón «Cancelar suscripción» de Gmail, Outlook…). Abrir el enlace no da de baja (los antivirus abren enlaces): hay que pulsar el botón de la página. También son baja un rebote permanente y una queja por spam (webhook), y la baja desde el panel.
- Una baja no se reabre: para volver, la persona se apunta otra vez desde la web y confirma de nuevo.
- **Borrar sus datos (RGPD)**: borra el suscriptor y deja solo la huella (hash) del email en `direcciones_email_suprimidas` para no volver a escribirle.

Límites del formulario de la web: campo trampa, consentimiento obligatorio, longitudes, 5 altas por hora por huella de IP (HMAC, la IP no se guarda) y solo desde los orígenes de la web. La respuesta es la misma tanto si el email ya estaba como si no (no se puede averiguar quién está suscrito).

## Enviar

- **Crear y enviar**: plantilla (o «Crear con IA», que solo propone: nunca envía), asunto, etiqueta, texto junto al asunto y bloques (texto, imagen de la galería de la web, destacado, lista, datos, botón, cita, separador y firma). Vista previa con el mismo HTML que el envío, como en el ordenador o en el móvil.
- **Enviar prueba a mi correo**: a quien la pide (y a la dirección de pruebas de Configuración), con «[PRUEBA]» en el asunto.
- **Enviar a N suscriptores**: pide confirmación y avisa de los [huecos] sin completar. Solo a los **activos**. Una clave por envío evita mandarlo dos veces si se pulsa dos veces.
- Todo correo lleva el pie con los datos del negocio (de Web › Contenido › Datos del negocio; si falta algo, los de `src/config/negocio.ts`), el motivo por el que lo recibe y el enlace de baja. Si una plantilla no lo tuviera, el envío se para.
- **Canal**: «uno a uno» (por defecto, un correo por suscriptor con la API de Resend; tope por envío en Configuración, 80 de serie para no pasar de los 100 diarios del plan gratuito) o «Broadcast de Resend» (para más suscriptores: usa la lista de envío, una copia de los activos en un Segment de Resend que se actualiza cada mañana, al abrir Suscriptores y antes de cada envío).

## Base de datos

Migración `20261124173700_newsletter.sql`: tablas `newsletter_config` (una fila: remitente, canal, límite, web), `newsletter_suscriptores`, `newsletter_claves` (envíos ya hechos), `newsletter_altas_limite`, `newsletter_envios`, `newsletter_plantillas`, `newsletter_ia_peticiones` (tope de 40 propuestas al día por persona), `newsletter_sincronizaciones_resend`, `email_eventos` (lo que manda el webhook) y `direcciones_email_suprimidas`. Las transiciones de estado las protege un disparador (nadie pasa a activo sin el token; una baja no vuelve).

Tareas programadas (pg_cron):

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `newsletter-sync-resend` | 05:20 UTC cada día | Con el canal Broadcast, actualiza la lista de envío de Resend (`newsletter_disparar_sync`) |
| `newsletter-purgar` | 04:10 UTC cada día | Borra pendientes de más de 30 días, el registro del límite de altas (1 día), las peticiones a la IA (90 días) y los eventos de correo (13 meses) |

## Logs de la web

La web apunta en Logs el evento `newsletter_alta` (aceptada, pendiente de confirmar, o rechazada con su código), con el origen (pie de página o presupuesto) y nunca el email. La migración lo añade al catálogo (`web_eventos_catalogo`) y está en `supabase/functions/_shared/logs-web/eventos.ts`. La llamada a `newsletter-alta` también sale como `peticion` (código y duración).

## Funciones

| Función | Quién la llama | Qué hace |
|---|---|---|
| `newsletter-alta` | La web (pública, `verify_jwt = false`) | Alta con doble opt-in y correo de confirmación; con GET, si se puede apuntar alguien (para enseñar o no el bloque del pie) |
| `newsletter-baja` | La web y la cabecera de baja de un clic (pública) | Confirmar la suscripción, consultar y darse de baja con el token |
| `enviar-newsletter` | El panel («Editar») | Prueba, envío a todos y correos de confirmación |
| `newsletter-ia` | El panel («Editar») | Propuesta de correo con IA (no guarda ni envía) |
| `newsletter-sync-resend` | El panel y pg_cron | Estado de la configuración y lista de envío del canal Broadcast |
| `resend-webhook` | Resend (firma Svix) | Estadísticas, bajas por rebote y spam |

## Probar en la demo

1. Configuración: sin secretos tiene que decir qué falta y «Crear y enviar» tiene que tener «Enviar» desactivado.
2. Con `RESEND_API_KEY`, remitente y webhook: apuntarse desde el pie de la web de la demo con una dirección propia de pruebas → llega el correo de confirmación → «Confirmar mi suscripción» → en el panel pasa a «Activo».
3. Crear una newsletter con una plantilla, **Enviar prueba a mi correo**, revisar el pie (datos del negocio y enlace de baja) en el ordenador y en el móvil.
4. Pulsar el enlace de baja del correo → la página pide confirmar → en el panel pasa a «De baja».
5. Estadísticas: las pruebas y los correos de confirmación no cuentan; tras un envío real, al rato salen entregados, abiertos y clics.
