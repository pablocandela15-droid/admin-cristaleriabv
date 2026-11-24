// ============================================================================
//  Logs web · clasificación en el servidor: entorno por origen, dispositivo y
//  bot por User-Agent, y procedencia de la visita.
//  Lo que diga el navegador sobre sí mismo no se cree (salvo `prueba`, que solo
//  sirve para EXCLUIR tráfico de las estadísticas, nunca para incluirlo).
// ============================================================================

import { hostDe } from "./saneado.ts";
import { entornoDeSupabase as entornoPorRef, type Entorno } from "../entorno.ts";

export type { Entorno };

// La web de la cristalería (proyecto `cristaleriabv` de Vercel, equipo pablo1505) y el dominio propio si se le pone.
const ORIGENES_PRODUCCION = new Set([
  "https://cristaleriabv.vercel.app",
  "https://cristaleriabaixvinalopo.es",
  "https://www.cristaleriabaixvinalopo.es",
]);
// Previews de Vercel (ramas y despliegues sueltos): cuentan como demo.
const RE_DEMO = /^https:\/\/cristaleriabv-(git-[a-z0-9-]+|[a-z0-9]+)-pablo1505\.vercel\.app$/;
const RE_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

/**
 * Entorno según el Origin de la petición. `extra` = "origen=entorno,…" (secret
 * opcional LOGS_WEB_ORIGENES_EXTRA, p. ej. un dominio nuevo). NULL = origen no
 * permitido: la ingesta responde 403 y no guarda nada.
 */
export function entornoDeOrigen(origen: string | null, extra = ""): Entorno | null {
  if (!origen) return null;
  const o = origen.trim().toLowerCase().replace(/\/+$/, "");
  for (const par of extra.split(",")) {
    const [k, v] = par.split("=").map((x) => x?.trim().toLowerCase());
    if (k && k === o && (v === "produccion" || v === "demo" || v === "local")) return v;
  }
  if (ORIGENES_PRODUCCION.has(o)) return "produccion";
  if (RE_DEMO.test(o)) return "demo";
  if (RE_LOCAL.test(o)) return "local";
  return null;
}

/**
 * Entorno de una Edge Function según su SUPABASE_URL: los refs salen de SUPABASE_REF_PRODUCCION y SUPABASE_REF_DEMO
 * (_shared/entorno.ts). Sin ellos, el de producción conocido (gorekooabfhqudeshtgq) y, si no, «local».
 */
export function entornoDeSupabase(url: string | null | undefined): Entorno {
  const e = entornoPorRef(url);
  if (e !== "local") return e;
  if (url?.includes("gorekooabfhqudeshtgq")) return "produccion";
  return "local";
}

// Bots, rastreadores, monitores y navegadores sin cabeza (salvo los de pruebas, que se marcan aparte).
const RE_BOT = /bot\b|crawl|spider|slurp|bingpreview|facebookexternalhit|facebot|embedly|quora link|outbrain|pinterest\/|vkshare|w3c_validator|whatsapp\/|telegrambot|discordbot|skypeuripreview|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|headlesschrome|phantomjs|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|axios\/|node-fetch|undici|java\/|libwww|httpclient|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider|bytespider|gptbot|claudebot|ccbot|perplexity|amazonbot|applebot|duckduckbot|seznambot/i;

export function esBot(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true; // sin User-Agent real no es un navegador de una persona
  return RE_BOT.test(ua);
}

export type Dispositivo = "movil" | "tablet" | "escritorio" | "desconocido";

export function dispositivoDe(ua: string | null | undefined, tactil?: boolean | null): Dispositivo {
  if (!ua) return "desconocido";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return "tablet";
  // iPadOS se presenta como un Mac de escritorio: solo la pantalla táctil lo delata.
  if (/macintosh/i.test(ua) && tactil === true) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) return "movil";
  if (/windows|macintosh|linux|cros|x11/i.test(ua)) return "escritorio";
  return "desconocido";
}

export function navegadorDe(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/fbav|fban|instagram/i.test(ua)) return "Navegador de app social";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Otro";
}

export function soDe(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/macintosh|mac os x/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Otro";
}

// ─── Procedencia ─────────────────────────────────────────────────────────────
export type OrigenTipo = "buscador" | "campana" | "qr" | "red_social" | "enlace" | "directo" | "interno" | "desconocido";

const BUSCADORES = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|yandex\.[a-z.]+|qwant\.com|startpage\.com|search\.brave\.com|baidu\.com)$/;
const REDES = /(^|\.)(instagram\.com|facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com|t\.co|twitter\.com|x\.com|tiktok\.com|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|youtube\.com|youtu\.be|wa\.me|whatsapp\.com|telegram\.org|t\.me|threads\.net|habitissimo\.es|houzz\.[a-z.]+|maps\.app\.goo\.gl)$/;
const PROPIOS = /(^|\.)(cristaleriabaixvinalopo\.es|cristaleriabv[a-z0-9-]*\.vercel\.app|localhost)$/;

export interface DatosProcedencia {
  /** Host del document.referrer (el navegador manda solo el host). */
  referente?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  /** ?qr=<código> de los QR impresos. */
  qr?: string | null;
}

export interface Procedencia {
  origen_tipo: OrigenTipo;
  origen_detalle: string | null;
  campana: string | null;
}

const limpiar = (v: unknown, max = 80): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9 ._:/+-]/g, "").slice(0, max);
  return s || null;
};

/**
 * Clasifica la entrada de una sesión. Prioridad: QR > campaña (utm) >
 * referente (buscador, red social, propio, otro enlace) > directo.
 * «directo» incluye apps que no mandan referente (correo, WhatsApp de escritorio, marcadores).
 */
export function clasificarProcedencia(d: DatosProcedencia): Procedencia {
  const qr = limpiar(d.qr, 60);
  const medio = limpiar(d.utm_medium);
  const fuenteUtm = limpiar(d.utm_source);
  const campana = limpiar(d.utm_campaign, 120);
  if (qr || medio === "qr") return { origen_tipo: "qr", origen_detalle: fuenteUtm ?? "qr", campana: qr ?? campana };
  if (fuenteUtm || medio || campana) {
    return { origen_tipo: "campana", origen_detalle: [fuenteUtm, medio].filter(Boolean).join(" / ") || null, campana };
  }
  const host = hostDe(d.referente ?? null);
  if (!host) return { origen_tipo: "directo", origen_detalle: null, campana: null };
  if (PROPIOS.test(host)) return { origen_tipo: "interno", origen_detalle: host, campana: null };
  if (BUSCADORES.test(host)) return { origen_tipo: "buscador", origen_detalle: host, campana: null };
  if (REDES.test(host)) return { origen_tipo: "red_social", origen_detalle: host, campana: null };
  return { origen_tipo: "enlace", origen_detalle: host, campana: null };
}
