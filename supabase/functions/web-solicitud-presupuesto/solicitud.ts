// ============================================================================
//  web-solicitud-presupuesto · lógica (sin Deno ni red: se prueba con vitest)
// ----------------------------------------------------------------------------
//  La calculadora de la web (cristaleriabv) manda aquí la solicitud de
//  presupuesto del cliente. Es PÚBLICA (verify_jwt = false, CORS abierto sin
//  credenciales): se defiende sola con
//    · el campo trampa `website` (si viene relleno: 200 sin guardar nada);
//    · la validación de cada campo (longitudes, total, valores ≤ 20 KB,
//      consentimiento obligatorio);
//    · el límite por IP en la base (5 por hora por huella de IP: HMAC-SHA256
//      con sal, nunca la IP), en web_solicitud_presupuesto_registrar().
//  Guarda un presupuesto «solicitud» (origen web) con una línea y un aviso en
//  la campana. Respuestas: 200 {numero}, 400 {error}, 429 {error}.
//  Contrato completo en docs/WEB.md.
// ============================================================================

/** Ids de categoría de la calculadora (src/lib/web/pricing/categories.ts). */
export const CATEGORIAS_CALCULADORA = [
  "mamparas", "domino", "espejos", "cerramientos", "aluminio", "barandillas", "armarios", "otros",
] as const;

/** Solicitudes por hora y huella de IP. */
export const MAX_SOLICITUDES_HORA = 5;
/** Cuerpo máximo (bytes): los valores van con 20 KB como mucho y el resto son textos cortos. */
export const MAX_CUERPO = 40 * 1024;
export const MAX_VALORES = 20 * 1024;

export interface DatosSolicitud {
  nombre: string;
  telefono: string;
  email: string | null;
  poblacion: string | null;
  direccion: string | null;
  notas: string | null;
  categoria: string;
  valores: Record<string, unknown>;
  /** Precio de la calculadora de la web, IVA incluido (la base guarda la línea sin IVA: 20261124100000). */
  total: number;
  resumen: string;
}

export type Validacion = { ok: true; datos: DatosSolicitud } | { ok: false; error: string };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const responder = (status: number, datos: unknown) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Texto recortado; `undefined`/`null` = "". Cualquier otro tipo, null (no válido). */
function texto(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  return v.replace(/\s+/g, " ").trim();
}
/** Igual, pero conservando los saltos de línea (notas y resumen). */
function textoLargo(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  return v.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida el cuerpo de la solicitud. No mira el campo trampa (eso va antes). */
export function validarSolicitud(cuerpo: unknown): Validacion {
  if (!esObjeto(cuerpo)) return { ok: false, error: "La solicitud no es válida." };
  const nombre = texto(cuerpo.nombre);
  if (nombre === null || nombre.length < 2 || nombre.length > 120) {
    return { ok: false, error: "Escribe tu nombre (entre 2 y 120 caracteres)." };
  }
  const telefono = texto(cuerpo.telefono);
  if (telefono === null || telefono.length < 6 || telefono.length > 30 || !/^[0-9+().\s-]+$/.test(telefono)
      || (telefono.match(/\d/g) ?? []).length < 6) {
    return { ok: false, error: "Escribe un teléfono válido." };
  }
  const email = texto(cuerpo.email);
  if (email === null || email.length > 200 || (email && !EMAIL.test(email))) {
    return { ok: false, error: "El correo electrónico no es válido." };
  }
  const poblacion = texto(cuerpo.poblacion);
  if (poblacion === null || poblacion.length > 120) return { ok: false, error: "La población es demasiado larga." };
  const direccion = texto(cuerpo.direccion);
  if (direccion === null || direccion.length > 200) return { ok: false, error: "La dirección es demasiado larga." };
  const notas = textoLargo(cuerpo.notas);
  if (notas === null || notas.length > 1500) return { ok: false, error: "Las observaciones no pueden pasar de 1500 caracteres." };
  const categoria = typeof cuerpo.categoria === "string" ? cuerpo.categoria : "";
  if (!(CATEGORIAS_CALCULADORA as readonly string[]).includes(categoria)) {
    return { ok: false, error: "El tipo de trabajo no es válido." };
  }
  if (!esObjeto(cuerpo.valores) || bytes(JSON.stringify(cuerpo.valores)) > MAX_VALORES) {
    return { ok: false, error: "Las medidas y opciones elegidas no son válidas." };
  }
  const total = typeof cuerpo.total === "number" ? cuerpo.total : typeof cuerpo.total === "string" && cuerpo.total.trim() ? Number(cuerpo.total) : NaN;
  if (!Number.isFinite(total) || total < 0 || total > 1_000_000) return { ok: false, error: "El precio orientativo no es válido." };
  const resumen = textoLargo(cuerpo.resumen);
  if (resumen === null || resumen.length > 4000) return { ok: false, error: "El resumen es demasiado largo." };
  if (cuerpo.consentimiento !== true) {
    return { ok: false, error: "Tienes que aceptar la política de privacidad para enviar la solicitud." };
  }
  return {
    ok: true,
    datos: {
      nombre,
      telefono,
      email: email || null,
      poblacion: poblacion || null,
      direccion: direccion || null,
      notas: notas || null,
      categoria,
      valores: cuerpo.valores,
      total: Math.round(total * 100) / 100,
      resumen,
    },
  };
}

/** ¿Ha rellenado el campo trampa? (lo hacen los bots; las personas no lo ven). */
export function esBot(cuerpo: unknown): boolean {
  if (!esObjeto(cuerpo)) return false;
  const v = cuerpo.website;
  return v !== undefined && v !== null && v !== "" && !(typeof v === "string" && !v.trim());
}

/** Huella de la IP: HMAC-SHA256 con sal, en hexadecimal (64 caracteres). La IP no se guarda nunca. */
export async function huellaIp(ip: string, sal: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(sal), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`web-solicitud-presupuesto:${ip}`));
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ResultadoRegistro = { ok: true; numero: string } | { ok: false; motivo: "limite" };

export interface DependenciasSolicitud {
  /** IP del cliente (cf-connecting-ip o último salto de XFF; "" si no hay). */
  ip(req: Request): string;
  /** Sal de la huella (en la función, la clave de servicio: secreta y siempre presente). */
  sal: string;
  /** Guarda la solicitud (RPC web_solicitud_presupuesto_registrar con el service role). */
  registrar(ipHash: string, datos: DatosSolicitud, maxHora: number): Promise<ResultadoRegistro>;
}

export async function manejarSolicitud(req: Request, deps: DependenciasSolicitud): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return responder(405, { error: "Método no permitido." });
  if (Number(req.headers.get("content-length") || 0) > MAX_CUERPO) return responder(400, { error: "La solicitud es demasiado grande." });
  const crudo = await req.text();
  if (bytes(crudo) > MAX_CUERPO) return responder(400, { error: "La solicitud es demasiado grande." });
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return responder(400, { error: "La solicitud no es válida." });
  }
  // Campo trampa: se responde como si se hubiera guardado, sin guardar nada.
  if (esBot(cuerpo)) return responder(200, { numero: null });
  const v = validarSolicitud(cuerpo);
  if (!v.ok) return responder(400, { error: v.error });
  let resultado: ResultadoRegistro;
  try {
    resultado = await deps.registrar(await huellaIp(deps.ip(req), deps.sal), v.datos, MAX_SOLICITUDES_HORA);
  } catch (e) {
    console.error("[web-solicitud-presupuesto] no se pudo guardar:", e instanceof Error ? e.message : e);
    return responder(500, { error: "No hemos podido guardar la solicitud. Inténtalo de nuevo o llámanos." });
  }
  if (!resultado.ok) {
    return responder(429, { error: "Has enviado varias solicitudes seguidas. Espera un rato o llámanos por teléfono." });
  }
  return responder(200, { numero: resultado.numero });
}
