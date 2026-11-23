// ============================================================================
//  Web › Contenido: forma de cada bloque de `web_contenido` (sin React)
// ----------------------------------------------------------------------------
//  La web (cristaleriabv) mezcla cada `valor` sobre lo de su código:
//    · negocio:   parcial de `site` (mezcla superficial; address por campos);
//    · servicios: { [slug]: parcial de Service sin slug };
//    · faq:       lista completa [{q, a, tags}] (vacía = la del código);
//    · imagenes:  { hero?, heroHouse?, about?, aboutHands?, contact? } con
//                 {ruta, alt} en el bucket web-fotos (también acepta la ruta sola).
// ============================================================================
import { urlFotoWeb } from "./fotos";

export type ClaveContenido = "negocio" | "servicios" | "faq" | "imagenes";

export interface TelefonoWeb {
  label: string;
  display: string;
  tel: string;
}
export interface DireccionWeb {
  street?: string;
  postalCode?: string;
  city?: string;
  province?: string;
  country?: string;
  lat?: number;
  lon?: number;
}
export interface HorarioWeb {
  days: string;
  time: string;
}
export interface NegocioWeb {
  tagline?: string;
  description?: string;
  yearsExperience?: number;
  phones?: TelefonoWeb[];
  whatsapp?: string;
  email?: string;
  address?: DireccionWeb;
  hours?: HorarioWeb[];
  serviceArea?: string;
}

export interface ServicioWeb {
  name?: string;
  short?: string;
  headline?: string;
  intro?: string;
  features?: string[];
  ideas?: string[];
  seoTitle?: string;
  seoDescription?: string;
}
export type ServiciosWeb = Record<string, ServicioWeb>;

export interface PreguntaWeb {
  q: string;
  a: string;
  tags: string[];
}

export interface ImagenWeb {
  ruta: string;
  alt?: string;
}
export const HUECOS_IMAGEN = [
  { clave: "hero", titulo: "Portada", detalle: "La foto grande de arriba de la página de inicio." },
  { clave: "heroHouse", titulo: "Portada (segunda)", detalle: "La foto de la casa que acompaña a la portada." },
  { clave: "about", titulo: "Quiénes somos", detalle: "La foto principal del apartado «Quiénes somos»." },
  { clave: "aboutHands", titulo: "Quiénes somos (detalle)", detalle: "La foto pequeña del taller en «Quiénes somos»." },
  { clave: "contact", titulo: "Contacto", detalle: "La foto de la página de contacto." },
] as const;
export type HuecoImagen = (typeof HUECOS_IMAGEN)[number]["clave"];
export type ImagenesWeb = Partial<Record<HuecoImagen, ImagenWeb | string>>;

/** Dirección de la web en producción: de ahí salen las imágenes que trae su código. */
export const URL_WEB = "https://cristaleriabv.vercel.app";

/** Las imágenes que tiene hoy el código de la web (cristaleriabv › src/content/images.ts). */
export const IMAGENES_POR_DEFECTO: Record<HuecoImagen, { src: string; alt: string }> = {
  hero: {
    src: "/images/hero/bano-mampara-cristal-luminoso.jpg",
    alt: "Baño moderno y luminoso con mampara de cristal transparente y bañera exenta",
  },
  heroHouse: {
    src: "/images/hero/casa-mediterranea-ventanales.jpg",
    alt: "Casa mediterránea blanca de líneas modernas con grandes ventanales bajo el cielo azul",
  },
  about: {
    src: "/images/about/manos-cortando-cristal.jpg",
    alt: "Manos de un cristalero cortando una lámina de vidrio con cortavidrios en el taller",
  },
  aboutHands: {
    src: "/images/about/manos-cortando-vidrio-guantes.jpg",
    alt: "Manos con guantes manipulando piezas de vidrio sobre la mesa de trabajo del taller",
  },
  contact: {
    src: "/images/contact/interior-luminoso-cristal.jpg",
    alt: "Salón sereno y luminoso con sofá claro frente a grandes puertas correderas de cristal con vistas al bosque",
  },
};

export const urlImagenPorDefecto = (hueco: HuecoImagen) => `${URL_WEB}${IMAGENES_POR_DEFECTO[hueco].src}`;

/** La imagen elegida para un hueco ({ruta, alt} o la ruta sola), o null si va la de la web. */
export function imagenElegida(imagenes: ImagenesWeb | null | undefined, hueco: HuecoImagen): ImagenWeb | null {
  const v = imagenes?.[hueco];
  if (typeof v === "string") return v.trim() ? { ruta: v.trim() } : null;
  if (v && typeof v === "object" && typeof v.ruta === "string" && v.ruta.trim()) {
    return { ruta: v.ruta.trim(), ...(typeof v.alt === "string" && v.alt.trim() ? { alt: v.alt.trim() } : {}) };
  }
  return null;
}

/** URL y texto alternativo de lo que enseña la web en ese hueco. */
export function imagenEnLaWeb(imagenes: ImagenesWeb | null | undefined, hueco: HuecoImagen, baseSupabase: string) {
  const elegida = imagenElegida(imagenes, hueco);
  if (elegida) return { url: urlFotoWeb(baseSupabase, elegida.ruta), alt: elegida.alt ?? IMAGENES_POR_DEFECTO[hueco].alt, porDefecto: false };
  return { url: urlImagenPorDefecto(hueco), alt: IMAGENES_POR_DEFECTO[hueco].alt, porDefecto: true };
}

const texto = (v: unknown) => (typeof v === "string" ? v : "");
const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Lista de textos de un área con una línea por elemento (características, ideas). */
export const lineas = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);
/** Etiquetas separadas por comas. */
export const etiquetas = (v: string) => v.split(",").map((l) => l.trim()).filter(Boolean);

/** Teléfono para enlazar (`tel:`) a partir de cómo se escribe: «650 06 63 23» → «+34650066323». */
export function telefonoEnlace(display: string): string {
  const digitos = display.replace(/[^\d+]/g, "");
  if (!digitos) return "";
  if (digitos.startsWith("+")) return digitos;
  if (digitos.startsWith("00")) return `+${digitos.slice(2)}`;
  return digitos.length === 9 ? `+34${digitos}` : digitos;
}

/** Preguntas válidas (con pregunta y respuesta), sin espacios de más. */
export function limpiarFaq(lista: unknown): PreguntaWeb[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter(esObjeto)
    .map((p) => ({
      q: texto(p.q).trim(),
      a: texto(p.a).trim(),
      tags: Array.isArray(p.tags) ? p.tags.map((t) => texto(t).trim()).filter(Boolean) : [],
    }))
    .filter((p) => p.q && p.a);
}

/** Negocio sin campos vacíos (lo vacío no se manda: la web pone lo de su código). */
export function limpiarNegocio(n: NegocioWeb): NegocioWeb {
  const out: NegocioWeb = {};
  for (const k of ["tagline", "description", "whatsapp", "email", "serviceArea"] as const) {
    const v = texto(n[k]).trim();
    if (v) out[k] = v;
  }
  if (typeof n.yearsExperience === "number" && Number.isFinite(n.yearsExperience) && n.yearsExperience > 0) out.yearsExperience = Math.round(n.yearsExperience);
  const phones = (n.phones ?? [])
    .map((p) => ({ label: texto(p.label).trim(), display: texto(p.display).trim(), tel: texto(p.tel).trim() || telefonoEnlace(texto(p.display)) }))
    .filter((p) => p.display);
  if (phones.length) out.phones = phones;
  const hours = (n.hours ?? []).map((h) => ({ days: texto(h.days).trim(), time: texto(h.time).trim() })).filter((h) => h.days || h.time);
  if (hours.length) out.hours = hours;
  if (n.address) {
    const a: DireccionWeb = {};
    for (const k of ["street", "postalCode", "city", "province", "country"] as const) {
      const v = texto(n.address[k]).trim();
      if (v) a[k] = v;
    }
    for (const k of ["lat", "lon"] as const) {
      const v = n.address[k];
      if (typeof v === "number" && Number.isFinite(v)) a[k] = v;
    }
    if (Object.keys(a).length) out.address = a;
  }
  return out;
}

/** Servicio sin campos vacíos. */
export function limpiarServicio(s: ServicioWeb): ServicioWeb {
  const out: ServicioWeb = {};
  for (const k of ["name", "short", "headline", "intro", "seoTitle", "seoDescription"] as const) {
    const v = texto(s[k]).trim();
    if (v) out[k] = v;
  }
  for (const k of ["features", "ideas"] as const) {
    const v = (s[k] ?? []).map((x) => texto(x).trim()).filter(Boolean);
    if (v.length) out[k] = v;
  }
  return out;
}
