// ============================================================================
//  Facturas › Productos: catálogo, categorías y correcciones
// ----------------------------------------------------------------------------
//  Lecturas por RPC/tablas con RLS (can_read_section('facturas')); escrituras
//  por las RPC SECURITY DEFINER de la migración 20261121100000_facturas, que
//  comprueban el permiso de edición dentro. Las categorías se crean/editan
//  directamente (RLS con can_edit_section('facturas')).
//
//  Todo cuelga de la clave ['productos', …]: cualquier cambio invalida el
//  bloque entero y también ['facturas'] (la etiqueta de categoría de cada
//  línea en la ficha del documento).
// ============================================================================
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { opcionReintento } from "@/hooks/useListaCompras";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  aGastoCategoria,
  aResumen,
  type CategoriaProducto,
  type GastoCategoria,
  type ResumenProducto,
} from "@/lib/facturas/productos";

export const CLAVE_PRODUCTOS = "productos";

export interface FiltroPeriodo {
  desde: string | null;
  hasta: string | null;
}

/** Una línea de factura con su documento (detalle de un producto o «Sin clasificar»). */
export interface LineaProducto {
  id: number;
  nombre: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  total: number | null;
  producto_id: number | null;
  factura_id: number;
  fecha: string | null;
  proveedor: string | null;
  numero_documento: string | null;
  /** Proveedor unificado del documento (null si aún no tiene). */
  proveedor_id?: number | null;
}

// Las llamadas a las RPC pasan por aquí para no repetir el cast de los argumentos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

const argsPeriodo = (f: FiltroPeriodo) => ({ p_desde: f.desde, p_hasta: f.hasta });

/** `enabled: false` deja la petición para luego (Compras la pide cuando ya tiene la lista). */
export interface OpcionesConsulta {
  enabled?: boolean;
}

export const useCategoriasProducto = ({ enabled = true }: OpcionesConsulta = {}) =>
  useQuery({
    queryKey: [CLAVE_PRODUCTOS, "categorias"],
    enabled,
    queryFn: async (): Promise<CategoriaProducto[]> => {
      const { data, error } = await supabase
        .from("categorias_producto")
        .select("id, clave, nombre, descripcion, padre_id, orden, activa")
        .order("orden", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoriaProducto[];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useResumenProductos = (f: FiltroPeriodo, { enabled = true }: OpcionesConsulta = {}) =>
  useQuery({
    queryKey: [CLAVE_PRODUCTOS, "resumen", f.desde, f.hasta],
    enabled,
    queryFn: async (): Promise<ResumenProducto[]> => {
      const { data, error } = await rpc("productos_resumen", argsPeriodo(f));
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(aResumen);
    },
    staleTime: 60_000,
    retry: false,
  });

export const useGastoCategorias = (f: FiltroPeriodo) =>
  useQuery({
    queryKey: [CLAVE_PRODUCTOS, "gasto", f.desde, f.hasta],
    queryFn: async (): Promise<GastoCategoria[]> => {
      const { data, error } = await rpc("productos_gasto_por_categoria", argsPeriodo(f));
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(aGastoCategoria);
    },
    staleTime: 60_000,
    retry: false,
  });

/** Líneas de un producto (id) o las que no tienen producto ("sin"). null = no consultar. */
export const useLineasProducto = (producto: number | "sin" | null) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [CLAVE_PRODUCTOS, "lineas", producto],
    enabled: producto !== null,
    retry: opcionReintento(qc),
    queryFn: async (): Promise<LineaProducto[]> => {
      let q = supabase
        .from("productos_factura")
        .select("id, nombre, cantidad, unidad, precio_unitario, total, producto_id, factura_id, facturas(fecha, proveedor, numero_documento, proveedor_id)")
        .order("id", { ascending: false })
        .limit(500);
      q = producto === "sin" ? q.is("producto_id", null) : q.eq("producto_id", producto as number);
      const { data, error } = await q;
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filas = ((data ?? []) as any[]).map((l) => ({
        id: l.id,
        nombre: l.nombre,
        cantidad: l.cantidad === null ? null : Number(l.cantidad),
        unidad: l.unidad ?? null,
        precio_unitario: l.precio_unitario === null ? null : Number(l.precio_unitario),
        total: l.total === null ? null : Number(l.total),
        producto_id: l.producto_id ?? null,
        factura_id: l.factura_id,
        fecha: l.facturas?.fecha ?? null,
        proveedor: l.facturas?.proveedor ?? null,
        numero_documento: l.facturas?.numero_documento ?? null,
        proveedor_id: l.facturas?.proveedor_id ?? null,
      }));
      // Más reciente primero (fecha del documento; a igualdad, la última insertada).
      return filas.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id);
    },
    staleTime: 30_000,
  });
};

/** El `producto_id` que más se repite en esas filas (null si ninguna tiene). */
function productoMasFrecuente(filas: { producto_id: number | null }[] | null): number | null {
  const cuenta = new Map<number, number>();
  for (const f of filas ?? []) if (f.producto_id != null) cuenta.set(f.producto_id, (cuenta.get(f.producto_id) ?? 0) + 1);
  let mejor: number | null = null;
  let max = 0;
  for (const [id, n] of cuenta) if (n > max) [mejor, max] = [id, n];
  return mejor;
}

/**
 * El producto del catálogo de una línea por su NOMBRE: «Qué le compras» de un
 * proveedor (`ficha_proveedor`) trae el nombre del catálogo o, si la línea aún
 * no está clasificada, el de la línea («TEMPL 8 INC 1500X800»), y no trae el
 * id. Se busca la línea con ese nombre exacto (y si no, sin mayúsculas) y se
 * toma su producto. null = ninguno.
 */
export async function productoDeLinea(nombre: string): Promise<number | null> {
  const texto = nombre.trim();
  if (!texto) return null;
  const exacta = await supabase.from("productos_factura").select("producto_id").eq("nombre", texto).limit(200);
  if (exacta.error) throw exacta.error;
  const id = productoMasFrecuente(exacta.data as { producto_id: number | null }[] | null);
  if (id !== null) return id;
  // Sin mayúsculas (los comodines de LIKE se escapan: es el nombre tal cual).
  const patron = texto.replace(/[\\%_*]/g, (c) => `\\${c}`);
  const parecida = await supabase.from("productos_factura").select("producto_id").ilike("nombre", patron).limit(200);
  if (parecida.error) throw parecida.error;
  return productoMasFrecuente(parecida.data as { producto_id: number | null }[] | null);
}

export function invalidarProductos(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: [CLAVE_PRODUCTOS] });
  qc.invalidateQueries({ queryKey: ["facturas"] });
  qc.invalidateQueries({ queryKey: ["compras"] });   // gráficas y comparaciones de Compras
}

/** Mensaje legible de un error de Supabase/PostgREST. */
export function mensajeError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  if (err?.code === "42501") return "No tienes permiso de edición en Facturas.";
  return err?.message || "Error desconocido";
}

function useMutacionProductos<A, R>(fn: (a: A) => Promise<R>, ok: (r: R, a: A) => string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, a) => {
      invalidarProductos(qc);
      const texto = ok(r, a);
      if (texto) toast.success(texto);
    },
    onError: (e) => toast.error("No se ha guardado", { description: mensajeError(e) }),
  });
}

export const useRenombrarProducto = () =>
  useMutacionProductos(
    async ({ id, nombre }: { id: number; nombre: string }) => {
      const { data, error } = await rpc("productos_renombrar", { p_producto_id: id, p_nombre: nombre });
      if (error) throw error;
      return data as { nombre: string };
    },
    (r) => `Ahora se llama «${r?.nombre ?? ""}»`,
  );

export const useRecategorizarProductos = () =>
  useMutacionProductos(
    async ({ ids, categoriaId }: { ids: number[]; categoriaId: number | null }) => {
      const { data, error } = await rpc("productos_recategorizar", { p_producto_ids: ids, p_categoria_id: categoriaId });
      if (error) throw error;
      return Number(data ?? 0);
    },
    (n) => (n === 1 ? "Categoría cambiada" : `Categoría cambiada en ${n} productos`),
  );

export const useFusionarProductos = () =>
  useMutacionProductos(
    async ({ origenIds, destinoId }: { origenIds: number[]; destinoId: number }) => {
      const { data, error } = await rpc("productos_fusionar", { p_origen_ids: origenIds, p_destino_id: destinoId });
      if (error) throw error;
      return data as { lineas_movidas: number; productos_borrados: number };
    },
    (r) => `Fusionados: ${r?.productos_borrados ?? 0} producto(s) menos, ${r?.lineas_movidas ?? 0} línea(s) movidas`,
  );

export const useAsignarLineas = () =>
  useMutacionProductos(
    async (a: { lineaIds: number[]; productoId?: number | null; nombreNuevo?: string | null; categoriaId?: number | null }) => {
      const { data, error } = await rpc("productos_asignar_lineas", {
        p_linea_ids: a.lineaIds,
        p_producto_id: a.productoId ?? null,
        p_nombre_nuevo: a.nombreNuevo ?? null,
        p_categoria_id: a.categoriaId ?? null,
      });
      if (error) throw error;
      return data as { producto_id: number; creado: boolean; lineas: number };
    },
    (r) => `${r?.lineas ?? 0} línea(s) asignadas${r?.creado ? " a un producto nuevo" : ""}`,
  );

export const useBorrarProducto = () =>
  useMutacionProductos(
    async (id: number) => {
      const { error } = await rpc("productos_borrar", { p_producto_id: id });
      if (error) throw error;
      return id;
    },
    () => "Producto borrado",
  );

export interface ResultadoClasificarIA {
  ok: boolean;
  pendientes?: number;
  textos?: number;
  propuestas?: number;
  aplicado?: { productos_creados?: number; alias_creados?: number; lineas_asignadas?: number } | null;
  error?: string;
}

/** Lanza la función clasificar-productos (las líneas sin producto, con IA). */
export const useClasificarConIA = () =>
  useMutacionProductos<void, ResultadoClasificarIA>(
    async () => {
      const { data, error } = await supabase.functions.invoke("clasificar-productos", { body: {} });
      if (error) throw error;
      const r = data as ResultadoClasificarIA;
      if (!r?.ok) throw new Error(r?.error || "La clasificación no ha terminado");
      return r;
    },
    (r) => {
      const n = r.aplicado?.lineas_asignadas ?? 0;
      const nuevos = r.aplicado?.productos_creados ?? 0;
      return n === 0
        ? "No había nada nuevo que clasificar"
        : `${n} línea(s) clasificadas${nuevos ? ` · ${nuevos} producto(s) nuevos` : ""}`;
    },
  );

export const useGuardarCategoria = () =>
  useMutacionProductos(
    async (c: { id?: number; nombre: string; padre_id?: number | null; activa?: boolean; orden?: number }) => {
      if (c.id) {
        const cambios: Record<string, unknown> = { nombre: c.nombre };
        if (c.activa !== undefined) cambios.activa = c.activa;
        const { data, error } = await supabase.from("categorias_producto").update(cambios as never).eq("id", c.id).select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("No tienes permiso de edición en Facturas.");
        return c.id;
      }
      const { data, error } = await supabase
        .from("categorias_producto")
        .insert({ nombre: c.nombre, padre_id: c.padre_id ?? null, orden: c.orden ?? 999 } as never)
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: number }).id;
    },
    () => "Categorías guardadas",
  );
