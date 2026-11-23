/**
 * Datos y dobles de los hooks de Presupuestos para las pruebas de componentes (no es una prueba: la importan).
 * Cada mutación es un `vi.fn()` que se puede inspeccionar; `mutate(args, { onSuccess })` llama a `onSuccess` al
 * momento para seguir el flujo como si la base hubiera contestado.
 */
import { vi } from "vitest";
import type { CambiosLinea, EstadoPresupuesto, LineaNueva, LineaPresupuesto, Presupuesto, PresupuestoConLineas } from "@/lib/presupuestos/tipos";
import type { DatosNuevoPresupuesto, PresupuestoLista } from "@/hooks/usePresupuestos";
import type { DatosPdfPresupuesto } from "@/lib/presupuestos/pdf";

/** Lo que reciben las mutaciones (para leer sus llamadas en las pruebas). */
export interface ArgsAnadir {
  presupuestoId: string;
  linea: LineaNueva;
  orden: number;
  pasarABorrador?: boolean;
}
export interface ArgsCambiarLinea {
  presupuestoId: string;
  id: string;
  cambios: CambiosLinea;
  pasarABorrador?: boolean;
  aviso?: string;
}
export interface ArgsEstado {
  presupuesto: Pick<Presupuesto, "id" | "numero" | "estado">;
  destino: EstadoPresupuesto;
  condicionesSiFaltan?: string;
}
export type ArgsCrear = DatosNuevoPresupuesto;
export type ArgsPdf = Omit<DatosPdfPresupuesto, "logoSvg">;

/** Primer argumento de la llamada `i` de un `vi.fn()`. */
export const argumentos = <T,>(fn: { mock: { calls: unknown[][] } }, i = 0): T => fn.mock.calls[i][0] as T;

export const presupuestoDePrueba = (extra: Partial<Presupuesto> = {}): Presupuesto => ({
  id: "p1",
  numero: "P-2026-0001",
  estado: "borrador",
  origen: "panel",
  cliente_nombre: "Juan Pérez",
  cliente_telefono: "650 06 63 23",
  cliente_email: "juan@example.com",
  cliente_direccion: null,
  cliente_poblacion: "Elche",
  notas_cliente: null,
  notas_internas: null,
  condiciones: "Presupuesto válido durante 30 días desde su fecha.",
  fecha: "2026-11-20",
  validez_dias: 30,
  descuento_pct: 0,
  iva_pct: 21,
  subtotal: 0,
  total: 0,
  enviado_en: null,
  respondido_en: null,
  creado_por: null,
  creado_en: "2026-11-20T10:00:00Z",
  actualizado_en: "2026-11-20T10:00:00Z",
  ...extra,
});

export const lineaDePrueba = (extra: Partial<LineaPresupuesto> = {}): LineaPresupuesto => ({
  id: "l1",
  presupuesto_id: "p1",
  orden: 0,
  categoria: null,
  valores: null,
  descripcion: "Desplazamiento",
  detalle: null,
  cantidad: 1,
  precio_unitario: 100,
  importe: 100,
  precio_calculado: null,
  creado_en: "2026-11-20T10:00:00Z",
  ...extra,
});

export const deLista = (p: Presupuesto, extra: Partial<PresupuestoLista> = {}): PresupuestoLista => ({ ...p, precioWeb: null, numLineas: 0, ...extra });

/** Una mutación de React Query de mentira: `mutate` llama a `onSuccess` con `resultado`. */
export function mutacionFalsa<R = void>(resultado?: R) {
  const fn = vi.fn((_args: unknown, opciones?: { onSuccess?: (r: R) => void }) => opciones?.onSuccess?.(resultado as R));
  return {
    mutate: fn,
    mutateAsync: vi.fn(async () => resultado as R),
    isPending: false,
  };
}

export type Mutaciones = ReturnType<typeof crearMutaciones>;
export function crearMutaciones() {
  return {
    crear: mutacionFalsa({ id: "p-nuevo", numero: "P-2026-0099" }),
    guardar: mutacionFalsa(),
    estado: mutacionFalsa(),
    borrar: mutacionFalsa(),
    anadir: mutacionFalsa(),
    cambiarLinea: mutacionFalsa(),
    borrarLinea: mutacionFalsa(),
    ordenar: mutacionFalsa(),
  };
}

export const consulta = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() });

export type DetalleDePrueba = PresupuestoConLineas | null;
