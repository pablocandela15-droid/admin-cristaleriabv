/**
 * Presupuestos (/presupuestos) según los permisos de la sección «presupuestos»: con solo «Ver», la lista y el
 * presupuesto en lectura («Solo lectura», sin crear, convertir, cambiar de estado ni enviar; el PDF sí); con
 * «Editar», todo. `?id=` abre un presupuesto (el enlace del aviso de la campana) y «Presupuestos» vuelve a la lista.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { PresupuestoConLineas } from "@/lib/presupuestos/tipos";
import { crearMutaciones, deLista, lineaDePrueba, presupuestoDePrueba, type Mutaciones } from "@/components/presupuestos/__tests__/dobles";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
const h = vi.hoisted(() => ({
  permisos: {} as Permisos,
  superAdmin: false,
  mut: null as unknown as Mutaciones,
  detalle: null as unknown as PresupuestoConLineas,
}));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "staff", isAdmin: false, permissions: [], loading: false }),
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({ canAccess: h.superAdmin || !!h.permisos[seccion]?.[tipo], loading: false }),
}));
vi.mock("@/hooks/usePresupuestos", () => ({
  usePresupuestos: () => ({
    data: [deLista(h.detalle, { precioWeb: 560 }), deLista(presupuestoDePrueba({ id: "p2", numero: "P-2026-0002", cliente_nombre: "Ana López" }))],
    isLoading: false,
    error: null,
    refetch: () => undefined,
  }),
  usePresupuesto: () => ({ data: h.detalle, isLoading: false, error: null, refetch: () => undefined }),
  useCrearPresupuesto: () => h.mut.crear,
  useGuardarPresupuesto: () => h.mut.guardar,
  useCambiarEstado: () => h.mut.estado,
  useBorrarPresupuesto: () => h.mut.borrar,
  useAnadirLinea: () => h.mut.anadir,
  useCambiarLinea: () => h.mut.cambiarLinea,
  useBorrarLinea: () => h.mut.borrarLinea,
  useOrdenarLineas: () => h.mut.ordenar,
}));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));
vi.mock("@/hooks/useWebTarifas", () => ({ useTarifasWeb: () => ({ data: undefined, isLoading: false, error: null }) }));
vi.mock("@/hooks/useWebContenido", () => ({ useContenidoWeb: () => ({ data: undefined, isLoading: false, error: null }) }));

import Presupuestos from "@/pages/Presupuestos";

function Direccion() {
  const l = useLocation();
  return <output data-testid="direccion">{l.pathname + l.search}</output>;
}
function montar(permisos: Permisos | "superAdmin", ruta = "/presupuestos") {
  h.superAdmin = permisos === "superAdmin";
  h.permisos = permisos === "superAdmin" ? {} : permisos;
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/presupuestos" element={<><Presupuestos /><Direccion /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.mut = crearMutaciones();
  h.detalle = {
    ...presupuestoDePrueba({ estado: "solicitud", origen: "web", notas_cliente: "Llamar por la tarde" }),
    lineas: [lineaDePrueba({ categoria: "mamparas", valores: { ancho: 120 }, descripcion: "Solicitud web · Mampara a medida", precio_unitario: 560, importe: 560, precio_calculado: 560 })],
  };
});
afterEach(() => {
  h.permisos = {};
  h.superAdmin = false;
});

describe("Presupuestos según los permisos", () => {
  it("solo «Ver»: la lista en lectura", () => {
    montar({ presupuestos: { view: true } });
    expect(screen.getByRole("heading", { level: 1, name: "Presupuestos" })).toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nuevo presupuesto/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Convertir en borrador" })).toBeNull();
    expect(screen.getAllByTestId("presupuesto")).toHaveLength(2);
  });

  it("solo «Ver» con ?id=: el presupuesto en lectura, con el PDF", () => {
    montar({ presupuestos: { view: true } }, "/presupuestos?id=p1");
    expect(screen.getByRole("heading", { level: 1, name: "P-2026-0001" })).toBeInTheDocument();
    expect(screen.getByTestId("bloque-solicitud")).toHaveTextContent("Llamar por la tarde");
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convertir en borrador" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Añadir desde calculadora/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enviar por/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeInTheDocument();
  });

  it("«Editar»: crear, convertir la solicitud y añadir líneas; «Presupuestos» vuelve a la lista", () => {
    montar({ presupuestos: { view: true, edit: true } }, "/presupuestos?id=p1&estado=solicitud");
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Convertir en borrador" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Añadir desde calculadora/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Presupuestos$/ }));
    expect(screen.getByTestId("direccion")).toHaveTextContent("/presupuestos?estado=solicitud");
    expect(screen.getByRole("button", { name: /Nuevo presupuesto/ })).toBeInTheDocument();
    // La lista sigue filtrada (solo la solicitud); abrir uno lleva su id a la dirección.
    expect(screen.queryByText("Ana López")).toBeNull();
    fireEvent.click(screen.getByText("Juan Pérez"));
    expect(screen.getByTestId("direccion")).toHaveTextContent("/presupuestos?estado=solicitud&id=p1");
  });

  it("el filtro y la búsqueda van en la dirección", () => {
    montar("superAdmin", "/presupuestos?estado=solicitud");
    expect(screen.getByRole("tab", { name: /Solicitudes/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("presupuesto")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar por número, cliente o teléfono"), { target: { value: "juan" } });
    expect(screen.getByTestId("direccion")).toHaveTextContent("/presupuestos?estado=solicitud&q=juan");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Todos" }));
    expect(screen.getByTestId("direccion")).toHaveTextContent("/presupuestos?q=juan");
  });
});
