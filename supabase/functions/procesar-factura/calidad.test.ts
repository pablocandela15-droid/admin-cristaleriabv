// Reglas deterministas de calidad tras la extracción (calidad.ts).
import { describe, expect, it } from "vitest";
import {
  avisoClienteAjeno,
  cifControlValido,
  limpiarObservaciones,
  numeroProvisional,
  proveedorCorto,
} from "./calidad";
import { normalizarDatos, paginaImpresa } from "./extraccion";
import {
  comprobarCuadre,
  type DocumentoExtraido,
  DOCUMENTO_JSON_SCHEMA,
  leerImporteLiteral,
  retirarImportesNoImpresos,
  validarEstructura,
} from "./esquema";
import { parseImporte } from "./normalizacion";

const linea = (o: Record<string, unknown>) => ({
  nombre: "X", cantidad: 1, unidad: "ud", peso_kg: null, base_precio: "por_unidad",
  precio_unitario: 1, total: 1, iva_pct: null, bonificada: false, ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  proveedor: "Prov", cif: null, cliente: null, numero_documento: "1",
  pagina: { actual: null, total: null }, fecha: "2026-10-10", sin_importes: false, productos: [linea({})],
  subtotal: null, iva: null, total: null, observaciones: null, ...o,
});
const codigos = (d: ReturnType<typeof normalizarDatos>) => d.avisos.map((a) => a.codigo);

describe("1 · documento sin número", () => {
  it("documento sin número → provisional SN-PASTOR-20261010 y aviso, sin fallar", () => {
    for (const numero of [null, "", "  "]) {
      const d = normalizarDatos(base({ numero_documento: numero, proveedor: "HERMANOS PASTOR S.L.", fecha: "2026-10-10" }));
      expect(d.numero_documento).toBe("SN-PASTOR-20261010");
      expect(codigos(d)).toContain("numero_ausente");
    }
  });
  it("Herrajes Elda, S.L. → SN-HERRAJES-…; sin proveedor → SN-DESCONOCIDO-…; las palabras genéricas se saltan", () => {
    expect(numeroProvisional("Herrajes Elda, S.L.", "2026-10-08")).toBe("SN-HERRAJES-20261008");
    expect(numeroProvisional(null, "2026-10-08")).toBe("SN-DESCONOCIDO-20261008");
    expect(proveedorCorto("Vidrios del Vinalopó, S.L.")).toBe("VINALOPO");
    expect(proveedorCorto("Distribuciones Aluminios Levante, S.R.L.")).toBe("LEVANTE");
  });
  it("el esquema permite null y prohíbe sacarlo de teléfonos o del año", () => {
    const p = DOCUMENTO_JSON_SCHEMA.schema.properties.numero_documento;
    expect(p.type).toContain("null");
    expect(p.description).toMatch(/telefono/);
    expect(p.description).toMatch(/ano/);
    expect(validarEstructura(base({ numero_documento: null })).ok).toBe(true);
  });
});

describe("2 · CIF con dígito de control", () => {
  it.each([
    ["B06805246", true], ["B08605246", false], ["B06050246", false], ["B06505246", false], ["B06B05246", false],
    ["F54450895", true], ["F54650895", false], ["B53363974", true], ["B55363974", false],
    ["29016276M", true], ["33288687M", true], ["323288687M", false], ["46914230-A", true], ["X1234567L", true],
    ["ESB06805246", true], ["", false],
  ])("%s → %s", (cif, ok) => {
    expect(cifControlValido(cif)).toBe(ok);
  });
  it("se guarda normalizado: «46914230-A» → 46914230A, «F-54650895» → F54650895", () => {
    expect(normalizarDatos(base({ cif: "46914230-A" })).cif).toBe("46914230A");
    expect(normalizarDatos(base({ cif: "F-54650895" })).cif).toBe("F54650895");
  });
});

describe("3 · cargos del pie: el descuadre pequeño ya avisa", () => {
  it("líneas 316,23 frente a base 318,05 (embalaje 1,82 en el pie) → descuadre_cabecera", () => {
    const doc = base({
      productos: [linea({ cantidad: 1, precio_unitario: 316.23, total: 316.23 })],
      subtotal: 318.05, subtotal_literal: "318,05",
    }) as unknown as DocumentoExtraido;
    expect(comprobarCuadre(doc).map((d) => d.codigo)).toContain("descuadre_cabecera");
  });
  it("con el embalaje como línea cuadra exacto", () => {
    const doc = base({
      productos: [linea({ precio_unitario: 316.23, total: 316.23 }), linea({ nombre: "Embalaje", precio_unitario: 1.82, total: 1.82 })],
      subtotal: 318.05,
    }) as unknown as DocumentoExtraido;
    expect(comprobarCuadre(doc).map((d) => d.codigo)).not.toContain("descuadre_cabecera");
  });
});

describe("4 · unidades por medida y precio neto", () => {
  it("vidrio 1,925 ud → m2; templado a €/m² → m2; perfil 12,5 ud → ml; bisagras 4 ud se quedan en ud", () => {
    const d = normalizarDatos(base({
      productos: [
        linea({ nombre: "VIDRIO FLOTADO 4MM INCOLORO", cantidad: 1.925, precio_unitario: null, total: null }),
        linea({ nombre: "TEMPLADO 8MM", cantidad: 5, base_precio: "por_m2", precio_unitario: 38, total: 190 }),
        linea({ nombre: "PERFIL GUÍA SUPERIOR", cantidad: 12.5, precio_unitario: 2, total: 25 }),
        linea({ nombre: "BISAGRA MAMPARA VIDRIO-PARED", cantidad: 4, precio_unitario: 14, total: 56 }),
        linea({ nombre: "SILICONA NEUTRA 300ML", cantidad: 12, precio_unitario: 4, total: 48 }),
      ],
    }));
    expect(d.productos.map((p) => p.unidad)).toEqual(["m2", "m2", "ml", "ud", "ud"]);
  });
  it("precio bruto 12,83 con bonificación y descuento e importe 55,18 → precio NETO 9,1967", () => {
    const d = normalizarDatos(base({
      productos: [linea({ nombre: "TIRADOR INOX 300MM", cantidad: 6, precio_unitario: 12.83, total: 55.18 })],
    }));
    expect(d.productos[0].precio_unitario).toBeCloseTo(9.1967, 4);
    expect(d.productos[0].total).toBe(55.18);
  });
  it("sin descuento el precio no se toca", () => {
    const d = normalizarDatos(base({ productos: [linea({ cantidad: 3, precio_unitario: 2.5, total: 7.5 })] }));
    expect(d.productos[0].precio_unitario).toBe(2.5);
  });
});

describe("5 · manuscritos y talonarios", () => {
  it("conceptos preimpresos de un talonario sin cantidad se descartan; el rellenado se queda", () => {
    const d = normalizarDatos(base({
      productos: [
        linea({ nombre: "CORTE", cantidad: null, precio_unitario: null, total: null }),
        linea({ nombre: "CANTO PULIDO", cantidad: 0, precio_unitario: null, total: null }),
        linea({ nombre: "TALADRO", cantidad: null, precio_unitario: null, total: null }),
        linea({ nombre: "BISELADO", cantidad: 3, precio_unitario: 17, total: 51 }),
      ],
    }));
    expect(d.productos.map((p) => p.nombre)).toEqual(["BISELADO"]);
    expect(codigos(d)).toContain("lineas_descartadas");
  });
  it("apóstrofo como coma decimal: 51'00, 134'97, 1'20, 60'00; con 3 cifras es de miles", () => {
    expect(leerImporteLiteral("51'00")).toBe(51);
    expect(leerImporteLiteral("134'97")).toBe(134.97);
    expect(leerImporteLiteral("128’00 €")).toBe(128);
    expect(leerImporteLiteral("1'234,56")).toBe(1234.56);
    expect(parseImporte("1'20")).toBe(1.2);
    expect(parseImporte("60'00")).toBe(60);
  });
  it("manuscrito: el verificador cita «134'97» y el total es 134,97 → sin aviso falso", () => {
    const doc = base({ subtotal: 122.7, subtotal_literal: "122'70", iva: 12.27, iva_literal: "12'27", total: 134.97, total_literal: "134'97" }) as unknown as DocumentoExtraido;
    const r = retirarImportesNoImpresos(doc, {
      fila_total_impresa: true, total_citado: "134'97", base_imponible_citada: "122'70", cuota_iva_citada: "12'27",
    });
    expect(r.discordancias).toEqual([]);
    expect(r.retiradas).toEqual([]);
  });
});

describe("8 · cliente ajeno", () => {
  it("otro destinatario avisa; Cristalería Baix Vinalopó (o su CIF configurado) no", () => {
    expect(avisoClienteAjeno("Aluminios Novelda SL, Pol. Ind. Santa Fe (Novelda)")?.codigo).toBe("cliente_ajeno");
    expect(avisoClienteAjeno("CRISTALERÍA BAIX VINALOPÓ, S.L.")).toBeNull();
    expect(avisoClienteAjeno("Cristalería BV · Obra C/ Mayor 12")).toBeNull();
    expect(avisoClienteAjeno("B-12345674", "B12345674")).toBeNull();
    expect(avisoClienteAjeno("B12345674")?.codigo).toBe("cliente_ajeno");
    expect(avisoClienteAjeno(null)).toBeNull();
    expect(codigos(normalizarDatos(base({ cliente: "CERRAMIENTOS LEVANTE SLU B94186988" })))).toContain("cliente_ajeno");
  });
});

describe("9 · mercancía pendiente de servir", () => {
  it("«JUNTA EPDM 4MM» sin precio en un documento con precios → aviso linea_sin_importe", () => {
    const d = normalizarDatos(base({
      productos: [linea({ precio_unitario: 10, total: 10 }), linea({ nombre: "JUNTA EPDM 4MM", cantidad: 1, precio_unitario: null, total: null })],
    }));
    expect(d.productos).toHaveLength(2);
    expect(codigos(d)).toContain("linea_sin_importe");
  });
  it("una fila «Mercancía pendiente de servir» sin importe se descarta", () => {
    const d = normalizarDatos(base({
      productos: [linea({ precio_unitario: 10, total: 10 }), linea({ nombre: "Mercancía pendiente de servir: KIT CORREDERA", cantidad: 1, precio_unitario: null, total: null })],
    }));
    expect(d.productos).toHaveLength(1);
  });
  it("una nota de entrega sin precios no avisa de líneas sin importe", () => {
    const d = normalizarDatos(base({ sin_importes: true, productos: [linea({ precio_unitario: null, total: null })] }));
    expect(codigos(d)).not.toContain("linea_sin_importe");
  });
});

describe("paginación impresa (para A1: «PÁGINA Nº x/y»)", () => {
  it("se lee y se valida", () => {
    expect(normalizarDatos(base({ pagina: { actual: 2, total: 2 } })).pagina).toEqual({ actual: 2, total: 2 });
    expect(paginaImpresa({ actual: null, total: null })).toBeNull();
    expect(paginaImpresa({ actual: 3, total: 2 })).toEqual({ actual: 3, total: null });
    expect(paginaImpresa(undefined)).toBeNull();
    expect(DOCUMENTO_JSON_SCHEMA.schema.required).toContain("pagina");
  });
});

describe("observaciones sin notas de franjas (374)", () => {
  it("quita «En esta franja…» y deja la forma de pago", () => {
    expect(limpiarObservaciones("Forma de pago: RECIBO · En esta franja solo se ve la cabecera. La franja solo muestra iconos de la interfaz."))
      .toBe("Forma de pago: RECIBO");
    expect(limpiarObservaciones("En esta franja no hay nada.")).toBeNull();
  });
});
