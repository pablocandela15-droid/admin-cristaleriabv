// ============================================================================
//  Facturas › Compras — la lista LIGERA de documentos
// ----------------------------------------------------------------------------
//  El servidor da las CABECERAS con lo calculado de sus líneas (aviso de precio
//  atípico, «regalado», nº de líneas) en una sola respuesta
//  (`documentos_lista()`); las líneas se piden al abrir la ficha
//  (`documento_compras(id)`) y la búsqueda por línea la hace el servidor
//  (`buscar_documentos_compras(texto)`). Migración 20261121100000_facturas.
//
//  Aquí, cuentas puras (sin React ni Supabase): decodificar la respuesta
//  compacta, los avisos de una cabecera, el proveedor de la lista y los errores.
// ============================================================================
import type { AlertaValidacion, Factura, ProductoFactura } from "@/hooks/useFacturas";
import { avisosDocumento, precioAnomalo } from "@/components/facturas/shared/formatters";
import type { ProveedorResuelto, ResolverProveedor } from "./proveedores";
import type { Regalado } from "./resumenCompras";

/** Un documento en la lista: la cabecera y lo calculado de sus líneas (sin las líneas). */
export interface CabeceraDocumento {
  id: number;
  numero_documento: string;
  proveedor: string | null;
  /** `facturas.proveedor_id`: el proveedor unificado (null si aún no tiene). */
  proveedor_id: number | null;
  /** Nombre de ese proveedor unificado (`proveedores.nombre`). */
  proveedor_canonico: string | null;
  cif: string | null;
  fecha: string;
  subtotal: number | null;
  total: number | null;
  total_origen: "leido" | "deducido" | null;
  archivo_path: string | null;
  verificada: boolean;
  verificacion_origen: "auto" | "manual" | null;
  /** Nº de líneas del documento. */
  n_lineas: number;
  /** Avisos guardados al procesarlo (solo código y severidad; el texto está en la ficha). */
  alertas: Pick<AlertaValidacion, "codigo" | "severidad">[];
  /** Regalado / descuentos del documento (sin IVA). */
  regalado: Regalado;
  /** Algún producto cuesta más del doble que en otros documentos del mismo proveedor. */
  precio_atipico: boolean;
  /** Retención de IRPF; null = sin retención. */
  retencion_irpf: number | null;
}

export const SIN_REGALADO: Regalado = Object.freeze({ importe: 0, estimado: false, regalos: 0 }) as Regalado;

/** El aviso que se añade cuando el servidor (o el cálculo de antes) ve un precio atípico. */
export const AVISO_PRECIO_ATIPICO: AlertaValidacion = {
  codigo: "precio_atipico_pagina",
  severidad: "media",
  mensaje: "Algún producto cuesta más del doble que en otros documentos cargados del mismo proveedor",
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const texto = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const origenTotal = (v: unknown): CabeceraDocumento["total_origen"] => (v === "leido" || v === "deducido" ? v : null);
const origenVerificacion = (v: unknown): CabeceraDocumento["verificacion_origen"] => (v === "auto" || v === "manual" ? v : null);

/**
 * Decodifica `documentos_lista()`: `{ v: 1, proveedores: {id: nombre}, docs: [[…]] }`. Cada documento es un
 * array posicional (el orden lo fija la migración 20261121100000_facturas):
 *   [0] id, [1] numero_documento, [2] proveedor, [3] proveedor_id, [4] cif, [5] fecha, [6] subtotal, [7] total,
 *   [8] total_origen, [9] archivo_path, [10] verificada, [11] verificacion_origen, [12] nº de líneas,
 *   [13] alertas [[codigo, severidad]…], [14] regalado [importe, estimado, nº de regalos], [15] precio atípico,
 *   [16] retencion_irpf.
 * Lanza si no es eso.
 */
export function decodificarLista(crudo: unknown): CabeceraDocumento[] {
  const r = crudo as { v?: unknown; proveedores?: Record<string, unknown>; docs?: unknown } | null;
  if (!r || r.v !== 1 || !Array.isArray(r.docs)) throw new Error("Respuesta de documentos_lista() no reconocida");
  const nombres = r.proveedores ?? {};
  const salida: CabeceraDocumento[] = [];
  for (const fila of r.docs as unknown[][]) {
    if (!Array.isArray(fila)) continue;
    const proveedorId = num(fila[3]);
    const alertas = Array.isArray(fila[13])
      ? (fila[13] as unknown[][]).filter(Array.isArray).map((a) => ({ codigo: String(a[0] ?? ""), severidad: String(a[1] ?? "") }))
      : [];
    const reg = Array.isArray(fila[14]) ? (fila[14] as unknown[]) : null;
    salida.push({
      id: Number(fila[0]),
      numero_documento: texto(fila[1]) ?? "",
      proveedor: texto(fila[2]),
      proveedor_id: proveedorId,
      proveedor_canonico: proveedorId !== null ? texto(nombres[String(proveedorId)]) : null,
      cif: texto(fila[4]),
      fecha: texto(fila[5]) ?? "",
      subtotal: num(fila[6]),
      total: num(fila[7]),
      total_origen: origenTotal(fila[8]),
      archivo_path: texto(fila[9]),
      verificada: fila[10] === true,
      verificacion_origen: origenVerificacion(fila[11]),
      n_lineas: num(fila[12]) ?? 0,
      alertas,
      regalado: reg ? { importe: num(reg[0]) ?? 0, estimado: reg[1] === true, regalos: num(reg[2]) ?? 0 } : SIN_REGALADO,
      precio_atipico: fila[15] === true,
      retencion_irpf: num(fila[16]) || null,
    });
  }
  return salida;
}

/**
 * Meses incompletos de `documentos_lista()`: los «AAAA-MM» con muchos menos
 * documentos de lo normal (faltan facturas por subir). Si no viene, ninguno.
 */
export function decodificarMesesIncompletos(crudo: unknown): Set<string> {
  const lista = (crudo as { meses_incompletos?: unknown } | null)?.meses_incompletos;
  if (!Array.isArray(lista)) return new Set();
  const meses = lista
    .map((m) => (typeof m === "string" ? m : (m as { mes?: unknown } | null)?.mes))
    .filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m));
  return new Set(meses);
}

/**
 * Avisos de una fila de la lista: los guardados más el de precio atípico (para contarlos y filtrar).
 * Un documento VERIFICADO no tiene avisos pendientes: quien lo verifica ya los ha visto (ni en la
 * lista ni en la ficha).
 */
export function avisosCabecera(
  d: Pick<CabeceraDocumento, "alertas" | "precio_atipico"> & { verificada?: boolean },
): Pick<AlertaValidacion, "codigo" | "severidad">[] {
  if (d.verificada) return [];
  return d.precio_atipico ? [...d.alertas, AVISO_PRECIO_ATIPICO] : d.alertas;
}

/** Avisos de la FICHA (documento completo): los guardados y, si alguna línea pasa del doble de su media, el de precio. */
export function avisosFicha(doc: Factura): AlertaValidacion[] {
  if (doc.verificada) return [];
  return avisosDocumento(doc, [], (d) => d.productos.some((p) => precioAnomalo(p.precio_unitario, p.media_referencia ?? undefined)));
}

/** Media de referencia de cada línea de la ficha (la que trae el servidor). */
export const mediaDeLinea = (p: Pick<ProductoFactura, "media_referencia">): number | undefined => p.media_referencia ?? undefined;

/**
 * Resolver de proveedor para la lista: cada texto de proveedor de un documento,
 * a SU proveedor unificado (el `proveedor_id` del documento); lo que no esté,
 * con `base` (el resolver de `proveedores_listado()` o el de texto). Así la
 * lista enseña el nombre unificado sin esperar a la lista de proveedores.
 */
export function crearResolverDeLista(cabeceras: CabeceraDocumento[], base: ResolverProveedor): ResolverProveedor {
  const porTexto = new Map<string, ProveedorResuelto>();
  for (const d of cabeceras) {
    if (d.proveedor && d.proveedor_id !== null && d.proveedor_canonico && !porTexto.has(d.proveedor)) {
      porTexto.set(d.proveedor, { clave: `#${d.proveedor_id}`, nombre: d.proveedor_canonico });
    }
  }
  if (porTexto.size === 0) return base;
  return (t) => porTexto.get(t) ?? base(t);
}

/**
 * ¿Merece la pena reintentar? No si el error es definitivo:
 * sin permiso (42501), petición mal hecha o recurso inexistente (HTTP 4xx,
 * códigos `PGRST…`, errores de datos `22…`/`23…`). Sí los de red o 5xx.
 */
export function errorDefinitivo(error: unknown): boolean {
  const e = error as { code?: unknown; status?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "42501" || /^PGRST/.test(code) || /^2[23]/.test(code) || code === "42883" || code === "42P01") return true;
  const status = typeof e.status === "number" ? e.status : null;
  return status !== null && status >= 400 && status < 500;
}

/** `retry` de react-query para Compras: hasta 2 reintentos, nunca con un error definitivo. */
export const reintentarConsulta = (fallos: number, error: unknown): boolean => fallos < 2 && !errorDefinitivo(error);

/** El texto técnico de un error (para el «Detalle» plegado; nunca como mensaje principal). */
export function detalleError(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown } | null;
  const msg = typeof e?.message === "string" && e.message ? e.message : "error desconocido";
  return typeof e?.code === "string" && e.code ? `${msg} (${e.code})` : msg;
}
