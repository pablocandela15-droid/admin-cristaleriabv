// ============================================================================
//  Facturas › Compras — periodo, abonos, regalado y resumen
// ----------------------------------------------------------------------------
//  Cuentas puras (sin React ni Supabase). Todo lo que se suma usa el MISMO
//  criterio que la lista por meses y que la RPC de proveedores: importe con
//  IVA de las facturas; los abonos (total < 0) restan.
// ============================================================================
import type { Factura } from "@/hooks/useFacturas";
import { claveMes, etiquetaMes, importeQueSuma, masReciente, redondear, type DocumentoAgrupable } from "./agrupacionDocumentos";
import type { Proveedor, ResolverProveedor } from "./proveedores";

// ─── Periodo ────────────────────────────────────────────────────────────────

export type PeriodoPreset = "este_mes" | "mes_anterior" | "trimestre" | "anio" | "todo";
/** Un preset del selector, o un mes concreto (al tocar una barra de la gráfica). */
export type Periodo = { tipo: PeriodoPreset } | { tipo: "mes"; mes: string };

export const PERIODOS: { valor: PeriodoPreset; etiqueta: string }[] = [
  { valor: "este_mes", etiqueta: "Este mes" },
  { valor: "mes_anterior", etiqueta: "Mes anterior" },
  { valor: "trimestre", etiqueta: "Trimestre" },
  { valor: "anio", etiqueta: "Año" },
  { valor: "todo", etiqueta: "Todo" },
];

/** Meses `YYYY-MM` inclusive; null = sin límite (todo el histórico). */
export interface RangoMeses {
  desde: string;
  hasta: string;
}

const mesClave = (anio: number, mes0: number) => {
  const d = new Date(anio, mes0, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Meses que abarca un periodo. «Trimestre» y «Año» son los NATURALES de hoy
 * (los del IVA: oct-dic, ene-dic), no los últimos 3 o 12 meses.
 */
export function rangoPeriodo(p: Periodo, hoy: Date): RangoMeses | null {
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (p.tipo) {
    case "este_mes":
      return { desde: mesClave(a, m), hasta: mesClave(a, m) };
    case "mes_anterior":
      return { desde: mesClave(a, m - 1), hasta: mesClave(a, m - 1) };
    case "trimestre": {
      const inicio = m - (m % 3);
      return { desde: mesClave(a, inicio), hasta: mesClave(a, inicio + 2) };
    }
    case "anio":
      return { desde: mesClave(a, 0), hasta: mesClave(a, 11) };
    case "mes":
      return { desde: p.mes, hasta: p.mes };
    default:
      return null;
  }
}

/** ¿El documento cae en el periodo? Sin fecha solo entra en «Todo». */
export function pasaPeriodo(d: Pick<Factura, "fecha">, rango: RangoMeses | null): boolean {
  if (!rango) return true;
  const mes = claveMes(d.fecha);
  return mes >= rango.desde && mes <= rango.hasta && /^\d{4}-\d{2}$/.test(mes);
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Mes corto: «oct» (o «oct 25» si `conAnio`). */
export function mesCorto(clave: string, conAnio = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave);
  if (!m) return clave;
  return `${MESES_CORTOS[Number(m[2]) - 1]}${conAnio ? ` ${m[1].slice(2)}` : ""}`;
}

/** Lo que abarca el periodo, en palabras: «Noviembre 2026», «4.º trimestre 2026 (oct–dic)», «Año 2026». */
export function textoPeriodo(p: Periodo, hoy: Date): string {
  const r = rangoPeriodo(p, hoy);
  if (!r) return "Todo el histórico";
  if (p.tipo === "trimestre") {
    const t = Math.floor((Number(r.desde.slice(5)) - 1) / 3) + 1;
    return `${t}.º trimestre ${r.desde.slice(0, 4)} (${mesCorto(r.desde)}–${mesCorto(r.hasta)})`;
  }
  if (p.tipo === "anio") return `Año ${r.desde.slice(0, 4)}`;
  return etiquetaMes(r.desde);
}

export const mismoPeriodo = (a: Periodo, b: Periodo): boolean =>
  a.tipo === b.tipo && (a.tipo !== "mes" || (b.tipo === "mes" && a.mes === b.mes));

// ─── Abonos y regalado ──────────────────────────────────────────────────────

/** Abono: documento con total negativo (devolución, rectificativa…). */
export const esAbono = (d: Pick<Factura, "total">): boolean => d.total != null && Number(d.total) < 0;

export interface Regalado {
  /** Valor de lo regalado o descontado, sin IVA (importe bruto − importe de la línea). */
  importe: number;
  /** Alguna línea trae el bruto estimado (con el precio de otras facturas). */
  estimado: boolean;
  /** Líneas regaladas (importe 0 y bruto > 0). */
  regalos: number;
}

/** Línea regalada: no se cobró nada pero vale algo. */
export const esLineaRegalo = (p: { precio?: number | null; importe_bruto?: number | null }): boolean =>
  p.importe_bruto != null && p.importe_bruto > 0.005 && Math.abs(p.precio ?? 0) < 0.005;

/** Regalado / descuentos de un documento: suma de (bruto − importe) en las líneas donde es > 0. */
export function regaladoDocumento(d: Pick<Factura, "productos">): Regalado {
  let importe = 0;
  let estimado = false;
  let regalos = 0;
  for (const p of d.productos) {
    if (p.importe_bruto == null) continue;
    const diferencia = p.importe_bruto - (p.precio ?? 0);
    if (diferencia <= 0.005) continue;
    importe += diferencia;
    if (p.importe_bruto_estimado) estimado = true;
    if (esLineaRegalo(p)) regalos += 1;
  }
  return { importe: redondear(importe), estimado, regalos };
}

/**
 * Regalado de un documento: el que ya trae calculado (cabecera de la lista,
 * `documentos_lista()`) o, si trae sus líneas, sumándolas.
 */
export function regaladoDe(d: { regalado?: Regalado; productos?: Factura["productos"] }): Regalado {
  if (d.regalado) return d.regalado;
  return d.productos ? regaladoDocumento({ productos: d.productos }) : { importe: 0, estimado: false, regalos: 0 };
}

// ─── Por proveedor ──────────────────────────────────────────────────────────

/** Lo mínimo para sumar por proveedor: la cabecera y el regalado (ya calculado o con sus líneas). */
export type DocumentoAgregable = DocumentoAgrupable &
  Pick<Factura, "proveedor"> & { regalado?: Regalado; productos?: Factura["productos"] };

export interface AgregadoProveedor<D extends DocumentoAgregable = Factura> {
  /** Clave canónica (`#id`), el texto normalizado si no está unificado, o "" sin proveedor. */
  clave: string;
  nombre: string;
  /** Sus documentos (del periodo elegido), el más reciente primero. */
  documentos: D[];
  /** Neto con IVA (los abonos restan). */
  gasto: number;
  /** Lo que restan sus abonos (0 o negativo) y cuántos son. */
  abonos: number;
  nAbonos: number;
  regalado: number;
  regaladoEstimado: boolean;
  ultimaFecha: string | null;
}

const claveProveedorDoc = (d: Pick<Factura, "proveedor">, resolver: ResolverProveedor) =>
  d.proveedor && d.proveedor.trim() ? resolver(d.proveedor) : null;

/** Una pasada por los documentos: lo de cada proveedor (para la lista, el despliegue y el top). */
export function agregarPorProveedor<D extends DocumentoAgregable>(docs: D[], resolver: ResolverProveedor): Map<string, AgregadoProveedor<D>> {
  const mapa = new Map<string, AgregadoProveedor<D>>();
  for (const d of docs) {
    const r = claveProveedorDoc(d, resolver);
    const clave = r?.clave || "";
    let a = mapa.get(clave);
    if (!a) {
      a = {
        clave,
        nombre: r?.nombre || "Sin proveedor",
        documentos: [],
        gasto: 0,
        abonos: 0,
        nAbonos: 0,
        regalado: 0,
        regaladoEstimado: false,
        ultimaFecha: null,
      };
      mapa.set(clave, a);
    }
    a.documentos.push(d);
    const i = importeQueSuma(d);
    a.gasto += i;
    if (esAbono(d)) {
      a.nAbonos += 1;
      a.abonos += i;
    }
    const reg = regaladoDe(d);
    a.regalado += reg.importe;
    if (reg.importe > 0 && reg.estimado) a.regaladoEstimado = true;
    if (d.fecha && (a.ultimaFecha === null || d.fecha > a.ultimaFecha)) a.ultimaFecha = d.fecha;
  }
  for (const a of mapa.values()) {
    a.documentos.sort(masReciente);
    a.gasto = redondear(a.gasto);
    a.abonos = redondear(a.abonos);
    a.regalado = redondear(a.regalado);
  }
  return mapa;
}

/**
 * Lista del modo Proveedores: por GASTO (mayor primero; empate, por nombre).
 * Con un periodo elegido (`soloConDocumentos`), solo los que tienen algún
 * documento en ese periodo.
 */
export function ordenarProveedoresPorGasto(
  proveedores: Proveedor[],
  agregados: Map<string, AgregadoProveedor<DocumentoAgregable>>,
  soloConDocumentos: boolean,
): Proveedor[] {
  const gasto = (p: Proveedor) => agregados.get(`#${p.id}`)?.gasto ?? 0;
  return proveedores
    .filter((p) => !soloConDocumentos || agregados.has(`#${p.id}`))
    .sort((a, b) => gasto(b) - gasto(a) || a.nombre.localeCompare(b.nombre, "es"));
}
