/** Compras › Proveedores en acordeón: gasto filtrado, aria-expanded y despliegue. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Factura } from "@/hooks/useFacturas";
import { crearResolverProveedor, type Proveedor } from "@/lib/facturas/proveedores";
import { agregarPorProveedor } from "@/lib/facturas/resumenCompras";
import { ListaProveedores } from "../ListaProveedores";

const prov = (id: number, nombre: string, extra: Partial<Proveedor> = {}): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 9,
  total: 9999,
  ultima_fecha: "2026-01-01",
  variantes: [nombre],
  alias: [],
  cifs_extra: [],
  ...extra,
});

const doc = (id: number, extra: Partial<Factura>): Factura =>
  ({ id, numero_documento: `F-${id}`, proveedor: "Tecnovidrio", fecha: "2026-10-03", total: 100, productos: [], ...extra }) as Factura;

const PROVS = [prov(1, "Tecnovidrio"), prov(2, "Herrajes Petrer")];
const agregados = agregarPorProveedor(
  [doc(1, { total: 1234.5 }), doc(2, { total: 10, fecha: "2026-10-09" })],
  crearResolverProveedor(PROVS),
);

function pintar(extra: Partial<React.ComponentProps<typeof ListaProveedores>> = {}) {
  const onAlternar = vi.fn();
  render(
    <ListaProveedores
      proveedores={PROVS}
      agregados={agregados}
      abiertoId={null}
      cargando={false}
      hayFiltros={false}
      onAlternar={onAlternar}
      despliegue={(p) => <div data-testid="despliegue">{p.nombre}</div>}
      {...extra}
    />,
  );
  return onAlternar;
}

describe("ListaProveedores", () => {
  it("cada fila: documentos, último y gasto del filtro (no el de la RPC)", () => {
    pintar();
    const tecnovidrio = screen.getByRole("button", { name: /^Tecnovidrio/ });
    expect(tecnovidrio).toHaveTextContent("2 documentos · último 09/10/26");
    expect(tecnovidrio).toHaveTextContent(/1\.244,50\s€/);
    const hielos = screen.getByRole("button", { name: /^Herrajes Petrer/ });
    expect(hielos).toHaveTextContent("0 documentos · último 01/01/26");
    expect(hielos).toHaveTextContent(/0,00\s€/);
  });

  it("acordeón: aria-expanded, el despliegue solo del abierto y cabecera de nivel 3", () => {
    const onAlternar = pintar({ abiertoId: 1 });
    expect(screen.getByRole("button", { name: /^Tecnovidrio/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Herrajes Petrer/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("despliegue")).toHaveLength(1);
    expect(within(screen.getByRole("heading", { level: 3, name: /^Tecnovidrio/ })).getByRole("button")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Herrajes Petrer/ }));
    expect(onAlternar).toHaveBeenCalledWith(2);
  });

  it("con un periodo elegido no tira de la última fecha de la RPC", () => {
    pintar({ hayFiltros: true });
    expect(screen.getByRole("button", { name: /^Herrajes Petrer/ })).not.toHaveTextContent("último");
  });

  it("vacío con filtros y sin proveedores todavía", () => {
    const { unmount } = render(
      <ListaProveedores proveedores={[]} agregados={new Map()} abiertoId={null} cargando={false} hayFiltros onAlternar={vi.fn()} despliegue={() => null} />,
    );
    expect(screen.getByText("Ningún proveedor coincide")).toBeInTheDocument();
    unmount();
    render(<ListaProveedores proveedores={[]} agregados={new Map()} abiertoId={null} cargando={false} hayFiltros={false} onAlternar={vi.fn()} despliegue={() => null} />);
    expect(screen.getByText("No hay proveedores todavía")).toBeInTheDocument();
  });
});
