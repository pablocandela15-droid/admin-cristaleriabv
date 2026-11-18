// ============================================================================
// ALTO DISPONIBLE — cuentas puras (sin DOM) del alto de pantalla de cada página
// ----------------------------------------------------------------------------
// Regla del panel (2026-10-04): «que cada vista calcule la altura para el
// tamaño de la pantalla, para que sea fija, sin scroll». El hook
// `useAlturaDisponible` mide el DOM; aquí viven las cuentas, que son lo que se
// testea (jsdom no calcula layout).
//
// ALTURA DEL BLOQUE = alto del viewport VISUAL − posición del bloque en la
// PÁGINA − relleno inferior del layout. La posición es relativa al documento
// (top + scrollY), no a la ventana: si fuera la de la ventana, al hacer scroll
// el bloque encogería a cada paso.
//
// SUELO (`ALTURA_MINIMA_BLOQUE`): por debajo, el bloque no encoge más y la
// página hace scroll. Equivale a una ventana de ~640 px de alto.
// ============================================================================

/** Alto mínimo del bloque (px) por defecto: por debajo, scroll de página. */
export const ALTURA_MINIMA_BLOQUE = 520;

export interface EntradaAltura {
  /** `getBoundingClientRect().top + scrollY` del bloque: su posición en el documento. */
  topPagina: number;
  /** Alto del viewport visual (`visualViewport.height`, o `innerHeight` sin soporte). */
  altoVisible: number;
  /** Relleno inferior del `<main>` del layout. */
  paddingInferior: number;
  minimo?: number;
}

/**
 * Alto (px, entero) que le queda al bloque desde su posición hasta el fondo
 * visible, con el relleno del layout respetado, y nunca menos que el suelo.
 * Entradas no finitas (medidas rotas) caen al suelo.
 */
export function calcularAlturaDisponible({
  topPagina,
  altoVisible,
  paddingInferior,
  minimo = ALTURA_MINIMA_BLOQUE,
}: EntradaAltura): number {
  const bruto = Math.floor(altoVisible - topPagina - paddingInferior);
  return Number.isFinite(bruto) ? Math.max(minimo, bruto) : minimo;
}
