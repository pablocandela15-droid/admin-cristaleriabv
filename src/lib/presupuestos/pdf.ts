// ============================================================================
//  Presupuestos: PDF con pdf-lib (A4, vectorial, con la marca)
// ----------------------------------------------------------------------------
//  Cabecera con el logotipo original (public/marca/logo-horizontal.svg: sus
//  trazos se dibujan tal cual con drawSvgPath, sin redibujarlo ni rasterizarlo;
//  sin el SVG, el nombre escrito), «PRESUPUESTO», número, fecha y validez; los
//  datos del negocio (Web › Contenido); el cliente; las líneas con su detalle
//  (la tabla sigue en la hoja siguiente si no cabe, con su cabecera); los
//  totales con descuento e IVA; las condiciones; y al pie, número y página.
//  Colores del manual de marca (COLORES_MARCA). Letra Helvetica del propio PDF
//  (WinAnsi: acentos, ñ, €, º…; lo que no cabe en ella se cambia por lo más
//  parecido). pdf-lib se carga con import(): no engorda la página.
// ============================================================================
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { COLORES_MARCA } from "@/config/negocio";
import { fechaCorta, validoHasta } from "./estados";
import type { NegocioDocumento } from "./documento";
import { calcularTotales, eurosCentimos, formatoCantidad, formatoPorcentaje, importeLinea } from "./totales";
import type { LineaPresupuesto, Presupuesto } from "./tipos";

export interface DatosPdfPresupuesto {
  presupuesto: Pick<
    Presupuesto,
    | "numero"
    | "fecha"
    | "validez_dias"
    | "cliente_nombre"
    | "cliente_telefono"
    | "cliente_email"
    | "cliente_direccion"
    | "cliente_poblacion"
    | "condiciones"
    | "descuento_pct"
    | "iva_pct"
  >;
  lineas: ReadonlyArray<Pick<LineaPresupuesto, "descripcion" | "detalle" | "cantidad" | "precio_unitario">>;
  negocio: NegocioDocumento;
  /** Texto del SVG del logotipo. Sin él (o si no se entiende), el nombre del negocio escrito. */
  logoSvg?: string | null;
}

/** «Presupuesto-P-2026-0001.pdf». */
export const nombrePdfPresupuesto = (numero: string): string => `Presupuesto-${numero.trim().replace(/[^\w.-]+/g, "-") || "sin-numero"}.pdf`;

/* ------------------------------------------------------------------ */
/* Logotipo: trazos del SVG                                            */
/* ------------------------------------------------------------------ */

export interface TrazosLogo {
  /** viewBox: x, y, ancho, alto. */
  caja: [number, number, number, number];
  trazos: { d: string; color: string }[];
}

/** Trazos (`<path d fill>`) y viewBox del SVG del logotipo, o null si no se entiende. */
export function trazosLogo(svg: string | null | undefined): TrazosLogo | null {
  if (!svg) return null;
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) return null;
  const trazos: TrazosLogo["trazos"] = [];
  for (const etiqueta of svg.match(/<path\b[^>]*>/g) ?? []) {
    const d = /\sd="([^"]+)"/.exec(etiqueta)?.[1];
    const color = /\sfill="(#[0-9a-fA-F]{6})"/.exec(etiqueta)?.[1] ?? COLORES_MARCA.marino;
    if (d) trazos.push({ d, color });
  }
  return trazos.length ? { caja: vb as TrazosLogo["caja"], trazos } : null;
}

/* ------------------------------------------------------------------ */
/* Texto                                                                */
/* ------------------------------------------------------------------ */

const SUSTITUTOS: Record<string, string> = { "−": "-", " ": " ", " ": " ", " ": " ", "→": "->", "≤": "<=", "≥": ">=", "≈": "~", "\t": " " };

/** Deja solo lo que la fuente sabe escribir: lo demás, por lo más parecido (sin acento) o «?». */
export function textoParaFuente(texto: string, soportados: ReadonlySet<number>): string {
  let out = "";
  for (const ch of String(texto ?? "").replace(/\r\n?/g, "\n")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || soportados.has(cp)) {
      out += ch;
      continue;
    }
    const sustituto = SUSTITUTOS[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += [...sustituto].every((c) => soportados.has(c.codePointAt(0) ?? 0)) && sustituto ? sustituto : "?";
  }
  return out;
}

/** Parte un texto en líneas que caben en `ancho` (respeta los saltos de línea; corta palabras demasiado largas). */
export function envolver(texto: string, font: Pick<PDFFont, "widthOfTextAtSize">, size: number, ancho: number): string[] {
  const lineas: string[] = [];
  const cabe = (t: string) => font.widthOfTextAtSize(t, size) <= ancho;
  for (const parrafo of texto.split("\n")) {
    if (!parrafo.trim()) {
      lineas.push("");
      continue;
    }
    let actual = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (cabe(prueba)) {
        actual = prueba;
        continue;
      }
      if (actual) lineas.push(actual);
      if (cabe(palabra)) {
        actual = palabra;
        continue;
      }
      // Palabra más larga que la línea (una URL, un código): se corta.
      let trozo = "";
      for (const c of palabra) {
        if (cabe(trozo + c)) trozo += c;
        else {
          lineas.push(trozo);
          trozo = c;
        }
      }
      actual = trozo;
    }
    if (actual) lineas.push(actual);
  }
  // Sin líneas en blanco al final.
  while (lineas.length && !lineas[lineas.length - 1]) lineas.pop();
  return lineas;
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

const A4: [number, number] = [595.28, 841.89];
const MARGEN = 48;
const PIE = 52;

export async function construirPdfPresupuesto(datos: DatosPdfPresupuesto): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const color = (hex: string): RGB => {
    const n = Number.parseInt(hex.replace("#", ""), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const MARINO = color(COLORES_MARCA.marino);
  const TINTA = color(COLORES_MARCA.tinta);
  const ACERO = color(COLORES_MARCA.acero);
  const NIEBLA = color(COLORES_MARCA.niebla);
  const CREMA = color(COLORES_MARCA.crema);
  const BLANCO = rgb(1, 1, 1);

  const { presupuesto: p, negocio } = datos;
  const doc = await PDFDocument.create();
  doc.setTitle(`Presupuesto ${p.numero}`);
  doc.setAuthor(negocio.nombre);
  doc.setSubject(`Presupuesto para ${p.cliente_nombre}`);
  doc.setCreator(`Panel de ${negocio.nombre}`);
  doc.setLanguage("es-ES");

  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const soportados = new Set(normal.getCharacterSet());
  const t = (s: string | null | undefined) => textoParaFuente(String(s ?? ""), soportados);

  const [ANCHO, ALTO] = A4;
  const IZQ = MARGEN;
  const DER = ANCHO - MARGEN;
  const paginas: PDFPage[] = [];
  let pagina!: PDFPage;
  let y = 0;

  const escribir = (texto: string, x: number, yy: number, { size = 10, font = normal, c = TINTA, alinear = "izq" as "izq" | "der" | "centro" } = {}) => {
    const limpio = t(texto);
    const w = font.widthOfTextAtSize(limpio, size);
    const xx = alinear === "der" ? x - w : alinear === "centro" ? x - w / 2 : x;
    pagina.drawText(limpio, { x: xx, y: yy, size, font, color: c });
  };

  const nuevaPagina = () => {
    pagina = doc.addPage(A4);
    paginas.push(pagina);
    y = ALTO - MARGEN;
  };

  // ── Cabecera ────────────────────────────────────────────────────────────
  nuevaPagina();
  const logo = trazosLogo(datos.logoSvg);
  const anchoLogo = 160;
  let altoCabecera = 0;
  if (logo) {
    const [vx, vy, vw, vh] = logo.caja;
    const escala = anchoLogo / vw;
    for (const trazo of logo.trazos) {
      pagina.drawSvgPath(trazo.d, { x: IZQ - vx * escala, y: y + vy * escala, scale: escala, color: color(trazo.color) });
    }
    altoCabecera = vh * escala;
  } else {
    escribir(negocio.nombre, IZQ, y - 18, { size: 16, font: negrita, c: MARINO });
    altoCabecera = 24;
  }
  escribir("PRESUPUESTO", DER, y - 18, { size: 20, font: negrita, c: MARINO, alinear: "der" });
  escribir(p.numero, DER, y - 36, { size: 12, font: negrita, alinear: "der" });
  escribir(`Fecha: ${fechaCorta(p.fecha)}`, DER, y - 51, { size: 9.5, c: ACERO, alinear: "der" });
  escribir(`Válido hasta: ${fechaCorta(validoHasta(p))}`, DER, y - 64, { size: 9.5, c: ACERO, alinear: "der" });
  y -= Math.max(altoCabecera, 66) + 12;

  // Datos del negocio
  const lineasNegocio = [negocio.direccion.join(" · "), [negocio.telefonos.join(" · "), negocio.email].filter(Boolean).join(" · ")].filter(Boolean);
  for (const l of lineasNegocio.flatMap((x) => envolver(t(x), normal, 8.5, DER - IZQ))) {
    escribir(l, IZQ, y, { size: 8.5, c: ACERO });
    y -= 11.5;
  }
  y -= 4;
  pagina.drawRectangle({ x: IZQ, y, width: DER - IZQ, height: 2, color: CREMA });
  pagina.drawRectangle({ x: IZQ, y: y - 0.75, width: DER - IZQ, height: 0.75, color: MARINO });
  y -= 18;

  // ── Cliente ─────────────────────────────────────────────────────────────
  const datosCliente = [
    p.cliente_direccion,
    p.cliente_poblacion,
    [p.cliente_telefono && `Tel. ${p.cliente_telefono}`, p.cliente_email].filter(Boolean).join(" · "),
  ]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .flatMap((x) => envolver(t(x), normal, 9.5, DER - IZQ - 24));
  const nombreCliente = envolver(t(p.cliente_nombre), negrita, 11.5, DER - IZQ - 24);
  const altoCliente = 14 + 12 + nombreCliente.length * 14 + datosCliente.length * 12.5 + 6;
  pagina.drawRectangle({ x: IZQ, y: y - altoCliente, width: DER - IZQ, height: altoCliente, color: NIEBLA });
  let yc = y - 18;
  escribir("CLIENTE", IZQ + 12, yc, { size: 8, font: negrita, c: ACERO });
  yc -= 15;
  for (const l of nombreCliente) {
    escribir(l, IZQ + 12, yc, { size: 11.5, font: negrita });
    yc -= 14;
  }
  for (const l of datosCliente) {
    escribir(l, IZQ + 12, yc, { size: 9.5 });
    yc -= 12.5;
  }
  y -= altoCliente + 20;

  // ── Líneas ──────────────────────────────────────────────────────────────
  const COL_IMPORTE = DER - 8;
  const COL_PRECIO = DER - 92;
  const COL_CANT = DER - 182;
  const ANCHO_CONCEPTO = COL_CANT - 40 - (IZQ + 8);
  const ALTO_CABECERA_TABLA = 20;

  const cabeceraTabla = () => {
    pagina.drawRectangle({ x: IZQ, y: y - ALTO_CABECERA_TABLA, width: DER - IZQ, height: ALTO_CABECERA_TABLA, color: MARINO });
    const yy = y - 13.5;
    escribir("Concepto", IZQ + 8, yy, { size: 9, font: negrita, c: BLANCO });
    escribir("Cant.", COL_CANT, yy, { size: 9, font: negrita, c: BLANCO, alinear: "der" });
    escribir("Precio", COL_PRECIO, yy, { size: 9, font: negrita, c: BLANCO, alinear: "der" });
    escribir("Importe", COL_IMPORTE, yy, { size: 9, font: negrita, c: BLANCO, alinear: "der" });
    y -= ALTO_CABECERA_TABLA + 14;
  };
  /** Asegura `alto` puntos libres; si no, sigue en una hoja nueva (con la cabecera de la tabla si se pide). */
  const hueco = (alto: number, conTabla = false) => {
    if (y - alto >= PIE + 8) return;
    nuevaPagina();
    if (conTabla) cabeceraTabla();
  };

  cabeceraTabla();
  if (!datos.lineas.length) {
    escribir("Sin líneas.", IZQ + 8, y, { size: 9.5, c: ACERO });
    y -= 16;
  }
  for (const linea of datos.lineas) {
    const titulo = envolver(t(linea.descripcion), negrita, 10, ANCHO_CONCEPTO);
    const detalle = linea.detalle ? envolver(t(linea.detalle), normal, 8.5, ANCHO_CONCEPTO) : [];
    // El título y los importes van juntos (y la primera línea del detalle, si la hay).
    hueco(titulo.length * 13 + (detalle.length ? 11 : 0), true);
    titulo.forEach((l, i) => {
      escribir(l, IZQ + 8, y, { size: 10, font: negrita });
      if (i === 0) {
        escribir(formatoCantidad(linea.cantidad), COL_CANT, y, { size: 9.5, alinear: "der" });
        escribir(eurosCentimos(linea.precio_unitario), COL_PRECIO, y, { size: 9.5, alinear: "der" });
        escribir(eurosCentimos(importeLinea(linea)), COL_IMPORTE, y, { size: 9.5, font: negrita, alinear: "der" });
      }
      y -= 13;
    });
    for (const l of detalle) {
      hueco(11, true);
      if (l) escribir(l, IZQ + 8, y, { size: 8.5, c: ACERO });
      y -= 11;
    }
    y += 4;
    pagina.drawLine({ start: { x: IZQ, y: y - 4 }, end: { x: DER, y: y - 4 }, thickness: 0.5, color: NIEBLA });
    y -= 18;
  }

  // ── Totales ─────────────────────────────────────────────────────────────
  const tot = calcularTotales(datos.lineas, p.descuento_pct, p.iva_pct);
  const filas: [string, string][] = [["Subtotal", eurosCentimos(tot.subtotal)]];
  if (tot.descuento > 0) filas.push([`Descuento (${formatoPorcentaje(p.descuento_pct)})`, `-${eurosCentimos(tot.descuento)}`]);
  filas.push(["Base imponible", eurosCentimos(tot.baseImponible)]);
  filas.push([`IVA (${formatoPorcentaje(p.iva_pct)})`, eurosCentimos(tot.iva)]);
  hueco(filas.length * 16 + 44);
  const IZQ_TOTALES = DER - 230;
  for (const [etiqueta, valor] of filas) {
    escribir(etiqueta, IZQ_TOTALES + 10, y, { size: 9.5, c: ACERO });
    escribir(valor, COL_IMPORTE, y, { size: 9.5, alinear: "der" });
    y -= 16;
  }
  y -= 8;
  pagina.drawRectangle({ x: IZQ_TOTALES, y: y - 9, width: DER - IZQ_TOTALES, height: 26, color: MARINO });
  escribir("TOTAL", IZQ_TOTALES + 10, y, { size: 11, font: negrita, c: BLANCO });
  escribir(eurosCentimos(tot.total), COL_IMPORTE, y, { size: 12, font: negrita, c: BLANCO, alinear: "der" });
  y -= 38;

  // ── Condiciones ─────────────────────────────────────────────────────────
  const condiciones = (p.condiciones ?? "").trim();
  if (condiciones) {
    // El título no se queda solo al pie: con él, al menos dos líneas.
    hueco(15 + 24);
    escribir("Condiciones", IZQ, y, { size: 10, font: negrita, c: MARINO });
    y -= 15;
    for (const l of envolver(t(condiciones), normal, 9, DER - IZQ)) {
      hueco(12);
      if (l) escribir(l, IZQ, y, { size: 9, c: TINTA });
      y -= 12;
    }
  }

  // ── Pie de cada hoja ────────────────────────────────────────────────────
  paginas.forEach((hoja, i) => {
    pagina = hoja;
    hoja.drawLine({ start: { x: IZQ, y: PIE - 14 }, end: { x: DER, y: PIE - 14 }, thickness: 0.5, color: NIEBLA });
    escribir(`${negocio.nombre} · ${negocio.email}`, IZQ, PIE - 28, { size: 8, c: ACERO });
    escribir(`${p.numero} · Página ${i + 1} de ${paginas.length}`, DER, PIE - 28, { size: 8, c: ACERO, alinear: "der" });
  });

  return doc.save();
}
