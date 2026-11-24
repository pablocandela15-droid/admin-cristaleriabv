/** Ficha de documento › abonos («Abono X», importe con «−»), regalado/descuentos y líneas «Regalo». */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(async () => ({ data: null, error: null })), storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: false, loading: false }) }));
vi.mock("@/components/facturas/CosteLecturaDocumento", () => ({ CosteLecturaFactura: () => null }));
vi.mock("@/components/facturas/shared/OriginalIncrustado", () => ({ OriginalIncrustado: () => null }));
vi.mock("@/components/facturas/shared/BotonOriginal", () => ({ BotonOriginal: () => null }));

import { FichaDocumento } from "../FichaDocumento";
import type { Factura } from "@/hooks/useFacturas";

const base = {
  id: 42, numero_documento: "F-1", proveedor: "P", cif: null, fecha: "2026-09-01",
  subtotal: 100, iva: 10, total: 110, observaciones: null, archivo_path: null,
  productos: [], verificada: true, alertas: [],
} as unknown as Factura;

function montar(doc: Factura) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FichaDocumento
        doc={doc}
        avisos={[]}
        onEditar={vi.fn()}
        onAbrirProducto={vi.fn()}
        onAbrirProveedor={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("FichaDocumento › abonos y regalado", () => {
  afterEach(cleanup);

  it("un abono se titula «Abono» y su total lleva «−»", () => {
    montar({ ...base, numero_documento: "AB-3", subtotal: -20, iva: -2, total: -1222 });
    expect(screen.getByRole("heading", { name: "Abono AB-3" })).toBeInTheDocument();
    expect(screen.getByLabelText("Importes")).toHaveTextContent(/Total\s−1\.222,00/);
  });

  it("regalado / descuentos junto a los importes, con «estimado» si alguna línea lo es, y «Regalo» en la línea", () => {
    montar({
      ...base,
      productos: [
        { id: 1, producto_nombre: "Escuadra regalada", precio: 0, cantidad: 2, precio_unitario: 0, proveedor: null, importe_bruto: 4, importe_bruto_estimado: true },
        { id: 2, producto_nombre: "Silicona neutra", precio: 90, cantidad: 1, precio_unitario: 90, proveedor: null, importe_bruto: 100, descuento_pct: 10 },
      ],
    });
    expect(screen.getByTestId("regalado-documento")).toHaveTextContent(/Regalado \/ descuentos 14,00\s€ sin IVA · estimado/);
    const lineas = screen.getByRole("region", { name: "Líneas del documento" });
    expect(within(lineas).getAllByText("Regalo")).toHaveLength(1);
    // La explicación del valor sin descuento se abre con un toque (no va en `title`).
    expect(within(lineas).getByText(/Valor sin descuento 4,00\s€ \(estimado\)/)).toBeInTheDocument();
    fireEvent.click(within(lineas).getAllByRole("button", { name: "Qué es el valor sin descuento" })[0]);
    expect(screen.getByText(/precio al que este proveedor cobró el artículo/)).toBeInTheDocument();
  });

  it("sin nada regalado no sale la cifra", () => {
    montar(base);
    expect(screen.queryByTestId("regalado-documento")).toBeNull();
  });
});
