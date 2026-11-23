import { beforeEach, describe, expect, it } from "vitest";
import type { Factura } from "@/hooks/useFacturas";
import {
  agruparDocumentos,
  claveEstadoMes,
  claveMes,
  etiquetaMes,
  guardarPlegado,
  importeQueSuma,
  leerPlegado,
  MESES_ABIERTOS_BUSCANDO,
  mesAbierto,
  mesesRecientes,
} from "../agrupacionDocumentos";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  numero_documento: `D-${id}`,
  proveedor: "Vidrios del Vinalopó",
  cif: null,
  fecha: "2026-10-03",
  subtotal: null,
  iva: null,
  total: 100,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: true,
  ...extra,
});

describe("fechas y etiquetas", () => {
  it("saca el mes de la fecha y lo llama en español", () => {
    expect(claveMes("2026-10-03")).toBe("2026-10");
    expect(claveMes("2026-10-03T22:00:00+00:00")).toBe("2026-10");
    expect(claveMes("")).toBe("sin-fecha");
    expect(claveMes(null)).toBe("sin-fecha");
    expect(claveMes("2026-13-01")).toBe("sin-fecha");
    expect(etiquetaMes("2026-10")).toBe("Octubre 2026");
    expect(etiquetaMes("2026-01")).toBe("Enero 2026");
    expect(etiquetaMes("sin-fecha")).toBe("Sin fecha");
  });

  it("mes actual y anterior, también al cruzar de año", () => {
    expect(mesesRecientes(new Date(2026, 9, 10))).toEqual(["2026-10", "2026-09"]);
    expect(mesesRecientes(new Date(2027, 0, 5))).toEqual(["2027-01", "2026-12"]);
  });
});

describe("agruparDocumentos", () => {
  it("meses del más reciente al más antiguo y «Sin fecha» al final", () => {
    const g = agruparDocumentos([
      doc(1, { fecha: "2026-08-20" }),
      doc(2, { fecha: "" }),
      doc(3, { fecha: "2026-10-01" }),
      doc(4, { fecha: "2025-12-31" }),
      doc(5, { fecha: "2026-09-15" }),
    ]);
    expect(g.map((m) => m.clave)).toEqual(["2026-10", "2026-09", "2026-08", "2025-12", "sin-fecha"]);
    expect(g.at(-1)?.etiqueta).toBe("Sin fecha");
  });

  it("dentro del mes, del documento más reciente al más antiguo (sin subgrupos por proveedor)", () => {
    const g = agruparDocumentos([
      doc(1, { fecha: "2026-10-01", proveedor: "Vidrios del Vinalopó" }),
      doc(2, { fecha: "2026-10-09", proveedor: "Aluminios Elda" }),
      doc(3, { fecha: "2026-10-09", proveedor: null }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].documentos.map((d) => d.id)).toEqual([3, 2, 1]);
  });

  it("total = suma de las facturas del mes; una sin importe cuenta como documento pero no suma", () => {
    const g = agruparDocumentos([doc(1, { total: 1000.5 }), doc(2, { total: 120.25 }), doc(3, { total: null })]);
    expect(g[0].documentos).toHaveLength(3);
    expect(g[0].total).toBe(1120.75);
    expect(g[0].abonos).toBe(0);
  });

  it("los abonos restan del total del mes y se cuentan aparte", () => {
    const g = agruparDocumentos([doc(1, { total: 500 }), doc(2, { total: -120.4 }), doc(3, { total: -9.6 })]);
    expect(g[0].total).toBe(370);
    expect(g[0].abonos).toBe(-130);
  });

  it("no arrastra errores de coma flotante", () => {
    const g = agruparDocumentos([doc(1, { total: 0.1 }), doc(2, { total: 0.2 }), doc(3, { total: 10 })]);
    expect(g[0].total).toBe(10.3);
  });

  it("lista vacía = sin grupos", () => {
    expect(agruparDocumentos([])).toEqual([]);
  });

  it("importeQueSuma: el total (0 sin importe; los abonos, en negativo)", () => {
    expect(importeQueSuma({ total: 50 })).toBe(50);
    expect(importeQueSuma({ total: null })).toBe(0);
    expect(importeQueSuma({ total: -12.5 })).toBe(-12.5);
  });
});

describe("qué grupos están abiertos", () => {
  const hoy = new Date(2026, 9, 10);

  it("por defecto (y con cualquier chip), solo el mes actual y el anterior", () => {
    expect(mesAbierto("2026-10", {}, hoy)).toBe(true);
    expect(mesAbierto("2026-09", {}, hoy)).toBe(true);
    expect(mesAbierto("2026-08", {}, hoy)).toBe(false);
    expect(mesAbierto("sin-fecha", {}, hoy)).toBe(false);
    expect(mesAbierto("2026-03", {}, hoy, null)).toBe(false);
  });

  it("con texto buscado se abren solo los 3 meses con resultados más recientes", () => {
    expect(MESES_ABIERTOS_BUSCANDO).toBe(3);
    expect(mesAbierto("2025-01", {}, hoy, 0)).toBe(true);
    expect(mesAbierto("2024-12", {}, hoy, 2)).toBe(true);
    expect(mesAbierto("2024-11", {}, hoy, 3)).toBe(false);
    // Aunque sea el mes de hoy: si no está entre los 3 primeros con resultados, plegado.
    expect(mesAbierto("2026-10", {}, hoy, 5)).toBe(false);
  });

  it("lo que decidió el usuario manda, con o sin búsqueda", () => {
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: false }, hoy, 0)).toBe(false);
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: true }, hoy, 7)).toBe(true);
    expect(mesAbierto("2026-10", { [claveEstadoMes("2026-10")]: false }, hoy)).toBe(false);
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: true }, hoy)).toBe(true);
  });

  it("si la lista tiene un solo mes, sale abierto (salvo que se pliegue a mano)", () => {
    expect(mesAbierto("2025-03", {}, hoy, null, 1)).toBe(true);
    expect(mesAbierto("2025-03", {}, hoy, 4, 1)).toBe(true);
    expect(mesAbierto("2025-03", { [claveEstadoMes("2025-03")]: false }, hoy, null, 1)).toBe(false);
    expect(mesAbierto("2025-03", {}, hoy, null, 2)).toBe(false);
  });
});

describe("estado recordado en localStorage", () => {
  beforeEach(() => window.localStorage.clear());

  it("guarda y vuelve a leer", () => {
    guardarPlegado({ "m:2026-03": true, "m:2026-10": false });
    expect(leerPlegado()).toEqual({ "m:2026-03": true, "m:2026-10": false });
  });

  it("ignora contenido roto o de otro tipo", () => {
    window.localStorage.setItem("compras.documentos.plegado", "{no es json");
    expect(leerPlegado()).toEqual({});
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify(["a"]));
    expect(leerPlegado()).toEqual({});
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ a: true, b: "sí", c: 1 }));
    expect(leerPlegado()).toEqual({ a: true });
  });

  it("si localStorage falla, no revienta", () => {
    const original = Storage.prototype.getItem;
    const guardar = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("bloqueado");
    };
    Storage.prototype.setItem = () => {
      throw new Error("bloqueado");
    };
    try {
      expect(leerPlegado()).toEqual({});
      expect(() => guardarPlegado({ a: true })).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = guardar;
    }
  });
});
