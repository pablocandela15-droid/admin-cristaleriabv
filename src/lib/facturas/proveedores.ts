// ============================================================================
//  Facturas › Proveedores — cuentas puras (sin React ni Supabase)
// ----------------------------------------------------------------------------
//  Proveedores unificados (migración 20261121100000_facturas): cada proveedor
//  canónico con los textos con que llega en los documentos
//  («variantes»). El panel traduce el texto de un documento a su proveedor
//  canónico con esas variantes, para filtrar y sumar sin partir por nombre.
// ============================================================================
import { claveProveedor } from "./productos";

/** Una fila de `proveedores_listado()`. */
export interface Proveedor {
  id: number;
  nombre: string;
  nombre_comercial: string | null;
  /** CIF normalizado (sin guiones, en mayúsculas). */
  cif: string | null;
  activo: boolean;
  origen: string | null;
  /** Nº de facturas (y abonos) suyas. */
  documentos: number;
  /** Suma de sus totales con IVA (los abonos restan). */
  total: number;
  ultima_fecha: string | null;
  /** Textos de proveedor tal y como vienen en sus documentos. */
  variantes: string[];
  /** Nombres normalizados que se reconocen como este proveedor. */
  alias: string[];
  /** CIF de proveedores fusionados con este. */
  cifs_extra: string[];
}

/** Proveedor ya resuelto para filtros y listas: clave estable + nombre a enseñar. */
export interface ProveedorResuelto {
  clave: string;
  nombre: string;
}

/** Traduce el texto de proveedor de un documento a su proveedor canónico. */
export type ResolverProveedor = (texto: string) => ProveedorResuelto;

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

/** Normaliza una fila cruda de la RPC (numeric llega como string o número). */
export function aProveedor(f: Record<string, unknown>): Proveedor {
  return {
    id: Number(f.id),
    nombre: String(f.nombre ?? ""),
    nombre_comercial: (f.nombre_comercial as string | null) ?? null,
    cif: (f.cif as string | null) ?? null,
    activo: f.activo === undefined || f.activo === null ? true : Boolean(f.activo),
    origen: (f.origen as string | null) ?? null,
    documentos: num(f.documentos),
    total: num(f.total),
    ultima_fecha: (f.ultima_fecha as string | null) ?? null,
    variantes: lista(f.variantes),
    alias: lista(f.alias),
    cifs_extra: lista(f.cifs_extra),
  };
}

/** Clave de un proveedor canónico (no choca con las claves de texto de `claveProveedor`). */
export const claveProveedorCanonico = (id: number) => `#${id}`;

/**
 * Resolver texto → proveedor canónico. Primero el texto exacto (las variantes
 * vienen de los propios documentos); luego por clave sin forma jurídica (para
 * textos que aún no tienen documento asignado). Sin proveedores se queda en la
 * clave de texto.
 */
export function crearResolverProveedor(proveedores: Proveedor[] | null | undefined): ResolverProveedor {
  const exacto = new Map<string, ProveedorResuelto>();
  const porClave = new Map<string, ProveedorResuelto>();
  for (const p of proveedores ?? []) {
    const r = { clave: claveProveedorCanonico(p.id), nombre: p.nombre };
    for (const v of p.variantes) {
      exacto.set(v.trim(), r);
      const k = claveProveedor(v);
      if (k && !porClave.has(k)) porClave.set(k, r);
    }
    for (const n of [p.nombre, p.nombre_comercial, ...p.alias]) {
      const k = n ? claveProveedor(n) : "";
      if (k && !porClave.has(k)) porClave.set(k, r);
    }
  }
  return (texto: string) => {
    const t = (texto ?? "").trim();
    const r = exacto.get(t) ?? porClave.get(claveProveedor(t));
    return r ?? { clave: claveProveedor(t), nombre: t };
  };
}

/** Buscar por nombre, nombre comercial, CIF (con o sin guion) o cualquier variante. */
export function filtrarProveedores(proveedores: Proveedor[], texto: string): Proveedor[] {
  const q = claveProveedor(texto);
  const qCif = normalizarCif(texto);
  if (!q && !qCif) return proveedores;
  return proveedores.filter(
    (p) =>
      [p.nombre, p.nombre_comercial ?? "", ...p.variantes, ...p.alias].some((n) => q && claveProveedor(n).includes(q)) ||
      (!!qCif && qCif.length >= 3 && [p.cif ?? "", ...p.cifs_extra].some((c) => c.includes(qCif))),
  );
}

/** Igual que `normalizar_cif()` en SQL: sin guiones/espacios/puntos, mayúsculas y sin «ES» del NIF-IVA. */
export function normalizarCif(cif: string | null | undefined): string | null {
  const s = (cif ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (/^ES[0-9A-Z]{9}$/.test(s)) return s.slice(2);
  return s || null;
}

/** El que queda al fusionar: el que tiene CIF, luego el de más documentos, luego el más antiguo (id menor). */
export function destinoFusionProveedorSugerido(seleccion: Pick<Proveedor, "id" | "cif" | "documentos">[]): number | null {
  if (seleccion.length === 0) return null;
  const orden = [...seleccion].sort(
    (a, b) => (a.cif ? 0 : 1) - (b.cif ? 0 : 1) || b.documentos - a.documentos || a.id - b.id,
  );
  return orden[0].id;
}

/** CIF distintos entre los seleccionados: si hay más de uno, probablemente NO son el mismo proveedor. */
export function cifsDistintos(seleccion: Pick<Proveedor, "cif">[]): string[] {
  return [...new Set(seleccion.map((p) => p.cif).filter((c): c is string => !!c))];
}
