/**
 * Usuarios sin Dashboard en el menú y en las rutas (lo que hacían los tipos de usuario «Reservas» y
 * «Albaranes» del 10/11/2026; hoy no hay tipos fijos, `TIPOS_USUARIO` está vacío, pero la regla sigue):
 * cada uno ve solo sus secciones y, al entrar (Auth lleva a /dashboard), va directo a la primera que
 * puede ver sin que cuente como acceso denegado. Una sección que no ve sí lo rebota y se apunta.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";

const h = vi.hoisted(() => ({
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  superAdmin: false,
  auditar: vi.fn(),
}));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: h.auditar }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: "u-1", email: "movil@ejemplo.test", user_metadata: {} }, loading: false }),
  useUsuarioIdOpcional: () => "u-1",
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ isAdmin: false, role: "staff", loading: false, permissions: h.permisos }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: h.superAdmin, loading: false }) }));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({ useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }) }));

import { AppSidebar } from "@/components/AppSidebar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TIPOS_USUARIO } from "@/components/usuarios/tiposUsuario";

const ver = (...secciones: string[]) => secciones.map((section_key) => ({ section_key, can_view: true, can_edit: false }));

function Donde() {
  const l = useLocation();
  return <output data-testid="donde">{l.pathname}</output>;
}

function rutas(inicial: string) {
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <Donde />
      <Routes>
        <Route path="/dashboard" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute requiredSection="usuarios"><p>Usuarios</p></ProtectedRoute>} />
        <Route path="/ayuda" element={<p>Ayuda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function menu() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
  return screen.getAllByRole("link").map((a) => a.getAttribute("href"));
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.permisos = [];
  h.superAdmin = false;
  h.auditar.mockClear();
});

it("hoy no hay tipos de usuario fijos", () => {
  expect(TIPOS_USUARIO).toEqual([]);
});

describe("con solo «Usuarios» (sin Dashboard)", () => {
  it("el menú enseña solo Usuarios (y Nueva petición y Ayuda, que son de todos)", () => {
    h.permisos = ver("usuarios");
    expect(menu()).toEqual(["/usuarios", "/peticiones", "/ayuda"]);
  });

  it("al entrar (/dashboard) va directo a /usuarios, sin apuntarlo como acceso denegado", async () => {
    h.permisos = ver("usuarios");
    rutas("/dashboard");
    expect(await screen.findByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/usuarios");
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(h.auditar).not.toHaveBeenCalled();
  });
});

describe("con solo Dashboard", () => {
  it("el menú no enseña Usuarios", () => {
    h.permisos = ver("dashboard");
    expect(menu()).toEqual(["/dashboard", "/peticiones", "/ayuda"]);
  });

  it("/usuarios lo rebota al Dashboard (y eso sí se apunta)", async () => {
    h.permisos = ver("dashboard");
    rutas("/usuarios");
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard");
    expect(h.auditar).toHaveBeenCalledWith("/usuarios");
  });
});

describe("sin ninguna sección", () => {
  it("el menú enseña solo lo que es de todos", () => {
    expect(menu()).toEqual(["/peticiones", "/ayuda"]);
  });

  it("al entrar va a Ayuda (siempre disponible), sin bucles ni acceso denegado", async () => {
    rutas("/dashboard");
    expect(await screen.findByText("Ayuda")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/ayuda");
    expect(h.auditar).not.toHaveBeenCalled();
  });
});

it("el super admin ve todo el menú sin permisos guardados", () => {
  h.superAdmin = true;
  expect(menu()).toEqual(["/dashboard", "/facturas", "/web", "/presupuestos", "/trafico-web", "/newsletter", "/rrss", "/usuarios", "/peticiones", "/ayuda"]);
});
