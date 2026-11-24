// ============================================================================
//  newsletter-alta · lógica (sin Deno ni red: se prueba con vitest)
// ----------------------------------------------------------------------------
//  La llama la web de la cristalería (cristaleriabv): el bloque de suscripción
//  del pie y, si el cliente marca la casilla, la solicitud de presupuesto. Es
//  PÚBLICA (verify_jwt = false) y se defiende sola:
//    · CORS y Origin: solo los orígenes de la web (los mismos que la ingesta de
//      Logs web, _shared/logs-web/clasificacion.ts › entornoDeOrigen); otro
//      origen → 403 sin tocar nada;
//    · campo trampa `website` (relleno → 200 sin guardar nada);
//    · consentimiento explícito obligatorio y longitudes acotadas;
//    · límite por huella de IP (HMAC-SHA256 con sal, nunca la IP) en la RPC
//      newsletter_alta_web, y como mucho 5 confirmaciones por persona (una
//      cada 10 minutos);
//    · respuesta igual exista o no el email (no dice quién está suscrito).
//  Doble opt-in: el alta queda PENDIENTE y se manda el correo de confirmación;
//  la suscripción solo se activa cuando la persona pulsa «Confirmar» en la
//  página del enlace (accion «confirmar», RPC newsletter_confirmar).
//  Sin RESEND_API_KEY o sin remitente no se guarda nada: 503 «no disponible».
//
//  POST { accion?: "alta", email, nombre?, consentimiento: true, origen?, website }
//    200 { ok: true, mensaje }   ·  400 { error }  ·  403 origen  ·  429 límite  ·  503 sin configurar
//  POST { accion: "confirmar", t }
//    200 { ok, estado: confirmada | ya_confirmada | caducado | invalido, email (a medias) }
// ============================================================================

import { entornoDeOrigen } from "../_shared/logs-web/clasificacion.ts";
import { TOKEN_RE, enmascararEmail, faltaParaEnviar, type ConfigNewsletter } from "../_shared/newsletter/enlaces.ts";
import type { DatosNegocio } from "../_shared/newsletter/negocio.ts";

export const ORIGENES_ALTA = ["web_formulario", "web_presupuesto"] as const;
export type OrigenAlta = (typeof ORIGENES_ALTA)[number];

/**
 * El texto exacto de cada casilla de la web (prueba del consentimiento, se guarda con el alta). Si cambia la casilla
 * de la web (cristaleriabv: src/components/newsletter/), cambiar también aquí y subir la versión.
 */
export const TEXTOS_CONSENTIMIENTO: Record<OrigenAlta, string> = {
  web_formulario:
    "Casilla del bloque de suscripción de la web (v1, noviembre de 2026): «Quiero recibir por correo las novedades y ofertas de Cristalería Baix Vinalopó. He leído la política de privacidad y sé que puedo darme de baja cuando quiera.»",
  web_presupuesto:
    "Casilla opcional de la solicitud de presupuesto de la web (v1, noviembre de 2026): «Quiero recibir también por correo las novedades y ofertas de Cristalería Baix Vinalopó (puedo darme de baja cuando quiera).»",
};

/** Altas por hora y huella de IP. */
export const MAX_ALTAS_HORA = 5;
/** Cuerpo máximo (bytes). */
export const MAX_CUERPO = 4 * 1024;

export const MENSAJE_OK =
  "¡Casi está! Te hemos enviado un correo: pulsa el enlace para confirmar la suscripción. Si ya estabas suscrito, no hace falta que hagas nada.";
export const MENSAJE_NO_DISPONIBLE = "La suscripción no está disponible ahora mismo. Inténtalo más tarde.";

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export interface DatosAlta {
  email: string;
  nombre: string | null;
  origen: OrigenAlta;
}

export type Validacion = { ok: true; datos: DatosAlta } | { ok: false; error: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Valida el alta. No mira el campo trampa (eso va antes). */
export function validarAlta(cuerpo: unknown): Validacion {
  if (!esObjeto(cuerpo)) return { ok: false, error: "La solicitud no es válida." };
  const email = typeof cuerpo.email === "string" ? cuerpo.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL.test(email)) return { ok: false, error: "Escribe un correo electrónico válido." };
  let nombre: string | null = null;
  if (cuerpo.nombre !== undefined && cuerpo.nombre !== null && cuerpo.nombre !== "") {
    if (typeof cuerpo.nombre !== "string") return { ok: false, error: "El nombre no es válido." };
    // eslint-disable-next-line no-control-regex
    const n = cuerpo.nombre.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
    if (n.length > 80) return { ok: false, error: "El nombre es demasiado largo." };
    nombre = n || null;
  }
  const origen = cuerpo.origen === undefined ? "web_formulario" : cuerpo.origen;
  if (!(ORIGENES_ALTA as readonly unknown[]).includes(origen)) return { ok: false, error: "La solicitud no es válida." };
  if (cuerpo.consentimiento !== true) {
    return { ok: false, error: "Marca la casilla para aceptar recibir las novedades." };
  }
  return { ok: true, datos: { email, nombre, origen: origen as OrigenAlta } };
}

/** ¿Ha rellenado el campo trampa? (lo hacen los bots; las personas no lo ven). */
export function esBot(cuerpo: unknown): boolean {
  if (!esObjeto(cuerpo)) return false;
  const v = cuerpo.website;
  return v !== undefined && v !== null && v !== "" && !(typeof v === "string" && !v.trim());
}

/** Huella de la IP: HMAC-SHA256 con sal, en hexadecimal (64 caracteres). La IP no se guarda nunca. */
export async function huellaIp(ip: string, sal: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(sal || "sin-sal"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`newsletter-alta:${ip}`));
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function cabecerasCors(origen: string | null, permitido: boolean): Record<string, string> {
  return {
    ...(permitido && origen ? { "Access-Control-Allow-Origin": origen, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

export type ResultadoRegistro =
  | { ok: true; accion: string; enviar: boolean; id?: string; token?: string; email?: string }
  | { ok: false; motivo: "limite" };

export type EstadoConfirmacion = "confirmada" | "ya_confirmada" | "caducado" | "invalido";

export interface DependenciasAlta {
  /** IP del cliente (cf-connecting-ip o último salto de XFF; "" si no hay). */
  ip: string;
  /** Sal de la huella (la service role: secreta y siempre presente). */
  sal: string;
  /** LOGS_WEB_ORIGENES_EXTRA (otros orígenes permitidos, «https://dominio=produccion,…»). */
  origenesExtra?: string;
  /** ¿Hay RESEND_API_KEY? */
  apiKey: boolean;
  /** Ajustes (newsletter_config) y datos del negocio para el correo. */
  leerConfig(): Promise<{ config: ConfigNewsletter; negocio: DatosNegocio }>;
  /** RPC newsletter_alta_web (service role). */
  registrar(ipHash: string, datos: DatosAlta, texto: string, maxHora: number): Promise<ResultadoRegistro>;
  /** Manda el correo de confirmación. true si Resend lo aceptó. */
  enviarConfirmacion(o: { id: string; email: string; nombre: string | null; token: string; config: ConfigNewsletter; negocio: DatosNegocio }): Promise<boolean>;
  /** RPC newsletter_confirmar (service role). */
  confirmar(token: string): Promise<{ estado: EstadoConfirmacion; email?: string | null }>;
  log?: (m: string) => void;
}

const json = (status: number, cuerpo: unknown, cors: Record<string, string>) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function leerConTope(req: Request): Promise<string | null> {
  if (Number(req.headers.get("content-length") || 0) > MAX_CUERPO) return null;
  const texto = await req.text();
  return new TextEncoder().encode(texto).length > MAX_CUERPO ? null : texto;
}

export async function manejarAlta(req: Request, deps: DependenciasAlta): Promise<Response> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const origen = req.headers.get("origin");
  const permitido = entornoDeOrigen(origen, deps.origenesExtra ?? "") !== null;
  const cors = cabecerasCors(origen, permitido);
  if (req.method === "OPTIONS") return new Response(null, { status: permitido ? 204 : 403, headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Método no permitido." }, cors);
  if (!permitido) return json(403, { ok: false, error: "origen_no_permitido" }, cors);

  const crudo = await leerConTope(req);
  if (crudo === null) return json(400, { ok: false, error: "La solicitud es demasiado grande." }, cors);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return json(400, { ok: false, error: "La solicitud no es válida." }, cors);
  }
  const accion = esObjeto(cuerpo) && cuerpo.accion !== undefined ? cuerpo.accion : "alta";

  if (accion === "confirmar") {
    const t = esObjeto(cuerpo) && typeof cuerpo.t === "string" ? cuerpo.t.trim() : "";
    if (!TOKEN_RE.test(t)) return json(200, { ok: false, estado: "invalido", email: null }, cors);
    try {
      const r = await deps.confirmar(t);
      const ok = r.estado === "confirmada" || r.estado === "ya_confirmada";
      return json(200, { ok, estado: r.estado, email: ok ? enmascararEmail(r.email) : null }, cors);
    } catch (e) {
      log(`[newsletter-alta] no se pudo confirmar: ${e instanceof Error ? e.message : e}`);
      return json(500, { ok: false, estado: "error", error: "No hemos podido confirmar ahora mismo. Inténtalo en unos minutos." }, cors);
    }
  }
  if (accion !== "alta") return json(400, { ok: false, error: "La solicitud no es válida." }, cors);

  // Campo trampa: se responde como si se hubiera guardado, sin guardar nada.
  if (esBot(cuerpo)) return json(200, { ok: true, mensaje: MENSAJE_OK }, cors);
  const v = validarAlta(cuerpo);
  if (!v.ok) return json(400, { ok: false, error: v.error }, cors);

  let ajustes: { config: ConfigNewsletter; negocio: DatosNegocio };
  try {
    ajustes = await deps.leerConfig();
  } catch (e) {
    log(`[newsletter-alta] no se pudieron leer los ajustes: ${e instanceof Error ? e.message : e}`);
    return json(503, { ok: false, error: MENSAJE_NO_DISPONIBLE, motivo: "no_configurado" }, cors);
  }
  const faltan = faltaParaEnviar({ apiKey: deps.apiKey, config: ajustes.config });
  if (faltan.length) {
    log(`[newsletter-alta] sin configurar, no se guarda nada (falta ${faltan.join(" y ")})`);
    return json(503, { ok: false, error: MENSAJE_NO_DISPONIBLE, motivo: "no_configurado" }, cors);
  }

  let r: ResultadoRegistro;
  try {
    r = await deps.registrar(await huellaIp(deps.ip, deps.sal), v.datos, TEXTOS_CONSENTIMIENTO[v.datos.origen], MAX_ALTAS_HORA);
  } catch (e) {
    log(`[newsletter-alta] no se pudo guardar: ${e instanceof Error ? e.message : e}`);
    return json(500, { ok: false, error: "No hemos podido apuntarte ahora mismo. Inténtalo en unos minutos." }, cors);
  }
  if (!r.ok) return json(429, { ok: false, error: "Has hecho varias solicitudes seguidas. Espera un rato y vuelve a intentarlo." }, cors);

  if (r.enviar && r.id && r.token) {
    const enviado = await deps
      .enviarConfirmacion({ id: r.id, email: r.email ?? v.datos.email, nombre: v.datos.nombre, token: r.token, config: ajustes.config, negocio: ajustes.negocio })
      .catch((e) => {
        log(`[newsletter-alta] fallo enviando la confirmación a ${r.id}: ${e instanceof Error ? e.message : e}`);
        return false;
      });
    if (!enviado) {
      return json(502, { ok: false, error: "No hemos podido enviarte el correo de confirmación. Inténtalo de nuevo dentro de un rato." }, cors);
    }
  }
  log(`[newsletter-alta] alta ${v.datos.origen}: ${r.accion}`);
  return json(200, { ok: true, mensaje: MENSAJE_OK }, cors);
}
