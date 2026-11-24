/**
 * Módulos desactivados en Control del Panel (14/11/2026): desaparecen del menú del equipo y no se abren ni
 * escribiendo su dirección (se va al Dashboard con un aviso). El super admin los sigue viendo y abriendo,
 * marcados «Desactivado para el equipo». Los permisos por usuario siguen mandando igual por debajo.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ESTADO_TRAS_LOGIN } from "@/lib/seccionInicio";

const h = vi.hoisted(() => ({
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  superAdmin: false,
  apagados: [] as string[],
  cargandoToggles: false,
  seccionInicio: null as string | null,
  aviso: vi.fn(),
  auditar: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { info: h.aviso, success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: h.auditar }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: "u-1", email: "sala@cristaleria.test", user_metadata: {} }, loading: false }),
  useUsuarioIdOpcional: () => "u-1",
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ isAdmin: false, role: "staff", loading: false, verificado: true, permissions: h.permisos, seccionInicio: h.seccionInicio }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }) }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({ isEnabled: (k: string) => !h.apagados.includes(k), loading: h.cargandoToggles }),
}));

import { AppSidebar } from "@/components/AppSidebar";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const ver = (...secciones: string[]) => secciones.map((section_key) => ({ section_key, can_view: true, can_edit: false }));

function Donde() {
  return <output data-testid="donde">{useLocation().pathname}</output>;
}

function menu() {
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
  return screen.getAllByRole("link").map((a) => a.getAttribute("href"));
}

function abrir(entrada: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Donde />
      <Routes>
        <Route path="/dashboard" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute requiredSection="usuarios"><p>Página de Usuarios</p></ProtectedRoute>} />
        <Route path="/peticiones" element={<ProtectedRoute><p>Página de Peticiones</p></ProtectedRoute>} />
        <Route path="/avisos" element={<ProtectedRoute><p>Página de Avisos</p></ProtectedRoute>} />
        <Route path="/ayuda" element={<ProtectedRoute><p>Ayuda</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.permisos = ver("dashboard", "usuarios");
  h.superAdmin = false;
  h.apagados = [];
  h.cargandoToggles = false;
  h.seccionInicio = null;
  h.aviso.mockClear();
  h.auditar.mockClear();
});

describe("menú del equipo", () => {
  it("todo activado: lo de siempre según sus permisos", () => {
    expect(menu()).toEqual(["/dashboard", "/usuarios", "/peticiones", "/ayuda"]);
  });

  it("Usuarios apagado desaparece del menú; lo demás sigue", () => {
    h.apagados = ["usuarios"];
    expect(menu()).toEqual(["/dashboard", "/peticiones", "/ayuda"]);
  });

  it("Nueva petición (sin permisos) también se puede apagar; Dashboard y Ayuda no", () => {
    h.apagados = ["peticiones", "dashboard", "ayuda"];
    expect(menu()).toEqual(["/dashboard", "/usuarios", "/ayuda"]);
  });

  it("los permisos siguen mandando: sin el de Usuarios no sale aunque esté activado", () => {
    h.permisos = ver("dashboard");
    expect(menu()).toEqual(["/dashboard", "/peticiones", "/ayuda"]);
  });

  it("mientras no se saben los interruptores, el menú espera (como antes)", () => {
    h.cargandoToggles = true;
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Usuarios" })).toBeNull();
  });
});

describe("menú del super admin", () => {
  beforeEach(() => {
    h.superAdmin = true;
    h.permisos = [];
  });

  it("ve los módulos apagados, marcados «Desactivado para el equipo»; los demás, sin marca", () => {
    h.apagados = ["usuarios", "peticiones"];
    expect(menu()).toEqual(["/dashboard", "/facturas", "/web", "/presupuestos", "/trafico-web", "/usuarios", "/peticiones", "/ayuda"]);
    const usuarios = screen.getByRole("link", { name: "Usuarios (desactivado para el equipo)" });
    expect(usuarios).toHaveAttribute("data-desactivado", "true");
    expect(within(usuarios).getByText("Desactivado")).toHaveAttribute("title", "Desactivado para el equipo");
    expect(screen.getByRole("link", { name: "Nueva petición (desactivado para el equipo)" })).toBeInTheDocument();
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard).not.toHaveAttribute("data-desactivado");
    expect(within(dashboard).queryByText("Desactivado")).toBeNull();
  });
});

describe("rutas de un módulo apagado", () => {
  it("el equipo va al Dashboard con un aviso, y la página no llega a pintarse", async () => {
    h.apagados = ["usuarios"];
    abrir("/usuarios");
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard");
    expect(screen.queryByText("Página de Usuarios")).toBeNull();
    expect(h.aviso).toHaveBeenCalledTimes(1);
    expect(h.aviso).toHaveBeenCalledWith("«Usuarios» está desactivado", expect.objectContaining({ description: expect.any(String) }));
    // No es un acceso denegado por permisos: no se apunta en la auditoría.
    expect(h.auditar).not.toHaveBeenCalled();
  });

  it("los módulos sin permisos (Nueva petición) también se bloquean", async () => {
    h.apagados = ["peticiones"];
    abrir("/peticiones");
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(h.aviso).toHaveBeenCalledWith("«Nueva petición» está desactivado", expect.anything());
  });

  it("los demás módulos se abren igual (y Avisos, que no se puede apagar, aunque tenga fila)", async () => {
    h.apagados = ["usuarios", "avisos"];
    const { unmount } = abrir("/peticiones");
    expect(await screen.findByText("Página de Peticiones")).toBeInTheDocument();
    unmount();
    abrir("/avisos");
    expect(await screen.findByText("Página de Avisos")).toBeInTheDocument();
    expect(h.aviso).not.toHaveBeenCalled();
  });

  it("sin Dashboard, a la primera sección que pueda ver y esté activada", async () => {
    h.permisos = ver("usuarios");
    h.apagados = ["peticiones"];
    abrir("/peticiones");
    expect(await screen.findByText("Página de Usuarios")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/usuarios");
  });

  it("sin otra sección que pueda ver, a Ayuda, sin bucles", async () => {
    h.permisos = ver("usuarios");
    h.apagados = ["usuarios"];
    abrir("/usuarios");
    expect(await screen.findByText("Ayuda")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/ayuda");
  });

  it("el super admin entra igual (sin aviso)", async () => {
    h.superAdmin = true;
    h.apagados = ["usuarios", "peticiones"];
    abrir("/usuarios");
    expect(await screen.findByText("Página de Usuarios")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/usuarios");
    expect(h.aviso).not.toHaveBeenCalled();
  });

  it("mientras no se saben los interruptores se deja pasar (como con los permisos recordados)", async () => {
    h.apagados = ["usuarios"];
    h.cargandoToggles = true;
    abrir("/usuarios");
    expect(await screen.findByText("Página de Usuarios")).toBeInTheDocument();
    expect(h.aviso).not.toHaveBeenCalled();
  });

  it("el permiso sigue mandando por debajo: sin permiso de Usuarios no entra aunque esté activado", async () => {
    h.permisos = ver("dashboard");
    abrir("/usuarios");
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(h.auditar).toHaveBeenCalledWith("/usuarios");
    expect(h.aviso).not.toHaveBeenCalled();
  });

  it("una sección de inicio apagada no se abre al entrar: lo de siempre, sin aviso", async () => {
    h.seccionInicio = "usuarios";
    h.apagados = ["usuarios"];
    abrir({ pathname: "/dashboard", state: ESTADO_TRAS_LOGIN });
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard");
    expect(h.aviso).not.toHaveBeenCalled();
  });
});
