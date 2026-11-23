/**
 * Web (/web) según los permisos (ver lib/web/permisos.ts): una pestaña por sección («Web · Fotos», «Web · Tarifas»,
 * «Web · Contenido»). Con solo «Ver» la pestaña sale con «Solo lectura» y sin poder editar; con «Editar», sin la
 * etiqueta; el super admin las ve todas. Las pestañas de verdad tienen sus pruebas: aquí son marcadores.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/web/fotos/TabFotos", () => ({
  TabFotos: ({ puedeEditar }: { puedeEditar: boolean }) => <p data-testid="fotos">Fotos {puedeEditar ? "edita" : "lee"}</p>,
}));
vi.mock("@/components/web/tarifas/TabTarifas", () => ({
  TabTarifas: ({ puedeEditar }: { puedeEditar: boolean }) => <p data-testid="tarifas">Tarifas {puedeEditar ? "edita" : "lee"}</p>,
}));
vi.mock("@/components/web/contenido/TabContenido", () => ({
  TabContenido: ({ puedeEditar }: { puedeEditar: boolean }) => <p data-testid="contenido">Contenido {puedeEditar ? "edita" : "lee"}</p>,
}));

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
const h = vi.hoisted(() => ({ permisos: {} as Permisos, superAdmin: false }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "staff", isAdmin: false, permissions: [], loading: false }),
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({
    canAccess: h.superAdmin || !!h.permisos[seccion]?.[tipo],
    loading: false,
  }),
}));

import Web from "@/pages/Web";
import { pestanaWebPermitida, pestanasWeb } from "@/lib/web/permisos";

function montar(permisos: Permisos | "superAdmin", ruta = "/web") {
  h.superAdmin = permisos === "superAdmin";
  h.permisos = permisos === "superAdmin" ? {} : permisos;
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/web" element={<Web />} />
      </Routes>
    </MemoryRouter>,
  );
}
const pestanas = () => screen.getAllByRole("tab").map((t) => t.textContent?.trim());

afterEach(() => {
  h.permisos = {};
  h.superAdmin = false;
});

describe("Web según los permisos", () => {
  it("solo «Ver» en Tarifas: solo esa pestaña, en lectura y con «Solo lectura»", () => {
    montar({ web_tarifas: { view: true } });
    expect(pestanas()).toEqual(["Tarifas"]);
    expect(screen.getByTestId("tarifas")).toHaveTextContent("lee");
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-publicacion")).toHaveTextContent(/en un minuto/);
  });

  it("«Editar» en Fotos y «Ver» en Contenido: dos pestañas; la etiqueta solo donde no edita", () => {
    montar({ web_fotos: { view: true, edit: true }, web_contenido: { view: true } });
    expect(pestanas()).toEqual(["Fotos", "Contenido"]);
    expect(screen.getByTestId("fotos")).toHaveTextContent("edita");
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Contenido" }));
    expect(screen.getByTestId("contenido")).toHaveTextContent("lee");
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
  });

  it("un enlace a una pestaña que no puede ver lleva a la primera que sí", () => {
    montar({ web_contenido: { view: true, edit: true } }, "/web?tab=tarifas");
    expect(pestanas()).toEqual(["Contenido"]);
    expect(screen.getByTestId("contenido")).toHaveTextContent("edita");
  });

  it("el super admin las ve todas y edita", () => {
    montar("superAdmin", "/web?tab=tarifas");
    expect(pestanas()).toEqual(["Fotos", "Tarifas", "Contenido"]);
    expect(screen.getByTestId("tarifas")).toHaveTextContent("edita");
  });
});

describe("lib/web/permisos", () => {
  const nada = { ver: false, editar: false };
  it("editar implica ver; orden fijo; sin ninguna, ninguna", () => {
    expect(pestanasWeb({ fotos: nada, tarifas: { ver: false, editar: true }, contenido: { ver: true, editar: false } })).toEqual(["tarifas", "contenido"]);
    expect(pestanasWeb({ fotos: nada, tarifas: nada, contenido: nada })).toEqual([]);
    expect(pestanaWebPermitida("fotos", { fotos: nada, tarifas: nada, contenido: nada })).toBeNull();
  });
});
