# Web editable desde el panel

La web de la cristalería (`cristaleriabv`, Next.js) lee de Supabase, con su clave pública, lo que se edita en **Web** (`/web`) del panel. Lo que no esté en Supabase (o si las tablas aún no existen) lo pone la web con los valores de su código, así que nunca se queda en blanco. La web vuelve a leer cada **60 segundos**: los cambios se ven en ella en un minuto, más o menos.

Esquema: [`20261123100000_web_y_presupuestos.sql`](../supabase/migrations/20261123100000_web_y_presupuestos.sql) (vuelta atrás en `supabase/rollbacks/`). Prueba PGlite: `scripts/test-web-presupuestos.mjs` (dentro de `npm run test:nucleo:db`).

## Permisos

Una sección por pestaña, con «Ver» (consulta, la pestaña sale en solo lectura) y «Puede editar». El super admin, todo. La base lo hace cumplir: las escrituras piden `can_edit_section(...)` y las tablas del panel llevan la política restrictiva `acceso_panel_no_bloqueado`.

| Sección | Pestaña | Con «Editar» |
|---|---|---|
| `web_fotos` (Web · Fotos) | Fotos | Subir, ordenar, editar, ocultar y borrar las fotos de cada tipo de trabajo y marcar las del inicio (★); crear, publicar, ordenar y borrar otros books |
| `web_tarifas` (Web · Tarifas) | Tarifas | Precios y opciones de la calculadora |
| `web_contenido` (Web · Contenido) | Contenido | Textos e imágenes fijas de la web; puede subir fotos **sueltas** (no a un book) para esas imágenes |
| `presupuestos` (Presupuestos) | *(página Presupuestos, ver [PRESUPUESTOS.md](PRESUPUESTOS.md))* | Crear, cambiar y enviar presupuestos; atender las solicitudes de la web |

El módulo **Web** (Control del Panel, grupo «Web y clientes») sale en el menú con cualquiera de las tres primeras.

## Fotos (por tipo de trabajo)

La pestaña **Fotos** va por tipo de trabajo: un apartado plegable por cada servicio de la web (Mamparas, Espejos, Cerramientos, Aluminio, Barandillas, Armarios, Dominó y Otros trabajos, en ese orden). Cada uno dice cuántas fotos tiene y, al abrirlo, tiene su zona para subir fotos directamente a ese tipo y sus fotos con las acciones: mover antes o después, ★ (sale en el inicio de la web), mostrar u ocultar en la web, título y descripción, y borrar. Lógica sin React en `src/lib/web/fotosPorTipo.ts` (pruebas en `src/lib/web/__tests__/fotosPorTipo.test.ts`).

- **Book de cada tipo** (sin cambiar el esquema): un `web_albumes` con slug `trabajos-<servicio>`, título = nombre del tipo, `servicio` = el tipo y publicado. Lo crea el panel al subir la primera foto a ese tipo (`asegurarAlbumTipo` en `src/hooks/useWebFotos.ts`: lo busca por su slug; si otra persona lo crea a la vez, 23505, lo vuelve a leer; si existía sin publicar o con otro servicio, lo arregla).
- El apartado de un tipo enseña las fotos de **todos** los books con ese `servicio` (también los creados antes a mano), ordenadas por el `orden` de cada foto (a igualdad, por el orden del book y la fecha de subida). Es el mismo orden que usa la web, así que mover una foto aquí la mueve en la web.
- **Otros books** (plegado, debajo de los tipos): los books hechos a mano (los que no son `trabajos-<servicio>`), con o sin tipo, y las **fotos sueltas**. Se crean, publican, ordenan, editan y borran como antes; al abrir uno se suben y gestionan sus fotos igual que en un tipo.
- **Books** (`web_albumes`): título, dirección (`slug`), descripción, tipo de trabajo (`servicio`, uno de los 8 o ninguno), publicado y orden. La portada (`portada_foto_id`) ya no se elige: la web no la usa (en la lista de «Otros books» sale la elegida antes o la primera foto).
- **Fotos** (`web_fotos`): en el bucket **público** `web-fotos`, en `albumes/<album_id>/<uuid>.webp`. El panel las reduce en el navegador a **2400 px** por el lado mayor y las guarda en **WebP al 85 %**, con su ancho y alto. Cada foto: título, descripción (`alt`), orden, publicada y ★ «en el inicio» (`destacada`). Al subir, el título sale del nombre del fichero salvo los que pone el móvil o la cámara («IMG_2034», «WhatsApp Image…»): sin título, la web pone el del book (en un tipo, su nombre). Borrar una foto borra su fichero; borrar un book, todas sus fotos y ficheros.
- **Fotos sueltas** (`album_id` nulo, `sueltas/<uuid>.webp`): las imágenes fijas que se suben desde Contenido. Se ven y se gestionan en Fotos › Otros books › Fotos sueltas.

Lo que hace la web (`cristaleriabv`, `src/lib/web/mezclar.ts`):

- `/trabajos` («Ver todos los trabajos»): siempre la galería con el filtro por tipo. Cada tipo, en el orden de los servicios, con sus fotos del panel o, si no tiene ninguna visible, sus fotos de ejemplo; al final, las de los books sin tipo (solo en «Todos»).
- Página de cada servicio: las mismas fotos de su tipo (si no hay, las de ejemplo).
- Inicio, «Espacios que se llenan de luz»: las fotos ★ (hasta 8). Si no hay ninguna, la primera foto de cada tipo que tenga fotos, completando hasta 4 con las de ejemplo de los tipos que falten; sin ninguna foto del panel, las de ejemplo de siempre.
- Solo ve lo publicado: una foto oculta no sale, ni las fotos de un book sin publicar.

## Tarifas (calculadora)

**Todos los precios de la calculadora llevan el IVA incluido** (lo que paga el cliente; decisión del dueño del 24/11/2026). En Presupuestos la línea se guarda sin IVA para que el total con IVA sea el de la calculadora.

Una sola fila en `web_tarifas` (id 1) con dos JSON:

- `config`: los precios, con la forma de `DEFAULT_PRICING`. Se guarda entero; lo que falte lo pone el código (`mergePricing`).
- `catalogo`: textos y opciones por encima del código (tipos `Catalogo` de `tarifas.ts`).

El motor de precios es el de la web copiado tal cual en `src/lib/web/pricing/{config,categories,tarifas}.ts`. Si se cambia en un repo, hay que copiar los tres ficheros al otro (las pruebas `src/lib/web/__tests__/pricing.test.ts` lo vigilan). `src/lib/web/tarifasEditor.ts` sabe dónde lee `quote()` el precio de cada campo:

| Categoría | Precio de las opciones |
|---|---|
| Dominó, espejos, cerramientos, aluminio, barandillas, otros (por m²) | **Multiplicador** `factors[campo][opción]` sobre el precio por m² (1 = sin recargo) para los campos que tienen tabla. Además: «otros» › herrajes en € (`hardware`), espejos › extras en € (solo iluminación y antivaho tienen precio automático) |
| Mamparas | Suplemento en € por opción: `cristal`, `perfileria`, `acabadoPerfil`, `acabadoCristal` |
| Armarios | € por m²: `cristalM2`, `maderaM2`, `acabadoM2` |

Y los precios sueltos de cada categoría (base, por cm de ancho, suplemento por altura, extraclaro, extras por pieza, materiales del armario…), la nota del precio (`priceNote`) y la entrega (envío y montaje).

**0 €**: en los extras (y los acabados del cristal de la mampara) no suma nada y el cliente lo ve como «se valora en la visita»; en el resto, 0 € es sin recargo. Un multiplicador no puede ser 0.

En el editor, por categoría: si sale en la calculadora, nombre y descripción corta, sus precios y, campo a campo, pregunta, ayuda, si se pregunta (los obligatorios siempre) y la tabla de opciones (orden, nombre, ayuda, si se ve y su precio). **Añadir opción** crea el `value` a partir del nombre («Hexagonal» → `hexagonal`), guarda la lista completa y ordenada de opciones del campo en el catálogo y su precio en `config` (multiplicador 1 o 0 € al principio). Las opciones de serie no se borran: se ocultan. **Restaurar valores por defecto** devuelve una categoría a sus precios y textos de serie. **Probar** es la calculadora de la web con lo que hay en pantalla, aunque no se haya guardado; se guarda todo junto con «Guardar tarifas».

La calculadora reutilizable (`src/components/web/CalculadoraCampos.tsx` + `src/hooks/useCalculadora.ts`) pinta cualquier categoría respetando las condiciones (`when`) y calcula con `categoria.quote(valores, precios)`; la usa también el gestor de presupuestos ([PRESUPUESTOS.md](PRESUPUESTOS.md)).

## Contenido

Una fila por bloque en `web_contenido`; la web mezcla `valor` sobre lo de su código:

| Clave | Qué es | Cómo lo usa la web |
|---|---|---|
| `negocio` | Lema, descripción, años de experiencia, teléfonos, WhatsApp, correo, dirección, horario y zona de trabajo | Mezcla superficial sobre `site` (la dirección, campo a campo). Lo vacío no se guarda |
| `servicios` | Por servicio (`mamparas`, `espejos`, `cerramientos`, `aluminio`, `barandillas`, `armarios`, `domino`, `otros`): nombre, descripción corta, titular, presentación, lo que incluye, ideas y textos para buscadores | Sobre cada servicio de su código |
| `faq` | Lista completa `[{q, a, tags}]` | Si está vacía, la del código |
| `imagenes` | `hero`, `heroHouse`, `about`, `aboutHands`, `contact`: `{ruta, alt}` en `web-fotos` | La elegida o, sin ella, la de su código. El panel enseña la de la web (`https://cristaleriabv.vercel.app` + su ruta) hasta que se elige otra |

Las imágenes se eligen entre las fotos subidas o se sube una nueva (va a `sueltas/`); «Volver a la de la web» la quita. Si se borra una foto que usaba una imagen, la base quita esa imagen y la web vuelve a la suya.

## Lo que lee la web (REST, cabecera `apikey`)

- Tarifas: `GET /rest/v1/web_tarifas?select=config,catalogo&id=eq.1` → `resolverTarifas(categories, fila)`.
- Contenido: `GET /rest/v1/web_contenido?select=clave,valor`.
- Books: `GET /rest/v1/web_albumes?select=id,slug,titulo,descripcion,servicio,portada_foto_id,orden,fotos:web_fotos(id,ruta,titulo,alt,ancho,alto,orden,destacada)&publicado=eq.true&order=orden.asc&fotos.order=orden.asc`.
- Destacadas: `GET /rest/v1/web_fotos?select=id,ruta,titulo,alt,ancho,alto,album:web_albumes(slug,titulo,servicio)&destacada=eq.true&order=orden.asc`.
- Foto: `https://<ref>.supabase.co/storage/v1/object/public/web-fotos/<ruta>`.

La RLS deja a `anon` leer tarifas, contenido, los books publicados y sus fotos publicadas (o sueltas); nada de presupuestos. El bucket es público para ver las fotos por su URL, pero solo el panel puede listarlo (las fotos sin publicar no se pueden enumerar).

## Solicitudes de presupuesto desde la web

Edge Function **pública** `web-solicitud-presupuesto` (`verify_jwt = false`, CORS abierto sin credenciales). `POST` con `{nombre, telefono, email?, poblacion?, direccion?, notas?, categoria, valores, total, resumen, consentimiento: true, website: ""}`:

- `website` es un campo trampa: si llega relleno responde `200 {numero: null}` sin guardar nada.
- Valida nombre (2–120), teléfono (6–30, con al menos 6 cifras), email (≤ 200), notas (≤ 1500), resumen (≤ 4000), total (0–1 000 000), `valores` (objeto ≤ 20 KB), categoría (una de las 8) y consentimiento. Si algo falla: `400 {error}` con el motivo para el cliente.
- Límite: 5 solicitudes por hora por **huella** de IP (HMAC-SHA256 con la clave de servicio como sal; la IP no se guarda nunca), en la tabla `web_solicitudes_limite` (sin políticas, se purga sola al día). Pasado: `429 {error}`.
- Guarda con el service role, por `web_solicitud_presupuesto_registrar()`, un presupuesto `estado = 'solicitud'`, `origen = 'web'` con una línea (`categoria`, `valores`, «Solicitud web · <nombre de la categoría>», el resumen como detalle, cantidad 1, el total **con IVA** como precio calculado y ese total sin el IVA del presupuesto como precio: el total del presupuesto es el precio web; ver [PRESUPUESTOS.md](PRESUPUESTOS.md#iva-el-precio-de-la-web-lleva-iva)) y un aviso `presupuesto_solicitud` en la campana, que solo ve quien tiene Presupuestos. Responde `200 {numero}` (`P-AAAA-NNNN`).
- En la auditoría sale como «API · service_role · web-solicitud-presupuesto».

Los presupuestos (`presupuestos`, `presupuesto_lineas`) llevan número correlativo por año que pone la base y no se reutiliza (`presupuestos_numeracion`), y la base mantiene `subtotal` (suma de importes) y `total` (con descuento e IVA). Se atienden en **Presupuestos** (`/presupuestos?estado=solicitud`; el aviso de la campana abre la solicitud): ver [PRESUPUESTOS.md](PRESUPUESTOS.md).
