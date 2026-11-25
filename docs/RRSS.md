# RRSS (Instagram y Facebook)

Marketing › **RRSS** del panel (`/rrss`): publicar en la cuenta profesional de **Instagram** de la cristalería y en su **página de Facebook** (foto, carrusel, reel e historia), programar publicaciones para que salgan solas, coger las fotos de **Web › Fotos**, pedir ayuda a la IA para el texto y los hashtags, preparar campañas y ver las **métricas** (con lo que mejor funciona). Todo pasa por la Graph API de Meta desde las Edge Functions de Supabase: el navegador nunca ve un token.

Portado de la sección RRSS del panel de referencia y adaptado a una cristalería de Elche y el Baix Vinalopó: nada de restaurante (ni carta, ni menús, ni reservas). Los tipos de trabajo son los de la web (mamparas, espejos, cerramientos, aluminio, barandillas, armarios, dominó y otros), y la IA, las fechas y los textos de ejemplo hablan de obras, presupuestos y temporada de la cristalería.

**Mientras no esté conectado no se rompe nada y no se llama a Meta**: la pestaña «Conexión y estilo» dice qué falta, paso a paso, y enseña la dirección de vuelta que hay que copiar en la app de Meta; en «Crear» se pueden preparar borradores, pero «Publicar ahora» y «Programar» salen desactivados con el motivo; las tareas programadas no hacen nada (las métricas responden «omitida: sin conexión» sin salir a Internet). Sin la clave de OpenAI, la ayuda de la IA sale desactivada y lo explica.

## Puesta en marcha

El panel de la demo y el de producción usan **el mismo proyecto de Supabase** (`https://gorekooabfhqudeshtgq.supabase.co`): la migración, las funciones, los secretos y la conexión con Meta sirven para los dos a la vez. Lo que se publica desde la demo **sale de verdad** en Instagram y Facebook. Producción solo enseña la sección cuando se publique la release que la lleve.

### 1. Migración y funciones

1. **Migración** `supabase/migrations/20261125100000_rrss.sql` (vuelta atrás: `supabase/rollbacks/20261125100000_rrss_ROLLBACK.sql`). Crea las tablas `rrss_*`, el cubo privado `rrss`, las RPC, la sección de permisos `rrss`, el módulo apagable y las tres tareas de pg_cron.
2. **Funciones** (la configuración de `verify_jwt` está en `supabase/config.toml`):

   ```bash
   for f in rrss-conexion rrss-oauth rrss-publicar rrss-programador rrss-metricas rrss-ia; do
     npx supabase functions deploy "$f" --project-ref gorekooabfhqudeshtgq
   done
   ```

   | Función | Quién la llama | `verify_jwt` | Qué hace |
   |---|---|---|---|
   | `rrss-conexion` | El panel (Ver / Editar en RRSS) | sí | Estado de la conexión (sin tokens), «Conectar», elegir página, comprobar y desconectar |
   | `rrss-oauth` | Facebook, al volver del diálogo de permisos | no | Canjea el código por los tokens, los guarda cifrados y vuelve al panel. La protege un `state` de un solo uso (15 min) |
   | `rrss-publicar` | El panel («Publicar ahora», Editar en RRSS) | sí | Publica en Instagram y en Facebook |
   | `rrss-programador` | pg_cron (cada 5 min y de madrugada) | no | Publica lo programado, termina los vídeos que Meta estaba procesando, limpia el cubo y vigila la caducidad. La protege `OCR_TRABAJOS_SECRET` |
   | `rrss-metricas` | pg_cron (cada mañana) y el panel («Actualizar ahora») | no | Copia las métricas de Instagram y los seguidores de la página. La protegen `OCR_TRABAJOS_SECRET` o la sesión con Editar en RRSS |
   | `rrss-ia` | El panel (Editar en RRSS) | sí | Textos y hashtags, ideas, campañas y «aprender de lo publicado» |

3. **Tareas programadas**: usan lo de siempre del panel (Vault `project_url` y `ocr_trabajos_secret`, y el secreto `OCR_TRABAJOS_SECRET` con el mismo valor; ver [DESPLIEGUE.md](DESPLIEGUE.md#4-vault-tareas-programadas)). Sin Vault no fallan: no llaman a nada.

### 2. La cuenta de Instagram y la página de Facebook

1. En la app de Instagram de la cristalería: *Configuración › Tipo de cuenta y herramientas › Cambiar a cuenta profesional* y elegir **Empresa**.
2. Vincularla a la **página de Facebook** de la cristalería: en Instagram, *Centro de cuentas* (o, desde la página de Facebook, *Configuración › Cuentas vinculadas › Instagram*). Sin página vinculada, Meta no deja publicar en Instagram por la API.
3. La persona que va a pulsar «Conectar con Facebook» tiene que **administrar la página** (control total) con su usuario de Facebook.

### 3. La app de Meta

En [developers.facebook.com](https://developers.facebook.com) (gratis), con el mismo usuario de Facebook que administra la página. Meta cambia a menudo los nombres de los menús; lo que importa es lo que se configura.

1. *Mis apps › Crear app*. Tipo **Empresa** (*Business*); si el asistente pregunta por casos de uso, el de gestionar la página y el contenido de Instagram (con inicio de sesión de Facebook, no el de «inicio de sesión de Instagram»). Si pide un portfolio comercial, el de la cristalería (o ninguno).
2. Añadir los productos **Inicio de sesión con Facebook para empresas** (*Facebook Login for Business*; en apps antiguas, *Inicio de sesión con Facebook*) y **API de Instagram** (*Instagram Graph API* / «configuración de la API con inicio de sesión de Facebook»).
3. En el inicio de sesión, *Configuración*:
   - **URI de redireccionamiento de OAuth válidos**: `https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth` (exactamente esa; el panel la enseña y la copia en RRSS › Conexión y estilo).
   - «Inicio de sesión de OAuth web» y «Forzar HTTPS» activados; «Modo estricto para URI de redireccionamiento» activado.
4. *Configuración de la app › Básica*:
   - **Dominios de la app**: `gorekooabfhqudeshtgq.supabase.co` y `admin-cristaleriabv.vercel.app`.
   - **URL de la política de privacidad**: `https://cristaleriabv.vercel.app/privacidad` (o la del dominio propio de la web). La de **eliminación de datos** puede ser la misma página: el panel solo guarda la conexión, y «Desconectar» la borra.
   - Categoría: Empresa. Si pide sitio web, `https://admin-cristaleriabv.vercel.app`.
   - Aquí están el **Identificador de la app** (va en `META_APP_ID`) y la **Clave secreta de la app** (va en `META_APP_SECRET`).
5. **Permisos** que pide el panel (con *acceso estándar* bastan):

   | Permiso | Para qué |
   |---|---|
   | `instagram_basic` | Leer la cuenta de Instagram (nombre, foto, seguidores) |
   | `instagram_content_publish` | Publicar en Instagram |
   | `instagram_manage_insights` | Métricas de Instagram |
   | `pages_show_list` | Encontrar la página y su Instagram vinculado |
   | `pages_read_engagement` | Leer la página (seguidores) y su token |
   | `pages_manage_posts` | Publicar en la página de Facebook |
   | `business_management` | Encontrar la página si es de un portfolio comercial |

6. Si la app tiene **Inicio de sesión con Facebook para empresas**, crear una **configuración** (*Configuraciones › Crear configuración*): tipo de token «Token de acceso de usuario», con los siete permisos de arriba y los activos (la página y la cuenta de Instagram). Su **ID de configuración** va en `META_LOGIN_CONFIG_ID`. Con el inicio de sesión clásico se deja vacío y el panel pide los permisos uno a uno.
7. **Modo de la app y revisión**. Con *acceso estándar*, los permisos funcionan **sin revisión de la app** para las personas que tienen un rol en la app (administrador, desarrollador o evaluador; *Roles de la app*). Como solo conecta quien administra la cristalería, basta con que esa persona sea administradora de la app. Conviene pasar la app a modo **Publicado** (*Live*) cuando esté configurada (pide la política de privacidad): en modo desarrollo, lo que la app publica en la página de Facebook solo lo ve la gente con rol en la app. La **revisión de la app** (acceso avanzado y verificación del negocio) solo haría falta si fuera a conectar alguien sin rol en la app.

### 4. Secretos en Supabase

En Supabase › *Edge Functions › Secrets* (`https://supabase.com/dashboard/project/gorekooabfhqudeshtgq/functions/secrets`): `META_APP_ID`, `META_APP_SECRET` y, si se usa, `META_LOGIN_CONFIG_ID`. Recomendado: `RRSS_CLAVE_TOKENS` (ver la tabla). La IA usa la `OPENAI_API_KEY` general del panel.

### 5. Conectar desde el panel

1. RRSS › **Conexión y estilo** › **Conectar con Facebook** (hace falta Editar en RRSS). Lleva a Facebook: entrar con quien administra la página, elegir la página y la cuenta de Instagram de la cristalería y **aceptar todos los permisos**.
2. Facebook vuelve a Supabase (`rrss-oauth`), que guarda la conexión y te devuelve al panel desde el que empezaste (producción, la demo o `localhost`; nada más). Si administras varias páginas con Instagram, el panel pregunta cuál es la de la cristalería.
3. Tiene que salir «Conectada», la cuenta `@…`, la página y la lista de comprobaciones en verde. **Comprobar conexión** lo vuelve a mirar con Meta.

### Alternativa: token de usuario del sistema

Es lo que hacía el panel de referencia y no caduca. Si están, **mandan sobre la conexión del panel** (y «Conectar» no hace falta):

1. En *Meta Business Suite › Configuración del negocio › Usuarios del sistema*, crear uno (administrador), asignarle la página y la cuenta de Instagram con control total, y **generar un token** para la app con los permisos de arriba y caducidad «nunca».
2. Secretos: `IG_ACCESS_TOKEN` (ese token), `IG_USER_ID` (el id de la cuenta de Instagram profesional: en el Explorador de la Graph API, `GET /<id de la página>?fields=instagram_business_account`) y, para publicar también en Facebook, `FB_PAGE_ID`.

### Secretos y ajustes

| Nombre | Dónde se consigue | Dónde va | Sin él |
|---|---|---|---|
| `META_APP_ID` | App de Meta › Configuración de la app › Básica › Identificador de la app | Supabase › Edge Functions › Secrets | «Conectar con Facebook» desactivado; RRSS no publica ni mide |
| `META_APP_SECRET` | Lo mismo › Clave secreta de la app | Supabase › Edge Functions › Secrets | Igual que arriba |
| `META_LOGIN_CONFIG_ID` | Opcional: Inicio de sesión con Facebook para empresas › Configuraciones › ID | Supabase › Edge Functions › Secrets | Se piden los permisos por su nombre (inicio de sesión clásico) |
| `RRSS_CLAVE_TOKENS` | Opcional, recomendado: una cadena aleatoria larga (p. ej. `openssl rand -base64 48`) | Supabase › Edge Functions › Secrets | Los tokens se cifran con una clave derivada de `META_APP_SECRET`. Si cambia la clave (o se renueva la clave secreta de la app sin este secreto), hay que volver a conectar |
| URI de redireccionamiento | `https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth` | App de Meta › Inicio de sesión › URI de redireccionamiento de OAuth válidos | Facebook no deja volver: la conexión falla |
| Dominios | `gorekooabfhqudeshtgq.supabase.co`, `admin-cristaleriabv.vercel.app` | App de Meta › Configuración de la app › Básica | Facebook puede rechazar la vuelta |
| `IG_ACCESS_TOKEN`, `IG_USER_ID`, `FB_PAGE_ID` | Opcionales: token de usuario del sistema (ver arriba) | Supabase › Edge Functions › Secrets | Se usa la conexión del panel |
| `META_API_VERSION` | Opcional: versión de la Graph API (`vNN.N`) | Supabase › Edge Functions › Secrets | `v26.0` |
| `OPENAI_API_KEY` | La misma del resto del panel | Supabase › Edge Functions › Secrets | Ayuda de la IA, ideas, campañas y «aprender» desactivados (y explicado) |
| `RRSS_IA_MODEL` | Opcional. Manda el modelo elegido en Super Admin › Servicios › Modelos (`rrss-ia`) | Supabase › Edge Functions › Secrets | `gpt-4.1-mini` (ve imágenes) |
| `RRSS_DIAS_FICHEROS` | Opcional: días que se guardan en el cubo las fotos y vídeos de lo ya publicado (1-365) | Supabase › Edge Functions › Secrets | 30 |
| `PANEL_URL`, `PANEL_URL_DEMO` | Los de siempre del panel. Opcionales para RRSS | Supabase › Edge Functions › Secrets | El OAuth solo vuelve a `https://admin-cristaleriabv.vercel.app`, sus previews de Vercel y `localhost` |
| `OCR_TRABAJOS_SECRET` + Vault | Los de siempre del panel | Supabase (Secrets y Vault) | No sale nada programado, no se copian las métricas cada mañana ni se vigila la caducidad |

Ningún valor de un secreto ni ningún token sale nunca en el panel: «Conexión y estilo» solo dice si está o falta, la cuenta conectada, los permisos y cuándo caduca.

## Permisos

Sección `rrss` (Usuarios › Permisos, grupo Marketing) y módulo `rrss` (se puede apagar en Control del Panel). La base lo hace cumplir (RLS con `can_read_section('rrss')` / `can_edit_section('rrss')` y el bloqueo de accesos; el super admin siempre) y las funciones también (`exigirPermiso`).

| Permiso | Qué puede hacer |
|---|---|
| **Ver** | Calendario, publicaciones (con su estado y sus errores), ideas y campañas, métricas y la conexión en lectura. Sale «Solo lectura» y no aparece «Crear» |
| **Editar** | Además: crear, publicar, programar, mover y cancelar; reintentar y borrar; la ayuda de la IA, ideas y campañas; «Actualizar ahora» en métricas; conectar, renovar y desconectar; cambiar el estilo |

Los avisos de RRSS de la campana (conexión a punto de caducar, publicación programada que falló) solo los ven quienes tienen la sección.

## Cómo funciona

### Crear

- **Dónde**: Instagram, Facebook o los dos (una publicación por red, que se publican y programan juntas). «Facebook por defecto» se cambia en el estilo.
- **Formatos**: foto, carrusel (2 a 10 fotos o vídeos), reel (vídeo) e historia (solo Instagram, sin texto). En Facebook: foto, varias fotos (solo fotos) y vídeo.
- **Fotos**: subidas desde el ordenador o el móvil, o **elegidas de Web › Fotos** por tipo de trabajo (la foto de la web no cambia; su texto alternativo pasa a la publicación). El panel las **recorta en el navegador** a 1080 px de ancho en el formato elegido (vertical 4:5, cuadrada, apaisada 1,91:1 o historia 9:16), con encuadre y zoom, y avisa si la foto es pequeña.
- **Vídeo**: MP4 o MOV (H.264/HEVC con AAC), hasta 50 MB; reels de 3 s a 15 min; historias y vídeos de carrusel, de 3 a 60 s.
- **Texto**: hasta 2.200 caracteres y 30 hashtags (lo mismo que comprueban Meta y la base), con vista previa como en el móvil. Lo que falta para poder publicar sale en llano debajo.
- **Publicar ahora** o **Programar** (hora de Madrid, de 10 minutos a 75 días; avisa si hay otra en la misma red a menos de 30 minutos).

Los ficheros van al cubo **privado** `rrss` (`subidas/<usuario>/…`); a Meta se le da una URL firmada que caduca (1 h las fotos, 6 h los vídeos). Las subidas que ninguna publicación usa se borran a las 24 h, y los ficheros de lo ya publicado a los `RRSS_DIAS_FICHEROS` días (la publicación sigue en Instagram y Facebook; en el panel queda el enlace).

### Publicar y programar

- Instagram: se crea el contenedor (en el carrusel, uno por elemento), se espera a que Meta lo procese y se publica. **Publicar no se repite nunca a ciegas**: si se corta en mitad, la siguiente pasada mira si ya salió antes de volver a intentarlo. Los vídeos que Meta tarda en procesar quedan «Meta la está procesando» y el programador los termina.
- Facebook: foto, varias fotos o vídeo en la página, con el token de la página.
- La API de Instagram no programa: lo hace `rrss-programador` cada 5 minutos (solo si hay algo que hacer). Si falla por algo pasajero (Meta caído, red), lo reintenta a los 5 y a los 15 minutos; al tercer fallo, o si el fallo es definitivo (permisos, foto no válida…), queda en **error** con el motivo y cómo arreglarlo, y avisa en la campana. Si se ha llegado al límite de publicaciones de Instagram en 24 horas, la aplaza sin contar intento.
- **Publicaciones** lista todo por estado (borradores y listas, programadas, publicadas y con error), con «Reintentar», «Abrir en Crear», «Verla» y «Borrar».

### Ayuda de la IA y estilo

- **Ayuda de la IA** en Crear: propone textos y hashtags para la cristalería (Elche y el Baix Vinalopó), mirando las fotos, el tipo de trabajo y el estilo; solo propone, nunca publica. No se le mandan datos personales: los quita antes.
- **Estilo** (en «Conexión y estilo»): zona, tono, guía, hashtags de siempre, llamadas a la acción, palabras a evitar y emojis. **Aprender de lo publicado** propone cambios del estilo a partir de lo publicado y de lo que mejor funciona; solo se aplican si los aceptas.
- Tope diario: 80 peticiones por persona y 300 entre todos (hora de Madrid). El gasto sale en Super Admin › Servicios, y el modelo se elige en Super Admin › Servicios › Modelos (`rrss-ia`).

### Ideas y campañas

- **Ideas para la semana**: qué publicar y cómo grabarlo con el móvil en el taller o en la obra; «Crear» abre la idea en Crear.
- **Fechas que vienen**: temporada de la cristalería, fiestas de Elche y fechas comerciales (las «sin verificar» conviene confirmarlas).
- **Campañas**: la IA propone una campaña de 2 a 4 semanas; al aceptarla, sus publicaciones quedan como borradores en el calendario (con su gemela de Facebook si se quiere). Se pueden aceptar solo algunas.

### Métricas

- Cada mañana (05:10 UTC) se copian de Instagram los seguidores, el alcance, las visualizaciones, las interacciones y las visitas al perfil por día, y las métricas de cada publicación; y los seguidores de la página de Facebook. «Actualizar ahora» lo hace al momento (una vez cada 5 minutos).
- La pestaña enseña los últimos 7 o 28 días frente a los anteriores, la gráfica, las publicaciones ordenadas y **qué funciona** (90 días: formato, tipo de trabajo, día, franja horaria y hashtags), que también usa la IA.
- Meta tarda hasta 48 h en dar los datos de un día.

### Conexión y caducidad

- Con «Conectar con Facebook», el token del usuario dura 60 días y el de la página no caduca, pero Meta corta el **acceso a los datos** a los 90 días si nadie vuelve a entrar. El panel lo comprueba cada noche y **avisa 14 días antes** (en la pestaña y en la campana): basta con pulsar **Renovar conexión**.
- Si caduca o se quitan permisos, lo programado no se pierde: queda en error con «Renueva la conexión» y se puede reintentar.
- **Desconectar** borra los tokens guardados, quita el permiso de la app en Meta (si puede) y deja la cuenta como «sin conectar».

## Seguridad

- Los tokens solo viven en las funciones: se guardan **cifrados** (AES-GCM) en `rrss_meta_tokens`, una tabla sin ninguna política ni permiso para el panel (ni siquiera para el super admin desde el navegador). Las respuestas y los registros se limpian de tokens y códigos.
- El OAuth usa un `state` aleatorio de un solo uso que caduca a los 15 minutos (se guarda solo su hash) y solo vuelve a los paneles conocidos.
- Todas las tablas `rrss_*` tienen RLS por la sección `rrss` (y el bloqueo de accesos del panel). El cubo `rrss` es privado: solo se lee y se sube con la sección, y cada cual sube en su carpeta.
- `rrss-programador` y `rrss-metricas` solo aceptan el secreto de las tareas (`OCR_TRABAJOS_SECRET`, comparado en tiempo constante) o la clave de servicio (y `rrss-metricas`, además, una sesión con Editar).
- Limpieza automática: subidas sin usar (24 h), ficheros de lo publicado (`RRSS_DIAS_FICHEROS`), estados de OAuth (1 día), peticiones a la IA (90 días), capturas de métricas (13 meses), campañas descartadas y programaciones canceladas (180 días).

## Tareas programadas

Las instala la migración si hay pg_cron. Para lanzarlas a mano: `select public.rrss_disparar('programar');`, `select public.rrss_disparar('metricas');` o `select public.rrss_disparar('mantenimiento');` (devuelven `llamada` o `sin_vault`).

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `rrss-programador` | Cada 5 minutos, solo si hay algo vencido o procesándose | Publica lo programado y termina los vídeos que Meta procesaba |
| `rrss-metricas` | 05:10 UTC | Copia las métricas (sin conexión, no hace nada) |
| `rrss-mantenimiento` | 03:50 UTC | Purga lo antiguo de la base, limpia el cubo y comprueba la conexión con Meta (avisos de caducidad) |

## Comprobar

1. Sin configurar nada: RRSS › Conexión y estilo dice «todavía no está conectado», enseña la dirección de vuelta y «Conectar con Facebook» sale desactivado; en Crear se puede preparar un borrador, pero no publicar.
2. Con `META_APP_ID` y `META_APP_SECRET`: conectar. Tienen que salir la cuenta, la página y las comprobaciones en verde.
3. Publicar ahora una **historia** de prueba en Instagram (desaparece a las 24 h) y comprobar el enlace en Publicaciones. Después, una foto en Instagram y Facebook a la vez.
4. Programar una publicación a 15 minutos y ver que sale sola (o `select public.rrss_disparar('programar');` cuando venza).
5. Al día siguiente, Métricas con datos (o «Actualizar ahora»).
6. Con `OPENAI_API_KEY`: «Ayuda de la IA» en Crear, «Pedir ideas a la IA» y «Aprender de lo publicado».

## Problemas frecuentes

| Mensaje | Qué hacer |
|---|---|
| «Ninguna de tus páginas de Facebook tiene una cuenta de Instagram profesional vinculada» | Pasar Instagram a profesional (Empresa) y vincularlo a la página (paso 2) |
| «Tu usuario de Facebook no administra ninguna página» | Conectar con quien administra la página, o aceptar la página en el diálogo de Facebook |
| «Al token le faltan permisos» | «Renovar conexión» y aceptar todos los permisos (o añadirlos a la configuración de la app) |
| «URL bloqueada» / «redirect_uri» en Facebook | La dirección de vuelta no está, o no exacta, en la app de Meta (paso 3.3) |
| «Este panel no está en la lista de paneles permitidos» | Conectar desde el panel publicado, su preview o `localhost`; otro dominio, en `PANEL_URL` / `PANEL_URL_DEMO` |
| Lo publicado en Facebook no lo ve nadie | La app está en modo desarrollo: pasarla a Publicado (paso 3.7) |
| «Meta no terminó de procesar el vídeo en 24 horas» | Exportar el vídeo en MP4 (H.264), más corto, y volver a publicar |

## Qué no se ha portado (y por qué)

- **Encargos** del panel de referencia (pedidos de piezas a un diseñador): no encaja en una cristalería sin equipo de diseño.
- **Plantillas con texto encima, editor de reels y retoque de fotos con IA**: en el panel de referencia necesitan un servidor de render (Chromium y ffmpeg en Vercel) que este panel no tiene. Aquí el recorte se hace en el navegador y los vídeos se suben ya montados.
- **Importar desde Google Drive**: necesita otra carpeta compartida y más permisos de Google (`GOOGLE_DRIVE_…`). Las fotos salen de Web › Fotos y de lo que se suba.
- **Historias del menú del día** y todo lo de restaurante.
- **Varias marcas**: aquí hay una sola cuenta (la de la cristalería).
- **Informe de métricas en PDF**: los informes del panel ya están en Super Admin › Informes; se puede añadir si hace falta.
- **Novedad frente a la referencia**: publicar también en la **página de Facebook** y conectar desde el panel (en la referencia, solo con el token del sistema en los secretos, que aquí sigue funcionando).
