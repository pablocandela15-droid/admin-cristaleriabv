// ============================================================================
//  RRSS · formatos, medidas y límites (Instagram y Facebook)
// ----------------------------------------------------------------------------
//  Código puro: lo usan el panel (src/components/rrss, src/lib/rrss) y las Edge
//  Functions. Sin Deno ni imports remotos. Mismas reglas que la función SQL
//  public.rrss_pieza_problemas (migración 20261125100000_rrss).
//
//  Límites de Meta (documentación de Content Publishing de Instagram y de la
//  Graph API de páginas, consultada para el panel de referencia):
//    · Texto: 2200 caracteres, 30 hashtags y 20 menciones en Instagram. Las
//      historias no llevan texto por la API.
//    · Fotos: JPEG ≤ 8 MB, de 320 a 1440 px de ancho, entre 4:5 y 1,91:1; las
//      historias, 9:16. El panel las recorta a 1080 px de ancho.
//    · Carrusel: de 2 a 10 elementos (fotos o vídeos); todas las fotos con el
//      mismo recorte. En Facebook, «varias fotos» solo admite fotos.
//    · Vídeo: MP4/MOV (H.264 o HEVC, AAC). Reels de 3 s a 15 min; historias y
//      vídeos de un carrusel, de 3 a 60 s. Aquí, como mucho 50 MB (límite del
//      plan de Supabase para un fichero).
// ============================================================================

export type Red = "instagram" | "facebook";
export type FormatoPieza = "foto" | "carrusel" | "reel" | "story";
export type Proporcion = "4:5" | "1:1" | "1.91:1" | "9:16";
export type TipoMedio = "imagen" | "video";

export const REDES: readonly { valor: Red; nombre: string }[] = [
  { valor: "instagram", nombre: "Instagram" },
  { valor: "facebook", nombre: "Facebook" },
];

export const FORMATOS: readonly { valor: FormatoPieza; nombre: string; descripcion: string }[] = [
  { valor: "foto", nombre: "Foto", descripcion: "Una foto con su texto." },
  { valor: "carrusel", nombre: "Carrusel", descripcion: "De 2 a 10 fotos o vídeos que se pasan con el dedo." },
  { valor: "reel", nombre: "Reel (vídeo)", descripcion: "Un vídeo vertical; sale también en el perfil." },
  { valor: "story", nombre: "Historia", descripcion: "Una foto o vídeo vertical que dura 24 horas. Sin texto." },
];

/** Medidas de salida de cada recorte (ancho fijo de 1080 px, como recomienda Meta). */
export const PROPORCIONES: Readonly<Record<Proporcion, { ancho: number; alto: number; nombre: string }>> = {
  "4:5": { ancho: 1080, alto: 1350, nombre: "Vertical 4:5" },
  "1:1": { ancho: 1080, alto: 1080, nombre: "Cuadrada 1:1" },
  "1.91:1": { ancho: 1080, alto: 566, nombre: "Apaisada 1,91:1" },
  "9:16": { ancho: 1080, alto: 1920, nombre: "Historia 9:16" },
};

export const LIMITES = {
  caption: 2200,
  hashtags: 30,
  menciones: 20,
  altText: 1000,
  carruselMin: 2,
  carruselMax: 10,
  /** Bytes por fichero (límite del cubo «rrss»). */
  bytesFichero: 50 * 1024 * 1024,
  /** Bytes de una foto para Instagram. */
  bytesFoto: 8 * 1024 * 1024,
  videoMinS: 3,
  reelMaxS: 15 * 60,
  storyVideoMaxS: 60,
  carruselVideoMaxS: 60,
} as const;

/** Los tipos de trabajo de la web (web_albumes.servicio), en el mismo orden. */
export const SERVICIOS_RRSS = [
  { slug: "mamparas", nombre: "Mamparas" },
  { slug: "espejos", nombre: "Espejos" },
  { slug: "cerramientos", nombre: "Cerramientos" },
  { slug: "aluminio", nombre: "Aluminio" },
  { slug: "barandillas", nombre: "Barandillas" },
  { slug: "armarios", nombre: "Armarios" },
  { slug: "domino", nombre: "Dominó" },
  { slug: "otros", nombre: "Otros trabajos" },
] as const;
export type ServicioRrss = (typeof SERVICIOS_RRSS)[number]["slug"];

export const esRed = (v: unknown): v is Red => v === "instagram" || v === "facebook";
export const esFormato = (v: unknown): v is FormatoPieza => v === "foto" || v === "carrusel" || v === "reel" || v === "story";
export const esProporcion = (v: unknown): v is Proporcion => typeof v === "string" && v in PROPORCIONES;
export const esServicio = (v: unknown): v is ServicioRrss => SERVICIOS_RRSS.some((s) => s.slug === v);
export const nombreServicioRrss = (v: string | null | undefined): string | null => SERVICIOS_RRSS.find((s) => s.slug === v)?.nombre ?? null;

/** ¿Admite esa red ese formato? (Facebook no publica historias por la API). */
export const formatoAdmitido = (red: Red, formato: FormatoPieza): boolean => !(red === "facebook" && formato === "story");

/** Recorte que corresponde a un formato: la historia siempre 9:16; el reel, 9:16 (solo informativo). */
export function proporcionDeFormato(formato: FormatoPieza, elegida: Proporcion): Proporcion {
  if (formato === "story" || formato === "reel") return "9:16";
  return elegida === "9:16" ? "4:5" : elegida;
}

/** Duración máxima de un vídeo según dónde va. */
export function maxDuracionVideo(formato: FormatoPieza): number {
  if (formato === "reel") return LIMITES.reelMaxS;
  if (formato === "story") return LIMITES.storyVideoMaxS;
  return LIMITES.carruselVideoMaxS;
}
