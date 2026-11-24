// ============================================================================
//  Calculadora de la web en el panel (sin React)
// ----------------------------------------------------------------------------
//  Lo comparten «Probar» de Web › Tarifas y el gestor de presupuestos: valores
//  de partida de una categoría, campos visibles (respetando `when`), el cálculo
//  con categoria.quote(valores, precios) y el resumen en texto de lo elegido
//  (el mismo formato «Etiqueta: valor» que manda la web).
// ============================================================================
import { optionLabel, visibleFields, type CategoryDef, type FieldDef, type Quote, type Values } from "./pricing/categories";
import type { PricingConfig } from "./pricing/config";

/** Valores con los que arranca una categoría (los de su código, ya corregidos por el catálogo). */
export function valoresIniciales(categoria: CategoryDef): Values {
  return JSON.parse(JSON.stringify(categoria.defaults ?? {})) as Values;
}

/** Campos visibles con esos valores (los que tienen `when` y no se cumple, fuera). */
export function camposVisibles(categoria: CategoryDef, valores: Values): FieldDef[] {
  return visibleFields(categoria, valores);
}

/** Precio con esos valores. `quote` usa `this`: siempre como método de la categoría. */
export function calcular(categoria: CategoryDef, valores: Values, precios: PricingConfig): Quote {
  try {
    return categoria.quote(valores, precios);
  } catch {
    return { total: 0, ready: false, missing: [], lines: [], pending: [] };
  }
}

/** Lo elegido, «Etiqueta: valor», solo de los campos visibles con valor (sin los «No»). */
export function opcionesElegidas(categoria: CategoryDef, valores: Values): { label: string; value: string }[] {
  return camposVisibles(categoria, valores)
    .map((f) => ({ label: f.label, value: optionLabel(f, valores[f.id]) }))
    .filter((x) => x.value && x.value !== "No");
}

/** Resumen en texto (una línea por opción): el detalle de la línea de un presupuesto. */
export function resumenValores(categoria: CategoryDef, valores: Values): string {
  return opcionesElegidas(categoria, valores)
    .map((o) => `${o.label}: ${o.value}`)
    .join("\n");
}

// `useGrouping: "always"`: en español el separador de miles no sale con 4 cifras («1903») salvo que se pida.
const ENTERO = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const DECIMAL = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);

/** Importe en euros al estilo español: «1.234 €», «1.234,50 €». */
export const euros = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${Number.isInteger(n) ? ENTERO.format(n) : DECIMAL.format(n)} €`;
