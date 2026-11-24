/**
 * Facturas según los permisos (ver lib/facturas/permisos.ts):
 *   · solo «Ver»       → Compras en lectura, sin Cargar y con «Solo lectura».
 *   · solo Subida      → solo Cargar (los enlaces a Compras llevan a ella), sin el
 *                        coste de lectura ni el contador de Compras.
 *   · Subida + «Ver»   → Compras en lectura + Cargar.
 *   · «Editar»         → todo.
 *   · super admin      → todo.
 * Las pestañas de verdad tienen sus tests: aquí son marcadores.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/facturas/compras/TabCompras", () => ({ TabCompras: () => <p data-testid="compras">Compras</p> }));
vi.mock("@/components/facturas/SubidaFacturas", () => ({ SubidaFacturas: () => <p data-testid="subida">Subida</p> }));
vi.mock("@/components/facturas/CosteLecturaMes", () => ({ CosteLecturaMes: () => <span data-testid="coste-lectura">coste</span> }));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));
const contador = vi.hoisted(() => ({ opciones: [] as unknown[] }));
vi.mock("@/hooks/useContadorDocumentos", () => ({
  useContadorDocumentos: (o?: unknown) => {
    contador.opciones.push(o);
    return { data: 3 };
  },
}));

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
const h = vi.hoisted(() => ({ permisos: {} as Permisos, superAdmin: false }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "staff", isAdmin: false, permissions: [], loading: false }),
  // Como el de verdad: el super admin, todo; si no, lo marcado.
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({
    canAccess: h.superAdmin || !!h.permisos[seccion]?.[tipo],
    loading: false,
  }),
}));

import Facturas from "@/pages/Facturas";

const PERFILES: Record<string, Permisos> = {
  soloVer: { facturas: { view: true } },
  soloSubida: { facturas_subida: { view: true } },
  subidaVer: { facturas: { view: true }, facturas_subida: { view: true } },
  editar: { facturas: { view: true, edit: true } },
};

const ubicacion = { actual: "" };
function Ubicacion() {
  const l = useLocation();
  ubicacion.actual = `${l.pathname}${l.search}`;
  return null;
}

function montar(perfil: keyof typeof PERFILES | "superAdmin", ruta = "/facturas") {
  h.superAdmin = perfil === "superAdmin";
  h.permisos = perfil === "superAdmin" ? {} : PERFILES[perfil];
  contador.opciones = [];
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="/facturas"
          element={
            <>
              <Facturas />
              <Ubicacion />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const pestanas = () => screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+/g, "").trim());

afterEach(() => {
  h.permisos = {};
  h.superAdmin = false;
});

describe("Facturas · permisos", () => {
  it("solo «Ver»: Compras en lectura, sin Cargar", () => {
    montar("soloVer");
    expect(pestanas()).toEqual(["Compras"]);
    expect(screen.getByTestId("compras")).toBeInTheDocument();
    expect(screen.queryByTestId("subida")).toBeNull();
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
  });

  it("solo Subida: solo Cargar; un enlace a Compras lleva a Cargar (sin pedir el contador)", () => {
    montar("soloSubida", "/facturas?tab=compras&doc=7");
    expect(pestanas()).toEqual(["Cargar"]);
    expect(screen.getByTestId("subida")).toBeInTheDocument();
    expect(screen.queryByTestId("compras")).toBeNull();
    expect(screen.queryByTestId("coste-lectura")).toBeNull();
    expect(ubicacion.actual).toBe("/facturas?tab=cargar");
    expect(contador.opciones.every((o) => (o as { enabled?: boolean }).enabled === false)).toBe(true);
    expect(screen.queryByText("Solo lectura")).toBeNull();
  });

  it("Subida + «Ver»: las dos pestañas; en Cargar no sale «Solo lectura» y sí el coste de lectura", () => {
    montar("subidaVer", "/facturas?tab=cargar");
    expect(pestanas()).toEqual(["Compras", "Cargar"]);
    expect(screen.getByTestId("subida")).toBeInTheDocument();
    expect(screen.getByTestId("coste-lectura")).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura")).toBeNull();
  });

  it("«Editar» y super admin: todo, sin «Solo lectura»", () => {
    for (const perfil of ["editar", "superAdmin"] as const) {
      const { unmount } = montar(perfil);
      expect(pestanas()).toEqual(["Compras", "Cargar"]);
      expect(screen.queryByText("Solo lectura")).toBeNull();
      unmount();
    }
  });
});
