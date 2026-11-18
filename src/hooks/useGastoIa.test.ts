import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Cliente compartido: los tests de los hooks le ponen `from`/`rpc` (con `this`, como SupabaseClient).
const cliente = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/integrations/supabase/client", () => ({ supabase: cliente }));

import { cargarGastoIaReal, cargarGastoIaRealMes, leerTopeIaMes, useFijarTopeIa, useTopeIaMes } from "./useGastoIa";
import { evaluarTope } from "@/lib/gastoIa";

/** Cliente con una respuesta por RPC; `this` obligatorio como en SupabaseClient. */
class ClienteReal {
  llamadas: string[] = [];
  constructor(private respuestas: Record<string, { data: unknown; error: { message?: string } | null } | "lanza">) {}
  rpc(fn: string) {
    this.llamadas.push(fn);
    const r = this.respuestas[fn];
    if (!r || r === "lanza") return Promise.reject(new Error("función inexistente"));
    return Promise.resolve(r);
  }
}

const FILAS_REALES = [
  { proceso: "ocr", usd_real: "1.5", ultimo_dia_real: "2026-10-07", usd_estimado_hoy: "0.1" },
  { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
  { proceso: "otros", usd_real: 0, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
];
const TIPO = [{ eur_por_usd: 0.9231, fecha: "2026-10-07", fuente: "bce" }];

describe("cargarGastoIaReal", () => {
  it("existe con datos: filas + tipo del BCE (invoca rpc con `this`)", async () => {
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: FILAS_REALES, error: null },
      tipo_cambio_usd_eur_actual: { data: TIPO, error: null },
    });
    const g = await cargarGastoIaReal(c);
    expect(c.llamadas).toEqual(["gasto_ia_real_resumen", "tipo_cambio_usd_eur_actual"]);
    expect(g?.filas[0].usd_real).toBe(1.5);
    expect(g?.tipo).toEqual({ eurPorUsd: 0.9231, fecha: "2026-10-07", fuente: "bce" });
  });

  it("existe pero vacía (sin ultimo_dia_real): null -> se usa el estimado", async () => {
    const vacia = FILAS_REALES.map((f) => ({ ...f, usd_real: 0, ultimo_dia_real: null }));
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: vacia, error: null },
      tipo_cambio_usd_eur_actual: { data: [{ eur_por_usd: 0.92, fecha: null, fuente: "por_defecto" }], error: null },
    });
    expect(await cargarGastoIaReal(c)).toBeNull();
    const c2 = new ClienteReal({ gasto_ia_real_resumen: { data: [], error: null } });
    expect(await cargarGastoIaReal(c2)).toBeNull();
  });

  it("no existe (error de PostgREST o excepción): null sin lanzar", async () => {
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: null, error: { message: "Could not find the function" } },
    });
    expect(await cargarGastoIaReal(c)).toBeNull();
    expect(await cargarGastoIaReal(new ClienteReal({ gasto_ia_real_resumen: "lanza" }))).toBeNull();
  });

  it("si solo falla el tipo de cambio, usa 0,92 por defecto", async () => {
    const c = new ClienteReal({
      gasto_ia_real_resumen: { data: FILAS_REALES, error: null },
      tipo_cambio_usd_eur_actual: "lanza",
    });
    const g = await cargarGastoIaReal(c);
    expect(g?.tipo).toEqual({ eurPorUsd: 0.92, fecha: null, fuente: "por_defecto" });
  });
});

// ─── Mes en curso y mes anterior ─────────────────────────────────────────────

/** RPC que responde según `p_dias` (la ventana va hacia atrás desde el último día cerrado). */
class ClientePorVentana {
  llamadas: Array<{ fn: string; dias?: number }> = [];
  constructor(private ventanas: Record<number, unknown>) {}
  rpc(fn: string, args?: { p_dias?: number }) {
    this.llamadas.push({ fn, dias: args?.p_dias });
    if (fn === "tipo_cambio_usd_eur_actual") return Promise.resolve({ data: TIPO, error: null });
    const v = this.ventanas[args?.p_dias ?? -1];
    return Promise.resolve(v === undefined ? { data: null, error: { message: "sin ventana" } } : { data: v, error: null });
  }
}
const ventana = (ocr: number, chat: number, hoy = 0, corte = "2026-10-08") => [
  { proceso: "ocr", usd_real: ocr, ultimo_dia_real: corte, usd_estimado_hoy: hoy },
  { proceso: "chat", usd_real: chat, ultimo_dia_real: corte, usd_estimado_hoy: 0 },
];
const diasPedidos = (c: ClientePorVentana) => c.llamadas.filter((l) => l.fn === "gasto_ia_real_resumen").map((l) => l.dias);

describe("cargarGastoIaRealMes", () => {
  const hoy = new Date(2026, 9, 9); // 9 oct 2026; último cierre: 8 oct

  it("pide el último día cerrado y luego tantos días como lleva el mes", async () => {
    const c = new ClientePorVentana({ 1: ventana(0.1, 0.05, 0.02), 8: ventana(1, 0.5, 0.02) });
    const g = await cargarGastoIaRealMes(c, hoy);
    expect(diasPedidos(c)).toEqual([1, 8]);
    expect(g?.actual.filas.find((f) => f.proceso === "ocr")?.usd_real).toBe(1);
    expect(g?.anterior).toBeNull();
  });

  it("con mes anterior: ventana grande menos mes en curso (nunca negativo, sin estimado de hoy)", async () => {
    // 1 sep … 8 oct = 38 días
    const c = new ClientePorVentana({ 1: ventana(0.1, 0.05), 8: ventana(1, 0.5), 38: ventana(4, 0.4) });
    const g = await cargarGastoIaRealMes(c, hoy, true);
    expect(diasPedidos(c)).toEqual([1, 8, 38]);
    const ant = g?.anterior;
    expect(ant?.filas.find((f) => f.proceso === "ocr")?.usd_real).toBe(3);
    expect(ant?.filas.find((f) => f.proceso === "chat")?.usd_real).toBe(0); // 0,4 − 0,5 → 0
    expect(ant?.filas.every((f) => f.usd_estimado_hoy === 0)).toBe(true);
  });

  it("si el último cierre es del mes anterior (día 1): el real del mes es 0 y queda el estimado de hoy", async () => {
    const c = new ClientePorVentana({ 1: ventana(0.7, 0.2, 0.03, "2026-09-30") });
    const g = await cargarGastoIaRealMes(c, new Date(2026, 9, 1));
    expect(g?.actual.filas.find((f) => f.proceso === "ocr")?.usd_real).toBe(0);
    expect(g?.actual.filas.find((f) => f.proceso === "ocr")?.usd_estimado_hoy).toBe(0.03);
  });

  it("sin datos reales o con la RPC caída: null (manda el estimado)", async () => {
    expect(await cargarGastoIaRealMes(new ClientePorVentana({}), hoy)).toBeNull();
    const sinCorte = ventana(0, 0).map((f) => ({ ...f, ultimo_dia_real: null }));
    expect(await cargarGastoIaRealMes(new ClientePorVentana({ 1: sinCorte }), hoy)).toBeNull();
  });
});

describe("tope mensual de IA", () => {
  class ClienteTabla {
    constructor(private respuesta: { data: unknown; error: unknown }) {}
    from(tabla: string) {
      expect(tabla).toBe("servicios_config");
      return { select: () => ({ limit: () => Promise.resolve(this.respuesta) }) };
    }
  }

  it("leerTopeIaMes lee servicios_config con `this` del cliente y cae a 5 € si falla", async () => {
    expect(await leerTopeIaMes(new ClienteTabla({ data: [{ tope_ia_mes_eur: "12.50" }], error: null }))).toBe(12.5);
    expect(await leerTopeIaMes(new ClienteTabla({ data: null, error: { message: "column does not exist" } }))).toBe(5);
    expect(await leerTopeIaMes(new ClienteTabla({ data: [], error: null }))).toBe(5);
    expect(
      await leerTopeIaMes({
        from: () => {
          throw new Error("x");
        },
      }),
    ).toBe(5);
  });

  it("evaluarTope: ok < 80 % ≤ aviso < 100 % ≤ superado", () => {
    expect(evaluarTope(3.9, 5).nivel).toBe("ok");
    expect(evaluarTope(4, 5).nivel).toBe("aviso");
    expect(evaluarTope(4.99, 5).nivel).toBe("aviso");
    expect(evaluarTope(5, 5).nivel).toBe("superado");
    expect(evaluarTope(7.5, 5).pct).toBe(150);
    expect(evaluarTope(null, 5).nivel).toBe("ok");
    expect(evaluarTope(3, 0).nivel).toBe("ok");
  });

  const envoltorio = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Envoltorio = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    return { qc, Envoltorio };
  };

  it("useTopeIaMes guarda el tope en la caché [servicios, tope_ia_mes_eur]", async () => {
    cliente.from = function (this: unknown, tabla: string) {
      expect(this).toBe(cliente);
      expect(tabla).toBe("servicios_config");
      return { select: () => ({ limit: () => Promise.resolve({ data: [{ tope_ia_mes_eur: 7 }], error: null }) }) };
    };
    const { qc, Envoltorio } = envoltorio();
    const { result } = renderHook(() => useTopeIaMes(), { wrapper: Envoltorio });
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(qc.getQueryData(["servicios", "tope_ia_mes_eur"])).toBe(7);
  });

  it("useFijarTopeIa llama a fijar_tope_ia_mes con `this` y deja el tope nuevo en la caché; si falla, lanza con el mensaje", async () => {
    const llamadas: Array<{ fn: string; args: unknown }> = [];
    let respuesta: { data: unknown; error: { message?: string } | null } = { data: 8, error: null };
    cliente.rpc = function (this: unknown, fn: string, args: unknown) {
      expect(this).toBe(cliente);
      llamadas.push({ fn, args });
      return Promise.resolve(respuesta);
    };
    const { qc, Envoltorio } = envoltorio();
    const { result } = renderHook(() => useFijarTopeIa(), { wrapper: Envoltorio });
    await act(async () => {
      expect(await result.current.mutateAsync(8)).toBe(8);
    });
    expect(llamadas).toEqual([{ fn: "fijar_tope_ia_mes", args: { p_eur: 8 } }]);
    expect(qc.getQueryData(["servicios", "tope_ia_mes_eur"])).toBe(8);

    respuesta = { data: null, error: { message: "solo super admin" } };
    await act(async () => {
      await expect(result.current.mutateAsync(9)).rejects.toThrow("solo super admin");
    });
    expect(qc.getQueryData(["servicios", "tope_ia_mes_eur"])).toBe(8);
  });
});
