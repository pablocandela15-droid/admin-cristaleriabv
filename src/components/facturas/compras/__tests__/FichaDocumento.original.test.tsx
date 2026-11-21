/**
 * Ficha de documento › el original: se ve AL LADO de los datos.
 *   · Ancha (≥ 880 px) y con original en Storage: dos columnas,
 *     datos a la izquierda con su scroll y el visor a la derecha a todo el alto.
 *   · Estrecha: el visor va debajo de los importes.
 *   · Sin original: nada de columna vacía; un aviso discreto.
 *   · Un solo sitio: sin botón «Original» en la cabecera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const firmar = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: { from: (bucket: string) => ({ createSignedUrl: (path: string, s: number) => firmar(bucket, path, s) }) },
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-de-prueba" } } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useAuth", () => ({ useUsuarioIdOpcional: () => "u-1" }));
vi.mock("@/components/facturas/CosteLecturaDocumento", () => ({ CosteLecturaFactura: () => null }));
// El visor del PDF (pdf.js) se prueba en OriginalIncrustado: aquí solo importa dónde va.
vi.mock("@/components/visores/VisorPdf", () => ({ VisorPdf: () => <div data-testid="visor-pdf" /> }));

import { FichaDocumento } from "../FichaDocumento";
import type { Factura } from "@/hooks/useFacturas";

const FOTO = "originales/2026/10/9-f9.jpg";
const base = {
  id: 9, numero_documento: "F-9", proveedor: "P", cif: null, fecha: "2026-10-01",
  subtotal: 10, iva: 1, total: 11, observaciones: null, archivo_path: null,
  productos: [], verificada: true, alertas: [],
} as unknown as Factura;

let ancho = 1200;
beforeEach(() => {
  ancho = 1200;
  firmar.mockReset();
  firmar.mockImplementation(async (_b: string, path: string) => ({
    data: { signedUrl: path.endsWith(".pdf") ? "https://x.test/firmada.pdf" : "https://x.test/firmada" },
    error: null,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: ancho, height: 800, top: 0, left: 0, right: ancho, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("FichaDocumento › visor del original", () => {
  it("ancha con original: dos columnas, datos con su scroll y el original (URL firmada) a la derecha", async () => {
    const { container } = montar({ ...base, archivo_path: FOTO });
    expect(container.querySelector('[data-vista="lateral"]')).not.toBeNull();
    const detalles = screen.getByTestId("ficha-detalles");
    expect(detalles.className).toMatch(/overflow-y-auto/);
    const visor = screen.getByRole("region", { name: "Documento original" });
    expect(detalles).not.toContainElement(visor);
    expect(await screen.findByAltText("Factura F-9")).toHaveAttribute("src", "https://x.test/firmada");
    expect(firmar).toHaveBeenCalledWith("facturas-originales", FOTO, expect.any(Number));
  });

  it("un solo sitio para el original: ni botón en la cabecera ni otra fila", async () => {
    montar({ ...base, archivo_path: FOTO });
    expect(screen.queryByRole("button", { name: /^ver original/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Documento original" })).toHaveLength(1);
    expect(await screen.findAllByRole("link", { name: /abrir/i })).toHaveLength(1);
  });

  it("ancha con copia en Storage: también al lado", async () => {
    const { container } = montar({ ...base, archivo_path: "originales/2026/10/9-f9.pdf" });
    expect(container.querySelector('[data-vista="lateral"]')).not.toBeNull();
    expect(await screen.findByRole("link", { name: /abrir pdf/i })).toBeInTheDocument();
  });

  it("estrecha: el visor va debajo de los importes, dentro de la columna única", () => {
    ancho = 600;
    const { container } = montar({ ...base, archivo_path: FOTO });
    expect(container.querySelector('[data-vista="apilada"]')).not.toBeNull();
    const importes = screen.getByLabelText("Importes");
    const visor = screen.getByRole("region", { name: "Documento original" });
    expect(importes.compareDocumentPosition(visor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin original: sin columna vacía, solo un aviso discreto", () => {
    const { container } = montar(base);
    expect(container.querySelector('[data-vista="apilada"]')).not.toBeNull();
    expect(screen.getByTestId("sin-original")).toHaveTextContent("No se guardó el original de este documento.");
    expect(screen.queryByRole("region", { name: "Documento original" })).not.toBeInTheDocument();
  });
});
