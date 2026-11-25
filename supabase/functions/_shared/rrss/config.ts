// ============================================================================
//  RRSS · configuración de las funciones (secretos de Supabase)
// ----------------------------------------------------------------------------
//  Lectura pura de los secretos (el entorno se inyecta: las pruebas no tienen
//  Deno). NUNCA devuelve valores de secretos al panel: solo si están o no.
//
//  Conexión desde el panel («Conectar con Facebook»):
//    META_APP_ID, META_APP_SECRET           obligatorios (app de Meta)
//    META_LOGIN_CONFIG_ID                   opcional: configuración de «Inicio de sesión con Facebook para
//                                           empresas» (si la app es de tipo Empresa); sin él se piden los permisos
//    RRSS_CLAVE_TOKENS                      opcional: clave para cifrar los tokens (por defecto, derivada de
//                                           META_APP_SECRET)
//  Token de usuario del sistema (como en el panel de referencia; si está, manda sobre la conexión):
//    IG_ACCESS_TOKEN + IG_USER_ID (+ FB_PAGE_ID para publicar también en la página)
//  Otros: META_API_VERSION (v26.0), PANEL_URL / PANEL_URL_DEMO (adónde vuelve el OAuth), OCR_TRABAJOS_SECRET (cron).
// ============================================================================
import { VERSION_API_POR_DEFECTO } from "./cliente.ts";

export type LectorEnv = (nombre: string) => string | undefined;

export function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nombre);
}

const leer = (env: LectorEnv, n: string) => (env(n) ?? "").trim();

/** Permisos que se piden al conectar (Facebook Login con la Graph API de Instagram y de páginas). */
export const PERMISOS_META = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
] as const;

/** Imprescindibles para publicar en Instagram. */
export const PERMISOS_INSTAGRAM = ["instagram_basic", "instagram_content_publish"] as const;

export interface ConfigMeta {
  versionApi: string;
  appId: string;
  appSecret: string;
  configId: string;
  claveTokens: string;
  /** Token de usuario del sistema (modo secretos). */
  tokenSistema: string;
  igUserIdSistema: string;
  paginaSistema: string;
  supabaseUrl: string;
}

export function configMeta(env: LectorEnv = envDeDeno): ConfigMeta {
  const version = leer(env, "META_API_VERSION");
  return {
    versionApi: /^v\d{1,3}\.\d$/.test(version) ? version : VERSION_API_POR_DEFECTO,
    appId: leer(env, "META_APP_ID"),
    appSecret: leer(env, "META_APP_SECRET"),
    configId: leer(env, "META_LOGIN_CONFIG_ID"),
    claveTokens: leer(env, "RRSS_CLAVE_TOKENS") || leer(env, "META_APP_SECRET"),
    tokenSistema: leer(env, "IG_ACCESS_TOKEN"),
    igUserIdSistema: leer(env, "IG_USER_ID"),
    paginaSistema: leer(env, "FB_PAGE_ID"),
    supabaseUrl: leer(env, "SUPABASE_URL").replace(/\/+$/, ""),
  };
}

/** ¿Se usa el token de usuario del sistema de los secretos? */
export const usaSecretos = (c: ConfigMeta): boolean => Boolean(c.tokenSistema && /^[0-9]{1,30}$/.test(c.igUserIdSistema));

/** Qué falta para poder pulsar «Conectar con Facebook» (nombres de secretos, nunca valores). */
export function faltaParaConectar(c: ConfigMeta): string[] {
  const f: string[] = [];
  if (!c.appId) f.push("META_APP_ID");
  if (!c.appSecret) f.push("META_APP_SECRET");
  if (!c.supabaseUrl) f.push("SUPABASE_URL");
  return f;
}

/** URL de vuelta del OAuth: la Edge Function rrss-oauth de este Supabase (va tal cual en la app de Meta). */
export const redirectUri = (c: ConfigMeta): string => `${c.supabaseUrl}/functions/v1/rrss-oauth`;

/** Diálogo de Facebook para conectar. */
export function urlDialogo(c: ConfigMeta, state: string): string {
  const u = new URL(`https://www.facebook.com/${c.versionApi}/dialog/oauth`);
  u.searchParams.set("client_id", c.appId);
  u.searchParams.set("redirect_uri", redirectUri(c));
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  if (c.configId) u.searchParams.set("config_id", c.configId);
  else u.searchParams.set("scope", PERMISOS_META.join(","));
  return u.toString();
}

// Paneles a los que puede volver el OAuth: el de producción, sus previews de Vercel (demo), localhost y los de los
// secretos PANEL_URL / PANEL_URL_DEMO. Nada más (sin redirecciones abiertas).
const PANEL_PRODUCCION = "https://admin-cristaleriabv.vercel.app";
const RE_PREVIEW = /^https:\/\/admin-cristaleriabv-(git-[a-z0-9-]+|[a-z0-9]+)-pablo1505\.vercel\.app$/;
const RE_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

function origenDe(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** El origen del panel si está permitido; null si no. */
export function panelPermitido(origen: string | null | undefined, env: LectorEnv = envDeDeno): string | null {
  if (!origen) return null;
  const o = origenDe(origen.trim());
  if (!o) return null;
  const extra = [leer(env, "PANEL_URL"), leer(env, "PANEL_URL_DEMO")].map(origenDe).filter((x): x is string => Boolean(x));
  if (o === PANEL_PRODUCCION || extra.includes(o) || RE_PREVIEW.test(o) || RE_LOCAL.test(o)) return o;
  return null;
}

/** Panel por defecto (si el state no vale, a dónde mandar a la persona). */
export function panelPorDefecto(env: LectorEnv = envDeDeno): string {
  return origenDe(leer(env, "PANEL_URL")) ?? PANEL_PRODUCCION;
}
