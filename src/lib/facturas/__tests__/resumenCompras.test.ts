import { describe, expect, it } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import { crearResolverProveedor, type Proveedor } from "../proveedores";
import {
  agregarPorProveedor,
  esAbono,
  esLineaRegalo,
  mesCorto,
  mismoPeriodo,
  ordenarProveedoresPorGasto,
  pasaPeriodo,
  rangoPeriodo,
  regaladoDocumento,
  textoPeriodo,
} from "../resumenCompras";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  numero_documento: `D-${id}`,
  proveedor: "Vidrios del Vinalopó",
  cif: null,
  fecha: "2026-11-03",
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

const linea = (id: number, extra: Partial<ProductoFactura>): ProductoFactura => ({
  id,
  producto_nombre: `L-${id}`,
  precio: 10,
  proveedor: null,
  ...extra,
});

const prov = (id: number, nombre: string, variantes: string[]): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 0,
  total: 0,
  ultima_fecha: null,
  variantes,
  alias: [],
  cifs_extra: [],
});

const PROVEEDORES = [
  prov(1, "Vidrios del Vinalopó", ["Vidrios del Vinalopó"]),
  prov(2, "Aluminios Elda", ["ALUMINIOS ELDA, S.L."]),
  prov(3, "Herrajes Petrer", ["Herrajes Petrer"]),
];
const resolver = crearResolverProveedor(PROVEEDORES);
const HOY = new Date(2026, 10, 5); // 5 de noviembre de 2026

describe("periodo", () => {
  it("rangos: mes, mes anterior (también en enero), trimestre y año naturales, todo", () => {
    expect(rangoPeriodo({ tipo: "este_mes" }, HOY)).toEqual({ desde: "2026-11", hasta: "2026-11" });
    expect(rangoPeriodo({ tipo: "mes_anterior" }, HOY)).toEqual({ desde: "2026-10", hasta: "2026-10" });
    expect(rangoPeriodo({ tipo: "mes_anterior" }, new Date(2027, 0, 10))).toEqual({ desde: "2026-12", hasta: "2026-12" });
    expect(rangoPeriodo({ tipo: "trimestre" }, HOY)).toEqual({ desde: "2026-10", hasta: "2026-12" });
    expect(rangoPeriodo({ tipo: "trimestre" }, new Date(2026, 1, 1))).toEqual({ desde: "2026-01", hasta: "2026-03" });
    expect(rangoPeriodo({ tipo: "anio" }, HOY)).toEqual({ desde: "2026-01", hasta: "2026-12" });
    expect(rangoPeriodo({ tipo: "mes", mes: "2025-03" }, HOY)).toEqual({ desde: "2025-03", hasta: "2025-03" });
    expect(rangoPeriodo({ tipo: "todo" }, HOY)).toBeNull();
  });

  it("pasaPeriodo: por mes del documento; sin fecha solo en «Todo»", () => {
    const r = rangoPeriodo({ tipo: "trimestre" }, HOY);
    expect(pasaPeriodo({ fecha: "2026-10-01" }, r)).toBe(true);
    expect(pasaPeriodo({ fecha: "2026-12-31" }, r)).toBe(true);
    expect(pasaPeriodo({ fecha: "2026-09-30" }, r)).toBe(false);
    expect(pasaPeriodo({ fecha: "" }, r)).toBe(false);
    expect(pasaPeriodo({ fecha: "" }, null)).toBe(true);
  });

  it("texto del periodo y meses cortos", () => {
    expect(textoPeriodo({ tipo: "este_mes" }, HOY)).toBe("Noviembre 2026");
    expect(textoPeriodo({ tipo: "trimestre" }, HOY)).toBe("4.º trimestre 2026 (oct–dic)");
    expect(textoPeriodo({ tipo: "anio" }, HOY)).toBe("Año 2026");
    expect(textoPeriodo({ tipo: "todo" }, HOY)).toBe("Todo el histórico");
    expect(textoPeriodo({ tipo: "mes", mes: "2025-03" }, HOY)).toBe("Marzo 2025");
    expect(mesCorto("2026-01")).toBe("ene");
    expect(mesCorto("2026-01", true)).toBe("ene 26");
    expect(mismoPeriodo({ tipo: "mes", mes: "2025-03" }, { tipo: "mes", mes: "2025-03" })).toBe(true);
    expect(mismoPeriodo({ tipo: "mes", mes: "2025-03" }, { tipo: "mes", mes: "2025-04" })).toBe(false);
    expect(mismoPeriodo({ tipo: "todo" }, { tipo: "anio" })).toBe(false);
  });
});

describe("abonos y regalado", () => {
  it("abono = total negativo", () => {
    expect(esAbono({ total: -0.01 })).toBe(true);
    expect(esAbono({ total: 0 })).toBe(false);
    expect(esAbono({ total: null })).toBe(false);
  });

  it("regalado = bruto − importe en las líneas donde es mayor; marca lo estimado y cuenta los regalos", () => {
    const d = doc(1, {
      productos: [
        linea(1, { precio: 0, importe_bruto: 24 }), // regalo
        linea(2, { precio: 90, importe_bruto: 100, descuento_pct: 10, importe_bruto_estimado: true }), // descuento
        linea(3, { precio: 50, importe_bruto: 50 }), // sin diferencia
        linea(4, { precio: 30, importe_bruto: null }), // sin dato
        linea(5, { precio: 40, importe_bruto: 35 }), // bruto menor: no cuenta
      ],
    });
    expect(regaladoDocumento(d)).toEqual({ importe: 34, estimado: true, regalos: 1 });
    expect(regaladoDocumento(doc(2, {}))).toEqual({ importe: 0, estimado: false, regalos: 0 });
    expect(esLineaRegalo({ precio: 0, importe_bruto: 5 })).toBe(true);
    expect(esLineaRegalo({ precio: 1, importe_bruto: 5 })).toBe(false);
    expect(esLineaRegalo({ precio: 0, importe_bruto: null })).toBe(false);
  });
});

const DOCS: Factura[] = [
  doc(1, { proveedor: "Vidrios del Vinalopó", total: 1000, productos: [linea(1, { precio: 0, importe_bruto: 20, importe_bruto_estimado: true })] }),
  doc(2, { proveedor: "Vidrios del Vinalopó", total: -100, fecha: "2026-11-04" }), // abono
  doc(3, { proveedor: "ALUMINIOS ELDA, S.L.", total: 300 }),
  doc(5, { proveedor: "ALUMINIOS ELDA, S.L.", total: 300, fecha: "2026-10-20" }),
  doc(6, { proveedor: null, total: 50, fecha: "2026-01-02" }),
  doc(7, { proveedor: "Vidrios del Vinalopó", total: 70, fecha: "2025-11-30" }),
];

describe("por proveedor", () => {
  it("gasto, abonos, regalado y documentos ordenados", () => {
    const a = agregarPorProveedor(DOCS, resolver);
    const vinalopo = a.get("#1")!;
    expect(vinalopo.gasto).toBe(970);
    expect(vinalopo.abonos).toBe(-100);
    expect(vinalopo.nAbonos).toBe(1);
    expect(vinalopo.regalado).toBe(20);
    expect(vinalopo.regaladoEstimado).toBe(true);
    expect(vinalopo.documentos.map((d) => d.id)).toEqual([2, 1, 7]);
    expect(vinalopo.ultimaFecha).toBe("2026-11-04");
    const elda = a.get("#2")!;
    expect(elda.gasto).toBe(600);
    expect(elda.regalado).toBe(0);
    expect(a.get("")?.nombre).toBe("Sin proveedor");
  });

  it("lista de proveedores por gasto; con filtros, solo los que tienen documentos", () => {
    const a = agregarPorProveedor(DOCS, resolver);
    expect(ordenarProveedoresPorGasto([...PROVEEDORES].reverse(), a, false).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(ordenarProveedoresPorGasto(PROVEEDORES, a, true).map((p) => p.id)).toEqual([1, 2]);
  });
});
