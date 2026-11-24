/**
 * Facturas › Productos (pantalla). Con el doble de Supabase de
 * dobleSupabaseProductos.ts (datos de la carga inicial del 07/10/2026).
 *
 * Cubre: lista con categoría, compras, cantidades y gasto; totales por
 * categoría madre (Vidrio = Templado + Laminado); buscar y filtrar con las
 * tarjetas; seleccionar dos y fusionar (queda el de más gasto); «Sin
 * clasificar» enseña las líneas sin producto; sin permiso de edición no hay
 * casillas ni botones; sin la migración, un aviso claro en vez de la lista.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseProductos");
  return { supabase: m.doble.supabase };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const permiso = vi.hoisted(() => ({ editar: true }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: permiso.editar, loading: false }),
}));

import { doble, cargarDatos } from "./dobleSupabaseProductos";
import { TabProductos } from "../productos/TabProductos";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <div style={{ height: 800 }}>
        <TabProductos />
      </div>
    </QueryClientProvider>,
  );
}

const lista = () => screen.getByTestId("lista-productos");
const nombresVisibles = () =>
  within(lista())
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("button span span")?.textContent)
    .filter(Boolean);

beforeEach(() => {
  doble.reiniciar();
  permiso.editar = true;
  cargarDatos();
});

describe("TabProductos", () => {
  it("lista los productos con categoría y los totales por categoría madre", async () => {
    montar();
    expect(await screen.findByText("Planilux 8 mm")).toBeInTheDocument();
    expect(nombresVisibles()).toEqual([
      "Planilux 8 mm", "Bisagra 90 grados", "Stadip 3+3 incoloro", "Planilux 8 mm Magnum", "Portes",
    ]);
    // Ruta de categoría bajo el nombre.
    expect(within(lista()).getAllByText(/Vidrio › Templado/).length).toBe(2);
    // Tarjetas: Vidrio suma Templado + Laminado; «Sin clasificar» con su nº de líneas.
    const tarjetas = screen.getByRole("toolbar", { name: "Gasto por categoría" });
    const vidrio = within(tarjetas).getByRole("button", { name: /Vidrio/ });
    expect(vidrio.textContent?.replace(/\s/g, " ")).toMatch(/3\.?483,20/);
    expect(within(tarjetas).getByRole("button", { name: /Sin clasificar/ }).textContent).toMatch(/1 línea/);
    // Botón de la IA con las líneas pendientes.
    expect(screen.getByRole("button", { name: "Clasificar 1 con IA" })).toBeInTheDocument();
  });

  it("buscar y filtrar por tarjeta de categoría", async () => {
    montar();
    await screen.findByText("Planilux 8 mm");
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "planilúx" } });
    expect(nombresVisibles()).toEqual(["Planilux 8 mm", "Planilux 8 mm Magnum"]);
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Gasto por categoría" })).getByRole("button", { name: /Herrajes/ }));
    expect(nombresVisibles()).toEqual(["Bisagra 90 grados"]);
  });

  it("seleccionar dos y fusionar: queda el de más gasto", async () => {
    doble.fijarRpc("productos_fusionar", () => ({ data: { lineas_movidas: 1, productos_borrados: 1 }, error: null }));
    montar();
    await screen.findByText("Planilux 8 mm");
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar Planilux 8 mm Magnum" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar Planilux 8 mm" }));
    fireEvent.click(screen.getByRole("button", { name: /Fusionar/ }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/Queda «Planilux 8 mm»/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Fusionar/ }));
    await waitFor(() =>
      expect(doble.rpc).toHaveBeenCalledWith("productos_fusionar", { p_origen_ids: [11], p_destino_id: 10 }),
    );
  });

  it("«Sin clasificar» enseña las líneas sin producto", async () => {
    montar();
    await screen.findByText("Planilux 8 mm");
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Gasto por categoría" })).getByRole("button", { name: /Sin clasificar/ }));
    expect(await screen.findByText("Perfil U 20x20")).toBeInTheDocument();
    expect(doble.filtros).toContainEqual({ tabla: "productos_factura", metodo: "is", args: ["producto_id", null] });
    expect(screen.getByRole("button", { name: "Clasificar con IA ahora" })).toBeInTheDocument();
  });

  it("abrir un producto enseña su ficha", async () => {
    montar();
    fireEvent.click(await screen.findByText("Stadip 3+3 incoloro"));
    const ficha = await screen.findByRole("dialog");
    expect(within(ficha).getByText(/Vidrio › Laminado · 2 compra/)).toBeInTheDocument();
    expect(within(ficha).getByLabelText("Nombre")).toHaveValue("Stadip 3+3 incoloro");
  });

  it("sin permiso de edición: ni casillas ni botones de cambio", async () => {
    permiso.editar = false;
    montar();
    await screen.findByText("Planilux 8 mm");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Categorías/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /con IA/ })).not.toBeInTheDocument();
  });


});
