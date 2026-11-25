// RRSS · respuestas HTTP de las funciones (JSON saneado con CORS) y lectura del cuerpo.
import { sanearProfundo } from "./secretos.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ocr-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** Respuesta JSON SIEMPRE saneada (ningún token, secreto ni JWT puede salir). */
export function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(sanearProfundo(cuerpo)), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export const MAX_CUERPO = 64 * 1024;

/** Cuerpo JSON de un POST ({} si viene vacío); null si no es JSON válido o es demasiado grande. */
export async function leerCuerpo(req: Request): Promise<Record<string, unknown> | null> {
  if (req.method !== "POST") return {};
  const texto = await req.text();
  if (texto.length > MAX_CUERPO) return null;
  if (!texto.trim()) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
