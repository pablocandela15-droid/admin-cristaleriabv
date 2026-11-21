import { describe, expect, it, vi } from "vitest";
import { archivarDesdeStorage, limpiarPendientesTrabajo, nombreSeguro, rutaOriginal } from "./archivo.ts";

describe("rutas de los originales en el bucket", () => {
  it("originales/AAAA/MM/{factura}-{nombre}, con el nombre limpio", () => {
    expect(rutaOriginal("2026-03-14", 42, "Factura Nº Ángel.pdf")).toBe("originales/2026/03/42-Factura_N_Angel.pdf");
    expect(nombreSeguro("")).toBe("documento");
  });

  it("sin fecha válida, el mes de hoy", () => {
    const hoy = new Date().toISOString().slice(0, 7).replace("-", "/");
    expect(rutaOriginal(null, 7, "foto.jpg")).toBe(`originales/${hoy}/7-foto.jpg`);
  });
});

/** Doble mínimo del bucket. */
function bucket(opciones: { moverFalla?: boolean; yaEsta?: boolean } = {}) {
  const movidos: [string, string][] = [];
  const borrados: string[][] = [];
  const storage = {
    from: () => ({
      move: async (a: string, b: string) => {
        movidos.push([a, b]);
        return { error: opciones.moverFalla ? { message: "no" } : null };
      },
      list: async (_c: string, o: { search: string }) => ({ data: opciones.yaEsta ? [{ name: o.search }] : [], error: null }),
      remove: async (r: string[]) => {
        borrados.push(r);
        return { error: null };
      },
    }),
  };
  return { storage, movidos, borrados };
}

describe("archivarDesdeStorage", () => {
  it("mueve el original de pendientes/ a su ruta definitiva", async () => {
    const b = bucket();
    const r = await archivarDesdeStorage({ storage: b.storage }, "pendientes/u/t/original.pdf", "factura.pdf", "2026-10-05", 9);
    expect(r).toEqual({ archivo_path: "originales/2026/10/9-factura.pdf", error: null });
    expect(b.movidos).toEqual([["pendientes/u/t/original.pdf", "originales/2026/10/9-factura.pdf"]]);
  });

  it("en un reintento, si el destino ya está, no es error", async () => {
    const b = bucket({ moverFalla: true, yaEsta: true });
    const r = await archivarDesdeStorage({ storage: b.storage }, "pendientes/u/t/o.pdf", "o.pdf", "2026-10-05", 9);
    expect(r.archivo_path).toBe("originales/2026/10/9-o.pdf");
  });

  it("si no se puede mover, el original sigue donde estaba y se apunta ahí", async () => {
    const b = bucket({ moverFalla: true });
    const r = await archivarDesdeStorage({ storage: b.storage }, "pendientes/u/t/o.pdf", "o.pdf", "2026-10-05", 9);
    expect(r.archivo_path).toBe("pendientes/u/t/o.pdf");
    expect(r.error).toMatch(/no se pudo mover/);
  });
});

describe("limpiarPendientesTrabajo", () => {
  const supabase = (factura: { id: number; archivo_path: string | null } | null, usadas: string[] = []) => {
    const b = bucket();
    const tablas: Record<string, unknown> = {
      ocr_trabajos: { data: { original_path: "pendientes/u/t/original.pdf" }, error: null },
      ocr_trabajo_paginas: { data: [{ storage_path: "pendientes/u/t/p1.jpg" }, { storage_path: "pendientes/u/t/p2.jpg" }], error: null },
    };
    const from = (t: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => (t === "facturas" ? Promise.resolve({ data: factura ? [factura] : [], error: null }) : q);
      q.in = () => Promise.resolve({ data: usadas.map((archivo_path) => ({ archivo_path })), error: null });
      q.maybeSingle = () => Promise.resolve(tablas[t]);
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(tablas[t]).then(ok);
      return q;
    };
    return { cliente: { from, storage: b.storage }, b };
  };

  it("borra las piezas y el original de pendientes/ que ninguna factura usa", async () => {
    const { cliente, b } = supabase({ id: 1, archivo_path: "originales/2026/10/1-f.pdf" }, ["pendientes/u/t/p2.jpg"]);
    expect(await limpiarPendientesTrabajo(cliente, "t")).toBe(2);
    expect(b.borrados).toEqual([["pendientes/u/t/original.pdf", "pendientes/u/t/p1.jpg"]]);
  });

  it("si la factura no tiene original, no borra nada (es lo único que queda)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente, b } = supabase({ id: 1, archivo_path: null });
    expect(await limpiarPendientesTrabajo(cliente, "t")).toBe(0);
    expect(b.borrados).toEqual([]);
    aviso.mockRestore();
  });
});
