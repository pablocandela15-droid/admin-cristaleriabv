/**
 * RRSS · cliente mínimo de la Graph API de Meta (graph.facebook.com) para
 * Instagram profesional y páginas de Facebook. Portado del panel de referencia
 * (_shared/instagram/cliente.ts) y ampliado con el OAuth de «Conectar con
 * Facebook», las páginas y la publicación en Facebook.
 *
 *  - Versión configurable (META_API_VERSION, por defecto v26.0).
 *  - El token va en la cabecera `Authorization: Bearer`. Excepciones: el OAuth
 *    y /debug_token, que llevan las credenciales en la consulta (esas URL se
 *    sanean antes de registrarlas).
 *  - Reintentos con espera creciente solo para errores transitorios. NUNCA en
 *    media_publish ni en las publicaciones de Facebook (un reintento tras un
 *    tiempo agotado puede publicar dos veces): si media_publish falla, se mira
 *    el contenedor (publicarSinDuplicar) y, si ya está PUBLISHED, se recupera.
 *  - `limite` (instante en ms): ninguna petición pasa de ahí (el timeout se
 *    recorta y no se reintenta si no da tiempo), para no pasarse del reloj de
 *    la Edge Function.
 *  - `fetch`, `dormir` y `ahora` se inyectan para poder probar sin red.
 */
import { mensajeSaneado, registrarSecreto, sanear, sanearUrl } from "./secretos.ts";
import { ErrorMeta, mapearErrorGraph, textoDeTipo, tipoDesdeTextoEstado, TIPOS_DUDOSOS } from "./errores.ts";

export const HOST_GRAPH = "https://graph.facebook.com";
export const VERSION_API_POR_DEFECTO = "v26.0";

export type FuncionFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesCliente {
  token: string;
  versionApi?: string | undefined;
  fetch?: FuncionFetch | undefined;
  /** Tiempo máximo por petición (ms). Por defecto 30 s. */
  timeoutMs?: number | undefined;
  /** Reintentos extra para errores transitorios. Por defecto 3. */
  reintentos?: number | undefined;
  /** Espera base del backoff exponencial (ms). Por defecto 1000. */
  esperaBaseMs?: number | undefined;
  dormir?: ((ms: number) => Promise<void>) | undefined;
  ahora?: (() => number) | undefined;
  /** Registro de cada llamada (método, ruta y estado HTTP; nunca credenciales). */
  registro?: ((linea: string) => void) | undefined;
  /** Instante (ms, mismo reloj que `ahora`) a partir del cual no se hacen más peticiones. */
  limite?: number | undefined;
}

export interface MedioPublicado {
  id: string;
  permalink: string | null;
}

export interface ResultadoPublicar {
  /** id del medio; null si Meta dice PUBLISHED pero no se encontró cuál es. */
  mediaId: string | null;
  permalink: string | null;
  /** true si media_publish falló pero el contenedor ya estaba publicado. */
  recuperado: boolean;
}

export interface PaginaMeta {
  id: string;
  nombre: string | null;
  /** Token de la página (solo en memoria del servidor; nunca sale en respuestas). */
  token: string | null;
  tareas: string[];
  instagram: { id: string; usuario: string | null; nombre: string | null; foto: string | null } | null;
}

export interface PerfilIg {
  id: string;
  usuario: string | null;
  nombre: string | null;
  foto: string | null;
  seguidores: number | null;
  publicaciones: number | null;
}

export interface DatosDepuracion {
  app_id?: string;
  type?: string;
  is_valid?: boolean;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
  user_id?: string;
  error?: { code?: number; message?: string; subcode?: number };
}

export interface LimitePublicacion {
  usadas: number;
  /** config.quota_total: NUNCA se supone un valor fijo. */
  total: number | null;
  restantes: number | null;
}

/** Contenedor de Instagram (POST /{ig-user-id}/media). */
export type DatosContenedor =
  | { tipo: "imagen"; imageUrl: string; caption?: string; altText?: string }
  | { tipo: "reel"; videoUrl: string; caption?: string; thumbOffsetMs?: number | null }
  | { tipo: "story_imagen"; imageUrl: string }
  | { tipo: "story_video"; videoUrl: string }
  | { tipo: "hijo_imagen"; imageUrl: string; altText?: string }
  | { tipo: "hijo_video"; videoUrl: string }
  | { tipo: "carrusel"; hijos: string[]; caption?: string };

export type EstadoContenedor = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

export interface InfoContenedor {
  id: string;
  estado: EstadoContenedor | string;
  /** Campo `status` (texto libre de Meta, saneado). */
  detalle: string | null;
}

export interface OpcionesSondeo {
  /** Intervalo entre consultas. Por defecto 5 s. */
  intervaloMs?: number | undefined;
  /** Tiempo total máximo. Por defecto 45 s. */
  maxMs?: number | undefined;
}

export const SONDEO_POR_DEFECTO = { intervaloMs: 5_000, maxMs: 45_000 } as const;

type Metodo = "GET" | "POST" | "DELETE";

interface OpcionesPeticion {
  consulta?: Record<string, string>;
  cuerpo?: Record<string, string>;
  /** «bearer» (por defecto) o «ninguna» (la credencial va ya en la consulta). */
  auth?: "bearer" | "ninguna";
  reintentos?: number;
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** El mismo error, diciendo qué elemento del carrusel falló. */
export function conElemento(e: unknown, n: number): unknown {
  if (!(e instanceof ErrorMeta)) return e;
  return new ErrorMeta({
    tipo: e.tipo, mensaje: `Elemento ${n} del carrusel: ${e.message}`, comoArreglarlo: e.comoArreglarlo, reintentable: e.reintentable,
    codigo: e.codigo, subcodigo: e.subcodigo, estadoHttp: e.estadoHttp, fbtraceId: e.fbtraceId, detalleMeta: e.detalleMeta,
  });
}

export class ClienteGraph {
  private readonly token: string;
  readonly versionApi: string;
  private readonly fetch: FuncionFetch;
  private readonly timeoutMs: number;
  private readonly reintentos: number;
  private readonly esperaBaseMs: number;
  readonly dormir: (ms: number) => Promise<void>;
  readonly ahora: () => number;
  private readonly registro: ((linea: string) => void) | undefined;
  private readonly limite: number | undefined;

  constructor(o: OpcionesCliente) {
    if (!o.token) throw new Error("ClienteGraph: falta el token.");
    this.token = o.token;
    registrarSecreto(o.token);
    this.versionApi = /^v\d{1,3}\.\d$/.test(o.versionApi ?? "") ? (o.versionApi as string) : VERSION_API_POR_DEFECTO;
    this.fetch = o.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.reintentos = o.reintentos ?? 3;
    this.esperaBaseMs = o.esperaBaseMs ?? 1_000;
    this.dormir = o.dormir ?? dormirReal;
    this.ahora = o.ahora ?? Date.now;
    this.registro = o.registro;
    this.limite = o.limite;
  }

  /** ms que quedan hasta el límite (Infinity si no hay). */
  quedaMs(): number {
    return this.limite === undefined ? Infinity : this.limite - this.ahora();
  }

  private url(ruta: string, consulta?: Record<string, string>): string {
    const limpia = ruta.startsWith("/") ? ruta : `/${ruta}`;
    const u = new URL(`${HOST_GRAPH}/${this.versionApi}${limpia}`);
    for (const [k, v] of Object.entries(consulta ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }

  /** Petición con reintentos, timeout, mapeo de errores y saneado. */
  async peticion<T>(metodo: Metodo, ruta: string, op: OpcionesPeticion = {}): Promise<T> {
    const url = this.url(ruta, op.consulta);
    const rutaVisible = sanearUrl(url).replace(HOST_GRAPH, "");
    const cabeceras: Record<string, string> = { Accept: "application/json" };
    if ((op.auth ?? "bearer") === "bearer") cabeceras.Authorization = `Bearer ${this.token}`;
    const init: RequestInit = { method: metodo, headers: cabeceras };
    if (op.cuerpo) {
      cabeceras["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(op.cuerpo).toString();
    }
    const maxReintentos = op.reintentos ?? this.reintentos;
    let intento = 0;
    for (;;) {
      let error: ErrorMeta;
      const queda = this.quedaMs();
      if (queda < 1_000) throw new ErrorMeta({ tipo: "tiempo_agotado", mensaje: `Sin tiempo para ${metodo} ${rutaVisible} (límite de la pasada)` });
      try {
        const respuesta = await this.fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(this.timeoutMs, queda)) });
        const texto = await respuesta.text();
        let cuerpo: unknown = null;
        try {
          cuerpo = texto ? JSON.parse(texto) : null;
        } catch {
          cuerpo = null;
        }
        this.registro?.(sanear(`${metodo} ${rutaVisible} → ${respuesta.status}`));
        const conError = cuerpo !== null && typeof cuerpo === "object" && "error" in cuerpo;
        if (respuesta.ok && !conError) {
          if (cuerpo === null) {
            throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: `Respuesta no JSON de ${metodo} ${rutaVisible} (HTTP ${respuesta.status})` });
          }
          return cuerpo as T;
        }
        error = mapearErrorGraph({ estadoHttp: respuesta.status, cuerpo, cabeceras: respuesta.headers });
      } catch (e) {
        if (e instanceof ErrorMeta) {
          error = e;
        } else {
          const esTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
          this.registro?.(sanear(`${metodo} ${rutaVisible} → ${esTimeout ? "tiempo agotado" : "error de red"}`));
          error = new ErrorMeta({
            tipo: esTimeout ? "tiempo_agotado" : "red",
            mensaje: `${textoDeTipo(esTimeout ? "tiempo_agotado" : "red").mensaje} (${metodo} ${rutaVisible}): ${mensajeSaneado(e)}`,
          });
        }
      }
      const limite = error.tipo === "contenedor_inexistente" ? Math.min(maxReintentos, 2) : maxReintentos;
      if (!error.reintentable || intento >= limite) throw error;
      const espera = this.esperaBaseMs * 2 ** intento;
      if (espera + 1_000 > this.quedaMs()) throw error;
      this.registro?.(`  reintento ${intento + 1}/${limite} en ${Math.round(espera / 100) / 10} s (${error.tipo})`);
      await this.dormir(espera);
      intento++;
    }
  }

  // ── OAuth y páginas (con el token de la app «APP_ID|APP_SECRET» o el del usuario) ──

  /** Código del diálogo de Facebook → token de usuario de corta duración. */
  async canjearCodigo(p: { appId: string; appSecret: string; redirectUri: string; codigo: string }): Promise<string> {
    registrarSecreto(p.appSecret);
    registrarSecreto(p.codigo);
    const r = await this.peticion<{ access_token?: string }>("GET", "/oauth/access_token", {
      consulta: { client_id: p.appId, client_secret: p.appSecret, redirect_uri: p.redirectUri, code: p.codigo },
      auth: "ninguna",
      reintentos: 1,
    });
    if (!r.access_token) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Facebook no devolvió el token al canjear el código." });
    registrarSecreto(r.access_token);
    return r.access_token;
  }

  /** Token de usuario de corta duración → de larga duración (60 días). */
  async tokenLargo(p: { appId: string; appSecret: string; tokenCorto: string }): Promise<{ token: string; caducaEn: string | null }> {
    const r = await this.peticion<{ access_token?: string; expires_in?: number }>("GET", "/oauth/access_token", {
      consulta: { grant_type: "fb_exchange_token", client_id: p.appId, client_secret: p.appSecret, fb_exchange_token: p.tokenCorto },
      auth: "ninguna",
      reintentos: 1,
    });
    if (!r.access_token) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Facebook no devolvió el token de larga duración." });
    registrarSecreto(r.access_token);
    const caducaEn = typeof r.expires_in === "number" && r.expires_in > 0 ? new Date(this.ahora() + r.expires_in * 1000).toISOString() : null;
    return { token: r.access_token, caducaEn };
  }

  /** Páginas que administra el usuario del token, con su token y su cuenta de Instagram vinculada. */
  async paginas(): Promise<PaginaMeta[]> {
    const r = await this.peticion<{ data?: Array<{ id: string; name?: string; access_token?: string; tasks?: string[];
      instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string } }> }>(
      "GET", "/me/accounts", {
        consulta: { fields: "id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url}", limit: "100" },
      },
    );
    return (r.data ?? []).map((p) => {
      registrarSecreto(p.access_token);
      const ig = p.instagram_business_account;
      return {
        id: String(p.id),
        nombre: p.name ?? null,
        token: p.access_token ?? null,
        tareas: Array.isArray(p.tasks) ? p.tasks.map(String) : [],
        instagram: ig ? { id: String(ig.id), usuario: ig.username ?? null, nombre: ig.name ?? null, foto: ig.profile_picture_url ?? null } : null,
      };
    });
  }

  /** Token de una página con el token de un usuario del sistema (modo secretos). */
  async tokenDePagina(paginaId: string): Promise<string | null> {
    const r = await this.peticion<{ access_token?: string }>("GET", `/${encodeURIComponent(paginaId)}`, { consulta: { fields: "access_token" }, reintentos: 1 });
    registrarSecreto(r.access_token);
    return r.access_token ?? null;
  }

  /** GET /debug_token del token de este cliente, autenticado con el token de la app («APP_ID|APP_SECRET»). */
  async depurarToken(appId: string, appSecret: string): Promise<DatosDepuracion> {
    const tokenApp = `${appId}|${appSecret}`;
    registrarSecreto(tokenApp);
    const r = await this.peticion<{ data?: DatosDepuracion }>("GET", "/debug_token", {
      consulta: { input_token: this.token, access_token: tokenApp },
      auth: "ninguna",
      reintentos: 1,
    });
    if (!r.data) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "debug_token no devolvió «data»." });
    return r.data;
  }

  async perfil(igUserId: string): Promise<PerfilIg> {
    const r = await this.peticion<{ id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number }>(
      "GET", `/${encodeURIComponent(igUserId)}`, { consulta: { fields: "id,username,name,profile_picture_url,followers_count,media_count" } },
    );
    return {
      id: String(r.id),
      usuario: r.username ?? null,
      nombre: r.name ?? null,
      foto: r.profile_picture_url ?? null,
      seguidores: typeof r.followers_count === "number" ? r.followers_count : null,
      publicaciones: typeof r.media_count === "number" ? r.media_count : null,
    };
  }

  // ── Instagram: publicación ───────────────────────────────────────────────

  async limitePublicacion(igUserId: string): Promise<LimitePublicacion> {
    const r = await this.peticion<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
      "GET", `/${encodeURIComponent(igUserId)}/content_publishing_limit`, { consulta: { fields: "config,quota_usage" } },
    );
    const fila = r.data?.[0];
    if (!fila || typeof fila.quota_usage !== "number") {
      throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "content_publishing_limit no devolvió quota_usage." });
    }
    const total = typeof fila.config?.quota_total === "number" ? fila.config.quota_total : null;
    return { usadas: fila.quota_usage, total, restantes: total === null ? null : Math.max(0, total - fila.quota_usage) };
  }

  /** POST /{ig-user-id}/media → id del contenedor. */
  async crearContenedor(igUserId: string, d: DatosContenedor): Promise<string> {
    const cuerpo: Record<string, string> = {};
    switch (d.tipo) {
      case "imagen":
        cuerpo.image_url = d.imageUrl;
        if (d.caption) cuerpo.caption = d.caption;
        if (d.altText) cuerpo.alt_text = d.altText;
        break;
      case "reel":
        cuerpo.media_type = "REELS";
        cuerpo.video_url = d.videoUrl;
        cuerpo.share_to_feed = "true";
        if (d.caption) cuerpo.caption = d.caption;
        if (typeof d.thumbOffsetMs === "number" && d.thumbOffsetMs >= 0) cuerpo.thumb_offset = String(Math.round(d.thumbOffsetMs));
        break;
      case "story_imagen":
        cuerpo.media_type = "STORIES";
        cuerpo.image_url = d.imageUrl;
        break;
      case "story_video":
        cuerpo.media_type = "STORIES";
        cuerpo.video_url = d.videoUrl;
        break;
      case "hijo_imagen":
        cuerpo.image_url = d.imageUrl;
        cuerpo.is_carousel_item = "true";
        if (d.altText) cuerpo.alt_text = d.altText;
        break;
      case "hijo_video":
        cuerpo.media_type = "VIDEO";
        cuerpo.video_url = d.videoUrl;
        cuerpo.is_carousel_item = "true";
        break;
      case "carrusel":
        if (d.hijos.length < 2) throw new Error("crearContenedor: un carrusel necesita al menos 2 elementos.");
        cuerpo.media_type = "CAROUSEL";
        cuerpo.children = d.hijos.join(",");
        if (d.caption) cuerpo.caption = d.caption;
        break;
    }
    const r = await this.peticion<{ id?: string }>("POST", `/${encodeURIComponent(igUserId)}/media`, { cuerpo });
    if (!r.id) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Meta no devolvió el id del contenedor." });
    return String(r.id);
  }

  async estadoContenedor(contenedorId: string): Promise<InfoContenedor> {
    const r = await this.peticion<{ id?: string; status_code?: string; status?: string }>(
      "GET", `/${encodeURIComponent(contenedorId)}`, { consulta: { fields: "status_code,status" } },
    );
    return { id: String(r.id ?? contenedorId), estado: r.status_code ?? "DESCONOCIDO", detalle: r.status ? sanear(r.status) : null };
  }

  /**
   * Sondea el contenedor hasta FINISHED. Devuelve el último estado: FINISHED, o IN_PROGRESS si se acabó el tiempo
   * (el programador lo retoma). Lanza ErrorMeta si llega a ERROR / EXPIRED / PUBLISHED.
   */
  async esperarContenedor(contenedorId: string, o: OpcionesSondeo = {}): Promise<InfoContenedor> {
    const intervalo = o.intervaloMs ?? SONDEO_POR_DEFECTO.intervaloMs;
    const maximo = o.maxMs ?? SONDEO_POR_DEFECTO.maxMs;
    const inicio = this.ahora();
    for (;;) {
      const info = await this.estadoContenedor(contenedorId);
      const transcurrido = this.ahora() - inicio;
      if (info.estado === "FINISHED") return info;
      if (info.estado === "ERROR") {
        const tipo = tipoDesdeTextoEstado(info.detalle ?? undefined);
        throw new ErrorMeta({
          tipo: "contenedor_error",
          mensaje: `${textoDeTipo("contenedor_error").mensaje}${info.detalle ? ` — Meta dice: «${info.detalle}»` : ""}`,
          ...(tipo ? { comoArreglarlo: textoDeTipo(tipo).comoArreglarlo } : {}),
        });
      }
      if (info.estado === "EXPIRED") throw new ErrorMeta({ tipo: "contenedor_caducado" });
      if (info.estado === "PUBLISHED") throw new ErrorMeta({ tipo: "contenedor_ya_publicado" });
      if (transcurrido + intervalo > maximo || intervalo + 2_000 > this.quedaMs()) return info;
      await this.dormir(intervalo);
    }
  }

  /** POST /{ig-user-id}/media_publish. SIN reintentos: usa publicarSinDuplicar. */
  async publicar(igUserId: string, creationId: string): Promise<string> {
    const r = await this.peticion<{ id?: string }>("POST", `/${encodeURIComponent(igUserId)}/media_publish`, {
      cuerpo: { creation_id: creationId },
      reintentos: 0,
    });
    if (!r.id) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Meta no devolvió el id de la publicación." });
    return String(r.id);
  }

  /**
   * media_publish sin duplicar: si falla, mira el contenedor. PUBLISHED → salió: busca la publicación (por texto y
   * hora) y la devuelve con `recuperado`. Si no, relanza el error: el contenedor queda guardado en la pieza y el
   * siguiente intento lo vuelve a mirar antes de crear otro.
   */
  async publicarSinDuplicar(igUserId: string, creationId: string, o: { caption?: string | null; story?: boolean; desdeMs?: number } = {}): Promise<ResultadoPublicar> {
    try {
      return { mediaId: await this.publicar(igUserId, creationId), permalink: null, recuperado: false };
    } catch (e) {
      if (!(e instanceof ErrorMeta)) throw e;
      const miradas = TIPOS_DUDOSOS.has(e.tipo) ? 2 : 1;
      for (let i = 0; i < miradas; i++) {
        if (i > 0) {
          if (this.quedaMs() < 6_000) break;
          await this.dormir(3_000);
        }
        let info: InfoContenedor;
        try {
          info = await this.estadoContenedor(creationId);
        } catch {
          break;
        }
        if (info.estado === "PUBLISHED") {
          this.registro?.(`media_publish falló (${e.tipo}), pero el contenedor ya está publicado: no se reintenta`);
          const m = await this.buscarMedioPublicado(igUserId, o).catch(() => null);
          return { mediaId: m?.id ?? null, permalink: m?.permalink ?? null, recuperado: true };
        }
        if (info.estado !== "FINISHED" && info.estado !== "IN_PROGRESS") break;
      }
      throw e;
    }
  }

  /** Busca una publicación recién salida: las últimas de la cuenta desde `desdeMs` − 10 min, con el mismo texto. */
  async buscarMedioPublicado(igUserId: string, o: { caption?: string | null; story?: boolean; desdeMs?: number } = {}): Promise<MedioPublicado | null> {
    const ruta = o.story ? "stories" : "media";
    const r = await this.peticion<{ data?: Array<{ id?: string; caption?: string; timestamp?: string; permalink?: string }> }>(
      "GET", `/${encodeURIComponent(igUserId)}/${ruta}`, { consulta: { fields: "id,caption,timestamp,permalink", limit: "10" }, reintentos: 1 },
    );
    const desde = typeof o.desdeMs === "number" ? o.desdeMs - 10 * 60_000 : -Infinity;
    const texto = (o.caption ?? "").trim();
    const candidatos = (r.data ?? [])
      .filter((m) => m.id && (Date.parse(m.timestamp ?? "") || 0) >= desde)
      .filter((m) => o.story || !texto || (m.caption ?? "").trim() === texto)
      .sort((a, b) => (Date.parse(b.timestamp ?? "") || 0) - (Date.parse(a.timestamp ?? "") || 0));
    const m = candidatos[0];
    return m?.id ? { id: String(m.id), permalink: m.permalink ?? null } : null;
  }

  /** GET /{media-id}?fields=permalink. */
  async permalink(mediaId: string): Promise<string | null> {
    const r = await this.peticion<{ permalink?: string }>("GET", `/${encodeURIComponent(mediaId)}`, { consulta: { fields: "permalink" } });
    return r.permalink ?? null;
  }

  // ── Facebook: publicación en la página (con el token de la página) ───────

  /** POST /{page-id}/photos. publicada=false: foto suelta para una publicación de varias fotos. Sin reintentos. */
  async fbFoto(paginaId: string, d: { url: string; mensaje?: string; publicada: boolean }): Promise<{ id: string; postId: string | null }> {
    const cuerpo: Record<string, string> = { url: d.url, published: d.publicada ? "true" : "false" };
    if (!d.publicada) cuerpo.temporary = "true";
    if (d.mensaje) cuerpo.message = d.mensaje;
    const r = await this.peticion<{ id?: string; post_id?: string }>("POST", `/${encodeURIComponent(paginaId)}/photos`, { cuerpo, reintentos: d.publicada ? 0 : 2 });
    if (!r.id) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Facebook no devolvió el id de la foto." });
    return { id: String(r.id), postId: r.post_id ? String(r.post_id) : null };
  }

  /** POST /{page-id}/feed con las fotos ya subidas (attached_media). Sin reintentos. */
  async fbVariasFotos(paginaId: string, d: { mensaje: string; fotos: string[] }): Promise<string> {
    const cuerpo: Record<string, string> = { message: d.mensaje };
    d.fotos.forEach((id, i) => {
      cuerpo[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
    const r = await this.peticion<{ id?: string }>("POST", `/${encodeURIComponent(paginaId)}/feed`, { cuerpo, reintentos: 0 });
    if (!r.id) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Facebook no devolvió el id de la publicación." });
    return String(r.id);
  }

  /** POST /{page-id}/videos con la URL del vídeo (Facebook lo descarga y lo procesa solo). Sin reintentos. */
  async fbVideo(paginaId: string, d: { url: string; descripcion?: string }): Promise<string> {
    const cuerpo: Record<string, string> = { file_url: d.url };
    if (d.descripcion) cuerpo.description = d.descripcion;
    const r = await this.peticion<{ id?: string }>("POST", `/${encodeURIComponent(paginaId)}/videos`, { cuerpo, reintentos: 0 });
    if (!r.id) throw new ErrorMeta({ tipo: "respuesta_inesperada", mensaje: "Facebook no devolvió el id del vídeo." });
    return String(r.id);
  }

  /** Enlace a una publicación o vídeo de Facebook (null si aún no lo da). */
  async fbEnlace(objetoId: string): Promise<string | null> {
    const r = await this.peticion<{ permalink_url?: string }>("GET", `/${encodeURIComponent(objetoId)}`, { consulta: { fields: "permalink_url" }, reintentos: 1 });
    const p = r.permalink_url ?? null;
    if (!p) return null;
    return p.startsWith("http") ? p : `https://www.facebook.com${p.startsWith("/") ? "" : "/"}${p}`;
  }

  /** Seguidores de la página. */
  async fbSeguidores(paginaId: string): Promise<number | null> {
    const r = await this.peticion<{ followers_count?: number; fan_count?: number }>("GET", `/${encodeURIComponent(paginaId)}`, {
      consulta: { fields: "followers_count,fan_count" }, reintentos: 1,
    });
    return typeof r.followers_count === "number" ? r.followers_count : typeof r.fan_count === "number" ? r.fan_count : null;
  }
}
