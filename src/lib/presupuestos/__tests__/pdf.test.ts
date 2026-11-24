// @vitest-environment node
/**
 * PDF del presupuesto (pdf-lib): devuelve los bytes de un PDF válido, con el logotipo de la marca dibujado desde su
 * SVG, los textos con acentos y €, varias hojas si hay muchas líneas y el nombre de fichero de siempre.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { construirPdfPresupuesto, envolver, nombrePdfPresupuesto, textoParaFuente, trazosLogo, type DatosPdfPresupuesto } from "../pdf";
import { negocioParaDocumentos } from "../documento";

const LOGO = readFileSync(path.resolve(__dirname, "../../../../public/marca/logo-horizontal.svg"), "utf8");

const datos = (n = 2, extra: Partial<DatosPdfPresupuesto> = {}): DatosPdfPresupuesto => ({
  presupuesto: {
    numero: "P-2026-0001",
    fecha: "2026-11-23",
    validez_dias: 30,
    cliente_nombre: "José Ñúñez Peña",
    cliente_telefono: "650 00 00 00",
    cliente_email: "jose@example.com",
    cliente_direccion: "C/ Mayor, 1",
    cliente_poblacion: "Crevillente",
    condiciones: "Presupuesto válido durante 30 días desde su fecha.\nPrecio orientativo → sujeto a visita ≈ técnica.",
    descuento_pct: 5,
    iva_pct: 21,
  },
  lineas: Array.from({ length: n }, (_, i) => ({
    descripcion: `Mampara a medida · baño ${i + 1}`,
    detalle: "Ancho: 120 cm\nCristal: Templado 6 mm\n\nDesglose:\n· Mampara (120 cm): 560,00 €",
    cantidad: 1,
    precio_unitario: 560,
  })),
  negocio: negocioParaDocumentos(null),
  logoSvg: LOGO,
  ...extra,
});

describe("construirPdfPresupuesto", () => {
  it("devuelve los bytes de un PDF que se vuelve a abrir, con título y una hoja", async () => {
    const bytes = await construirPdfPresupuesto(datos());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(5_000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Presupuesto P-2026-0001");
    expect(doc.getAuthor()).toBe("Cristalería Baix Vinalopó");
  });

  it("con muchas líneas sigue en más hojas", async () => {
    const doc = await PDFDocument.load(await construirPdfPresupuesto(datos(40)));
    expect(doc.getPageCount()).toBeGreaterThan(2);
  });

  it("sin logotipo, sin líneas ni condiciones también sale", async () => {
    const bytes = await construirPdfPresupuesto(datos(0, { logoSvg: null, presupuesto: { ...datos().presupuesto, condiciones: null, cliente_telefono: null } }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("piezas del PDF", () => {
  it("lee los trazos y la caja del logotipo de la marca", () => {
    const logo = trazosLogo(LOGO)!;
    expect(logo.caja).toEqual([8.1, 9.2, 465.1, 174.9]);
    expect(logo.trazos.map((x) => x.color)).toEqual(["#f6e9c6", "#062c4c", "#062c4c", "#062c4c"]);
    expect(trazosLogo("<svg></svg>")).toBeNull();
    expect(trazosLogo(null)).toBeNull();
  });

  it("cambia lo que la fuente no sabe escribir y deja acentos, ñ y €", () => {
    const soportados = new Set([..."abcdefghijklmnopqrstuvwxyzáéíóúñ€0123456789 ->?~".split("").map((c) => c.codePointAt(0)!)]);
    expect(textoParaFuente("año → piña ≈ 5€", soportados)).toBe("año -> piña ~ 5€");
    expect(textoParaFuente("ŵ", soportados)).toBe("w");
    expect(textoParaFuente("😀", soportados)).toBe("?");
  });

  it("parte el texto por palabras y respeta los saltos de línea", () => {
    const fuente = { widthOfTextAtSize: (s: string) => s.length };
    expect(envolver("uno dos tres\ncuatro", fuente, 1, 7)).toEqual(["uno dos", "tres", "cuatro"]);
    expect(envolver("abcdefghij", fuente, 1, 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("nombre del fichero", () => {
    expect(nombrePdfPresupuesto("P-2026-0001")).toBe("Presupuesto-P-2026-0001.pdf");
    expect(nombrePdfPresupuesto("P 2026/7")).toBe("Presupuesto-P-2026-7.pdf");
  });
});
