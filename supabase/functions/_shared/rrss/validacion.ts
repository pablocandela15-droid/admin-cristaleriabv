// ============================================================================
//  RRSS · qué le falta a una publicación para poder salir
// ----------------------------------------------------------------------------
//  Espejo de public.rrss_pieza_problemas (migración 20261125100000_rrss): lo
//  usan el panel (antes de publicar o programar, para decirlo en llano) y
//  rrss-publicar / rrss-programador (antes de llamar a Meta). Las pruebas
//  comprueban los mismos casos. Código puro, sin Deno.
// ============================================================================
import { formatoAdmitido, LIMITES, maxDuracionVideo, type FormatoPieza, type Red, type TipoMedio } from "./formatos.ts";

export interface PiezaValidable {
  red: Red;
  formato: FormatoPieza;
  caption: string;
  medios_borrados_at?: string | null;
}

export interface MedioValidable {
  tipo: TipoMedio;
  duracion_s?: number | null;
  bytes?: number | null;
  alt_text?: string | null;
}

export interface CuentaTexto {
  caracteres: number;
  hashtags: number;
  menciones: number;
}

// Mismas expresiones que la función SQL (sin \b para que valgan igual en Postgres).
const RE_HASHTAG = /(^|[^\p{L}\p{N}_&])#[^\s#]+/gu;
const RE_MENCION = /(^|[^\p{L}\p{N}_])@[A-Za-z0-9._]+/gu;

/** Caracteres (como los cuenta Instagram: puntos de código), hashtags y menciones de un texto. */
export function contarTexto(texto: string): CuentaTexto {
  const t = texto ?? "";
  return {
    caracteres: Array.from(t).length,
    hashtags: (t.match(RE_HASHTAG) ?? []).length,
    menciones: (t.match(RE_MENCION) ?? []).length,
  };
}

/** Hashtags del texto, en minúsculas y sin repetir (para «qué funciona»). */
export function hashtagsDe(texto: string | null | undefined): string[] {
  const vistos = new Set<string>();
  for (const m of (texto ?? "").matchAll(/(?:^|[^\p{L}\p{N}_&])(#[\p{L}\p{N}_]+)/gu)) vistos.add(m[1].toLowerCase());
  return [...vistos].slice(0, 60);
}

/** Lista de problemas en castellano (vacía = se puede publicar). */
export function problemasPieza(pieza: PiezaValidable, medios: readonly MedioValidable[]): string[] {
  const p: string[] = [];
  const n = medios.length;
  const imagenes = medios.filter((m) => m.tipo === "imagen").length;
  const videos = medios.filter((m) => m.tipo === "video").length;
  if (!formatoAdmitido(pieza.red, pieza.formato)) p.push("Facebook no admite historias desde el panel");
  if (pieza.formato === "foto" && !(n === 1 && imagenes === 1)) p.push("Una foto necesita exactamente una imagen");
  if (pieza.formato === "carrusel" && !(n >= LIMITES.carruselMin && n <= LIMITES.carruselMax)) p.push("Un carrusel lleva de 2 a 10 fotos o vídeos");
  if (pieza.formato === "carrusel" && pieza.red === "facebook" && videos > 0) p.push("En Facebook, una publicación de varias fotos no admite vídeos");
  if (pieza.formato === "reel" && !(n === 1 && videos === 1)) p.push("Un reel necesita exactamente un vídeo");
  if (pieza.formato === "story" && n !== 1) p.push("Una historia lleva una sola foto o un solo vídeo");
  const cuenta = contarTexto(pieza.caption);
  if (cuenta.caracteres > LIMITES.caption) p.push(`El texto pasa de ${LIMITES.caption} caracteres`);
  if (pieza.red === "instagram" && cuenta.hashtags > LIMITES.hashtags) p.push("Instagram admite como mucho 30 hashtags");
  if (pieza.red === "instagram" && cuenta.menciones > LIMITES.menciones) p.push("Instagram admite como mucho 20 menciones");
  if (pieza.formato !== "story" && pieza.caption.trim() === "" && pieza.red === "facebook") p.push("En Facebook hace falta un texto");
  if (pieza.medios_borrados_at) p.push("Sus ficheros ya se borraron del panel");
  const max = maxDuracionVideo(pieza.formato);
  for (const m of medios) {
    if (m.tipo === "video" && typeof m.duracion_s === "number") {
      if (m.duracion_s < LIMITES.videoMinS) p.push(`Un vídeo dura menos de ${LIMITES.videoMinS} segundos`);
      else if (m.duracion_s > max) p.push(`Un vídeo pasa de ${max >= 120 ? `${max / 60} minutos` : `${max} segundos`}`);
    }
    if (typeof m.bytes === "number" && m.bytes > LIMITES.bytesFichero) p.push("Un fichero pasa de 50 MB");
    if ((m.alt_text ?? "").length > LIMITES.altText) p.push("Un texto alternativo pasa de 1000 caracteres");
  }
  return [...new Set(p)];
}
