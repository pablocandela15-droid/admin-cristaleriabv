// ============================================================================
//  Datos del negocio (un solo sitio)
// ----------------------------------------------------------------------------
//  Nombre, logotipo y colores de Cristalería Baix Vinalopó, sacados del manual
//  de identidad corporativa v1.0 (noviembre 2026). Para cambiarlos, solo aquí
//  (y en `index.html`, `public/manifest.webmanifest` y `public/offline.html`,
//  que no pasan por React). Los colores del tema viven en `src/index.css`.
// ============================================================================

export const NEGOCIO = {
  /** Nombre completo: login, menú lateral e informes. «Baix Vinalopó» nunca se separa de «Cristalería». */
  nombre: "Cristalería Baix Vinalopó",
  /** Nombre corto para huecos estrechos (cabecera del móvil por debajo de 400 px). */
  nombreCorto: "Cristalería BV",
  /** Subtítulo del menú lateral, bajo «Admin Panel». */
  subtitulo: "Cristalería Baix Vinalopó",
  /** Titular y lema de la portada de la pantalla de acceso. */
  tituloAcceso: "Panel de gestión",
  lemaAcceso:
    "Trabajamos el vidrio con oficio para que la luz entre bien en cada casa, comercio y empresa del Baix Vinalopó.",
} as const;

/**
 * Logotipo original del manual (páginas 03 y 05), en `public/marca/`. No se redibuja ni se escribe con una
 * fuente: se coloca tal cual. Tamaños mínimos en pantalla: horizontal 140 px de ancho, símbolo 24 px de alto
 * (por debajo, el símbolo solo y el nombre escrito en texto al lado).
 */
export const LOGOTIPO = {
  /** Positivo: fondos blancos, marfil o azul claro. */
  horizontal: { src: "/marca/logo-horizontal.svg", ancho: 465, alto: 175 },
  /** Negativo: sobre azul marino (portada del login). */
  horizontalNegativo: { src: "/marca/logo-horizontal-negativo.svg", ancho: 465, alto: 175 },
  /** La cúpula sola: sirve igual sobre claro y sobre marino (menú lateral, cabecera del móvil, favicon). */
  simbolo: { src: "/marca/simbolo.svg", ancho: 120, alto: 175 },
} as const;

/** Paleta del manual (página 07), para lo que no pasa por las variables CSS (PDF, lienzos, correos). */
export const COLORES_MARCA = {
  marino: "#062C4C",
  crema: "#F6E9C6",
  claro: "#8FC4E4",
  marfil: "#FBF8EF",
  niebla: "#E4EBF1",
  acero: "#56687A",
  tinta: "#0B1A2A",
} as const;
