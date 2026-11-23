# Facturas (lectura automática de facturas de proveedores)

Módulo del Admin Panel para guardar las facturas de los proveedores de Cristalería BV (vidrio, perfilería, herrajes, consumibles…), leerlas solas con IA y consultar qué se compra, a quién y a qué precio. Ruta `/facturas`, interruptor `facturas` en *Control del Panel*.

- **Base de datos**: [`supabase/migrations/20261121100000_facturas.sql`](../supabase/migrations/20261121100000_facturas.sql) (vuelta atrás: [`supabase/rollbacks/20261121100000_facturas_ROLLBACK.sql`](../supabase/rollbacks/20261121100000_facturas_ROLLBACK.sql)). Pruebas: `npm run test:nucleo:db` (`scripts/test-facturas.mjs`).
- **Edge Functions**: `procesar-factura` (con sesión), `ocr-trabajo` y `clasificar-productos` (de servidor a servidor, con `x-ocr-secret`).
- **Panel**: `src/pages/Facturas.tsx`, `src/components/facturas/`, `src/lib/facturas/`, `src/hooks/use{Facturas,ListaCompras,ProductosCatalogo,Proveedores,Compras,…}.ts`.
- Puesta en marcha (secretos, Vault, tareas): [DESPLIEGUE.md](DESPLIEGUE.md).

## Pestañas y permisos

| Pestaña | Qué hay |
|---|---|
| **Compras** | Un buscador y tres formas de mirar lo comprado: *Documentos* (facturas por meses, con su original al lado), *Productos* (catálogo con categorías, gasto, «Subieron de precio», gráfica de precio por proveedor, fusionar y clasificar) y *Proveedores* (de más a menos gasto; cada uno se despliega con qué se le compra y sus facturas). |
| **Cargar** | Subir PDF o fotos (también varias páginas de una misma factura), ver cómo van, decidir sobre las repetidas y corregir lo leído. |

| Permiso (Usuarios) | Puede |
|---|---|
| `facturas` · Ver | Consultar Compras (sin Cargar, sin cambiar nada). |
| `facturas` · Editar | Todo: corregir, verificar, borrar líneas, clasificar, ajustes y subir. |
| `facturas_subida` (un interruptor, «Puede subir») | Solo Cargar: subir y corregir lo que sube él mismo; sustituir o completar solo lo suyo. No ve Compras. |

La base lo hace cumplir: las escrituras piden `can_edit_section('facturas')` (no basta «Ver»), «Subida» pasa por `facturas_puede_subir()` y por el disparador `facturas_subida_solo_lo_leido`, y cada tabla lleva la política restrictiva `acceso_panel_no_bloqueado`.

## Cómo se lee una factura

1. **Subida**: el panel trocea el documento en el navegador si hace falta (PDF de varias páginas → una pieza por página; captura de móvil muy alta → franjas que se solapan) y sube las piezas al bucket privado `facturas-originales`, en `pendientes/{usuario}/{trabajo}/`.
2. **Trabajo**: `procesar-factura` (modo `iniciar`) crea el trabajo (`ocr_trabajos`) con sus piezas (`ocr_trabajo_paginas`) y Postgres lo despacha con `pg_net` a `ocr-trabajo` (función `ocr_despachar`; URL y secreto en Vault).
3. **Lectura**: `ocr-trabajo` lee cada pieza con el modelo de visión (OpenAI, clave del proceso «ocr») y, al terminar todas, **consolida**: une las páginas, quita las filas repetidas de los solapes, comprueba que cuadre (base + IVA = total, línea a línea, magnitudes) y guarda la factura y sus líneas (`facturas`, `productos_factura`).
4. **Original**: se mueve a `originales/AAAA/MM/{factura}-{nombre}` (`facturas.archivo_path`, para siempre) y se borran las piezas. Lo que quede en `pendientes/` lo borra la limpieza diaria (`limpiar-pendientes-ocr`, a los 7 días).
5. **Después**: un disparador asigna el proveedor (crea uno nuevo si no lo conoce; nunca toma a Cristalería BV por proveedor, ni por su nombre ni por `configuracion_facturas.cif_empresa`), cada línea va a su producto del catálogo si ya se conoce (`productos_alias`) y las que no, las clasifica `clasificar-productos` cada 5 minutos. Si un producto llega más caro que su referencia (media de 90 días o últimas compras) por encima del umbral de *Productos › Avisos de precio*, sale un aviso en la campana (`subida_precio`, enlazado al documento).
6. **Rescate**: la tarea `reanudar-trabajos-ocr` (cada minuto) vuelve a despachar las piezas paradas y da por fallidos los trabajos que pasan de su tiempo; el panel adopta al recargar los trabajos que siguen en el servidor.

Lo que cuesta cada lectura se guarda en dólares (`ocr_trabajos.coste_usd`, `facturas.coste_lectura_usd`) y cada llamada a OpenAI queda en `ia_uso` (funciones `procesar-factura`, `ocr-trabajo` y `clasificar-productos`), así que el gasto sale en *Super Admin › Servicios* y encima de la pestaña Cargar («Lectura con IA, 30 días»).

### Estados de un trabajo (`ocr_trabajos.estado`)

| Estado | Qué significa |
|---|---|
| `pendiente` | Creado; esperando a que se despache. |
| `pagina1` / `paginas` | Leyendo la primera pieza / el resto. |
| `consolidando` | Todas leídas; uniendo y guardando. |
| `completado` | Factura guardada (`factura_id`). |
| `duplicado` | Ya existía una factura con el mismo número y proveedor: queda en *Pendientes de decidir* para **Sustituir** (`ocr_sustituir_factura`, guarda la copia de antes en `facturas_sustituciones`), **Añadir como página** si es otra página de la misma (`ocr_anadir_pagina`) o **Dejar la que hay** (`ocr_descartar_trabajo`). |
| `fallido` | No se pudo leer (se puede reintentar desde Cargar). |
| `cancelado` | Lo cancelaste o descartaste. |

### Verificación y avisos

Al guardar, `validar_cordura_factura` deja los avisos en `facturas.alertas_validacion` (IVA que no cuadra, total deducido, precio unitario extremo, línea sin importe…). Una factura que cuadra, sin avisos graves y de un proveedor ya conocido se marca sola como **revisada (auto)**; el resto sale «Sin revisar» hasta que alguien con «Editar» la revise.

## Costes

Leer una factura de una página cuesta del orden de **1 céntimo**; las largas, proporcional a sus piezas. La estimación de partida (`ia_coste_estimado`) es de 0,0075 USD por documento y 60 facturas al mes. El modelo se elige en *Super Admin › Servicios › Modelos* (`ia_modelo_funcion`); los secretos `OCR_MODELO`, `OCR_MODELO_PIEZAS`, `OCR_DETALLE` y `CLASIFICAR_PRODUCTOS_MODELO` solo valen como respaldo.

## Qué no está (respecto al panel de referencia)

Notas de entrega y su cotejo con las facturas, varios locales, copia de los originales en Google Drive, chat con IA sobre las compras, tablero de análisis y márgenes, contenido por envase, abreviaturas de marcas e importación histórica.
