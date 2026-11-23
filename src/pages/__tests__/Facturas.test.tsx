/**
 * Facturas: pestañas Compras | Cargar. Los enlaces (`?tab=productos`,
 * `?tab=documentos`, `?doc=`, `?mes=`, `?prov=`) llevan a Compras en su modo;
 * `?tab=cargar`, a Cargar. Las pestañas de verdad tienen sus propios tests:
 * aquí se sustituyen por marcadores y se comprueba lo que reciben.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/facturas/compras/TabCompras", () => ({
  TabCompras: ({ modoPedido }: { modoPedido?: { modo: string; doc?: number; mes?: string; prov?: number } }) => (
    <p data-testid="compras">
      Compras · modo pedido: {modoPedido?.modo ?? "ninguno"}
      {modoPedido?.doc ? ` · doc ${modoPedido.doc}` : ""}
      {modoPedido?.mes ? ` · mes ${modoPedido.mes}` : ""}
      {modoPedido?.prov ? ` · prov ${modoPedido.prov}` : ""}
    </p>
  ),
}));
vi.mock("@/components/facturas/SubidaFacturas", () => ({ SubidaFacturas: () => <p>Contenido de la subida</p> }));
vi.mock("@/components/facturas/CosteLecturaMes", () => ({ CosteLecturaMes: () => <span data-testid="coste-lectura">coste</span> }));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));
// El contador de la pestaña Compras es un `count` de cabeceras (no descarga la lista).
vi.mock("@/hooks/useContadorDocumentos", () => ({ useContadorDocumentos: () => ({ data: 3 }) }));
// Con «Editar» en Facturas; los perfiles de permisos, en Facturas.permisos.test.tsx.
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: null, isAdmin: false, permissions: [], loading: false }),
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import Facturas from "@/pages/Facturas";

const montar = (ruta = "/facturas") =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Facturas />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("Facturas", () => {
  it("entra en Compras; dos pestañas, con el nº de documentos en Compras", () => {
    montar();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+/g, "").trim())).toEqual(["Compras", "Cargar"]);
    expect(screen.getByRole("tab", { name: /Compras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Compras/ })).toHaveTextContent("3");
    expect(screen.getByTestId("compras")).toHaveTextContent("modo pedido: ninguno");
    expect(screen.queryByText(/Análisis|Márgenes/)).toBeNull();
  });

  it("`?tab=cargar` abre Cargar con el coste de lectura; al tocar Compras, vuelve", () => {
    montar("/facturas?tab=cargar");
    expect(screen.getByText("Contenido de la subida")).toBeInTheDocument();
    expect(screen.getByTestId("coste-lectura")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Compras/ }));
    expect(screen.getByRole("tab", { name: /Compras/ })).toHaveAttribute("aria-selected", "true");
  });

  it("los enlaces abren Compras en su modo (campana, «Ver» de Cargar, un mes o un proveedor)", () => {
    const casos: [string, string][] = [
      ["/facturas?tab=productos", "modo pedido: productos"],
      ["/facturas?tab=compras&modo=documentos&doc=7", "modo pedido: documentos · doc 7"],
      ["/facturas?mes=2026-07", "modo pedido: documentos · mes 2026-07"],
      ["/facturas?prov=3", "modo pedido: proveedores · prov 3"],
      ["/facturas?tab=documentos", "modo pedido: ninguno"],
    ];
    for (const [ruta, texto] of casos) {
      const { unmount } = montar(ruta);
      expect(screen.getByTestId("compras")).toHaveTextContent(texto);
      unmount();
    }
  });
});
