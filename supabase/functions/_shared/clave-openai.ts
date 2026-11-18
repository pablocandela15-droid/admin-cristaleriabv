// ============================================================================
//  Clave de OpenAI por proceso (08-oct-2026)
// ----------------------------------------------------------------------------
//  OpenAI factura por PROYECTO, y cada proyecto tiene sus propias claves. Para
//  ver el gasto REAL separado por proceso, cada proceso puede usar la clave de
//  su proyecto (heredado del núcleo del panel; hoy todo usa la general):
//
//    'ocr'   → OPENAI_API_KEY_OCR   (lectura de documentos)
//    'chat'  → OPENAI_API_KEY_CHAT  (chat con herramientas)
//    'chatweb' → OPENAI_API_KEY_CHATWEB (chat de la web pública)
//    'vinos' → OPENAI_API_KEY_VINOS (fotos con IA; nombre heredado)
//    'carta' → OPENAI_API_KEY_CARTA (heredado; sin esa clave cae a la general)
//    'otros' → OPENAI_API_KEY       (clave general: analizar-peticion, ia-modelos-openai…)
//
//  Ninguna Edge Function lee OPENAI_API_KEY directamente: todas pasan por aquí.
//  El mapeo función → proceso del ESTIMADO está en SQL: ia_proceso_de_funcion().
//
//  Si la clave específica NO existe (o está vacía), se usa OPENAI_API_KEY: el
//  comportamiento anterior queda intacto hasta que el dueño cree las claves.
//  No lee el entorno al cargarse: `env` se inyecta (los tests no tienen Deno).
// ============================================================================

export type ProcesoOpenAI = "ocr" | "chat" | "chatweb" | "vinos" | "carta" | "otros";

const SECRETO_POR_PROCESO: Record<ProcesoOpenAI, string | null> = {
  ocr: "OPENAI_API_KEY_OCR",
  chat: "OPENAI_API_KEY_CHAT",
  chatweb: "OPENAI_API_KEY_CHATWEB",
  vinos: "OPENAI_API_KEY_VINOS",
  carta: "OPENAI_API_KEY_CARTA",
  otros: null,
};

type LectorEnv = (nombre: string) => string | undefined;

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } })
    .Deno?.env.get(nombre);
}

/** Devuelve la clave del proceso, con respaldo en OPENAI_API_KEY ("" si no hay ninguna). */
export function claveOpenAI(proceso: ProcesoOpenAI, env: LectorEnv = envDeDeno): string {
  const propio = SECRETO_POR_PROCESO[proceso];
  const clave = propio ? (env(propio) ?? "").trim() : "";
  if (clave) return clave;
  return (env("OPENAI_API_KEY") ?? "").trim();
}
