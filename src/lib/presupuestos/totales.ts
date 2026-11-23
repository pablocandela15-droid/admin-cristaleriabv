// ============================================================================
//  Presupuestos: importes y totales (sin React)
// ----------------------------------------------------------------------------
//  Lo mismo que hace la base (presupuesto_calcular_totales), para enseñarlo al
//  momento mientras se escribe:
//    importe  = round(cantidad × precio_unitario, 2)       (cada línea)
//    subtotal = suma de importes
//    total    = round(subtotal × (1 − descuento/100) × (1 + IVA/100), 2)
//  Y el desglose del PDF: base imponible = round(subtotal × (1 − descuento/100),
//  2), descuento = subtotal − base, IVA = total − base (así base + IVA = total).
// ============================================================================

/** Redondeo a céntimos como `round(numeric, 2)` de Postgres (mitades hacia fuera del cero). */
export function redondear2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const signo = n < 0 ? -1 : 1;
  // toPrecision quita el ruido del coma flotante (1.005 × 100 = 100.49999…) antes de redondear.
  return (signo * Math.round(Number((Math.abs(n) * 100).toPrecision(15)))) / 100;
}

export const importeLinea = (l: { cantidad: number; precio_unitario: number }): number =>
  redondear2((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0));

export interface Totales {
  subtotal: number;
  /** Importe del descuento (en positivo). */
  descuento: number;
  baseImponible: number;
  iva: number;
  total: number;
}

const porcentaje = (v: number) => Math.min(100, Math.max(0, Number(v) || 0));

export function calcularTotales(
  lineas: ReadonlyArray<{ cantidad: number; precio_unitario: number }>,
  descuentoPct: number,
  ivaPct: number,
): Totales {
  const subtotal = redondear2(lineas.reduce((s, l) => s + importeLinea(l), 0));
  const d = porcentaje(descuentoPct);
  const i = porcentaje(ivaPct);
  const baseImponible = redondear2(subtotal * (1 - d / 100));
  const total = redondear2(subtotal * (1 - d / 100) * (1 + i / 100));
  return {
    subtotal,
    descuento: redondear2(subtotal - baseImponible),
    baseImponible,
    iva: redondear2(total - baseImponible),
    total,
  };
}

/* ------------------------------------------------------------------ */
/* Números al estilo español                                            */
/* ------------------------------------------------------------------ */

// `useGrouping: "always"`: en español el separador de miles no sale con 4 cifras («1234») salvo que se pida.
const OPCIONES_AGRUPAR = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;
const CENTIMOS = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, ...OPCIONES_AGRUPAR });
const CANTIDAD = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, ...OPCIONES_AGRUPAR });
const PORCENTAJE = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/** Importe con céntimos: «1.234,50 €», «0,00 €». */
export const eurosCentimos = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "—" : `${CENTIMOS.format(Number(n))} €`;

/** Cantidad: «1», «2,5», «1.200». */
export const formatoCantidad = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "" : CANTIDAD.format(Number(n));

/** Porcentaje: «21 %», «7,5 %». */
export const formatoPorcentaje = (n: number): string => `${PORCENTAJE.format(Number(n) || 0)} %`;

/** Número para un campo de texto («2,5»; sin separador de miles). */
export const numeroEditable = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "" : String(Number(n)).replace(".", ",");

/**
 * Lee un número escrito a la española o a la inglesa: «1.234,5», «1234,5», «1234.5», «12». Devuelve null si no es un
 * número. Con coma, los puntos son de miles; sin coma, un único punto con 1–2 decimales es la coma decimal.
 */
export function leerNumero(texto: string): number | null {
  let t = String(texto ?? "").replace(/\s|€|%/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
