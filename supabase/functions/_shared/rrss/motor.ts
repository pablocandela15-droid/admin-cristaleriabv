// ============================================================================
//  RRSS · núcleo de publicación (Instagram y página de Facebook)
// ----------------------------------------------------------------------------
//  Lo usan rrss-publicar («Publicar ahora») y rrss-programador (lo programado y
//  lo que Meta estaba procesando). La pieza llega ya RESERVADA
//  (rrss_pieza_reservar); el que llama la cierra con el resultado.
//
//  Instagram (Content Publishing, como en el panel de referencia):
//    1. Si la pieza ya tiene contenedor (una pasada anterior), se mira antes de
//       crear otro: PUBLISHED → se recupera la publicación (nunca se repite);
//       FINISHED / IN_PROGRESS → se sigue con él; caducado → se empieza de nuevo.
//    2. Cupo de 24 h: si está agotado, se aplaza sin gastar nada.
//    3. Contenedor (foto, reel, historia; o un hijo por elemento y luego el
//       carrusel) con una URL firmada del cubo privado. Cada id se guarda en
//       cuanto existe (rrss_pieza_progreso).
//    4. Espera a FINISHED. Si Meta sigue procesando (vídeos) al acabarse el
//       tiempo, queda «procesando» y el programador lo retoma.
//    5. media_publish SIN reintento (publicarSinDuplicar) y media_id guardado al
//       momento; luego el enlace.
//  Facebook (página): foto (POST /photos), varias fotos (fotos sin publicar +
//  /feed) o vídeo (/videos con la URL). La llamada que publica no se repite: si
//  falla de forma dudosa (red, tiempo…), queda en error pidiendo comprobarlo en
//  la página.
//
//  Credenciales: si Meta rechaza el token de Instagram por credenciales (190,
//  10, 200-299: no ha hecho nada), se prueba una vez con el de respaldo.
// ============================================================================
import { ClienteGraph, conElemento, type DatosContenedor, type InfoContenedor } from "./cliente.ts";
import type { Credenciales } from "./credenciales.ts";
import { ErrorMeta, TIPOS_CREDENCIAL, TIPOS_DUDOSOS } from "./errores.ts";
import type { AvanceMotor, FilaMedio, FilaPieza } from "./repositorio.ts";
import { problemasPieza } from "./validacion.ts";

/** Caducidad de las URL firmadas que recibe Meta (las fotos las descarga al momento; los vídeos, mientras procesa). */
export const SEG_URL_IMAGEN = 60 * 60;
export const SEG_URL_VIDEO = 6 * 60 * 60;
/** No se llama a media_publish con menos de esto por delante (lo termina la siguiente pasada). */
export const MIN_PARA_PUBLICAR_MS = 20_000;
/** Espera máxima de FINISHED por contenedor en una pasada. */
export const MAX_SONDEO_MS = 45_000;

export interface DependenciasMotor {
  cred: Credenciales;
  reserva: string;
  /** Avance de la pieza (exige la reserva). */
  progreso(a: AvanceMotor): Promise<unknown>;
  urlFirmada(ruta: string, segundos: number): Promise<string>;
  /** Cliente de la Graph API con ese token (y el límite de tiempo de la pasada). */
  crearCliente(token: string): ClienteGraph;
  ahora: () => number;
  /** Instante (ms) a partir del cual no se empieza nada nuevo. */
  limite: number;
  intervaloSondeoMs?: number;
}

export type ResultadoMotor =
  | { tipo: "publicada"; mediaId: string | null; permalink: string | null; aviso?: string }
  | { tipo: "procesando"; mensaje: string }
  | { tipo: "aplazar"; mensaje: string; esperaSeg: number }
  | { tipo: "error"; error: ErrorMeta; limpiarContenedor?: boolean };

interface Contexto extends DependenciasMotor {
  cliente: ClienteGraph;
  respaldo: ClienteGraph | null;
}

/** Llama con el cliente de Instagram y, si Meta rechaza las credenciales, una vez con el de respaldo. */
async function llamar<T>(ctx: Contexto, fn: (c: ClienteGraph) => Promise<T>): Promise<T> {
  try {
    return await fn(ctx.cliente);
  } catch (e) {
    if (e instanceof ErrorMeta && TIPOS_CREDENCIAL.has(e.tipo) && ctx.respaldo) {
      ctx.cliente = ctx.respaldo;
      ctx.respaldo = null;
      return await fn(ctx.cliente);
    }
    throw e;
  }
}

function sondeo(ctx: Contexto) {
  const queda = ctx.limite - ctx.ahora() - MIN_PARA_PUBLICAR_MS;
  return { intervaloMs: ctx.intervaloSondeoMs ?? 5_000, maxMs: Math.max(0, Math.min(MAX_SONDEO_MS, queda)) };
}

const segundosUrl = (m: FilaMedio) => (m.tipo === "video" ? SEG_URL_VIDEO : SEG_URL_IMAGEN);

export async function publicarPieza(p: FilaPieza, medios: readonly FilaMedio[], deps: DependenciasMotor): Promise<ResultadoMotor> {
  if (p.media_id) return { tipo: "publicada", mediaId: p.media_id, permalink: p.permalink };
  const problemas = problemasPieza(p, medios);
  if (problemas.length > 0) {
    return { tipo: "error", error: new ErrorMeta({ tipo: "validacion", mensaje: problemas.join(". ") }) };
  }
  try {
    if (p.red === "instagram") {
      if (!deps.cred.tokenInstagram || !deps.cred.igUserId) throw new ErrorMeta({ tipo: "sin_conexion", mensaje: "Falta la cuenta de Instagram en la conexión" });
      const ctx: Contexto = {
        ...deps,
        cliente: deps.crearCliente(deps.cred.tokenInstagram),
        respaldo: deps.cred.tokenInstagramRespaldo ? deps.crearCliente(deps.cred.tokenInstagramRespaldo) : null,
      };
      return await instagram(p, medios, ctx, deps.cred.igUserId);
    }
    return await facebook(p, medios, deps);
  } catch (e) {
    if (!(e instanceof ErrorMeta)) throw e;
    if (e.tipo === "limite_publicacion") return { tipo: "aplazar", mensaje: e.message, esperaSeg: 30 * 60 };
    if (e.tipo === "limite_llamadas") return { tipo: "aplazar", mensaje: e.message, esperaSeg: Math.min(3600, Math.max(300, (e.minutosParaRecuperar ?? 5) * 60)) };
    return { tipo: "error", error: e, limpiarContenedor: e.tipo === "contenedor_error" || e.tipo === "contenedor_caducado" };
  }
}

async function instagram(p: FilaPieza, medios: readonly FilaMedio[], ctx: Contexto, ig: string): Promise<ResultadoMotor> {
  let contenedor = p.contenedor_id;
  let hijos = [...(p.hijos ?? [])];
  const iniciada = Date.parse(p.publicacion_iniciada_at ?? "");
  const desdeMs = Number.isFinite(iniciada) ? iniciada : ctx.ahora();
  const story = p.formato === "story";
  const caption = story ? undefined : p.caption.trim() || undefined;

  // 1. Lo que dejó una pasada anterior: antes de crear otro contenedor se mira si Meta ya lo publicó.
  if (contenedor) {
    const actual = contenedor;
    let info: InfoContenedor;
    try {
      info = await llamar(ctx, (c) => c.estadoContenedor(actual));
    } catch (e) {
      if (!(e instanceof ErrorMeta) || e.tipo !== "contenedor_inexistente") throw e;
      info = { id: actual, estado: "EXPIRED", detalle: null };
    }
    if (info.estado === "PUBLISHED") {
      const m = await llamar(ctx, (c) => c.buscarMedioPublicado(ig, { caption, story, desdeMs })).catch(() => null);
      if (m?.id) await ctx.progreso({ mediaId: m.id, permalink: m.permalink });
      return {
        tipo: "publicada",
        mediaId: m?.id ?? null,
        permalink: m?.permalink ?? null,
        ...(m?.id ? {} : { aviso: "Instagram la dio por publicada, pero no se ha encontrado cuál es: compruébala en la cuenta." }),
      };
    }
    if (info.estado !== "FINISHED" && info.estado !== "IN_PROGRESS" && info.estado !== "ERROR") {
      contenedor = null;
      hijos = [];
      await ctx.progreso({ limpiar: true });
    }
  }

  // 2. Cupo de 24 h (antes de crear nada).
  if (!contenedor) {
    const lim = await llamar(ctx, (c) => c.limitePublicacion(ig)).catch((e) => {
      if (e instanceof ErrorMeta && e.tipo === "respuesta_inesperada") return null;
      throw e;
    });
    if (lim && lim.restantes === 0) {
      return { tipo: "aplazar", mensaje: `Se ha gastado el cupo de publicaciones de Instagram de 24 h (${lim.usadas} de ${lim.total}).`, esperaSeg: 30 * 60 };
    }
  }

  // 3. Contenedor.
  if (!contenedor) {
    if (p.formato === "carrusel") {
      for (let i = 0; i < medios.length; i++) {
        if (hijos[i]) continue;
        const m = medios[i];
        const url = await ctx.urlFirmada(m.ruta, segundosUrl(m));
        const datos: DatosContenedor = m.tipo === "video" ? { tipo: "hijo_video", videoUrl: url } : { tipo: "hijo_imagen", imageUrl: url, altText: m.alt_text || undefined };
        try {
          hijos[i] = await llamar(ctx, (c) => c.crearContenedor(ig, datos));
        } catch (e) {
          throw conElemento(e, i + 1);
        }
        await ctx.progreso({ hijos: hijos.slice(0, medios.length) });
      }
      for (let i = 0; i < medios.length; i++) {
        const hijo = hijos[i];
        let info: InfoContenedor;
        try {
          info = await llamar(ctx, (c) => c.esperarContenedor(hijo, sondeo(ctx)));
        } catch (e) {
          throw conElemento(e, i + 1);
        }
        if (info.estado !== "FINISHED") return { tipo: "procesando", mensaje: `Instagram aún está procesando el elemento ${i + 1} del carrusel. Se publicará solo en unos minutos.` };
      }
      const listos = hijos.slice(0, medios.length);
      contenedor = await llamar(ctx, (c) => c.crearContenedor(ig, { tipo: "carrusel", hijos: listos, caption }));
    } else {
      const m = medios[0];
      const url = await ctx.urlFirmada(m.ruta, segundosUrl(m));
      const datos: DatosContenedor = story
        ? (m.tipo === "video" ? { tipo: "story_video", videoUrl: url } : { tipo: "story_imagen", imageUrl: url })
        : p.formato === "reel"
          ? { tipo: "reel", videoUrl: url, caption, thumbOffsetMs: m.portada_ms }
          : { tipo: "imagen", imageUrl: url, caption, altText: m.alt_text || undefined };
      contenedor = await llamar(ctx, (c) => c.crearContenedor(ig, datos));
    }
    await ctx.progreso({ contenedor });
  }

  // 4. Espera a que Meta lo tenga listo.
  const listo = contenedor;
  const info = await llamar(ctx, (c) => c.esperarContenedor(listo, sondeo(ctx)));
  if (info.estado !== "FINISHED") {
    return { tipo: "procesando", mensaje: "Instagram aún está procesando el vídeo. Se publicará solo en unos minutos." };
  }
  if (ctx.limite - ctx.ahora() < MIN_PARA_PUBLICAR_MS) {
    return { tipo: "procesando", mensaje: "Ya está preparada en Instagram; se publica en la siguiente pasada (unos minutos)." };
  }

  // 5. Publicar (una sola vez) y guardar el id en cuanto Meta lo confirma.
  const r = await llamar(ctx, (c) => c.publicarSinDuplicar(ig, listo, { caption, story, desdeMs }));
  if (r.mediaId) await ctx.progreso({ mediaId: r.mediaId, permalink: r.permalink });
  let permalink = r.permalink;
  const mediaId = r.mediaId;
  if (mediaId && !permalink) permalink = await llamar(ctx, (c) => c.permalink(mediaId)).catch(() => null);
  return {
    tipo: "publicada",
    mediaId,
    permalink,
    ...(mediaId ? {} : { aviso: "Instagram la dio por publicada, pero no se ha encontrado cuál es: compruébala en la cuenta." }),
  };
}

async function facebook(p: FilaPieza, medios: readonly FilaMedio[], deps: DependenciasMotor): Promise<ResultadoMotor> {
  const pagina = deps.cred.paginaId;
  if (!pagina || !deps.cred.tokenPagina) throw new ErrorMeta({ tipo: "sin_pagina" });
  const c = deps.crearCliente(deps.cred.tokenPagina);
  const mensaje = p.caption.trim();
  let final = false;
  let mediaId: string;
  try {
    if (p.formato === "foto") {
      const url = await deps.urlFirmada(medios[0].ruta, SEG_URL_IMAGEN);
      final = true;
      const r = await c.fbFoto(pagina, { url, mensaje, publicada: true });
      mediaId = r.postId ?? r.id;
    } else if (p.formato === "carrusel") {
      const hijos = [...(p.hijos ?? [])];
      for (let i = 0; i < medios.length; i++) {
        if (hijos[i]) continue;
        const url = await deps.urlFirmada(medios[i].ruta, SEG_URL_IMAGEN);
        try {
          hijos[i] = (await c.fbFoto(pagina, { url, publicada: false })).id;
        } catch (e) {
          throw conElemento(e, i + 1);
        }
        await deps.progreso({ hijos: hijos.slice(0, medios.length) });
      }
      final = true;
      mediaId = await c.fbVariasFotos(pagina, { mensaje, fotos: hijos.slice(0, medios.length) });
    } else {
      const url = await deps.urlFirmada(medios[0].ruta, SEG_URL_VIDEO);
      final = true;
      mediaId = await c.fbVideo(pagina, { url, descripcion: mensaje });
    }
  } catch (e) {
    if (final && e instanceof ErrorMeta && TIPOS_DUDOSOS.has(e.tipo)) {
      throw new ErrorMeta({ tipo: "dudoso", mensaje: `${e.message}. No se sabe si llegó a publicarse en Facebook.` });
    }
    throw e;
  }
  await deps.progreso({ mediaId });
  const permalink = await c.fbEnlace(mediaId).catch(() => null);
  return { tipo: "publicada", mediaId, permalink };
}
