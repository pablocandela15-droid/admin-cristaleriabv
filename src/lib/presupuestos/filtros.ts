// ============================================================================
//  Presupuestos: filtros de la lista (sin React)
// ----------------------------------------------------------------------------
//  Por estado («Todos» o uno) y búsqueda por número, cliente, teléfono, correo
//  o población, sin mirar acentos ni mayúsculas. En el teléfono solo cuentan
//  las cifras («650 06 63» encuentra «650066323»).
// ============================================================================
import { esEstadoPresupuesto } from "./estados";
import type { EstadoPresupuesto, Presupuesto } from "./tipos";

export type FiltroEstado = "todos" | EstadoPresupuesto;

export const leerFiltroEstado = (v: string | null | undefined): FiltroEstado => (esEstadoPresupuesto(v) ? v : "todos");

/** Minúsculas y sin acentos. */
export const normalizar = (s: string | null | undefined): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const cifras = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

type Buscable = Pick<Presupuesto, "numero" | "cliente_nombre" | "cliente_telefono"> &
  Partial<Pick<Presupuesto, "cliente_email" | "cliente_poblacion">>;

export function coincideBusqueda(p: Buscable, busqueda: string): boolean {
  const q = normalizar(busqueda);
  if (!q) return true;
  const textos = [p.numero, p.cliente_nombre, p.cliente_email, p.cliente_poblacion, p.cliente_telefono].map(normalizar);
  // Todas las palabras tienen que estar (en cualquier campo): «juan elche» encuentra a Juan, de Elche.
  const palabras = q.split(/\s+/).filter(Boolean);
  if (palabras.every((w) => textos.some((t) => t.includes(w)))) return true;
  const qCifras = cifras(busqueda);
  return qCifras.length >= 3 && cifras(p.cliente_telefono).includes(qCifras);
}

export function filtrarPresupuestos<T extends Buscable & Pick<Presupuesto, "estado">>(
  lista: readonly T[],
  { estado, busqueda }: { estado: FiltroEstado; busqueda: string },
): T[] {
  return lista.filter((p) => (estado === "todos" || p.estado === estado) && coincideBusqueda(p, busqueda));
}

export function contarPorEstado(lista: ReadonlyArray<Pick<Presupuesto, "estado">>): Record<EstadoPresupuesto, number> {
  const cuenta: Record<EstadoPresupuesto, number> = { solicitud: 0, borrador: 0, enviado: 0, aceptado: 0, rechazado: 0 };
  for (const p of lista) if (p.estado in cuenta) cuenta[p.estado] += 1;
  return cuenta;
}
