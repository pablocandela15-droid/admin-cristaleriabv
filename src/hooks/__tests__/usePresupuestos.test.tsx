/**
 * Capa de datos de Presupuestos (usePresupuestos) con un Supabase de mentira que anota cada petición: la lista con
 * el precio de la web, el cambio de estado al momento (y deshecho si falla), editar una línea de una solicitud la
 * pasa a borrador, y crear un presupuesto con líneas (si las líneas fallan, se borra la cabecera).
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Peticion = { tabla: string; op: string; datos?: unknown; filtros: [string, string, unknown][] };
const h = vi.hoisted(() => ({
  peticiones: [] as { tabla: string; op: string; datos?: unknown; filtros: [string, string, unknown][] }[],
  /** Respuesta para cada petición (por tabla y operación). */
  responder: (() => ({ data: null, error: null })) as (p: { tabla: string; op: string; datos?: unknown; filtros: [string, string, unknown][] }) => { data: unknown; error: unknown },
  toastError: vi.fn(),
  toastOk: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastError } }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const p: Peticion = { tabla, op: "select", filtros: [] };
    h.peticiones.push(p);
    const c: Record<string, unknown> = {};
    const filtro = (tipo: string) => (col: string, v: unknown) => (p.filtros.push([tipo, col, v]), c);
    Object.assign(c, {
      select: () => c,
      insert: (d: unknown) => ((p.op = "insert"), (p.datos = d), c),
      update: (d: unknown) => ((p.op = "update"), (p.datos = d), c),
      delete: () => ((p.op = "delete"), c),
      eq: filtro("eq"),
      is: filtro("is"),
      order: () => c,
      limit: () => c,
      single: () => c,
      maybeSingle: () => c,
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(h.responder(p)).then(ok, ko),
    });
    return c;
  };
  return {
    supabase: {
      from: (t: string) => consulta(t),
      auth: { getSession: async () => ({ data: { session: { user: { id: "u-1" } } } }) },
    },
  };
});

import {
  claveDetallePresupuesto,
  claveListaPresupuestos,
  useCambiarEstado,
  useCambiarLinea,
  useCrearPresupuesto,
  usePresupuestos,
  type PresupuestoLista,
} from "@/hooks/usePresupuestos";
import type { PresupuestoConLineas } from "@/lib/presupuestos/tipos";
import { deLista, lineaDePrueba, presupuestoDePrueba } from "@/components/presupuestos/__tests__/dobles";

let qc: QueryClient;
const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const escrituras = () => h.peticiones.filter((p) => p.op !== "select");

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  h.peticiones = [];
  h.responder = () => ({ data: null, error: null });
});
afterEach(() => {
  h.toastError.mockReset();
  h.toastOk.mockReset();
});

describe("usePresupuestos", () => {
  it("lee la lista y saca el precio que vio el cliente en la web", async () => {
    h.responder = () => ({
      data: [
        { ...presupuestoDePrueba({ id: "a", origen: "web", estado: "solicitud" }), total: "677.60", presupuesto_lineas: [{ precio_calculado: "560.00", cantidad: "1" }] },
        { ...presupuestoDePrueba({ id: "b" }), presupuesto_lineas: [{ precio_calculado: null, cantidad: 1 }, { precio_calculado: 100, cantidad: 2 }] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePresupuestos(), { wrapper: envoltorio });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data![0]).toMatchObject({ id: "a", total: 677.6, precioWeb: 560, numLineas: 1 });
    expect(result.current.data![0]).not.toHaveProperty("presupuesto_lineas");
    // Solo las de la web tienen «precio de la web».
    expect(result.current.data![1]).toMatchObject({ precioWeb: null, numLineas: 2 });
  });
});

describe("useCambiarEstado", () => {
  const p = presupuestoDePrueba({ id: "p1", estado: "borrador" });
  const sembrar = () => {
    qc.setQueryData<PresupuestoLista[]>(claveListaPresupuestos, [deLista(p)]);
    qc.setQueryData<PresupuestoConLineas>(claveDetallePresupuesto("p1"), { ...p, lineas: [] });
  };

  it("se ve al momento en la lista y en el presupuesto, y guarda enviado_en", async () => {
    sembrar();
    let soltar!: () => void;
    h.responder = (pet) => (pet.op === "update" ? new Promise((r) => (soltar = () => r({ data: null, error: null }))) : { data: null, error: null }) as never;
    const { result } = renderHook(() => useCambiarEstado(), { wrapper: envoltorio });
    act(() => result.current.mutate({ presupuesto: p, destino: "enviado" }));
    await waitFor(() => expect(qc.getQueryData<PresupuestoLista[]>(claveListaPresupuestos)![0].estado).toBe("enviado"));
    expect(qc.getQueryData<PresupuestoConLineas>(claveDetallePresupuesto("p1"))!.estado).toBe("enviado");
    const [escritura] = escrituras();
    expect(escritura).toMatchObject({ tabla: "presupuestos", op: "update", filtros: [["eq", "id", "p1"]] });
    expect(escritura.datos).toMatchObject({ estado: "enviado", respondido_en: null, enviado_en: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    soltar();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.toastOk).toHaveBeenCalledWith("P-2026-0001 marcado como enviado");
  });

  it("si falla, lo deshace y avisa", async () => {
    sembrar();
    h.responder = (pet) => (pet.op === "update" ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: null, error: null });
    const { result } = renderHook(() => useCambiarEstado(), { wrapper: envoltorio });
    act(() => result.current.mutate({ presupuesto: p, destino: "aceptado" }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<PresupuestoLista[]>(claveListaPresupuestos)![0].estado).toBe("borrador");
    expect(h.toastError).toHaveBeenCalledWith("No se ha cambiado el estado", { description: "No tienes permiso de edición en Presupuestos." });
  });

  it("al convertir una solicitud pone las condiciones de siempre solo si no tiene", async () => {
    const { result } = renderHook(() => useCambiarEstado(), { wrapper: envoltorio });
    await act(() => result.current.mutateAsync({ presupuesto: { ...p, estado: "solicitud" }, destino: "borrador", condicionesSiFaltan: "Válido 30 días." }));
    expect(escrituras().map((e) => [e.datos, e.filtros])).toEqual([
      [{ estado: "borrador", enviado_en: null, respondido_en: null }, [["eq", "id", "p1"]]],
      [{ condiciones: "Válido 30 días." }, [["eq", "id", "p1"], ["is", "condiciones", null]]],
    ]);
  });
});

describe("useCambiarLinea", () => {
  it("cambia la línea al momento (con su importe) y, si era una solicitud, la pasa a borrador", async () => {
    const p = presupuestoDePrueba({ id: "p1", estado: "solicitud" });
    qc.setQueryData<PresupuestoConLineas>(claveDetallePresupuesto("p1"), { ...p, lineas: [lineaDePrueba({ id: "l1", cantidad: 1, precio_unitario: 100, importe: 100 })] });
    const { result } = renderHook(() => useCambiarLinea(), { wrapper: envoltorio });
    await act(() => result.current.mutateAsync({ presupuestoId: "p1", id: "l1", cambios: { cantidad: 3 }, pasarABorrador: true }));
    const detalle = qc.getQueryData<PresupuestoConLineas>(claveDetallePresupuesto("p1"))!;
    expect(detalle.lineas[0]).toMatchObject({ cantidad: 3, importe: 300 });
    expect(detalle.estado).toBe("borrador");
    expect(escrituras().map((e) => [e.tabla, e.datos, e.filtros])).toEqual([
      ["presupuesto_lineas", { cantidad: 3 }, [["eq", "id", "l1"], ["eq", "presupuesto_id", "p1"]]],
      ["presupuestos", { estado: "borrador" }, [["eq", "id", "p1"], ["eq", "estado", "solicitud"]]],
    ]);
  });
});

describe("useCrearPresupuesto", () => {
  const linea = { categoria: null, valores: null, descripcion: "Montaje", detalle: null, cantidad: 1, precio_unitario: 50, precio_calculado: null };

  it("crea la cabecera (con quién la crea) y sus líneas en orden", async () => {
    h.responder = (pet) => (pet.tabla === "presupuestos" && pet.op === "insert" ? { data: { id: "nuevo", numero: "P-2026-0007" }, error: null } : { data: null, error: null });
    const { result } = renderHook(() => useCrearPresupuesto(), { wrapper: envoltorio });
    let creado: unknown;
    await act(async () => {
      creado = await result.current.mutateAsync({ cabecera: { cliente_nombre: "  Lucía  " }, lineas: [linea, { ...linea, descripcion: "Desplazamiento" }] });
    });
    expect(creado).toEqual({ id: "nuevo", numero: "P-2026-0007" });
    const [cabecera, lineas] = escrituras();
    expect(cabecera.datos).toMatchObject({ estado: "borrador", origen: "panel", cliente_nombre: "Lucía", creado_por: "u-1" });
    expect((lineas.datos as { orden: number; descripcion: string; presupuesto_id: string }[]).map((l) => [l.presupuesto_id, l.orden, l.descripcion])).toEqual([
      ["nuevo", 0, "Montaje"],
      ["nuevo", 1, "Desplazamiento"],
    ]);
  });

  it("si las líneas fallan, borra la cabecera y avisa", async () => {
    h.responder = (pet) =>
      pet.tabla === "presupuestos" && pet.op === "insert"
        ? { data: { id: "nuevo", numero: "P-2026-0008" }, error: null }
        : pet.tabla === "presupuesto_lineas"
          ? { data: null, error: { code: "23514", message: "violates check constraint" } }
          : { data: null, error: null };
    const { result } = renderHook(() => useCrearPresupuesto(), { wrapper: envoltorio });
    await act(async () => {
      await result.current.mutateAsync({ cabecera: { cliente_nombre: "Lucía" }, lineas: [linea] }).catch(() => undefined);
    });
    expect(escrituras().map((e) => [e.tabla, e.op])).toEqual([
      ["presupuestos", "insert"],
      ["presupuesto_lineas", "insert"],
      ["presupuestos", "delete"],
    ]);
    expect(h.toastError).toHaveBeenCalledWith("No se ha creado el presupuesto", { description: expect.stringMatching(/no es válido/) });
  });
});
