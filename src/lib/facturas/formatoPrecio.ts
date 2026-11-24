// Formato es-ES de cifras, precios y fechas de la gráfica de precio de un
// producto (Compras › Productos): sin pasar por `Intl` ni por `Date`.

const NBSP = " ";

/**
 * Número con punto de miles y coma decimal SIEMPRE («1.234,56»). Se hace a
 * mano porque `Intl` en es-ES no agrupa los números de 4 cifras («1234,56»).
 */
export function formatNumeroEs(n: number, decimales = 2, minimoDecimales = decimales): string {
  const factor = 10 ** decimales;
  const redondeado = Math.round(Math.abs(n) * factor) / factor;
  let [entera, dec = ""] = redondeado.toFixed(decimales).split(".");
  entera = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  dec = dec.replace(/0+$/, "").padEnd(minimoDecimales, "0");
  const signo = n < 0 && redondeado !== 0 ? "-" : "";
  return `${signo}${entera}${dec ? `,${dec}` : ""}`;
}

/** "2026-10-03" → "03/10/2026" (sin pasar por Date: nada de husos). */
export function formatFechaEs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Precio unitario: hasta 4 decimales, mínimo 2 («12,9» → «12,90 €/m2»). */
export const formatPrecioUnidad = (precio: number | null | undefined, unidad?: string | null): string =>
  precio === null || precio === undefined ? "—" : `${formatNumeroEs(precio, 4, 2)}${NBSP}€${unidad ? `/${unidad}` : ""}`;

/** «+12,5 %» / «−3 %». */
export const formatPorcentaje = (pct: number): string =>
  `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${formatNumeroEs(Math.abs(pct), 1, 0)}${NBSP}%`;
