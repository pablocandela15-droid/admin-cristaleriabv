// ============================================================================
//  _shared/secreto-servidor.ts — llamadas de servidor a servidor
// ----------------------------------------------------------------------------
//  pg_cron (pg_net) llama a algunas funciones sin JWT: se autentican con la
//  cabecera `x-ocr-secret` (= el secreto de Vault «ocr_trabajos_secret» y el
//  secreto OCR_TRABAJOS_SECRET de las Edge Functions). Comparación en tiempo
//  constante y fallo CERRADO si el secreto no está configurado.
// ============================================================================
import { compararTiempoConstante } from "./tiempo-constante.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** null si la cabecera `x-ocr-secret` coincide; si no, la respuesta de error (500 sin secreto, 401 si no coincide). */
export function verificarSecreto(req: Request, secreto: string | undefined | null): Response | null {
  if (!secreto) {
    console.error("[secreto-servidor] OCR_TRABAJOS_SECRET no configurado — rechazando (falla cerrado)");
    return jsonResponse({ ok: false, error: "server_misconfigured" }, 500);
  }
  const cabecera = req.headers.get("x-ocr-secret") ?? "";
  if (!cabecera || !compararTiempoConstante(cabecera, secreto)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return null;
}
