/**
 * Estilo de los informes en diapositivas (16:9, titular que cuenta la conclusión, cifras grandes, tarjetas y
 * número de página) con la identidad de Cristalería Baix Vinalopó (manual de marca v1.0, nov. 2026): papel
 * marfil, azul marino, crema y el azul del cristal; titulares y cifras en Lexend (la sans del logotipo) y
 * textos de apoyo en Inter.
 *
 * Las diapositivas se diseñan a 1280 × 720 px y se escalan al ancho disponible
 * (vista previa) o se rasterizan a ×3 (PDF), así que todas las medidas de los
 * componentes van en px de ese lienzo.
 *
 * Contraste del texto (WCAG 2):
 *   marfil #FBF8EF → marino 13,4:1 · acero 5,4:1 · acento 6,0:1
 *   marino #062C4C → blanco 14,3:1 · crema 11,8:1 · azul claro 7,6:1
 *   acento #246394 → blanco 6,4:1
 *   azul claro #8FC4E4 sobre marfil 1,8:1: solo como borde o serie con leyenda y cifra, nunca como texto.
 */

export const ANCHO_DIAPOSITIVA = 1280;
export const ALTO_DIAPOSITIVA = 720;

/** Familias propias (cargadas por `fuente.ts`): Inter para textos y Lexend para titulares y cifras. */
export const FAMILIA_INFORME = "Inter Informe";
export const FAMILIA_TITULOS = "Lexend Informe";
export const PILA_FUENTES = `"${FAMILIA_INFORME}", "Inter Variable", Inter, Arial, system-ui, sans-serif`;
export const PILA_TITULOS = `"${FAMILIA_TITULOS}", "Lexend Variable", Lexend, Arial, system-ui, sans-serif`;

export const COLOR = {
  /** Marfil #FBF8EF: el papel del manual, fondo de las diapositivas. */
  papel: "#FBF8EF",
  /** Azul marino #062C4C: titulares, cifras, texto, filetes y tarjetas. */
  marino: "#062C4C",
  /** Acero #56687A: textos de apoyo y ejes. */
  tenue: "#56687A",
  blanco: "#FFFFFF",
  /** Niebla #E4EBF1, un punto más oscura para que se vea sobre el marfil: rejilla y filetes finos. */
  rejilla: "#D3DDE6",
  /** El azul del cristal, oscurecido para leerse sobre marfil: acentos e insignia «sube». */
  acento: "#246394",
  /** Azul claro #8FC4E4: bordes y series secundarias (con leyenda y cifra). */
  claro: "#8FC4E4",
  /** Crema #F6E9C6: acento sobre la tarjeta marina. */
  crema: "#F6E9C6",
} as const;
