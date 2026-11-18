/**
 * Dashboard a la ALTURA DE LA PANTALLA (06/10/2026, regla del dueño para todo el panel: «que no haya scroll
 * vertical: el alto de la página es el alto de la pantalla del dispositivo»).
 *
 * Mismo mecanismo que el resto de pantallas (`useAlturaDisponible`): el bloque del Dashboard mide el alto visible
 * menos su posición y el relleno inferior del <main>, y lo reparte con flex: «Accesos rápidos» arriba con su alto
 * natural y «Avisos» debajo, con lo que sobra.
 *
 * Se monta el Dashboard con «Accesos rápidos» DE VERDAD (permisos de mentira); «Avisos», con un marcador (tiene sus
 * propios tests). jsdom no calcula layout: las medidas se dan a mano (el bloque empieza en y = 24, el relleno
 * superior del <main>); lo demás se comprueba por estructura. Los píxeles reales, con el arnés de capturas.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  layout: [] as Array<{ fixedHeight?: boolean }>,
}));

// El layout de verdad monta el menú lateral (sesión, permisos…): aquí basta un <main> con su relleno inferior
// (24 px, `sm:p-6`) y apuntar con qué props lo usa el Dashboard.
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children, fixedHeight }: { children: ReactNode; fixedHeight?: boolean }) => {
    h.layout.push({ fixedHeight });
    return <main style={{ paddingBottom: 24 }}>{children}</main>;
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1", email: "laura@cristaleria.test", user_metadata: { display_name: "Laura" } } }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ permissions: [{ section_key: "usuarios", can_view: true }], loading: false }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: false, loading: false }) }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }),
}));
vi.mock("@/components/dashboard/widgets/AvisosDashboard", () => ({
  AvisosDashboard: () => <div className="rounded-lg h-full">Avisos</div>,
}));

import Dashboard, { ALTURA_MINIMA_DASHBOARD, ALTURA_MINIMA_DASHBOARD_MOVIL } from "@/pages/Dashboard";

const original = { innerHeight: window.innerHeight, innerWidth: window.innerWidth };
function altoVentana(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}
function anchoVentana(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
}
/** Layout simulado: el bloque del Dashboard empieza en y = 24 (relleno superior del <main>). */
function conLayout(alto: number) {
  altoVentana(alto);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === "dashboard" ? 24 : 0;
    return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
}

async function montar() {
  await montarConRetorno();
}
async function montarConRetorno() {
  const r = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await screen.findByText("Accesos rápidos");
  return r;
}
const bloque = () => screen.getByTestId("dashboard");

beforeEach(() => {
  h.layout = [];
  anchoVentana(1280);
});
afterEach(() => {
  vi.restoreAllMocks();
  altoVentana(original.innerHeight);
  anchoVentana(original.innerWidth);
});

describe("Dashboard · ocupa el alto de la pantalla, sin scroll", () => {
  it("los suelos: 420 px (tablet y escritorio) y 640 px en el móvil (tarjetas una debajo de otra)", () => {
    expect(ALTURA_MINIMA_DASHBOARD).toBe(420);
    expect(ALTURA_MINIMA_DASHBOARD_MOVIL).toBe(640);
  });

  it("el bloque mide justo lo que queda de ventana: alto visible − su posición − relleno inferior del <main>", async () => {
    conLayout(800);
    await montar();

    // 800 − 24 − 24: termina en el borde inferior del <main>, sin scroll de página.
    expect(bloque()).toHaveAttribute("data-altura-fija", "752");
    expect(bloque().style.height).toBe("752px");
    expect(bloque()).toHaveClass("flex", "flex-col");
    // Sin scroll propio: lo que hay dentro se reparte el alto, no se desplaza.
    expect(bloque().className).not.toMatch(/overflow-(y-)?(auto|scroll)/);
  });

  it("lo reparte: «Accesos rápidos» arriba con su alto natural y «Avisos» con el resto", async () => {
    conLayout(800);
    await montar();
    const accesos = screen.getByTestId("dashboard-accesos");
    const avisos = screen.getByTestId("modulo-avisos");

    expect([...bloque().children]).toEqual([accesos, avisos]);
    expect(accesos).toHaveClass("flex-none", "min-h-0");
    expect(within(accesos).getByText("Accesos rápidos")).toBeInTheDocument();
    // Las secciones que puede abrir (sin el Dashboard, en el que ya está), en el orden del menú.
    expect(within(accesos).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/usuarios", "/peticiones", "/ayuda"]);
    // «Avisos» se queda con lo que sobra y puede encoger; su tarjeta lo llena entero.
    expect(avisos).toHaveClass("flex-1", "min-h-0", "min-w-0");
    const tarjeta = within(avisos).getByText("Avisos").closest(".rounded-lg") as HTMLElement;
    expect(tarjeta.parentElement).toBe(avisos);
    expect(tarjeta).toHaveClass("h-full");
    // Los widgets del restaurante ya no están.
    expect(screen.queryByText("Reservas de Hoy")).toBeNull();
    expect(screen.queryByText("Márgenes de precio")).toBeNull();
  });

  it("en el móvil el suelo sube a 640 px y la página hace scroll; en la tablet vertical sigue en 420 px", async () => {
    anchoVentana(375);
    conLayout(812);
    const primero = await montarConRetorno();
    // 812 − 48 = 764 > 640
    expect(bloque()).toHaveAttribute("data-altura-fija", "764");
    primero.unmount();

    anchoVentana(375);
    conLayout(600);
    const segundo = await montarConRetorno();
    // 600 − 48 = 552 < 640
    expect(bloque()).toHaveAttribute("data-altura-fija", "640");
    segundo.unmount();

    anchoVentana(820);
    conLayout(600);
    await montarConRetorno();
    expect(bloque()).toHaveAttribute("data-altura-fija", "552");
  });

  it("se recalcula al redimensionar la ventana y al girar la tablet", async () => {
    conLayout(800);
    await montar();
    expect(bloque()).toHaveAttribute("data-altura-fija", "752");

    act(() => {
      altoVentana(711);
      window.dispatchEvent(new Event("resize"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "663");

    act(() => {
      altoVentana(1024);
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "976");
  });

  it("en una ventana muy baja no encoge por debajo del suelo de 420 px y, solo entonces, la página hace scroll", async () => {
    conLayout(400);
    await montar();

    // 400 − 24 − 24 = 352 < 420: se queda en el suelo.
    expect(bloque()).toHaveAttribute("data-altura-fija", "420");
  });

  it("sin medidas de layout (jsdom) se queda como siempre: sin alto fijo, cada widget con su alto natural", async () => {
    await montar();

    expect(bloque()).not.toHaveAttribute("data-altura-fija");
    expect(bloque().style.height).toBe("");
  });

  it("no usa `fixedHeight`: el que hace scroll en el caso extremo es la página, como en el resto de pantallas", async () => {
    conLayout(800);
    await montar();

    // Con `fixedHeight` el <main> sería la caja con scroll y la medida (que cuenta el scroll de la página) se descuadraría.
    expect(h.layout.length).toBeGreaterThan(0);
    expect(h.layout.every((props) => !props.fixedHeight)).toBe(true);
  });
});
