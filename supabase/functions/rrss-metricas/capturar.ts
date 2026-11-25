/**
 * Acción «capturar» de rrss-metricas: pide a Meta las métricas de la cuenta de Instagram (por día de Europe/Madrid) y
 * de sus publicaciones recientes, y los seguidores de la página de Facebook, y los guarda con la clave de servicio en
 * rrss_metricas_cuenta y rrss_metricas_publicacion. Portado del panel de referencia (instagram-metricas/capturar.ts).
 *
 *  - Días: los 3 últimos días completos (Meta avisa de que los datos pueden tardar hasta 48 h: se rehacen).
 *  - Seguidores: followers_count al capturar, solo en el día más reciente.
 *  - Publicaciones: las del feed (y reels) de los últimos 90 días (como mucho 200) + las historias activas. Una fila
 *    por publicación y día de captura, enlazada con rrss_piezas por media_id.
 *  - Si al token le falta instagram_manage_insights, la PRIMERA llamada falla y se lanza el error de permiso (no se
 *    guarda nada). Los fallos de una publicación suelta no paran la captura: van a avisos.
 */
import type { ClienteGraph } from "../_shared/rrss/cliente.ts";
import { ErrorMeta } from "../_shared/rrss/errores.ts";
import {
  errorPermisoInsights, esFaltaPermisoInsights, fechaMadrid, historiasActivas, inicioDiaMadrid, insightsCuenta, insightsMedio,
  mediosDesde, seguidores, sumarDias, visitasPerfil, type MedioIg, type ValoresMedio,
} from "../_shared/rrss/insights.ts";
import { mensajeSaneado } from "../_shared/rrss/secretos.ts";

export const DIAS_CUENTA = 3;
export const DIAS_PUBLICACIONES = 90;
export const MAX_PUBLICACIONES = 200;
const EN_PARALELO = 8;

export interface Almacen {
  guardar(tabla: "rrss_metricas_cuenta" | "rrss_metricas_publicacion", filas: Record<string, unknown>[], conflicto: string): Promise<void>;
  /** id de la pieza de cada media_id que salió del panel. */
  piezasDe(mediaIds: string[]): Promise<Map<string, string>>;
}

export interface DependenciasCaptura {
  cliente: ClienteGraph;
  igUserId: string;
  /** Página de Facebook (seguidores), si la hay. */
  pagina?: { id: string; cliente: ClienteGraph } | null;
  almacen: Almacen;
  ahora: () => number;
}

export interface ResultadoCaptura {
  fechaCaptura: string;
  dias: string[];
  publicaciones: number;
  avisos: string[];
}

export async function capturarMetricas(d: DependenciasCaptura): Promise<ResultadoCaptura> {
  const avisos: string[] = [];
  const hoy = fechaMadrid(d.ahora());
  const dias = Array.from({ length: DIAS_CUENTA }, (_, i) => sumarDias(hoy, -(i + 1)));
  const capturado = () => new Date(d.ahora()).toISOString();

  // ── Cuenta: un día por llamada (total_value suma el rango pedido) ──
  let pedirVisitas = true;
  for (const [i, dia] of dias.entries()) {
    const desde = inicioDiaMadrid(dia);
    const hasta = inicioDiaMadrid(sumarDias(dia, 1));
    let v;
    try {
      v = await insightsCuenta(d.cliente, d.igUserId, desde, hasta);
    } catch (e) {
      if (esFaltaPermisoInsights(e)) throw errorPermisoInsights(e as ErrorMeta);
      throw e;
    }
    const fila: Record<string, unknown> = {
      fecha: dia, red: "instagram", cuenta_id: d.igUserId, alcance: v.alcance, visualizaciones: v.visualizaciones,
      cuentas_interaccion: v.cuentasInteraccion, interacciones: v.interacciones, me_gusta: v.meGusta, comentarios: v.comentarios,
      guardados: v.guardados, compartidos: v.compartidos, toques_enlaces: v.toquesEnlaces, capturado_at: capturado(),
    };
    if (pedirVisitas) {
      try {
        fila.visitas_perfil = await visitasPerfil(d.cliente, d.igUserId, desde, hasta);
      } catch (e) {
        if (e instanceof ErrorMeta && (e.tipo === "token" || e.tipo === "sesion")) throw e;
        pedirVisitas = false;
        avisos.push(`Meta no da las visitas al perfil (profile_views): se dejan vacías. ${mensajeSaneado(e)}`);
      }
    }
    if (i === 0) {
      try {
        fila.seguidores = await seguidores(d.cliente, d.igUserId);
      } catch (e) {
        avisos.push(`No se pudo leer el número de seguidores: ${mensajeSaneado(e)}`);
      }
    }
    // Una petición por fila: no todas llevan las mismas columnas y PostgREST exige las mismas en un lote.
    await d.almacen.guardar("rrss_metricas_cuenta", [fila], "fecha,red,cuenta_id");
  }

  // ── Página de Facebook: seguidores de hoy ──
  if (d.pagina) {
    try {
      const n = await d.pagina.cliente.fbSeguidores(d.pagina.id);
      if (n !== null) {
        await d.almacen.guardar("rrss_metricas_cuenta", [{ fecha: hoy, red: "facebook", cuenta_id: d.pagina.id, seguidores: n, capturado_at: capturado() }], "fecha,red,cuenta_id");
      }
    } catch (e) {
      avisos.push(`No se pudieron leer los seguidores de la página de Facebook: ${mensajeSaneado(e)}`);
    }
  }

  // ── Publicaciones ──
  const lista = await mediosDesde(d.cliente, d.igUserId, inicioDiaMadrid(sumarDias(hoy, -DIAS_PUBLICACIONES)), MAX_PUBLICACIONES);
  const medios: MedioIg[] = lista.medios;
  if (lista.truncado) avisos.push(`Hay más publicaciones en los últimos ${DIAS_PUBLICACIONES} días de las que se capturan (${medios.length}).`);
  try {
    const vistos = new Set(medios.map((m) => m.id));
    for (const h of await historiasActivas(d.cliente, d.igUserId)) if (!vistos.has(h.id)) medios.push(h);
  } catch (e) {
    avisos.push(`No se pudieron leer las historias activas: ${mensajeSaneado(e)}`);
  }

  const metricas = new Map<string, ValoresMedio | null>();
  let fallosHistoria = 0;
  for (let i = 0; i < medios.length; i += EN_PARALELO) {
    const tanda = medios.slice(i, i + EN_PARALELO);
    const res = await Promise.allSettled(tanda.map((m) => insightsMedio(d.cliente, m)));
    res.forEach((r, j) => {
      const m = tanda[j];
      if (r.status === "fulfilled") {
        metricas.set(m.id, r.value);
        return;
      }
      metricas.set(m.id, null);
      const e = r.reason;
      if (e instanceof ErrorMeta && (e.tipo === "token" || e.tipo === "sesion")) throw e;
      if (m.producto === "STORY") fallosHistoria++;
      else avisos.push(`Sin métricas de la publicación ${m.id}: ${mensajeSaneado(e)}`);
    });
  }
  if (fallosHistoria) avisos.push(`${fallosHistoria} historia(s) sin métricas (Meta no las da con menos de 5 interacciones).`);

  const piezas = medios.length ? await d.almacen.piezasDe(medios.map((m) => m.id)) : new Map<string, string>();
  const filas = medios.map((m) => {
    const v = metricas.get(m.id);
    return {
      media_id: m.id, red: "instagram", cuenta_id: d.igUserId, fecha_captura: hoy, capturado_at: capturado(),
      pieza_id: piezas.get(m.id) ?? null, tipo_medio: m.tipoMedio, producto: m.producto, publicado_at: m.publicadoAt,
      publicado_local: m.publicadoLocal, permalink: m.permalink, miniatura_url: m.miniatura, caption: m.caption, hashtags: m.hashtags,
      alcance: v?.alcance ?? null, me_gusta: v?.meGusta ?? m.meGusta, comentarios: v?.comentarios ?? m.comentarios,
      guardados: v?.guardados ?? null, compartidos: v?.compartidos ?? null, visualizaciones: v?.visualizaciones ?? null,
      interacciones: v?.interacciones ?? null, tiempo_medio_ms: v?.tiempoMedioMs ?? null,
      tasa_salto: typeof v?.tasaSalto === "number" ? Math.min(100, v.tasaSalto) : null,
    };
  });
  if (filas.length) await d.almacen.guardar("rrss_metricas_publicacion", filas, "media_id,fecha_captura");
  return { fechaCaptura: hoy, dias, publicaciones: filas.length, avisos };
}
