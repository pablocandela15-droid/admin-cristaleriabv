# Presupuestos

Gestor de presupuestos del panel (`/presupuestos`, menú **Presupuestos**, grupo «Web y clientes» de Control del Panel, junto a Web). Hace los presupuestos con **la misma calculadora de la web** y las tarifas de **Web › Tarifas**, los descarga en PDF con la marca y los envía por WhatsApp o correo. Aquí llegan también las **solicitudes** que mandan los clientes desde la calculadora de la web ([WEB.md](WEB.md#solicitudes-de-presupuesto-desde-la-web)).

Esquema: tablas `presupuestos` y `presupuesto_lineas` de [`20261123100000_web_y_presupuestos.sql`](../supabase/migrations/20261123100000_web_y_presupuestos.sql). El panel no cambia el esquema: la base pone el número (`P-AAAA-NNNN`, correlativo por año, nunca reutilizado), el importe de cada línea (columna generada) y los totales (`subtotal` y `total` con descuento e IVA, por disparador).

## Permisos

Sección `presupuestos` (Usuarios › Permisos), módulo `presupuestos` (se puede apagar en Control del Panel). La base lo hace cumplir (RLS: leer con `can_read_section`, escribir con `can_edit_section`).

| Permiso | Qué puede hacer |
|---|---|
| **Ver** | Lista y presupuestos en **solo lectura** (sale la etiqueta «Solo lectura»); puede descargar el PDF. Ve el aviso de cada solicitud en la campana |
| **Puede editar** | Además: crear, cambiar, añadir y recalcular líneas, cambiar de estado, enviar por WhatsApp o correo, duplicar y borrar; atender las solicitudes de la web |

Se puede elegir como sección de inicio al entrar (Usuarios › Permisos › «Al iniciar sesión, abrir»).

## Lista

- Número, cliente (con teléfono y población), fecha, estado, total. Tabla en pantallas anchas y tarjetas en el móvil.
- **Estado**: Solicitud, Borrador, Enviado, Aceptado, Rechazado. **Caducado** no es un estado guardado: sale en un presupuesto **enviado** cuya validez (`fecha + validez_dias`) ya ha pasado.
- **Web**: llegó desde la calculadora de la web.
- Filtro por estado (el de **Solicitudes** lleva cuántas hay sin atender) y búsqueda por número, cliente (sin mirar acentos), correo, población o teléfono (solo cuentan las cifras). Filtro y búsqueda van en la dirección: `/presupuestos?estado=solicitud&q=juan`.
- Las **solicitudes** enseñan lo que escribió el cliente y el precio que le dio la web («Precio web (IVA incl.)»), con **Convertir en borrador** (pasa a borrador, le pone las condiciones de siempre si no tiene y lo abre).
- **Nuevo presupuesto**: basta con el nombre del cliente (y, si se tiene, teléfono, correo y población). Se crea en borrador, con validez de 30 días y las condiciones de siempre, y se abre.

## Un presupuesto

`/presupuestos?id=<id>` (el aviso `presupuesto_solicitud` de la campana lleva ahí; sin id, a las solicitudes).

- **Cliente**: nombre (obligatorio), teléfono, correo, dirección y población.
- **Líneas**: se ordenan arrastrando o con las flechas; descripción, detalle, cantidad y precio se cambian en la propia línea y se guardan al salir del campo (los números se escriben a la española, «1.234,5»). Quitar una línea se puede **deshacer** desde el aviso.
  - **Añadir desde calculadora**: cualquier categoría (también las ocultas en la web, marcadas «oculta en la web»), con los campos y las condiciones de la calculadora (`CalculadoraCampos`) y el cálculo al momento con las tarifas de hoy (`ResultadoCalculo`, «Total orientativo (IVA incl.)»). Añade `{categoria, valores, descripcion: nombre de la categoría (+ « · » nombre de la pieza), detalle: lo elegido + desglose, cantidad 1, precio_unitario = round(total / (1 + IVA/100), 2), precio_calculado = total}`: **los precios de la calculadora llevan el IVA incluido** (ver [IVA](#iva-el-precio-de-la-web-lleva-iva)).
  - **Recalcular** (líneas de la calculadora): abre la calculadora con lo que se guardó y compara el precio de la línea (sin IVA), el precio web al añadirla y el de las tarifas de hoy (los dos con IVA). Al actualizar se cambian valores, detalle y precios (con el IVA que haya en pantalla); la descripción solo si era la automática (o la de una solicitud de la web). Si con las tarifas de hoy sale otro precio, la línea lo avisa sin abrir nada («Tarifa de hoy: …»).
  - Cada línea de la calculadora enseña su **«Precio web (IVA incl.)»**; si con su precio y el IVA del presupuesto ya no da ese precio, lo dice en ámbar («con este precio e IVA: …»).
  - **Línea manual**: concepto, detalle, cantidad y precio (desplazamiento, retirada de un cristal…).
- **Totales**: subtotal, descuento (%), base imponible, IVA (%, 21 de serie) y total, calculados al momento como la base (`round(cantidad × precio, 2)` por línea; `total = round(subtotal × (1 − descuento/100) × (1 + IVA/100), 2)`); el IVA es `total − base`, así base + IVA = total. Lo guardado lo pone la base.
- **Condiciones y notas**: fecha, validez (días; enseña «válido hasta»), condiciones (salen en el PDF; «Poner las de siempre» = «Presupuesto válido durante N días desde su fecha.» + la nota de precios de Web › Tarifas; cambiar los días cambia esa frase) y notas internas (no salen en el PDF ni en los envíos).
- Los datos del cliente, totales y condiciones se guardan con la barra de abajo (sale solo con cambios). Antes de descargar o enviar, si hay cambios, se guardan.

### Estados

| Desde | Botones | Qué guarda |
|---|---|---|
| Solicitud | **Convertir en borrador**, Descartar solicitud | borrador (con las condiciones de siempre si no tiene) / rechazado + `respondido_en` |
| Borrador | **Marcar como enviado** | enviado + `enviado_en` |
| Enviado | **Aceptado**, Rechazado, Volver a borrador | `respondido_en` / borrador quita `enviado_en` y `respondido_en` |
| Aceptado o rechazado | Volver a enviado (si se envió), Reabrir como borrador | enviado conserva su `enviado_en` |

Cualquier cambio en una solicitud (cabecera o líneas) la pasa sola a borrador. **Duplicar** crea un borrador nuevo con fecha de hoy y las mismas líneas y lo abre; **Borrar** pide confirmación (el número no se reutiliza).

## PDF y envíos

- **Descargar PDF** (`Presupuesto-P-2026-0001.pdf`), con pdf-lib (cargado bajo demanda), A4 vectorial: el logotipo original (`public/marca/logo-horizontal.svg`, sus trazos dibujados tal cual; sin él, el nombre escrito), «PRESUPUESTO», número, fecha y validez; los datos del negocio de **Web › Contenido › Datos del negocio** (`web_contenido` 'negocio'; lo que falte, los de siempre); el cliente; las líneas con su detalle (sigue en otra hoja con la cabecera de la tabla si no cabe); los totales con descuento e IVA; las condiciones; y al pie, número y página. Colores del manual de marca; letra Helvetica del PDF (lo que no sabe escribir se cambia por lo más parecido).
- **Enviar por WhatsApp**: `wa.me` al teléfono del cliente (9 cifras → prefijo 34) con un texto corto: número, total (IVA incluido) y válido hasta. Sin teléfono válido no se puede.
- **Enviar por email**: descarga el PDF y abre el correo (`mailto`) con asunto y cuerpo. **El PDF hay que adjuntarlo a mano** (un enlace de correo no puede adjuntar nada); el panel lo dice al enviarlo.
- Tras enviar un borrador, el aviso ofrece **Marcar como enviado**.

## Código

| Qué | Dónde |
|---|---|
| Página (lista o `?id=`) | `src/pages/Presupuestos.tsx` |
| Lista, editor, líneas, calculadora, línea manual, totales, etiquetas, nuevo | `src/components/presupuestos/` |
| Datos (React Query; estado, líneas y orden al momento y deshechos si fallan) | `src/hooks/usePresupuestos.ts` |
| Permisos y tarifas resueltas | `src/hooks/usePermisosPresupuestos.ts`, `src/hooks/useTarifasCalculadora.ts` |
| Lógica sin React: estados, totales, filtros, líneas, formulario, negocio y condiciones, envíos, PDF | `src/lib/presupuestos/` |

Pruebas: `src/lib/presupuestos/__tests__/` (lógica y PDF), `src/components/presupuestos/__tests__/` (lista y editor), `src/hooks/__tests__/usePresupuestos.test.tsx` (datos) y `src/pages/__tests__/Presupuestos.permisos.test.tsx` (permisos).

## IVA: el precio de la web lleva IVA

Decisión del dueño (24/11/2026): **los precios de la calculadora de la web incluyen el IVA**. Una línea que viene de la calculadora (panel «Añadir desde calculadora», «Recalcular» y solicitudes de la web) guarda:

| Campo | Valor | Qué es |
|---|---|---|
| `precio_calculado` | total de la calculadora | El **precio web**, IVA incluido: lo que vio el cliente |
| `precio_unitario` | `round(total / (1 + iva_pct/100), 2)` | El precio de la línea, **sin IVA**, con el IVA del presupuesto (21 de serie) |

Así el total del presupuesto (que suma el IVA) es el precio web: una solicitud de 560 € lleva la línea a 462,81 € y el total es 560,00 € (antes salía 677,60 €). Con precios a céntimos el total puede salir **un céntimo** arriba o abajo (100 € → 82,64 € → 99,99 €).

- Las solicitudes de la web las guarda así `web_solicitud_presupuesto_registrar()` desde la migración [`20261124100000_presupuestos_iva_incluido.sql`](../supabase/migrations/20261124100000_presupuestos_iva_incluido.sql). Esa migración ajusta también las solicitudes **sin atender** que ya estaban guardadas con el precio web como precio de la línea; las que ya se están trabajando no se tocan. Su vuelta atrás (`supabase/rollbacks/`) restaura la función anterior y deshace ese ajuste.
- **Cambiar el IVA** de un presupuesto **no reescribe** sus líneas (ni en la base ni en el panel): el editor avisa («… no da su precio web con el IVA nuevo») y «Recalcular» ajusta cada línea al IVA de pantalla.
- Las líneas manuales no cambian: su precio es sin IVA, como siempre.
- Web › Tarifas lo dice arriba («Todos los precios llevan el IVA incluido») y «Probar» enseña «Total orientativo (IVA incl.)».
