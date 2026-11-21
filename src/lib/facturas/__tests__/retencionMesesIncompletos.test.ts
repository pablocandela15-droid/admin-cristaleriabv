/**
 * Retención de IRPF y meses incompletos en la lista de Compras
 * (`documentos_lista`, migración 20261121100000_facturas) y sus textos.
 */
import { describe, expect, it } from "vitest";
import { decodificarLista, decodificarMesesIncompletos } from "../listaCompras";
import { etiquetaRetencion, notaRetencionGasto } from "../retencion";

const fila = (id: number, retencion: unknown = null) => [
  id, `F-${id}`, "GESTORIA VINALOPO SL", 3, "B1", "2026-10-01", 1100, 1122,
  "leido", null, true, "auto", 1, null, null, false, retencion,
];

describe("documentos_lista: retención y meses incompletos", () => {
  it("docs[i][16] es la retención; sin retención o 0, null", () => {
    const [con, sin, cero] = decodificarLista({ v: 1, proveedores: {}, docs: [fila(1, "209.00"), fila(2), fila(3, 0)] });
    expect(con.retencion_irpf).toBe(209);
    expect(sin.retencion_irpf).toBeNull();
    expect(cero.retencion_irpf).toBeNull();
  });

  it("meses_incompletos: objetos con mes o textos; lo que no sea AAAA-MM se ignora; sin el campo, vacío", () => {
    expect([...decodificarMesesIncompletos({ meses_incompletos: [{ mes: "2026-10", documentos: 65 }, "2026-11", { mes: "oct" }, null] })]).toEqual(["2026-10", "2026-11"]);
    expect(decodificarMesesIncompletos({ v: 1, docs: [] }).size).toBe(0);
    expect(decodificarMesesIncompletos(null).size).toBe(0);
  });
});

describe("retención: textos", () => {
  it("nota bajo «Gasto con IVA»: lo retenido y el coste real (gasto + retención); sin retención, nada", () => {
    expect(notaRetencionGasto(1122, 209)).toMatch(/^incluye −209,00\s€ de IRPF retenido; coste real 1\.331,00\s€$/);
    expect(notaRetencionGasto(1000, 0)).toBeNull();
    expect(notaRetencionGasto(1000, null)).toBeNull();
  });

  it("etiqueta con el porcentaje en español", () => {
    expect(etiquetaRetencion(19)).toBe("Retención IRPF (−19 %)");
    expect(etiquetaRetencion(15.5)).toBe("Retención IRPF (−15,5 %)");
    expect(etiquetaRetencion(null)).toBe("Retención IRPF");
  });
});
