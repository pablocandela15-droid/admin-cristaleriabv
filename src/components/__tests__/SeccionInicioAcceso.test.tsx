/**
 * Sección de inicio (11/11/2026) en las rutas: al entrar tras iniciar sesión (Auth lleva a /dashboard
 * con su marca) ProtectedRoute abre la sección elegida si puede verla; si no, lo de siempre. Pulsar
 * «Dashboard» en el menú (sin la marca) sigue abriendo el Dashboard.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ESTADO_TRAS_LOGIN } from "@/lib/seccionInicio";

const h = vi.hoisted(() => ({
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  seccionInicio: null as string | null,
}));
vi.mock("@/lib/audit-access", () => ({ auditDeniedAccess: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1", email: "equipo@ejemplo.test", user_metadata: {} }, loading: false }),
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ isAdmin: false, role: "staff", loading: false, verificado: true, permissions: h.permisos, seccionInicio: h.seccionInicio }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: false, loading: false }) }));
// Interruptores de Control del Panel (ProtectedRoute los mira desde el 14/11/2026): todo activado, sin red.
vi.mock("@/hooks/useAdminFeatureToggles", () => ({ useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }) }));

import { ProtectedRoute } from "@/components/ProtectedRoute";

const ver = (...secciones: string[]) => secciones.map((section_key) => ({ section_key, can_view: true, can_edit: false }));

function Donde() {
  return <output data-testid="donde">{useLocation().pathname}</output>;
}

function entrar(estado: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/dashboard", state: estado }]}>
      <Donde />
      <Routes>
        <Route path="/dashboard" element={<ProtectedRoute><p>Dashboard</p></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute><p>Página de Usuarios</p></ProtectedRoute>} />
        <Route path="/ayuda" element={<p>Página de Ayuda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.permisos = ver("dashboard", "usuarios");
  h.seccionInicio = "usuarios";
});

describe("al iniciar sesión", () => {
  it("abre la sección elegida", async () => {
    entrar(ESTADO_TRAS_LOGIN);
    expect(await screen.findByText("Página de Usuarios")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/usuarios");
  });

  it("también una que no pide permisos (Ayuda)", async () => {
    h.seccionInicio = "ayuda";
    entrar(ESTADO_TRAS_LOGIN);
    expect(await screen.findByText("Página de Ayuda")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/ayuda");
  });

  it("sin permiso para verla, el Dashboard de siempre", async () => {
    h.permisos = ver("dashboard");
    entrar(ESTADO_TRAS_LOGIN);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard");
  });

  it("con una clave que ya no existe (sección retirada), el Dashboard de siempre", async () => {
    h.seccionInicio = "reservas";
    entrar(ESTADO_TRAS_LOGIN);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard");
  });

  it("el «Dashboard» del menú no lleva a la sección de inicio", async () => {
    entrar(null);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard");
  });
});
