/**
 * Visor del original en la ficha: imagen o PDF del bucket `facturas-originales`
 * (URL firmada), o nada. `supabase.storage` y `fetch` van simulados; la llamada
 * a Storage siempre va ligada (`.from(...).createSignedUrl(...)`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const base = vi.hoisted(() => ({ firmar: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: (bucket: string) => ({ createSignedUrl: (path: string, s: number) => base.firmar(bucket, path, s) }) },
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-de-prueba" } } }) },
  },
}));

// pdf.js no corre en jsdom: se simula el pintado de las hojas (ver pintarPdf.ts).
const pdf = vi.hoisted(() => ({ pintar: vi.fn() }));
vi.mock("@/lib/pintarPdf", () => ({ pintarHojasPdf: (...a: unknown[]) => pdf.pintar(...a) }));

import { OriginalIncrustado } from "../OriginalIncrustado";
import { nombrePdf } from "@/lib/facturas/nombrePdf";

type OpcionesPintar = { alHoja?: (url: string, i: number, total: number) => void };
const pintarDosHojas = async (_datos: ArrayBuffer, o: OpcionesPintar = {}) => {
  o.alHoja?.("blob:hoja-1", 0, 2);
  o.alHoja?.("blob:hoja-2", 1, 2);
  return { hojas: ["blob:hoja-1", "blob:hoja-2"], total: 2 };
};

function montar(props: { archivoPath: string | null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OriginalIncrustado {...props} titulo="Factura F-1" />
    </QueryClientProvider>,
  );
}

describe("OriginalIncrustado", () => {
  beforeEach(() => {
    base.firmar.mockReset();
    base.firmar.mockResolvedValue({ data: { signedUrl: "https://x.test/firmada" }, error: null });
    URL.createObjectURL = vi.fn(() => "blob:original");
    URL.revokeObjectURL = vi.fn();
    pdf.pintar.mockReset();
    pdf.pintar.mockImplementation(pintarDosHojas);
  });
  afterEach(() => vi.unstubAllGlobals());

  const servidor = (r: () => Response) => {
    const f = vi.fn(async (_u: string, _init?: RequestInit) => r());
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("PDF: tocar una hoja la abre a pantalla completa con zoom", async () => {
    servidor(() => new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    montar({ archivoPath: "originales/2026/10/1-f1.pdf" });
    fireEvent.click(await screen.findByRole("button", { name: "Ampliar la hoja 2 de 2" }));
    const visor = await screen.findByTestId("visor-original");
    expect(visor.querySelector("img")).toHaveAttribute("src", "blob:hoja-2");
  });

  it("PDF que pdf.js no sabe pintar: aviso con «Reintentar», que lo vuelve a intentar", async () => {
    servidor(() => new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    pdf.pintar.mockRejectedValueOnce(new Error("PDF roto"));
    montar({ archivoPath: "originales/2026/10/1-f1.pdf" });
    expect(await screen.findByText(/No se ha podido enseñar el PDF aquí/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByAltText("Factura F-1 · hoja 1")).toBeInTheDocument();
    expect(pdf.pintar).toHaveBeenCalledTimes(2);
  });

  it("imagen: pide la URL firmada del bucket y pinta la foto; al tocarla abre el visor", async () => {
    montar({ archivoPath: "facturas/1.jpeg" });
    const img = await screen.findByAltText("Factura F-1");
    expect(base.firmar).toHaveBeenCalledWith("facturas-originales", "facturas/1.jpeg", expect.any(Number));
    expect(img).toHaveAttribute("src", "https://x.test/firmada");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.getByText(/ctrl \+ rueda o pellizca para ampliar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pantalla completa/i }));
    expect(await screen.findByTestId("visor-original")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ver al 100/i }));
    expect(screen.getByRole("button", { name: /ajustar a la pantalla/i })).toBeInTheDocument();
  });

  it("imagen que falla: mensaje amable con Reintentar", async () => {
    montar({ archivoPath: "facturas/1.png" });
    fireEvent.error(await screen.findByAltText("Factura F-1"));
    expect(await screen.findByText(/no se ha podido cargar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(base.firmar).toHaveBeenCalledTimes(2));
  });

  it("pdf de Storage: descarga la URL firmada, enseña sus hojas y deja el enlace «Abrir PDF»", async () => {
    const f = servidor(() => new Response("%PDF-1.7", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const { container } = montar({ archivoPath: "facturas/1.pdf" });
    expect(await screen.findByRole("link", { name: /abrir pdf/i })).toHaveAttribute("href", "https://x.test/firmada");
    expect(await screen.findByAltText("Factura F-1 · hoja 1")).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith("https://x.test/firmada");
    expect(container.querySelector("object, embed, iframe")).toBeNull();
  });

  it("nombrePdf: nombre de fichero limpio para «Descargar PDF»", () => {
    expect(nombrePdf("Factura 12/3 · Vinalopó")).toBe("Factura 12 3 · Vinalopó.pdf");
    expect(nombrePdf("  ")).toBe("original.pdf");
  });

  it("sin original: estado vacío discreto y sin pedir nada", () => {
    montar({ archivoPath: null });
    expect(screen.getByTestId("sin-original")).toHaveTextContent("No se guardó el original de este documento.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(base.firmar).not.toHaveBeenCalled();
  });
});
