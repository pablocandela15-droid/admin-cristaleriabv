// ============================================================================
//  Presupuestos: líneas (sin React)
// ----------------------------------------------------------------------------
//  Una línea de la calculadora guarda la categoría y lo rellenado (`valores`)
//  para poder recalcularla con las tarifas de hoy; su texto sale del cálculo:
//    descripcion = nombre de la categoría (+ « · » nombre de la pieza)
//    detalle     = lo elegido («Etiqueta: valor», una línea por opción) y el
//                  desglose del cálculo
//    cantidad 1 y precio = total de la calculadora (que ya cuenta las piezas).
//  Las manuales no tienen categoría.
// ============================================================================
import type { CategoryDef, Quote, Values } from "@/lib/web/pricing/categories";
import type { PricingConfig } from "@/lib/web/pricing/config";
import { calcular, resumenValores } from "@/lib/web/calculadora";
import { eurosCentimos } from "./totales";
import type { LineaNueva, LineaPresupuesto } from "./tipos";

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Prefijo de la línea que crea una solicitud de la web (web_solicitud_presupuesto_registrar). */
export const PREFIJO_SOLICITUD_WEB = "Solicitud web · ";

export function descripcionDeCalculo(categoria: Pick<CategoryDef, "name">, valores: Values): string {
  const pieza = texto(valores.nombrePieza);
  return (pieza ? `${categoria.name} · ${pieza}` : categoria.name).slice(0, 500);
}

/** «Etiqueta: valor» de lo elegido y, debajo, el desglose del cálculo y lo que se valora en la visita. */
export function detalleDeCalculo(categoria: CategoryDef, valores: Values, calculo: Quote): string {
  const partes: string[] = [];
  const resumen = resumenValores(categoria, valores);
  if (resumen) partes.push(resumen);
  if (calculo.lines.length) {
    partes.push(
      ["Desglose:", ...calculo.lines.map((l) => `· ${l.label}${l.detail ? ` (${l.detail})` : ""}: ${l.amount == null ? "se valora en la visita" : eurosCentimos(l.amount)}`)].join("\n"),
    );
  }
  if (calculo.pending.length) partes.push(`Se valora en la visita: ${calculo.pending.join(", ")}.`);
  return partes.join("\n\n").slice(0, 5000);
}

/** La línea que se añade desde la calculadora. */
export function lineaDesdeCalculadora(categoria: CategoryDef, valores: Values, calculo: Quote): LineaNueva {
  return {
    categoria: categoria.id,
    valores: JSON.parse(JSON.stringify(valores)) as Values,
    descripcion: descripcionDeCalculo(categoria, valores),
    detalle: detalleDeCalculo(categoria, valores, calculo) || null,
    cantidad: 1,
    precio_unitario: calculo.total,
    precio_calculado: calculo.total,
  };
}

/**
 * ¿Es la descripción la que pone el cálculo (o la de una solicitud de la web)? Si alguien la ha cambiado a mano,
 * recalcular la respeta.
 */
export function descripcionAutomatica(
  linea: Pick<LineaPresupuesto, "descripcion" | "categoria" | "valores">,
  categorias: Partial<Record<string, CategoryDef>>,
): boolean {
  if (linea.descripcion.startsWith(PREFIJO_SOLICITUD_WEB)) return true;
  const cat = linea.categoria ? categorias[linea.categoria] : undefined;
  return !!cat && linea.descripcion === descripcionDeCalculo(cat, linea.valores ?? {});
}

/** Cambios al recalcular una línea con lo que hay ahora en la calculadora. */
export function cambiosAlRecalcular(
  linea: Pick<LineaPresupuesto, "descripcion" | "categoria" | "valores">,
  categoria: CategoryDef,
  valores: Values,
  calculo: Quote,
  categorias: Partial<Record<string, CategoryDef>>,
) {
  const nueva = lineaDesdeCalculadora(categoria, valores, calculo);
  return {
    categoria: nueva.categoria,
    valores: nueva.valores,
    detalle: nueva.detalle,
    precio_unitario: nueva.precio_unitario,
    precio_calculado: nueva.precio_calculado,
    ...(descripcionAutomatica(linea, categorias) ? { descripcion: nueva.descripcion } : {}),
  };
}

/**
 * Lo que daría hoy la calculadora con lo guardado en la línea, o null si no es de la calculadora o le faltan datos
 * (p. ej. una categoría cuyos campos han cambiado).
 */
export function precioConTarifasDeHoy(
  linea: Pick<LineaPresupuesto, "categoria" | "valores">,
  categorias: Partial<Record<string, CategoryDef>>,
  precios: PricingConfig,
): number | null {
  const cat = linea.categoria ? categorias[linea.categoria] : undefined;
  if (!cat || !linea.valores) return null;
  const r = calcular(cat, linea.valores, precios);
  return r.ready ? r.total : null;
}

/** Orden para una línea nueva: detrás de la última. */
export const siguienteOrdenLinea = (lineas: ReadonlyArray<Pick<LineaPresupuesto, "orden">>): number =>
  lineas.reduce((m, l) => Math.max(m, l.orden), -1) + 1;

/** Ordena como la base: por `orden` y, a igualdad, por creación. */
export const ordenarLineas = <T extends Pick<LineaPresupuesto, "orden" | "creado_en">>(lineas: readonly T[]): T[] =>
  [...lineas].sort((a, b) => a.orden - b.orden || a.creado_en.localeCompare(b.creado_en));

/** Mueve un elemento de `desde` a `hasta` (copia). */
export function mover<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  const copia = [...lista];
  if (desde < 0 || desde >= copia.length || hasta < 0 || hasta >= copia.length) return copia;
  const [x] = copia.splice(desde, 1);
  copia.splice(hasta, 0, x);
  return copia;
}

/** Nuevos `orden` (0, 1, 2…) para los ids en ese orden: solo los que cambian. */
export function ordenesNuevos(ids: readonly string[], actuales: ReadonlyMap<string, number>): { id: string; orden: number }[] {
  return ids.flatMap((id, i) => (actuales.get(id) === i ? [] : [{ id, orden: i }]));
}

/** Copia de las líneas para otro presupuesto (duplicar). */
export const copiarLineas = (lineas: readonly LineaPresupuesto[]): LineaNueva[] =>
  ordenarLineas(lineas).map((l) => ({
    categoria: l.categoria,
    valores: l.valores,
    descripcion: l.descripcion,
    detalle: l.detalle,
    cantidad: l.cantidad,
    precio_unitario: l.precio_unitario,
    precio_calculado: l.precio_calculado,
  }));

/** Precio que vio el cliente en la web (lo que dio la calculadora en sus líneas), o null. */
export function precioWeb(lineas: ReadonlyArray<Pick<LineaPresupuesto, "precio_calculado" | "cantidad">>): number | null {
  const conPrecio = lineas.filter((l) => l.precio_calculado != null);
  if (!conPrecio.length) return null;
  return conPrecio.reduce((s, l) => s + Number(l.precio_calculado) * (Number(l.cantidad) || 0), 0);
}
