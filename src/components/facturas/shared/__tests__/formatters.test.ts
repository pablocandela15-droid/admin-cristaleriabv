import { describe, expect, it } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import {
  avisosDocumento,
  claveProveedor,
  esLineaDeServicio,
  formatCantidadLinea,
  formatCurrency,
  formatEntero,
  formatImporte,
  formatNumero,
  indiceAnomaliasPrecio,
  indicePreciosLinea,
  plural,
  precioAnomalo,
  tieneAnomaliaPrecio,
  valorSinDescuento,
} from "../formatters";

let siguienteId = 1;

const linea = (producto_nombre: string, precio_unitario: number): ProductoFactura => ({
  id: siguienteId++,
  producto_nombre,
  precio: precio_unitario,
  cantidad: 1,
  unidad: null,
  proveedor: null,
  precio_unitario,
});

const doc = (
  id: number,
  proveedor: string,
  productos: ProductoFactura[],
  proveedor_normalizado?: string | null,
): Factura => ({
  id,
  numero_documento: String(id),
  proveedor,
  proveedor_normalizado,
  cif: null,
  fecha: "2026-10-01",
  subtotal: null,
  iva: null,
  total: null,
  total_origen: null,
  observaciones: null,
  productos,
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: false,
});

describe("tieneAnomaliaPrecio", () => {
  it("no compara los portes de Cristalpe con los de HERRAJES PETRER (documentos 45 y 47)", () => {
    const cristalpe = doc(45, "HEREDEROS JUAN PEÑA CRISTAL C.B. (CRISTALPE)", [
      linea("Bisagra 90 grados", 49),
      linea("Portes", 57),
    ], "herederos juan pena cristal c.b");
    const petrer = doc(47, "HERRAJES PETRER SLU", [linea("CUTTER", 32), linea("PORTES", 25.45)], "herrajes petrer");
    const todos = [cristalpe, petrer];

    expect(tieneAnomaliaPrecio(cristalpe, todos)).toBe(false);
    expect(avisosDocumento(cristalpe, todos)).toEqual([]);
  });

  it("no compara el mismo producto entre proveedores distintos", () => {
    const a = doc(1, "Proveedor A", [linea("Silicona neutra 300 ml", 60)]);
    const b = doc(2, "Proveedor B", [linea("SILICONA NEUTRA 300 ML", 20)]);
    expect(tieneAnomaliaPrecio(a, [a, b])).toBe(false);
  });

  it("sigue avisando si el MISMO proveedor cobra mas del doble", () => {
    const viejo = doc(1, "Aluminios Elda, S.L.", [linea("BRUGAL 1888 70 CL.", 34.05)]);
    const nuevo = doc(2, "ALUMINIOS ELDA, S.L.", [linea("Brugal 1888 70 cl.", 340.5)]);
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(true);
    expect(avisosDocumento(nuevo, [viejo, nuevo]).map((a) => a.codigo)).toEqual(["precio_atipico_pagina"]);
  });

  it("usa proveedor_normalizado cuando viene de la base", () => {
    const viejo = doc(1, "Vinalopó (Vidrios del Vinalopó)", [linea("Jamón", 100)], "vinalopo");
    const nuevo = doc(2, "VINALOPO", [linea("Jamón", 500)], "vinalopo");
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(true);
  });

  it("ignora las lineas de servicio aunque sean del mismo proveedor", () => {
    const viejo = doc(1, "Herrajes Petrer", [linea("PORTES", 10), linea("Gestión y logística", 1)]);
    const nuevo = doc(2, "Herrajes Petrer", [linea("Portes", 57), linea("GESTION Y LOGISTICA", 5)]);
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(false);
  });

  it("no usa precios a 0 (bonificaciones o importes no leidos) como referencia", () => {
    const viejo = doc(1, "Elda", [linea("TANQUERAY 70 CL.", 0), linea("TANQUERAY 70 CL.", 11.4)]);
    const nuevo = doc(2, "Elda", [linea("TANQUERAY 70 CL.", 11.4)]);
    expect(tieneAnomaliaPrecio(nuevo, [viejo, nuevo])).toBe(false);
  });
});

describe("indiceAnomaliasPrecio (muchos documentos de una vez)", () => {
  it("da lo mismo que tieneAnomaliaPrecio documento a documento", () => {
    const nombres = ["Brugal 1888 70 cl.", "BRUGAL 1888 70 CL.", "Portes", "Jamón", "TANQUERAY 70 CL."];
    const proveedores = ["Aluminios Elda, S.L.", "ALUMINIOS ELDA, S.L.", "Herrajes Petrer", "Vinalopó"];
    let semilla = 7;
    const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
    const docs = Array.from({ length: 60 }, (_, i) =>
      doc(i + 1, proveedores[Math.floor(azar() * proveedores.length)], Array.from({ length: 1 + Math.floor(azar() * 4) }, () =>
        linea(nombres[Math.floor(azar() * nombres.length)], [0, 10, 11, 25, 40][Math.floor(azar() * 5)]),
      )),
    );
    const anomalia = indiceAnomaliasPrecio(docs);
    const esperado = docs.map((d) => tieneAnomaliaPrecio(d, docs));
    expect(docs.map(anomalia)).toEqual(esperado);
    expect(esperado.some(Boolean)).toBe(true);
    expect(docs.map((d) => avisosDocumento(d, docs, anomalia))).toEqual(docs.map((d) => avisosDocumento(d, docs)));
  });

  it("un documento que no está en la lista se compara con todos", () => {
    const viejo = doc(1, "Elda", [linea("BRUGAL", 10)]);
    const nuevo = doc(2, "Elda", [linea("BRUGAL", 30)]);
    expect(indiceAnomaliasPrecio([viejo])(nuevo)).toBe(tieneAnomaliaPrecio(nuevo, [viejo]));
    expect(indiceAnomaliasPrecio([viejo])(nuevo)).toBe(true);
  });
});

describe("claveProveedor", () => {
  it("prefiere proveedor_normalizado", () => {
    expect(claveProveedor({ proveedor: "Aluminios Elda, S.L.", proveedor_normalizado: "aluminios elda" })).toBe(
      "aluminios elda",
    );
  });

  it("si no lo hay, normaliza igual que normalizar_proveedor()", () => {
    expect(claveProveedor({ proveedor: "Aluminios Elda, S.L." })).toBe("aluminios elda");
    expect(claveProveedor({ proveedor: "ALUMINIOS ELDA, S.L." })).toBe("aluminios elda");
    expect(claveProveedor({ proveedor: "DISTRIBUCIONES GUILLÉN, S.L." })).toBe("distribuciones guillen");
    expect(claveProveedor({ proveedor: "VINALOPO (Vidrios del Vinalopó)" })).toBe("vinalopo");
    expect(claveProveedor({ proveedor: null })).toBe("");
  });
});

describe("esLineaDeServicio", () => {
  it.each(["Portes", "PORTES", "Porte", "Transporte", "Gastos de envío", "GESTION Y LOGISTICA", "Punto Verde", "Canon punto verde"])(
    "%s es servicio",
    (nombre) => expect(esLineaDeServicio(nombre)).toBe(true),
  );

  it.each(["Bisagra 90 grados", "CUTTER", "TEMPLADO 8MM INC. 1500X800", "Silicona neutra"])(
    "%s es mercancia",
    (nombre) => expect(esLineaDeServicio(nombre)).toBe(false),
  );
});

describe("formatCantidadLinea (líneas por superficie con sus piezas)", () => {
  it("línea por m² con piezas: «12 ud · 24 m2»", () => {
    expect(formatCantidadLinea({ cantidad: 24, unidad: "m2", bultos: 12 })).toBe("12 ud · 24 m2");
    expect(formatCantidadLinea({ cantidad: 75.48, unidad: "m2", bultos: 8 })).toBe("8 ud · 75,48 m2");
  });
  it("sin bultos: solo la cantidad con su unidad", () => {
    expect(formatCantidadLinea({ cantidad: 3, unidad: "ud", bultos: null })).toBe("3 ud");
    expect(formatCantidadLinea({ cantidad: 4.96, unidad: "ml" })).toBe("4,96 ml");
    expect(formatCantidadLinea({ cantidad: 2, unidad: null })).toBe("2");
  });
  it("sin cantidad: guion", () => {
    expect(formatCantidadLinea({ cantidad: undefined, unidad: "kg", bultos: null })).toBe("-");
  });
  it("formatNumero: coma decimal y hasta 3 decimales", () => {
    expect(formatNumero(111.8)).toBe("111,8");
    expect(formatNumero(7.355)).toBe("7,355");
    expect(formatNumero(24)).toBe("24");
  });
});

describe("valorSinDescuento (líneas con descuento o regaladas)", () => {
  const nbsp = (t: string | undefined) => t?.replace(/\u00a0/g, " ");
  it("con descuento: valor antes de descuento y el %", () => {
    const v = valorSinDescuento({ precio: 24.99, importe_bruto: 35.2, importe_bruto_estimado: false, descuento_pct: 29 });
    expect(nbsp(v?.texto)).toBe("Valor sin descuento 35,20 € · dto. 29 %");
  });
  it("regalo con valor estimado", () => {
    const v = valorSinDescuento({ precio: 0, importe_bruto: 13.5, importe_bruto_estimado: true, descuento_pct: null });
    expect(nbsp(v?.texto)).toBe("Valor sin descuento 13,50 € (estimado)");
  });
  it("sin bruto, o igual al importe: nada", () => {
    expect(valorSinDescuento({ precio: 10, importe_bruto: null })).toBeNull();
    expect(valorSinDescuento({ precio: 10, importe_bruto: 10 })).toBeNull();
  });
  it("bruto MENOR que el importe: no es un descuento, nada (QA C-15)", () => {
    expect(valorSinDescuento({ precio: 12, importe_bruto: 9.5, importe_bruto_estimado: false, descuento_pct: null })).toBeNull();
  });
});

describe("indicePreciosLinea (media de referencia de cada línea, calculada una vez)", () => {
  it("media del MISMO proveedor y nombre, sin la propia línea ni precios a 0", () => {
    const a = linea("Gambón XXL", 10);
    const b = linea("GAMBÓN xxl", 14);
    const cero = linea("Gambón XXL", 0);
    const otroProv = linea("Gambón XXL", 100);
    const docs = [
      doc(1, "Vidrios Rías, S.L.", [a, cero], "vidrios rias"),
      doc(2, "Vidrios Rías", [b], "vidrios rias"),
      doc(3, "Tecnovidrio", [otroProv], "tecnovidrio"),
    ];
    const media = indicePreciosLinea(docs);
    expect(media(a, docs[0])).toBe(14); // solo la otra línea (b): ni la suya, ni la de 0, ni la de Tecnovidrio
    expect(media(b, docs[1])).toBe(10);
    expect(media(otroProv, docs[2])).toBeUndefined(); // en Tecnovidrio no hay otra
    // Una línea nueva (no indexada) se compara con todas las del proveedor.
    expect(media({ id: 0, producto_nombre: "gambon xxl" }, docs[0])).toBe(12);
  });

  it("sin proveedor o línea de servicio: sin referencia", () => {
    const p1 = linea("Portes", 10);
    const p2 = linea("Portes", 30);
    const docs = [doc(1, "Herrajes Petrer", [p1]), doc(2, "Herrajes Petrer", [p2]), doc(3, "", [linea("Jamón", 5)])];
    const media = indicePreciosLinea(docs);
    expect(media(p1, docs[0])).toBeUndefined();
    expect(media(docs[2].productos[0], docs[2])).toBeUndefined();
  });

  it("coherente con indiceAnomaliasPrecio y tieneAnomaliaPrecio", () => {
    const docs = [
      doc(1, "Elda", [linea("BRUGAL", 10), linea("TANQUERAY", 20)]),
      doc(2, "Elda", [linea("Brugal", 11)]),
      doc(3, "Elda", [linea("brugal", 40), linea("Stadip", 0)]),
    ];
    const media = indicePreciosLinea(docs);
    const conLinea = docs.map((d) => d.productos.some((p) => precioAnomalo(p.precio_unitario, media(p, d))));
    expect(conLinea).toEqual(docs.map((d) => tieneAnomaliaPrecio(d, docs)));
    expect(conLinea).toEqual(docs.map(indiceAnomaliasPrecio(docs, media)));
    expect(conLinea).toEqual([false, false, true]);
  });

  it("precioAnomalo: más del doble y con precio > 0", () => {
    expect(precioAnomalo(21, 10)).toBe(true);
    expect(precioAnomalo(20, 10)).toBe(false);
    expect(precioAnomalo(0, 10)).toBe(false);
    expect(precioAnomalo(null, 10)).toBe(false);
    expect(precioAnomalo(50, undefined)).toBe(false);
  });
});

describe("formatEntero y plural (es-ES, miles con punto)", () => {
  it("agrupa también los de 4 cifras", () => {
    expect(formatEntero(7)).toBe("7");
    expect(formatEntero(1860)).toBe("1.860");
    expect(formatEntero(12500)).toBe("12.500");
    expect(formatEntero(1234567)).toBe("1.234.567");
  });

  it("singular y plural", () => {
    expect(plural(1, "línea", "líneas")).toBe("1 línea");
    expect(plural(0, "línea", "líneas")).toBe("0 líneas");
    expect(plural(1860, "documento", "documentos")).toBe("1.860 documentos");
  });
});

describe("formatCurrency y formatImporte (miles con punto también con 4 cifras)", () => {
  it("1.234,50 € y no 1234,50 €", () => {
    expect(formatCurrency(1234.5).replace(/\s/g, " ")).toBe("1.234,50 €");
    expect(formatCurrency(999).replace(/\s/g, " ")).toBe("999,00 €");
    expect(formatCurrency(1234567.891).replace(/\s/g, " ")).toBe("1.234.567,89 €");
    expect(formatCurrency(null)).toBe("-");
  });

  it("los abonos llevan el signo menos tipográfico", () => {
    expect(formatImporte(-1234.5).replace(/\s/g, " ")).toBe("−1.234,50 €");
    expect(formatImporte(12).replace(/\s/g, " ")).toBe("12,00 €");
  });
});
