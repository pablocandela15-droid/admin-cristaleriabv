/**
 * Interruptores de Control del Panel (14/11/2026): lectura compartida entre menú, rutas y Control del Panel.
 * Sin fila, el módulo está activado; la fila se crea al primer cambio.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  filas: [] as Array<{ section_key: string; label: string; enabled: boolean; updated_at?: string | null }>,
  falloLectura: false,
  lecturas: 0,
  upsert: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "super-1" } } })) },
    from: vi.fn(() => ({
      select: () => ({
        order: async () => {
          h.lecturas += 1;
          return h.falloLectura ? { data: null, error: { message: "sin red" } } : { data: h.filas, error: null };
        },
      }),
      upsert: (...args: unknown[]) => h.upsert(...args),
    })),
  },
}));

import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { precargarFeatureToggles, reiniciarTogglesParaPruebas } from "@/lib/precargaToggles";

beforeEach(() => {
  reiniciarTogglesParaPruebas();
  h.filas = [
    { section_key: "usuarios", label: "Usuarios", enabled: false },
    // Fila vieja de un módulo que ya no existe: no afecta a nadie.
    { section_key: "reservas", label: "Reservas", enabled: false },
  ];
  h.falloLectura = false;
  h.lecturas = 0;
  h.upsert.mockReset().mockResolvedValue({ error: null });
});

describe("useAdminFeatureToggles", () => {
  it("sin fila, activado; con fila, lo que diga la fila", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isEnabled("usuarios")).toBe(false);
    expect(result.current.isEnabled("peticiones")).toBe(true);
    expect(result.current.isEnabled("dashboard")).toBe(true);
    expect(result.current.isEnabled("clave_desconocida")).toBe(true);
  });

  it("una sola lectura para todos (menú, rutas…) y todos ven el cambio al guardar", async () => {
    const menu = renderHook(() => useAdminFeatureToggles());
    const ruta = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(ruta.result.current.loading).toBe(false));
    expect(h.lecturas).toBe(1);

    await act(async () => {
      await menu.result.current.setEnabled("peticiones", "Nueva petición", false);
    });
    // Ningún módulo hereda de «Nueva petición»: se guarda solo su fila.
    expect(h.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ section_key: "peticiones", label: "Nueva petición", enabled: false, updated_by: "super-1" })],
      { onConflict: "section_key" },
    );
    expect(menu.result.current.isEnabled("peticiones")).toBe(false);
    expect(ruta.result.current.isEnabled("peticiones")).toBe(false);
  });

  it("volver a activar un módulo apagado guarda su fila con el valor nuevo", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setEnabled("usuarios", "Usuarios", true);
    });
    expect(h.upsert.mock.calls[0][0]).toEqual([expect.objectContaining({ section_key: "usuarios", enabled: true })]);
    expect(result.current.isEnabled("usuarios")).toBe(true);
  });

  it("si guardar falla, no cambia nada", async () => {
    h.upsert.mockResolvedValue({ error: { message: "permission denied" } });
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = true;
    await act(async () => {
      ok = await result.current.setEnabled("peticiones", "Nueva petición", false);
    });
    expect(ok).toBe(false);
    expect(result.current.isEnabled("peticiones")).toBe(true);
  });

  it("si la lectura falla, todo sigue activado (un corte no esconde secciones)", async () => {
    h.falloLectura = true;
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isEnabled("usuarios")).toBe(true);
    expect(result.current.isEnabled("peticiones")).toBe(true);
  });

  it("al entrar otro usuario (precarga) vuelve a leer, y refetch también", async () => {
    const { result } = renderHook(() => useAdminFeatureToggles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    h.filas = [{ section_key: "peticiones", label: "Nueva petición", enabled: false }];
    act(() => precargarFeatureToggles());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.isEnabled("peticiones")).toBe(false));
    expect(result.current.loading).toBe(false);
    h.filas = [];
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.isEnabled("peticiones")).toBe(true);
    expect(h.lecturas).toBe(3);
  });
});
