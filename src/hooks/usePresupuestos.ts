// ============================================================================
//  Presupuestos: lectura y escritura (React Query)
// ----------------------------------------------------------------------------
//  Tablas `presupuestos` y `presupuesto_lineas` (RLS: «Ver» en Presupuestos
//  lee; «Editar» escribe). La base pone el número, el importe de cada línea y
//  los totales: tras cada escritura se vuelve a leer lo guardado.
//
//  Claves: ['presupuestos', 'lista'] y ['presupuestos', 'detalle', id].
//  Cambios de estado, de líneas y del orden se ven al momento (optimista) y,
//  si fallan, se deshacen con un aviso. Editar una solicitud la pasa a
//  borrador (`pasarABorrador`).
// ============================================================================
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { avisoCambioEstado, cambiosEstado, esEstadoPresupuesto } from "@/lib/presupuestos/estados";
import { ordenarLineas, precioWeb } from "@/lib/presupuestos/lineas";
import { importeLinea } from "@/lib/presupuestos/totales";
import type {
  CabeceraEditable,
  CambiosLinea,
  EstadoPresupuesto,
  LineaNueva,
  LineaPresupuesto,
  Presupuesto,
  PresupuestoConLineas,
} from "@/lib/presupuestos/tipos";
import type { Values } from "@/lib/web/pricing/categories";

export const CLAVE_PRESUPUESTOS = "presupuestos";
export const claveListaPresupuestos = [CLAVE_PRESUPUESTOS, "lista"] as const;
export const claveDetallePresupuesto = (id: string) => [CLAVE_PRESUPUESTOS, "detalle", id] as const;

const SECCION = "Presupuestos";

/** Mensaje para el usuario a partir de un error de Supabase. */
export function mensajeErrorPresupuestos(e: unknown): string {
  const err = e as { message?: string; code?: string; status?: number } | null;
  const msg = err?.message ?? "";
  if (err?.code === "42501" || /row-level security|permission denied/i.test(msg) || err?.status === 403) {
    return `No tienes permiso de edición en ${SECCION}.`;
  }
  if (/relation .* does not exist|schema cache|PGRST205/i.test(msg)) {
    return "La base de datos aún no tiene los presupuestos (falta aplicar la migración de la web y los presupuestos).";
  }
  if (err?.code === "23514" || /violates check constraint/i.test(msg)) return "Algún dato no es válido (revisa textos muy largos, porcentajes y cantidades).";
  return msg || "Error desconocido";
}

/* ------------------------------------------------------------------ */
/* Filas                                                               */
/* ------------------------------------------------------------------ */

const num = (v: unknown, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const numONull = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Una fila de `presupuestos` con los números como números. */
export function aPresupuesto(f: Record<string, unknown>): Presupuesto {
  return {
    ...(f as unknown as Presupuesto),
    estado: esEstadoPresupuesto(f.estado) ? f.estado : "borrador",
    origen: f.origen === "web" ? "web" : "panel",
    validez_dias: num(f.validez_dias, 30),
    descuento_pct: num(f.descuento_pct),
    iva_pct: num(f.iva_pct, 21),
    subtotal: num(f.subtotal),
    total: num(f.total),
  };
}

export function aLinea(f: Record<string, unknown>): LineaPresupuesto {
  return {
    ...(f as unknown as LineaPresupuesto),
    orden: num(f.orden),
    valores: esObjeto(f.valores) ? (f.valores as Values) : null,
    cantidad: num(f.cantidad, 1),
    precio_unitario: num(f.precio_unitario),
    importe: num(f.importe),
    precio_calculado: numONull(f.precio_calculado),
  };
}

/** Lo que enseña la lista: la cabecera y, de las líneas, lo que vio el cliente en la web. */
export interface PresupuestoLista
  extends Pick<
    Presupuesto,
    | "id"
    | "numero"
    | "estado"
    | "origen"
    | "cliente_nombre"
    | "cliente_telefono"
    | "cliente_email"
    | "cliente_poblacion"
    | "notas_cliente"
    | "fecha"
    | "validez_dias"
    | "subtotal"
    | "total"
    | "enviado_en"
    | "respondido_en"
    | "creado_en"
    | "actualizado_en"
  > {
  /** Lo que dio la calculadora de la web (solicitudes), o null. */
  precioWeb: number | null;
  numLineas: number;
}

const COLUMNAS_LISTA =
  "id, numero, estado, origen, cliente_nombre, cliente_telefono, cliente_email, cliente_poblacion, notas_cliente, fecha, validez_dias, subtotal, total, enviado_en, respondido_en, creado_en, actualizado_en, presupuesto_lineas(precio_calculado, cantidad)";

export const usePresupuestos = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: claveListaPresupuestos,
    enabled,
    retry: false,
    queryFn: async (): Promise<PresupuestoLista[]> => {
      const { data, error } = await supabase.from("presupuestos").select(COLUMNAS_LISTA).order("creado_en", { ascending: false }).limit(2000);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((f) => {
        const lineas = (Array.isArray(f.presupuesto_lineas) ? f.presupuesto_lineas : []) as { precio_calculado: unknown; cantidad: unknown }[];
        const { presupuesto_lineas: _l, ...cabecera } = f;
        void _l;
        const p = aPresupuesto(cabecera);
        return {
          ...p,
          precioWeb: p.origen === "web" ? precioWeb(lineas.map((l) => ({ precio_calculado: numONull(l.precio_calculado), cantidad: num(l.cantidad, 1) }))) : null,
          numLineas: lineas.length,
        } as PresupuestoLista;
      });
    },
  });

export const usePresupuesto = (id: string | null, { enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: claveDetallePresupuesto(id ?? ""),
    enabled: enabled && !!id,
    retry: false,
    queryFn: async (): Promise<PresupuestoConLineas | null> => {
      const [cab, lin] = await Promise.all([
        supabase.from("presupuestos").select("*").eq("id", id as string).maybeSingle(),
        supabase.from("presupuesto_lineas").select("*").eq("presupuesto_id", id as string).order("orden", { ascending: true }).order("creado_en", { ascending: true }),
      ]);
      if (cab.error) throw cab.error;
      if (lin.error) throw lin.error;
      if (!cab.data) return null;
      return { ...aPresupuesto(cab.data as Record<string, unknown>), lineas: ordenarLineas(((lin.data ?? []) as Record<string, unknown>[]).map(aLinea)) };
    },
  });

/* ------------------------------------------------------------------ */
/* Caché                                                               */
/* ------------------------------------------------------------------ */

type Instantanea = { detalle?: PresupuestoConLineas | null; lista?: PresupuestoLista[] };

/** Guarda lo que hay en caché del presupuesto `id` (para deshacer) y para las lecturas en curso. */
async function instantanea(qc: QueryClient, id: string): Promise<Instantanea> {
  await Promise.all([qc.cancelQueries({ queryKey: claveDetallePresupuesto(id) }), qc.cancelQueries({ queryKey: claveListaPresupuestos })]);
  return {
    detalle: qc.getQueryData<PresupuestoConLineas | null>(claveDetallePresupuesto(id)),
    lista: qc.getQueryData<PresupuestoLista[]>(claveListaPresupuestos),
  };
}

function restaurar(qc: QueryClient, id: string, ant: Instantanea | undefined) {
  if (!ant) return;
  if (ant.detalle !== undefined) qc.setQueryData(claveDetallePresupuesto(id), ant.detalle);
  if (ant.lista !== undefined) qc.setQueryData(claveListaPresupuestos, ant.lista);
}

/** Aplica un cambio a la cabecera del presupuesto en la caché (detalle y lista). */
function cambiarEnCache(qc: QueryClient, id: string, cambios: Partial<Presupuesto>) {
  qc.setQueryData<PresupuestoConLineas | null>(claveDetallePresupuesto(id), (d) => (d ? { ...d, ...cambios } : d));
  qc.setQueryData<PresupuestoLista[]>(claveListaPresupuestos, (l) => l?.map((p) => (p.id === id ? { ...p, ...cambios } : p)));
}

function cambiarLineasEnCache(qc: QueryClient, id: string, fn: (lineas: LineaPresupuesto[]) => LineaPresupuesto[]) {
  qc.setQueryData<PresupuestoConLineas | null>(claveDetallePresupuesto(id), (d) => (d ? { ...d, lineas: ordenarLineas(fn(d.lineas)) } : d));
}

const refrescar = (qc: QueryClient, id?: string) => {
  if (id) void qc.invalidateQueries({ queryKey: claveDetallePresupuesto(id) });
  void qc.invalidateQueries({ queryKey: claveListaPresupuestos });
};

/** Si era una solicitud, pasa a borrador (solo si sigue siendo solicitud). */
async function solicitudABorrador(id: string) {
  const { error } = await supabase.from("presupuestos").update({ estado: "borrador" }).eq("id", id).eq("estado", "solicitud");
  if (error) throw error;
}

const avisoError = (titulo: string) => (e: unknown) => toast.error(titulo, { description: mensajeErrorPresupuestos(e) });

/* ------------------------------------------------------------------ */
/* Cabecera                                                            */
/* ------------------------------------------------------------------ */

export interface DatosNuevoPresupuesto {
  cabecera: Partial<CabeceraEditable> & Pick<CabeceraEditable, "cliente_nombre"> & { origen?: "panel"; estado?: EstadoPresupuesto; creado_por?: string | null };
  lineas?: LineaNueva[];
}

const filaLinea = (presupuestoId: string, l: LineaNueva, orden: number) => ({
  presupuesto_id: presupuestoId,
  orden,
  categoria: l.categoria,
  valores: (l.valores ?? null) as Json | null,
  descripcion: l.descripcion.trim().slice(0, 500) || "Concepto",
  detalle: l.detalle?.trim() ? l.detalle.slice(0, 5000) : null,
  cantidad: l.cantidad,
  precio_unitario: l.precio_unitario,
  precio_calculado: l.precio_calculado,
});

/** Crea un presupuesto (y sus líneas): devuelve su id y el número que le ha dado la base. */
export function useCrearPresupuesto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cabecera, lineas = [] }: DatosNuevoPresupuesto): Promise<{ id: string; numero: string }> => {
      // Quién lo crea (la sesión ya está en el dispositivo: no pide nada al servidor).
      const creadoPor = cabecera.creado_por !== undefined ? cabecera.creado_por : ((await supabase.auth.getSession()).data.session?.user.id ?? null);
      const { data, error } = await supabase
        .from("presupuestos")
        .insert({ estado: "borrador", origen: "panel", ...cabecera, creado_por: creadoPor, cliente_nombre: cabecera.cliente_nombre.trim() })
        .select("id, numero")
        .single();
      if (error) throw error;
      if (lineas.length) {
        const { error: e2 } = await supabase.from("presupuesto_lineas").insert(lineas.map((l, i) => filaLinea(data.id, l, i)));
        if (e2) {
          // Sin sus líneas no sirve: se borra (el número no se reutiliza).
          await supabase.from("presupuestos").delete().eq("id", data.id);
          throw e2;
        }
      }
      return data;
    },
    onSuccess: () => refrescar(qc),
    onError: avisoError("No se ha creado el presupuesto"),
  });
}

/** Guarda la cabecera (cliente, fechas, porcentajes, condiciones y notas). */
export function useGuardarPresupuesto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cambios, pasarABorrador }: { id: string; cambios: Partial<CabeceraEditable>; pasarABorrador?: boolean }) => {
      const { error } = await supabase
        .from("presupuestos")
        .update({ ...cambios, ...(pasarABorrador ? { estado: "borrador" } : {}) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, { id, pasarABorrador }) => {
      toast.success("Presupuesto guardado", pasarABorrador ? { description: "La solicitud pasa a borrador." } : undefined);
      refrescar(qc, id);
    },
    onError: avisoError("No se ha guardado el presupuesto"),
  });
}

/** Cambia el estado (con sus marcas de enviado y respondido), al momento. */
export function useCambiarEstado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      presupuesto,
      destino,
      condicionesSiFaltan,
    }: {
      presupuesto: Pick<Presupuesto, "id" | "numero" | "estado" | "enviado_en">;
      destino: EstadoPresupuesto;
      /** Condiciones que se ponen si el presupuesto no tiene (al convertir una solicitud en borrador). */
      condicionesSiFaltan?: string;
      silencioso?: boolean;
    }) => {
      const { error } = await supabase.from("presupuestos").update(cambiosEstado(presupuesto, destino)).eq("id", presupuesto.id);
      if (error) throw error;
      if (condicionesSiFaltan) {
        const { error: e2 } = await supabase.from("presupuestos").update({ condiciones: condicionesSiFaltan }).eq("id", presupuesto.id).is("condiciones", null);
        if (e2) throw e2;
      }
    },
    onMutate: async ({ presupuesto, destino }) => {
      const ant = await instantanea(qc, presupuesto.id);
      cambiarEnCache(qc, presupuesto.id, cambiosEstado(presupuesto, destino));
      return ant;
    },
    onSuccess: (_r, { presupuesto, destino, silencioso }) => {
      if (!silencioso) toast.success(avisoCambioEstado(destino, presupuesto.numero));
    },
    onError: (e, { presupuesto }, ant) => {
      restaurar(qc, presupuesto.id, ant);
      avisoError("No se ha cambiado el estado")(e);
    },
    onSettled: (_r, _e, { presupuesto }) => refrescar(qc, presupuesto.id),
  });
}

export function useBorrarPresupuesto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Pick<Presupuesto, "id" | "numero">) => {
      const { error } = await supabase.from("presupuestos").delete().eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: (_r, p) => {
      qc.setQueryData<PresupuestoLista[]>(claveListaPresupuestos, (l) => l?.filter((x) => x.id !== p.id));
      qc.removeQueries({ queryKey: claveDetallePresupuesto(p.id) });
      toast.success(`${p.numero} borrado`);
      refrescar(qc);
    },
    onError: avisoError("No se ha borrado el presupuesto"),
  });
}

/* ------------------------------------------------------------------ */
/* Líneas                                                              */
/* ------------------------------------------------------------------ */

export function useAnadirLinea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ presupuestoId, linea, orden, pasarABorrador }: { presupuestoId: string; linea: LineaNueva; orden: number; pasarABorrador?: boolean }) => {
      const { error } = await supabase.from("presupuesto_lineas").insert(filaLinea(presupuestoId, linea, orden));
      if (error) throw error;
      if (pasarABorrador) await solicitudABorrador(presupuestoId);
    },
    onSuccess: (_r, { presupuestoId, pasarABorrador }) => {
      toast.success("Línea añadida", pasarABorrador ? { description: "La solicitud pasa a borrador." } : undefined);
      refrescar(qc, presupuestoId);
    },
    onError: avisoError("No se ha añadido la línea"),
  });
}

/** Cambia una línea (texto, cantidad, precio o lo de la calculadora), al momento. */
export function useCambiarLinea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ presupuestoId, id, cambios, pasarABorrador }: { presupuestoId: string; id: string; cambios: CambiosLinea; pasarABorrador?: boolean; aviso?: string }) => {
      const { valores, ...resto } = cambios;
      const { error } = await supabase
        .from("presupuesto_lineas")
        .update({ ...resto, ...(valores !== undefined ? { valores: valores as Json | null } : {}) })
        .eq("id", id)
        .eq("presupuesto_id", presupuestoId);
      if (error) throw error;
      if (pasarABorrador) await solicitudABorrador(presupuestoId);
    },
    onMutate: async ({ presupuestoId, id, cambios, pasarABorrador }) => {
      const ant = await instantanea(qc, presupuestoId);
      cambiarLineasEnCache(qc, presupuestoId, (ls) => ls.map((l) => (l.id === id ? { ...l, ...cambios, importe: importeLinea({ ...l, ...cambios }) } : l)));
      if (pasarABorrador) cambiarEnCache(qc, presupuestoId, { estado: "borrador" });
      return ant;
    },
    onSuccess: (_r, { aviso, pasarABorrador }) => {
      if (aviso) toast.success(aviso);
      else if (pasarABorrador) toast.success("La solicitud pasa a borrador");
    },
    onError: (e, { presupuestoId }, ant) => {
      restaurar(qc, presupuestoId, ant);
      avisoError("No se ha guardado la línea")(e);
    },
    onSettled: (_r, _e, { presupuestoId }) => refrescar(qc, presupuestoId),
  });
}

export function useBorrarLinea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ presupuestoId, id, pasarABorrador }: { presupuestoId: string; id: string; pasarABorrador?: boolean }) => {
      const { error } = await supabase.from("presupuesto_lineas").delete().eq("id", id).eq("presupuesto_id", presupuestoId);
      if (error) throw error;
      if (pasarABorrador) await solicitudABorrador(presupuestoId);
    },
    onMutate: async ({ presupuestoId, id }) => {
      const ant = await instantanea(qc, presupuestoId);
      cambiarLineasEnCache(qc, presupuestoId, (ls) => ls.filter((l) => l.id !== id));
      return ant;
    },
    // El aviso (con «Deshacer») lo da quien la quita.
    onError: (e, { presupuestoId }, ant) => {
      restaurar(qc, presupuestoId, ant);
      avisoError("No se ha quitado la línea")(e);
    },
    onSettled: (_r, _e, { presupuestoId }) => refrescar(qc, presupuestoId),
  });
}

/** Guarda un orden nuevo de las líneas (solo las que cambian), al momento. */
export function useOrdenarLineas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ presupuestoId, cambios }: { presupuestoId: string; cambios: { id: string; orden: number }[] }) => {
      const resultados = await Promise.all(
        cambios.map((c) => supabase.from("presupuesto_lineas").update({ orden: c.orden }).eq("id", c.id).eq("presupuesto_id", presupuestoId)),
      );
      const fallo = resultados.find((r) => r.error);
      if (fallo?.error) throw fallo.error;
    },
    onMutate: async ({ presupuestoId, cambios }) => {
      const ant = await instantanea(qc, presupuestoId);
      const nuevos = new Map(cambios.map((c) => [c.id, c.orden]));
      cambiarLineasEnCache(qc, presupuestoId, (ls) => ls.map((l) => (nuevos.has(l.id) ? { ...l, orden: nuevos.get(l.id) as number } : l)));
      return ant;
    },
    onError: (e, { presupuestoId }, ant) => {
      restaurar(qc, presupuestoId, ant);
      avisoError("No se ha guardado el orden")(e);
    },
    onSettled: (_r, _e, { presupuestoId }) => refrescar(qc, presupuestoId),
  });
}
