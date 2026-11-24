import { describe, expect, it } from "vitest";
import {
  aplicarReglasLectura,
  aplicarSignoAbono,
  avisoFechaFueraDeAnio,
  documentoNoCompra,
  esOtraFacturaConNumeroDistinto,
} from "./reglasCarga";
import { esCifCliente, esNombreCliente, normalizarDatos } from "./extraccion";
import { comprobarCuadre, deducirImportes, type DocumentoExtraido } from "./esquema";
import { quitarIvaExplicadoPorExtras } from "./guardado";

// ============================================================================
//  Reglas de la lectura que no necesitan la imagen (reglasCarga.ts).
// ============================================================================

const linea = (o: Record<string, unknown> = {}) => ({
  nombre: "Producto", cantidad: 1, unidad: "ud", peso_kg: null, base_precio: "por_unidad",
  precio_unitario: 10, total: 10, iva_pct: null, bonificada: false, ...o,
});
const doc = (o: Record<string, unknown> = {}): DocumentoExtraido => ({
  proveedor: "PROVEEDOR SL", cif: "B03092038", cliente: null, numero_documento: "F-1",
  fecha: "2026-11-10", sin_importes: false, filas_tabla: 1, continua_en_otra_pagina: false,
  productos: [linea()], subtotal: 10, subtotal_literal: "10,00", iva: 1, iva_literal: "1,00",
  total: 11, total_literal: "11,00", observaciones: null, ...o,
} as DocumentoExtraido);
const HOY = new Date("2026-11-15T12:00:00Z");

describe("1. abonos en negativo", () => {
  it("es_abono: cabecera, líneas y cantidades en negativo; precio positivo (aunque el papel lo pinte en positivo)", () => {
    const d = normalizarDatos(doc({ es_abono: true, productos: [linea({ cantidad: 2, precio_unitario: 5, total: 10 })] }), HOY);
    expect([d.subtotal, d.iva, d.total]).toEqual([-10, -1, -11]);
    expect(d.productos[0].total).toBe(-10);
    expect(d.productos[0].cantidad).toBe(-2);
    expect(d.productos[0].precio_unitario).toBe(5);
    expect(d.observaciones).toMatch(/Abono/);
  });
  it("devolución de material dentro de una factura: la cantidad también en negativo", () => {
    const { data } = aplicarSignoAbono({ productos: [{ nombre: "Devolución caballete", cantidad: 3, total: -4.5 }] });
    expect(data.productos[0].cantidad).toBe(-3);
  });
});

describe("5. líneas con IVA incluido", () => {
  it("las pasa a base con el tipo de cada línea y avisa; el cuadre ya no protesta", () => {
    const d = aplicarReglasLectura(doc({
      productos: [linea({ precio_unitario: 11, total: 11, iva_pct: 10 }), linea({ precio_unitario: 22, total: 22, iva_pct: 10 })],
      subtotal: 30, iva: 3, total: 33, filas_tabla: 2,
    }));
    expect(d.productos.map((l) => l.total)).toEqual([10, 20]);
    expect(d.avisos_reglas?.[0].codigo).toBe("lineas_con_iva_incluido");
    expect(comprobarCuadre(d).map((x) => x.codigo)).not.toContain("descuadre_cabecera");
  });
  it("no toca un documento que ya viene en base", () => {
    const d = aplicarReglasLectura(doc());
    expect(d.productos[0].total).toBe(10);
    expect(d.avisos_reglas).toBeUndefined();
  });
});

describe("6. cuadre con recargo de equivalencia y cargos fuera de base", () => {
  it("la tasa DGT fuera de base no rompe base + IVA = total", () => {
    const d = doc({ subtotal: 40, iva: 8.4, total: 52.5, cargos_fuera_base: 4.1, productos: [linea({ precio_unitario: 40, total: 40 })] });
    expect(comprobarCuadre(d).map((x) => x.codigo)).not.toContain("iva_incoherente");
    expect(comprobarCuadre({ ...d, cargos_fuera_base: null }).map((x) => x.codigo)).toContain("iva_incoherente");
  });
  it("el total deducido suma el recargo", () => {
    const { datos } = deducirImportes(doc({ total: null, total_literal: null, recargo_equivalencia: 0.52 }));
    expect(datos.total).toBe(11.52);
  });
  it("la alerta SQL iva_incoherente que explica el extra se quita", () => {
    const sql = [{ codigo: "iva_incoherente", severidad: "media", mensaje: "", detalle: { diferencia: -4.1 } }];
    expect(quitarIvaExplicadoPorExtras(sql as never, 4.1)).toEqual([]);
    expect(quitarIvaExplicadoPorExtras(sql as never, 2)).toHaveLength(1);
  });
});

describe("7/11. lo que no es compra", () => {
  const nc = (o: Record<string, unknown>) => documentoNoCompra(o, esCifCliente, esNombreCliente);
  it("adeudo SEPA, TPV, leasing… no se cargan como gasto", () => {
    expect(nc({ clase_documento: "adeudo_bancario" })?.mensaje).toMatch(/No es una factura de compra/);
    expect(nc({ clase_documento: "comision_tpv" })?.clase).toBe("comision_tpv");
    expect(nc({ clase_documento: "compra" })).toBeNull();
    expect(nc({})).toBeNull();
  });
  it("factura EMITIDA por la propia cristalería a otro cliente = venta", () => {
    const ncEmpresa = (o: Record<string, unknown>) =>
      documentoNoCompra(o, (c) => esCifCliente(c, "B12345674"), esNombreCliente);
    expect(ncEmpresa({ cif: "B-12345674", proveedor: "CRISTALERIA BAIX VINALOPO S.L.", cliente: "COMUNIDAD DE VECINOS EDIFICIO SOL" })?.clase)
      .toBe("venta_emitida");
    expect(ncEmpresa({ cif: "B12345674", proveedor: "Cristalería Baix Vinalopó", cliente: "Cristalería BV" })).toBeNull();
  });
  it("normalizarDatos lo marca para que guardado no lo guarde", () => {
    expect(normalizarDatos(doc({ clase_documento: "cuota_leasing_prestamo" }), HOY).no_es_compra?.clase).toBe("cuota_leasing_prestamo");
  });
});

describe("3/10. filas de tarifa", () => {
  it("una fila de tarifa (precio sin cantidad ni importe) no es producto", () => {
    const d = normalizarDatos(doc({
      productos: [linea(), linea({ nombre: "Tarifa: espejo plata 5 mm", cantidad: 0, precio_unitario: 45, total: null })],
    }), HOY);
    expect(d.productos.map((p) => p.nombre)).toEqual(["Producto"]);
  });
});

describe("16. fecha fuera del año esperado", () => {
  it("avisa de años viejos y de fechas futuras; no de este año ni del anterior", () => {
    expect(avisoFechaFueraDeAnio("2026-03-01", HOY)).toBeNull();
    expect(avisoFechaFueraDeAnio("2025-12-30", HOY)).toBeNull();
    expect(avisoFechaFueraDeAnio("2024-12-30", HOY)?.codigo).toBe("fecha_fuera_de_anio");
    expect(avisoFechaFueraDeAnio("2026-12-11", HOY)?.codigo).toBe("fecha_fuera_de_anio");
  });
});

describe("17. duplicados por datos con números distintos", () => {
  it("dos números reales distintos no son duplicado; sin número o el mismo, sí", () => {
    expect(esOtraFacturaConNumeroDistinto("11-26", { numero_documento: "10-26", motivo: "datos_coincidentes" })).toBe(true);
    expect(esOtraFacturaConNumeroDistinto("A26/10,685", { numero_documento: "A26/10685", motivo: "datos_coincidentes" })).toBe(false);
    expect(esOtraFacturaConNumeroDistinto("SN-PROV-20261101", { numero_documento: "10-26", motivo: "datos_coincidentes" })).toBe(false);
    expect(esOtraFacturaConNumeroDistinto("11-26", { numero_documento: "11-26", motivo: "numero_proveedor" })).toBe(false);
  });
});
