// ============================================================================
//  Archivado del documento original en Supabase Storage
// ----------------------------------------------------------------------------
//  Bucket privado `facturas-originales` (migración 20261121100000_facturas):
//    - pendientes/{uid}/{trabajo}/…  lo que sube el panel para el OCR por
//      trabajos (piezas y original). Las piezas se borran al guardar o fallar
//      el trabajo (limpiarPendientesTrabajo); lo que quede, la limpieza diaria
//      (ocr-trabajo, modo «limpiar»).
//    - originales/AAAA/MM/{factura}-{nombre}  el original de cada factura, para
//      siempre (facturas.archivo_path). El panel lo abre con una URL firmada.
//  Nunca lanza: el documento ya está en la base de datos y un fallo de
//  archivado no debe invalidar la lectura (queda dicho en la respuesta).
// ============================================================================

export const STORAGE_BUCKET = "facturas-originales";
/** Prefijo de los originales archivados. */
export const CARPETA_ORIGINALES = "originales";

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

const DIACRITICOS = /[̀-ͯ]/g;

/** Nombre de fichero seguro para una clave de Storage. */
export function nombreSeguro(nombre: string): string {
  const limpio = (nombre || "documento")
    .normalize("NFD")
    .replace(DIACRITICOS, "")         // "Factura Nº Ángel" -> "Factura N Angel"
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);                     // por la cola: conserva la extension
  return limpio || "documento";
}

/** Ruta del original de una factura: originales/AAAA/MM/{factura}-{nombre} (sin fecha, el mes de hoy). */
export function rutaOriginal(fecha: string | null | undefined, facturaId: number, fileName: string): string {
  const f = /^\d{4}-\d{2}/.test(fecha ?? "") ? (fecha as string) : new Date().toISOString().slice(0, 10);
  return `${CARPETA_ORIGINALES}/${f.slice(0, 4)}/${f.slice(5, 7)}/${facturaId}-${nombreSeguro(fileName)}`;
}

export function mimeDeNombre(nombre: string, tipo?: string | null): string {
  if (tipo && tipo !== "application/octet-stream") return tipo;
  const n = nombre.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (/\.(jpe?g)$/.test(n)) return "image/jpeg";
  return "application/octet-stream";
}

export interface ResultadoArchivo {
  /** Dónde quedó el original en el bucket (null si se ha perdido). */
  archivo_path: string | null;
  /** Por qué no se pudo archivar (o por qué quedó donde no tocaba). */
  error: string | null;
}

function aBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Archiva un original que llega en base64 (camino síncrono de una página) en
 * su ruta definitiva. Nunca lanza.
 */
// deno-lint-ignore no-explicit-any
export async function archivarOriginal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  b64: string,
  fileName: string,
  mimeType: string,
  fecha: string | null,
  facturaId: number,
): Promise<ResultadoArchivo> {
  let bytes: Uint8Array;
  try {
    bytes = aBytes(b64);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "base64 invalido";
    console.error("[archivo] No se pudo decodificar el base64:", msg);
    return { archivo_path: null, error: msg };
  }
  const path = rutaOriginal(fecha, facturaId, fileName);
  try {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, new Blob([bytes], { type: mimeType }), { contentType: mimeType, upsert: true });
    if (error) throw new Error(`Storage upload: ${error.message}`);
    return { archivo_path: path, error: null };
  } catch (e) {
    const msg = mensaje(e);
    // Este SI es un problema serio: se ha perdido el original.
    console.error(`[archivo] PERDIDA DEL ORIGINAL de la factura ${facturaId} (${fileName}): ${msg}`);
    return { archivo_path: null, error: msg };
  }
}

/**
 * Archiva un original que ya está en el bucket (pendientes/…: documentos por
 * trabajos, sustituir, añadir página): lo MUEVE a su ruta definitiva (por
 * defecto rutaOriginal; `destino` para otra). Si no se puede mover, sigue a
 * salvo donde estaba y se apunta ahí. Nunca lanza.
 */
// deno-lint-ignore no-explicit-any
export async function archivarDesdeStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  desde: string,
  nombre: string,
  fecha: string | null,
  facturaId: number,
  destino: string | null = null,
): Promise<ResultadoArchivo> {
  const hasta = destino ?? rutaOriginal(fecha, facturaId, nombre);
  const m = await moverPendiente(supabase, desde, hasta);
  if (m.path) return { archivo_path: m.path, error: null };
  console.error(`[archivo] No se pudo mover ${desde} a ${hasta} (factura ${facturaId}); se queda donde estaba:`, m.error);
  return { archivo_path: desde, error: `no se pudo mover a ${hasta}: ${m.error}` };
}

/**
 * Mueve un fichero ya subido (pendientes/{uid}/{trabajo}/…) a otra ruta del
 * bucket. Si el destino ya existe (reintento), no es error: se devuelve.
 * Nunca lanza: devuelve la ruta final o el error.
 */
// deno-lint-ignore no-explicit-any
export async function moverPendiente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  desde: string,
  hasta: string,
): Promise<{ path: string | null; error: string | null }> {
  try {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).move(desde, hasta);
    if (!error) return { path: hasta, error: null };
    // Reintento: el destino ya está (se movió en un intento anterior).
    const carpeta = hasta.slice(0, hasta.lastIndexOf("/"));
    const nombre = hasta.slice(hasta.lastIndexOf("/") + 1);
    const { data } = await supabase.storage.from(STORAGE_BUCKET).list(carpeta, { search: nombre });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (Array.isArray(data) && data.some((o: any) => o?.name === nombre)) return { path: hasta, error: null };
    return { path: null, error: error.message ?? String(error) };
  } catch (e) {
    return { path: null, error: mensaje(e) };
  }
}

/**
 * Borra de Storage los ficheros de pendientes/ de un trabajo de OCR (piezas y
 * original) al terminarlo o fallar. Respeta lo que alguna factura use todavía
 * como archivo_path. Nunca lanza; devuelve cuántos borró.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function limpiarPendientesTrabajo(supabase: any, trabajoId: string): Promise<number> {
  try {
    const [{ data: t }, { data: piezas }, { data: facturas, error: eFacturas }] = await Promise.all([
      supabase.from("ocr_trabajos").select("original_path").eq("id", trabajoId).maybeSingle(),
      supabase.from("ocr_trabajo_paginas").select("storage_path").eq("trabajo_id", trabajoId),
      supabase.from("facturas").select("id, archivo_path").eq("ocr_trabajo_id", trabajoId),
    ]);
    if (eFacturas) throw new Error(eFacturas.message);
    // Si la factura de este trabajo no tiene original, lo de pendientes/ es lo
    // ÚNICO que queda: no se borra nada.
    type FacturaOriginal = { id: number; archivo_path: string | null };
    const sinOriginal = ((facturas ?? []) as FacturaOriginal[]).filter((f) => f && !f.archivo_path);
    if (sinOriginal.length > 0) {
      console.warn(
        `[archivo] el trabajo ${trabajoId} tiene la factura ${sinOriginal.map((f) => f.id).join(", ")} sin original: no se borra pendientes/`,
      );
      return 0;
    }
    const rutas = [...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [t?.original_path, ...((piezas ?? []) as any[]).map((p) => p?.storage_path)]
        .filter((r): r is string => typeof r === "string" && r.startsWith("pendientes/")),
    )];
    if (rutas.length === 0) return 0;
    const { data: usadas, error: eUsadas } = await supabase.from("facturas").select("archivo_path").in("archivo_path", rutas);
    if (eUsadas) throw new Error(eUsadas.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enUso = new Set(((usadas ?? []) as any[]).map((f) => f.archivo_path));
    const borrar = rutas.filter((r) => !enUso.has(r));
    if (borrar.length === 0) return 0;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(borrar);
    if (error) throw new Error(error.message);
    return borrar.length;
  } catch (e) {
    console.warn(`[archivo] No se pudieron borrar los ficheros de pendientes/ del trabajo ${trabajoId} (lo hará la limpieza):`, mensaje(e));
    return 0;
  }
}
