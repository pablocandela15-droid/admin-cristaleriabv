// ============================================================================
//  RRSS · recorte de fotos en el navegador (sin servidor de render)
// ----------------------------------------------------------------------------
//  Instagram solo acepta JPEG por la API, entre 4:5 y 1,91:1 (historias 9:16),
//  de 320 a 1440 px de ancho. El panel de referencia lo hacía con Chromium en
//  Vercel; aquí se hace con un <canvas>: la foto (subida o de Web › Fotos) se
//  recorta a la proporción elegida con el encuadre (centro x/y + zoom), se
//  escala a 1080 px de ancho y se exporta a JPEG (sRGB, calidad 0,9). Al
//  redibujarla se quitan los metadatos (GPS y datos del móvil) y se aplica la
//  orientación EXIF. La cuenta del recorte es la misma que la de la vista previa.
// ============================================================================
import { PROPORCIONES, type Proporcion } from "../../../supabase/functions/_shared/rrss/formatos";

export interface Encuadre {
  /** Centro del recorte en la foto (0-1). */
  x: number;
  y: number;
  /** 1 = el recorte más grande que cabe; hasta 3. */
  zoom: number;
}

export const ENCUADRE_CENTRADO: Encuadre = { x: 0.5, y: 0.5, zoom: 1 };

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Recorte de proporción ancho:alto dentro de una imagen W×H: el más grande que cabe, dividido por el zoom, centrado en (x, y) y sin salirse. */
export function rectanguloRecorte(W: number, H: number, ancho: number, alto: number, e: Encuadre): Rect {
  const r = ancho / alto;
  let cw: number;
  let ch: number;
  if (W / H > r) {
    ch = H;
    cw = H * r;
  } else {
    cw = W;
    ch = W / r;
  }
  const zoom = Math.max(1, Math.min(3, e.zoom || 1));
  cw = Math.max(1, cw / zoom);
  ch = Math.max(1, ch / zoom);
  const cx = Math.max(0, Math.min(1, e.x)) * W;
  const cy = Math.max(0, Math.min(1, e.y)) * H;
  const left = Math.max(0, Math.min(W - cw, cx - cw / 2));
  const top = Math.max(0, Math.min(H - ch, cy - ch / 2));
  return { left: Math.round(left), top: Math.round(top), width: Math.round(cw), height: Math.round(ch) };
}

/** Nuevo centro tras arrastrar dx, dy px sobre un marco de `marcoAncho` px que enseña el recorte `rc` de una foto W×H. */
export function moverEncuadre(e: Encuadre, dx: number, dy: number, rc: Rect, W: number, H: number, marcoAncho: number): Encuadre {
  const escala = rc.width / Math.max(1, marcoAncho);
  return {
    ...e,
    x: Math.max(0, Math.min(1, e.x - (dx * escala) / W)),
    y: Math.max(0, Math.min(1, e.y - (dy * escala) / H)),
  };
}

/** Estilo CSS para pintar el recorte dentro de un marco (object-fit no sabe de zoom). */
export function estiloRecorteCss(W: number, H: number, marcoAncho: number, marcoAlto: number, e: Encuadre) {
  const rc = rectanguloRecorte(W, H, marcoAncho, marcoAlto, e);
  const escala = marcoAncho / rc.width;
  return { width: W * escala, height: H * escala, left: -rc.left * escala, top: -rc.top * escala };
}

/** ¿La foto se queda corta para la salida? (se amplía más de 1,5 veces). */
export function fotoPequena(W: number, H: number, proporcion: Proporcion, e: Encuadre): boolean {
  const s = PROPORCIONES[proporcion];
  const rc = rectanguloRecorte(W, H, s.ancho, s.alto, e);
  return s.ancho / rc.width > 1.5;
}

/** Carga una imagen (URL o fichero) para dibujarla. Las de Web › Fotos vienen de Supabase con CORS abierto. */
export async function cargarImagen(origen: string | Blob): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number; cerrar: () => void }> {
  const blob = typeof origen === "string" ? await (await fetch(origen, { mode: "cors" })).blob() : origen;
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { fuente: bmp, ancho: bmp.width, alto: bmp.height, cerrar: () => bmp.close() };
    } catch {
      // HEIC en navegadores que no lo leen, o bitmap sin opciones: se prueba con <img>.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se puede leer esta imagen. Si es HEIC (iPhone), expórtala como JPEG («Más compatible»)."));
      i.src = url;
    });
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Recorta y exporta a JPEG de 1080 px de ancho (≤ 8 MB: si pasa, baja la calidad). */
export async function recortarAJpeg(origen: string | Blob, proporcion: Proporcion, e: Encuadre): Promise<{ blob: Blob; ancho: number; alto: number }> {
  const img = await cargarImagen(origen);
  try {
    const s = PROPORCIONES[proporcion];
    const rc = rectanguloRecorte(img.ancho, img.alto, s.ancho, s.alto, e);
    const canvas = document.createElement("canvas");
    canvas.width = s.ancho;
    canvas.height = s.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no deja dibujar la imagen.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, s.ancho, s.alto);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.fuente, rc.left, rc.top, rc.width, rc.height, 0, 0, s.ancho, s.alto);
    for (const calidad of [0.9, 0.82, 0.72]) {
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", calidad));
      if (blob && blob.size <= 8 * 1024 * 1024) return { blob, ancho: s.ancho, alto: s.alto };
    }
    throw new Error("La foto no baja de 8 MB. Prueba con otra.");
  } finally {
    img.cerrar();
  }
}

/** Duración y medidas de un vídeo (para validarlo antes de subirlo). */
export function datosVideo(fichero: Blob): Promise<{ duracion: number; ancho: number; alto: number }> {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(fichero);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      ok({ duracion: v.duration, ancho: v.videoWidth, alto: v.videoHeight });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      mal(new Error("No se puede leer este vídeo. Expórtalo en MP4 (H.264)."));
    };
    v.src = url;
  });
}
