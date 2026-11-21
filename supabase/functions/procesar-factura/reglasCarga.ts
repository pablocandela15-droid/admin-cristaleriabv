// ============================================================================
//  reglasCarga.ts · Reglas de la lectura que no necesitan ver la imagen
// ----------------------------------------------------------------------------
//  Las que el código puede decidir sin mirar el papel viven aquí; las que
//  exigen mirarlo van en el prompt (prompts.ts) y en el esquema.
//
//  Dos momentos:
//   · aplicarReglasLectura(doc): sobre la lectura del modelo, ANTES del cuadre
//     (líneas con IVA incluido). Así el cuadre ve ya el documento corregido y
//     no pide relecturas inútiles. Sus avisos viajan en `avisos_reglas` hasta
//     normalizarDatos.
//   · El resto (abonos, no-compra, fecha, duplicados) lo llaman
//     normalizarDatos y guardado.ts.
//  Puro: sin Deno ni red. Lo importa vitest.
// ============================================================================

export interface AvisoRegla {
  codigo: string;
  severidad: "alta" | "media";
  mensaje: string;
  detalle: Record<string, unknown>;
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// ─── Clase de documento: lo que NO es una compra ────────────────────────────
export const CLASES_DOCUMENTO = [
  "compra",
  "adeudo_bancario",
  "comision_tpv",
  "comision_bancaria",
  "cuota_leasing_prestamo",
  "venta_emitida",
  "otro_no_compra",
] as const;
export type ClaseDocumento = typeof CLASES_DOCUMENTO[number];

const QUE_ES: Record<Exclude<ClaseDocumento, "compra">, string> = {
  adeudo_bancario: "un adeudo o recibo SEPA del banco",
  comision_tpv: "una liquidación o comisión del datáfono",
  comision_bancaria: "una comisión o custodia bancaria",
  cuota_leasing_prestamo: "una cuota de leasing o de préstamo",
  venta_emitida: "una factura EMITIDA por Cristalería Baix Vinalopó (una venta, no una compra)",
  otro_no_compra: "un documento que no es una factura de proveedor",
};

export interface NoCompra {
  clase: Exclude<ClaseDocumento, "compra">;
  mensaje: string;
}

/**
 * ¿El documento NO es una factura de compra? (no se carga como gasto).
 * Manda la clase que da el modelo; además, si el emisor es la propia
 * empresa (su nombre y su CIF) y el destinatario es otro, es una venta.
 */
export function documentoNoCompra(
  d: { clase_documento?: unknown; cif?: unknown; proveedor?: unknown; cliente?: unknown },
  esCifCliente: (c: string) => boolean,
  esNombreCliente: (n: string) => boolean,
): NoCompra | null {
  let clase = typeof d.clase_documento === "string" && (CLASES_DOCUMENTO as readonly string[]).includes(d.clase_documento)
    ? d.clase_documento as ClaseDocumento
    : "compra";
  if (clase === "compra") {
    const emiteLaEmpresa = (typeof d.cif === "string" && esCifCliente(d.cif)) &&
      (typeof d.proveedor === "string" && esNombreCliente(d.proveedor));
    const cliente = typeof d.cliente === "string" ? d.cliente.trim() : "";
    if (emiteLaEmpresa && cliente && !esNombreCliente(cliente)) clase = "venta_emitida";
  }
  if (clase === "compra") return null;
  return {
    clase,
    mensaje: `No es una factura de compra: es ${QUE_ES[clase]}. No se guarda como gasto. ` +
      `Si de verdad es una compra, créala a mano en Facturas.`,
  };
}

// ─── Reglas sobre la lectura, antes del cuadre ───────────────────────────────

interface LineaLeida {
  nombre?: string;
  cantidad?: number | null;
  precio_unitario?: number | null;
  total?: number | null;
  iva_pct?: number | null;
  bonificada?: boolean;
}

interface DocLeido {
  subtotal?: number | null;
  iva?: number | null;
  total?: number | null;
  total_literal?: string | null;
  sin_importes?: boolean;
  productos?: LineaLeida[];
  avisos_reglas?: AvisoRegla[];
}

/**
 * Líneas impresas CON IVA incluido: suman el total con IVA y no la base. Se
 * pasan a base (con el tipo de cada línea si lo traen todas; si no, en
 * proporción base/total) y se avisa. Solo si base, IVA y total están leídos.
 */
function reglaIvaIncluido<T extends DocLeido>(d: T, avisos: AvisoRegla[]): T {
  if (d.sin_importes || !Array.isArray(d.productos) || d.productos.length === 0) return d;
  if (!esNum(d.subtotal) || !esNum(d.iva) || !esNum(d.total) || d.iva === 0 || d.subtotal === 0) return d;
  const lineas = d.productos;
  if (!lineas.every((l) => esNum(l?.total))) return d;
  const suma = lineas.reduce((a, l) => a + (l.total as number), 0);
  const tol = Math.max(0.05, lineas.length * 0.01);
  const pareceTotal = Math.abs(suma - d.total) <= tol;
  const pareceBase = Math.abs(suma - d.subtotal) <= tol;
  if (!pareceTotal || pareceBase || Math.abs(d.total - d.subtotal) <= tol) return d;

  const conTipo = lineas.every((l) => esNum(l.iva_pct) && (l.iva_pct as number) >= 0 && (l.iva_pct as number) <= 30);
  const factorProporcional = d.subtotal / suma;
  const productos = lineas.map((l) => {
    const f = conTipo ? 1 / (1 + (l.iva_pct as number) / 100) : factorProporcional;
    return {
      ...l,
      total: r2((l.total as number) * f),
      precio_unitario: esNum(l.precio_unitario) ? r4(l.precio_unitario * f) : l.precio_unitario ?? null,
    };
  });
  const sumaBase = r2(productos.reduce((a, l) => a + (l.total as number), 0));
  avisos.push({
    codigo: "lineas_con_iva_incluido",
    severidad: "media",
    mensaje: `Las líneas venían con el IVA incluido (suman ${r2(suma)} €, el total, y no la base ${d.subtotal} €): ` +
      `se han pasado a base ${conTipo ? "con el tipo de IVA de cada línea" : "en proporción base/total"} ` +
      `(ahora suman ${sumaBase} €). Revísalo contra el papel.`,
    detalle: { suma_con_iva: r2(suma), subtotal: d.subtotal, total: d.total, suma_base: sumaBase, metodo: conTipo ? "iva_por_linea" : "proporcional" },
  });
  return { ...d, productos };
}

/** Reglas sobre la lectura del modelo, antes del cuadre. No muta la entrada. */
export function aplicarReglasLectura<T extends DocLeido>(doc: T): T {
  const avisos: AvisoRegla[] = [...(doc.avisos_reglas ?? [])];
  const d = reglaIvaIncluido(doc, avisos);
  return avisos.length > 0 || doc.avisos_reglas ? { ...d, avisos_reglas: avisos } : d;
}

// ─── Abonos ──────────────────────────────────────────────────────────────────
const negativo = (n: unknown) => (esNum(n) ? -Math.abs(n) : n);

/**
 * Abono / factura rectificativa / devolución: TODOS los importes en negativo
 * (cabecera, líneas, recargos) y la cantidad de las líneas también (como la
 * suma de lo devuelto). El precio unitario queda positivo. Hay proveedores
 * que imprimen sus abonos en positivo: por eso se fuerza el signo y no se
 * confía en él. Fuera de un abono, una línea con importe negativo (una
 * devolución de material) lleva también la cantidad en negativo.
 */
// deno-lint-ignore no-explicit-any
export function aplicarSignoAbono(data: any): { data: any; esAbono: boolean } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const esAbono = data?.es_abono === true;
  const productos = Array.isArray(data?.productos)
    // deno-lint-ignore no-explicit-any
    ? data.productos.map((p: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!p || typeof p !== "object") return p;
      if (esAbono) {
        return {
          ...p,
          total: negativo(p.total),
          cantidad: negativo(p.cantidad),
          precio_unitario: esNum(p.precio_unitario) ? Math.abs(p.precio_unitario) : p.precio_unitario,
        };
      }
      if (esNum(p.total) && p.total < 0 && esNum(p.cantidad) && p.cantidad > 0) return { ...p, cantidad: -p.cantidad };
      return p;
    })
    : data?.productos;
  if (!esAbono) return { data: { ...data, productos }, esAbono };
  return {
    data: {
      ...data,
      productos,
      subtotal: negativo(data.subtotal),
      iva: negativo(data.iva),
      total: negativo(data.total),
      recargo_equivalencia: negativo(data.recargo_equivalencia),
      cargos_fuera_base: negativo(data.cargos_fuera_base),
    },
    esAbono,
  };
}

// ─── Avisos tras normalizar ──────────────────────────────────────────────────

/** Fecha fuera del año esperado: ni este año ni el anterior, o más de 7 días en el futuro. */
export function avisoFechaFueraDeAnio(fecha: string | null, hoy: Date = new Date()): AvisoRegla | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const anio = Number(fecha.slice(0, 4));
  const esteAnio = hoy.getUTCFullYear();
  const limiteFuturo = new Date(hoy.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const futura = fecha > limiteFuturo;
  if (!futura && (anio === esteAnio || anio === esteAnio - 1)) return null;
  return {
    codigo: "fecha_fuera_de_anio",
    severidad: "media",
    mensaje: futura
      ? `La fecha leída (${fecha}) es futura: revisa si el día y el mes están al revés o el año mal leído.`
      : `La fecha leída (${fecha}) no es de ${esteAnio} ni de ${esteAnio - 1}: revisa el año.`,
    detalle: { fecha, anio_actual: esteAnio },
  };
}

// ─── Duplicados ──────────────────────────────────────────────────────────────

const numNorm = (n: unknown) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const provisional = (n: unknown) => /^SN-/i.test(String(n ?? "").trim());

/**
 * La coincidencia por «mismo proveedor + fecha + total» solo es duplicado si a
 * alguna de las dos le falta número (o lleva el provisional SN-…). Con números
 * reales distintos son dos facturas (alquiler 10-26 y 11-26 del mismo día e
 * importe).
 */
export function esOtraFacturaConNumeroDistinto(
  nuevo: string | null | undefined,
  existente: { numero_documento?: string | null; motivo?: string | null },
): boolean {
  if (existente.motivo !== "datos_coincidentes") return false;
  const a = numNorm(nuevo), b = numNorm(existente.numero_documento);
  if (!a || !b || provisional(nuevo) || provisional(existente.numero_documento)) return false;
  return a !== b;
}
