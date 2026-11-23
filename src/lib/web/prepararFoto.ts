/**
 * Foto lista para la web: lado mayor como mucho 2400 px y WebP al 85 % (lienzo del navegador), respetando la
 * orientación de la cámara. Devuelve también sus medidas finales (web_fotos.ancho/alto: la web reserva el hueco y
 * no salta al cargar). Mismo cuidado que redimensionarFoto (Facturas) con las fotos grandes del móvil: se decodifica
 * ya reducida y se comprueba que el lienzo no ha salido vacío.
 */
import { bitmapReducido } from "@/lib/imagen/medidasFoto";
import { medidasDestino, pareceVacia } from "@/lib/imagen/redimensionarFoto";
import { CALIDAD_WEBP_WEB, LADO_MAX_FOTO_WEB, TIPOS_FOTO_WEB } from "./fotos";

export interface FotoPreparada {
  blob: Blob;
  ancho: number;
  alto: number;
}

export const esFotoAdmitida = (f: File) => TIPOS_FOTO_WEB.includes(f.type) || /\.(jpe?g|png|webp|avif)$/i.test(f.name);

export async function prepararFotoWeb(foto: Blob): Promise<FotoPreparada> {
  const bmp = await bitmapReducido(foto, LADO_MAX_FOTO_WEB);
  try {
    const final = medidasDestino(bmp.width, bmp.height, LADO_MAX_FOTO_WEB);
    const canvas = document.createElement("canvas");
    canvas.width = final.ancho;
    canvas.height = final.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no deja procesar la foto (sin lienzo).");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, final.ancho, final.alto);
    const muestra = ctx.getImageData(0, 0, Math.min(64, final.ancho), Math.min(64, final.alto)).data;
    if (pareceVacia(muestra) && pareceVacia(ctx.getImageData(0, 0, final.ancho, final.alto).data)) {
      throw new Error("La foto ha salido vacía al procesarla (demasiado grande para este dispositivo).");
    }
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", CALIDAD_WEBP_WEB));
    if (!blob || !blob.size) throw new Error("No se ha podido convertir la foto.");
    // Safari antiguo no sabe hacer WebP y devuelve PNG: el bucket lo admite igual, pero se avisa en el tipo.
    return { blob, ancho: final.ancho, alto: final.alto };
  } finally {
    bmp.close();
  }
}
