import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

interface ConfigFalsa {
  steps: { element?: Element }[];
  onNextClick: () => void;
  onPrevClick: () => void;
  onDestroyStarted: () => void;
}
// driver.js de mentira: guarda el índice activo como el de verdad.
let activo: number | undefined;
const drive = vi.fn((i: number) => {
  activo = i;
});
const moveTo = vi.fn((i: number) => {
  activo = i;
});
const destroy = vi.fn();
const driverMock = vi.fn((_config: ConfigFalsa) => ({
  drive,
  moveTo,
  destroy,
  isActive: () => activo !== undefined,
  getActiveIndex: () => activo,
}));
vi.mock("driver.js", () => ({ driver: (config: ConfigFalsa) => driverMock(config) }));
vi.mock("driver.js/dist/driver.css", () => ({}));
vi.mock("@/components/ayuda/tour.css", () => ({}));

// Ningún tour de verdad usa hoy subpestañas ni desplegables (Peticiones y Usuarios), pero el hook los sigue
// soportando: se prueban con un tour de mentira, «prueba», con pestaña › subpestaña y un desplegable.
const tourPrueba = vi.hoisted(() => [
  { titulo: "Prueba", texto: "Inicio." },
  { elemento: "a-pestana", pestana: "a-pestana", titulo: "A", texto: "Pestaña A." },
  { elemento: "a-sub", pestana: ["a-pestana", "a-sub"], titulo: "Sub", texto: "Subpestaña de A." },
  { elemento: "a-sub-foto", pestana: ["a-pestana", "a-sub"], titulo: "Foto", texto: "Dentro de la subpestaña." },
  { elemento: "b-pestana", pestana: "b-pestana", titulo: "B", texto: "Pestaña B." },
  { elemento: "b-pregunta", pestana: "b-pestana", abrir: "b-abrir", titulo: "Desplegable", texto: "Se despliega para enseñarlo." },
  { elemento: "boton-ayuda", titulo: "Fin", texto: "Botón «?»." },
]);
vi.mock("@/lib/ayuda/tours", async (original) => {
  const real = await original<typeof import("@/lib/ayuda/tours")>();
  return { ...real, TOURS: { ...real.TOURS, prueba: tourPrueba } };
});

let usuario: { id: string; user_metadata?: Record<string, unknown> } | null = null;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
const updateUser = vi.fn(async (_datos: unknown) => ({ data: {}, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { updateUser: (datos: unknown) => updateUser(datos) } },
}));

import { useTourSeccion } from "../useTourSeccion";
import { TOURS, claveTourVisto, esCambioDePestanaDelTour, type SeccionAyuda } from "@/lib/ayuda/tours";

const PRUEBA = "prueba" as SeccionAyuda;
const envoltorio = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("useTourSeccion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    driverMock.mockClear();
    drive.mockClear();
    moveTo.mockClear();
    destroy.mockClear();
    activo = undefined;
    localStorage.clear();
    usuario = null;
    updateUser.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("«lanzar» arranca en el primer paso y los opcionales que no aparecen se quitan (y el total baja)", async () => {
    const { result } = renderHook(() => useTourSeccion("peticiones", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drive).toHaveBeenCalledWith(0);
    const config = driverMock.mock.calls[0][0];
    expect(config.steps.length).toBe(TOURS.peticiones.length);

    // Recorre todo: sin pantalla real no hay elementos, así que solo quedan los obligatorios.
    for (let i = 0; i < 30 && activo !== undefined && destroy.mock.calls.length === 0; i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    expect(config.steps.length).toBe(TOURS.peticiones.filter((p) => !p.opcional).length);
    expect(config.steps.length).toBeLessThan(TOURS.peticiones.length);
    expect(destroy).toHaveBeenCalled();
  });

  it("abre la pestaña de cada paso (mousedown, como Radix) y al terminar vuelve a la que estaba", async () => {
    document.body.innerHTML = `
      <button data-tour="peticiones-pestana-nueva" aria-selected="false"></button>
      <button data-tour="peticiones-pestana-mias" aria-selected="true"></button>`;
    const pulsadas: string[] = [];
    document.querySelectorAll("button").forEach((b) =>
      b.addEventListener("mousedown", () => {
        pulsadas.push(b.getAttribute("data-tour") ?? "");
        document.querySelectorAll("button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
      }),
    );
    const { result } = renderHook(() => useTourSeccion("peticiones", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    await act(async () => {
      config.onNextClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pulsadas).toEqual(["peticiones-pestana-nueva"]);

    await act(async () => config.onDestroyStarted());
    expect(pulsadas.at(-1)).toBe("peticiones-pestana-mias");
    document.body.innerHTML = "";
  });

  it("hacia atrás desde la pestaña B vuelve a la subpestaña de A abriendo antes A y luego la subpestaña", async () => {
    document.body.innerHTML = `
      <button class="top" data-tour="a-pestana" aria-selected="true"></button>
      <button class="top" data-tour="b-pestana" aria-selected="false"></button>
      <button class="sub" data-tour="a-sub" aria-selected="false"></button>
      <div data-tour="a-sub-foto"></div>`;
    const sel = (id: string) => document.querySelector<HTMLElement>(`[data-tour="${id}"]`)!;
    const abierta = (id: string) => sel(id).getAttribute("aria-selected") === "true";
    const visibleSi = (el: HTMLElement, cond: () => boolean) => {
      el.getClientRects = () => (cond() ? [{}] : []) as unknown as DOMRectList;
    };
    visibleSi(sel("a-pestana"), () => true);
    visibleSi(sel("b-pestana"), () => true);
    // La subpestaña y su contenido solo se ven con A abierta (si no, siguen en el DOM, ocultos).
    visibleSi(sel("a-sub"), () => abierta("a-pestana"));
    visibleSi(sel("a-sub-foto"), () => abierta("a-pestana") && abierta("a-sub"));
    const pulsadas: string[] = [];
    document.querySelectorAll<HTMLElement>("button").forEach((b) =>
      b.addEventListener("mousedown", () => {
        pulsadas.push(b.getAttribute("data-tour") ?? "");
        if (b.classList.contains("top")) {
          document.querySelectorAll(".top").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
        } else {
          b.setAttribute("aria-selected", "true");
        }
      }),
    );
    const { result } = renderHook(() => useTourSeccion(PRUEBA, { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    const actual = () => config.steps[activo ?? -1]?.element;

    for (let i = 0; i < 30 && actual() !== sel("b-pestana"); i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    expect(actual()).toBe(sel("b-pestana"));
    expect(abierta("a-pestana")).toBe(false);

    pulsadas.length = 0;
    await act(async () => {
      config.onPrevClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pulsadas).toEqual(["a-pestana"]);
    expect(actual()).toBe(sel("a-sub-foto"));

    // Con la subpestaña ya abierta solo hace falta abrir A; si no, también la pulsa.
    sel("a-sub").setAttribute("aria-selected", "false");
    await act(async () => {
      config.onNextClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    pulsadas.length = 0;
    await act(async () => {
      config.onPrevClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pulsadas).toEqual(["a-pestana", "a-sub"]);
    expect(actual()).toBe(sel("a-sub-foto"));
    document.body.innerHTML = "";
  });

  it("sus cambios de pestaña van marcados como del tour (sin historial); los del usuario no", async () => {
    document.body.innerHTML = `
      <button data-tour="peticiones-pestana-nueva" aria-selected="false"></button>
      <button data-tour="peticiones-pestana-mias" aria-selected="true"></button>`;
    const marcas: boolean[] = [];
    document.querySelectorAll("button").forEach((b) =>
      b.addEventListener("mousedown", () => {
        marcas.push(esCambioDePestanaDelTour());
        document.querySelectorAll("button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
      }),
    );
    const { result } = renderHook(() => useTourSeccion("peticiones", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    await act(async () => {
      config.onNextClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    await act(async () => config.onDestroyStarted());
    // Ida (Nueva petición) y vuelta (Mis peticiones), las dos del tour.
    expect(marcas).toEqual([true, true]);
    expect(esCambioDePestanaDelTour()).toBe(false);
    document.body.innerHTML = "";
  });

  it("si abre un desplegable, lo vuelve a cerrar al acabar el tour", async () => {
    document.body.innerHTML = `
      <button data-tour="b-pestana" aria-selected="true"></button>
      <div data-tour="b-pregunta">
        <button data-tour="b-abrir" aria-expanded="false"></button>
      </div>`;
    const visible = () => [{}] as unknown as DOMRectList;
    const bloque = document.querySelector<HTMLElement>('[data-tour="b-pregunta"]')!;
    const abrir = document.querySelector<HTMLElement>('[data-tour="b-abrir"]')!;
    bloque.getClientRects = visible;
    abrir.getClientRects = visible;
    abrir.addEventListener("click", () =>
      abrir.setAttribute("aria-expanded", String(abrir.getAttribute("aria-expanded") !== "true")),
    );
    const { result } = renderHook(() => useTourSeccion(PRUEBA, { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    for (let i = 0; i < 30 && abrir.getAttribute("aria-expanded") !== "true"; i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    expect(abrir.getAttribute("aria-expanded")).toBe("true");

    await act(async () => config.onDestroyStarted());
    expect(abrir.getAttribute("aria-expanded")).toBe("false");
    document.body.innerHTML = "";
  });

  it("no cierra el desplegable si ya estaba abierto antes del tour", async () => {
    document.body.innerHTML = `
      <button data-tour="b-pestana" aria-selected="true"></button>
      <div data-tour="b-pregunta">
        <button data-tour="b-abrir" aria-expanded="true"></button>
      </div>`;
    const abrir = document.querySelector<HTMLElement>('[data-tour="b-abrir"]')!;
    const clic = vi.fn();
    abrir.addEventListener("click", clic);
    const { result } = renderHook(() => useTourSeccion(PRUEBA, { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    for (let i = 0; i < 30 && activo !== undefined && destroy.mock.calls.length === 0; i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    await act(async () => config.onDestroyStarted());
    expect(clic).not.toHaveBeenCalled();
    expect(abrir.getAttribute("aria-expanded")).toBe("true");
    document.body.innerHTML = "";
  });

  it("se lanza solo la primera vez y lo recuerda por usuario", () => {
    usuario = { id: "u1" };
    const { unmount } = renderHook(() => useTourSeccion("peticiones"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(claveTourVisto("peticiones", "u1"))).toBe("1");
    unmount();

    renderHook(() => useTourSeccion("peticiones"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it("lo apunta también en la cuenta, para que no vuelva a salir en otro navegador o dirección", () => {
    usuario = { id: "u-cuenta", user_metadata: { ayuda_tours_vistos: ["usuarios"] } };
    renderHook(() => useTourSeccion("peticiones"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ data: { ayuda_tours_vistos: ["peticiones", "usuarios"] } });
  });

  it("no se lanza solo si la cuenta ya lo tiene visto, aunque este navegador no lo sepa", () => {
    usuario = { id: "u-otro-movil", user_metadata: { ayuda_tours_vistos: ["peticiones"] } };
    renderHook(() => useTourSeccion("peticiones"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
    expect(localStorage.getItem(claveTourVisto("peticiones", "u-otro-movil"))).toBe("1");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("si solo lo sabía este navegador, lo sube a la cuenta sin relanzarlo", () => {
    usuario = { id: "u-antiguo" };
    localStorage.setItem(claveTourVisto("usuarios", "u-antiguo"), "1");
    renderHook(() => useTourSeccion("usuarios"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith({ data: { ayuda_tours_vistos: ["usuarios"] } });
  });

  it("sin usuario no se lanza solo", () => {
    renderHook(() => useTourSeccion("usuarios"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
  });
});
