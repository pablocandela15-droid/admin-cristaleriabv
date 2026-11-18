/**
 * Tipografía del informe, servida desde el propio panel (la CSP solo deja
 * fuentes de 'self') y cargada solo cuando se abre el informe:
 *   · Lexend (la sans del logotipo, manual de marca, página 08) para titulares y
 *     cifras: variable 100–900, subconjunto latino, OFL (`fuentes/OFL-Lexend.txt`).
 *   · Inter para los textos de apoyo y las gráficas: variable, subconjunto
 *     latino, 48 KB, OFL (`fuentes/OFL-Inter.txt`).
 *
 * Se declara con una regla `@font-face` en un `<style>` (no con la API
 * FontFace) porque html2canvas copia los estilos del documento al iframe en el
 * que maqueta la captura: si la fuente no estuviera allí, el texto se colocaría
 * con otra fuente y se dibujaría con Inter, descuadrado.
 */
import urlInter from "./fuentes/inter-latin-wght-normal.woff2?url";
import urlLexend from "./fuentes/lexend-latin-wght-normal.woff2?url";
import { FAMILIA_INFORME, FAMILIA_TITULOS } from "./tema";

const ID_ESTILO = "fuente-informe";

const reglaFontFace = (familia: string, src: string, pesos: string): string =>
  `@font-face{font-family:"${familia}";src:url("${src}") format("woff2");font-weight:${pesos};font-style:normal;font-display:block;}`;

/** Declara la fuente (una vez) y espera a que estén listos el peso normal y la negrita. */
export async function prepararFuenteInforme(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!document.getElementById(ID_ESTILO)) {
    const estilo = document.createElement("style");
    estilo.id = ID_ESTILO;
    estilo.textContent = reglaFontFace(FAMILIA_INFORME, urlInter, "100 900") + reglaFontFace(FAMILIA_TITULOS, urlLexend, "100 900");
    document.head.appendChild(estilo);
  }
  if (!document.fonts?.load) return;
  try {
    await Promise.all([
      ...[400, 500, 600, 700].map((peso) => document.fonts.load(`${peso} 32px "${FAMILIA_INFORME}"`, "Informe 0123456789 %")),
      ...[400, 600].map((peso) => document.fonts.load(`${peso} 32px "${FAMILIA_TITULOS}"`, "Informe 0123456789 %")),
    ]);
  } catch {
    // Sin la fuente se usa la del sistema (system-ui): el informe sigue siendo legible.
  }
}

let cssEmbebido: Promise<string | null> | null = null;

/**
 * La misma `@font-face` con la fuente incrustada (data: URI), para meterla
 * dentro de cada gráfica al capturarla para el PDF (ver `pdf.ts`): una imagen
 * SVG no ve las fuentes del documento.
 */
export function cssFuenteEmbebida(): Promise<string | null> {
  cssEmbebido ??= (async () => {
    try {
      const respuesta = await fetch(urlInter);
      if (!respuesta.ok) return null;
      const bytes = new Uint8Array(await respuesta.arrayBuffer());
      let binario = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `${reglaFontFace(FAMILIA_INFORME, `data:font/woff2;base64,${btoa(binario)}`, "100 900")} text{font-family:"${FAMILIA_INFORME}",system-ui,sans-serif;}`;
    } catch {
      return null;
    }
  })();
  return cssEmbebido;
}
