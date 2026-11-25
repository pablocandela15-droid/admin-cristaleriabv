/**
 * Edge Function rrss-metricas — captura las métricas de Instagram (y los seguidores de la página de Facebook).
 *
 *   POST {accion:"capturar"}
 *     · pg_cron (rrss_disparar('metricas'), 05:10 UTC) con x-ocr-secret = OCR_TRABAJOS_SECRET (tiempo constante;
 *       sin el secreto, rechaza todo), o la service role;
 *     · un usuario con «Editar» en RRSS («Actualizar ahora»; como mucho una vez cada 5 minutos).
 *   → 200 { ok, fechaCaptura, dias, publicaciones, avisos }
 *     200 { ok: true, omitida: "sin_conexion" } desde el cron si RRSS no está conectado (no llama a Meta).
 *   503 sin conexión (panel) · 502 permiso_insights y demás errores de Meta (explicados) · 429 demasiado pronto.
 *
 * Leer las métricas NO pasa por aquí: el panel lee las tablas con su RLS («Ver» en RRSS) y calcula el resumen con
 * _shared/rrss/resumen.ts. Cada captura queda en rrss_metricas_capturas (ok o el error, saneado).
 * Sin Deno ni imports remotos: las dependencias se inyectan (vitest).
 */
import type { ClienteGraph } from "../_shared/rrss/cliente.ts";
import type { ConfigMeta } from "../_shared/rrss/config.ts";
import { resolverCredenciales } from "../_shared/rrss/credenciales.ts";
import { ErrorMeta, errorMetaAJson, estadoHttpDeError, TIPOS_CREDENCIAL } from "../_shared/rrss/errores.ts";
import { json, leerCuerpo } from "../_shared/rrss/http.ts";
import type { RepositorioRrss } from "../_shared/rrss/repositorio.ts";
import { mensajeSaneado, sanear } from "../_shared/rrss/secretos.ts";
import { capturarMetricas, type Almacen } from "./capturar.ts";

export const MIN_ENTRE_CAPTURAS_PANEL_MS = 5 * 60_000;
export const LIMITE_CAPTURA_MS = 120_000;

export interface RegistroCapturas {
  /** Inicio de la última captura del panel (para el límite de 5 minutos). */
  ultimaDelPanel(): Promise<string | null>;
  empezar(origen: "cron" | "panel" | "servicio", cuentaId: string | null): Promise<number | null>;
  terminar(id: number | null, r: { ok: boolean; dias?: number; publicaciones?: number; errorTipo?: string | null; error?: string | null; avisos?: string[] }): Promise<void>;
}

export interface DependenciasMetricas {
  config: ConfigMeta;
  repo: RepositorioRrss;
  almacen: Almacen;
  capturas: RegistroCapturas;
  /** null si la petición no viene del cron ni de la service role. */
  origenServidor(req: Request): "cron" | "servicio" | null;
  autorizar(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }>;
  crearCliente(token: string, limite: number): ClienteGraph;
  ahora: () => number;
}

export async function manejarMetricas(req: Request, d: DependenciasMetricas): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const servidor = d.origenServidor(req);
  if (!servidor) {
    const auth = await d.autorizar(req);
    if (!auth.ok) return auth.response;
  }
  const cuerpo = await leerCuerpo(req);
  if (cuerpo === null) return json({ ok: false, error: "Cuerpo de la petición no válido" }, 400);
  if ((cuerpo.accion ?? "capturar") !== "capturar") return json({ ok: false, error: "accion no válida (capturar)" }, 400);
  const origen = servidor ?? "panel";

  if (origen === "panel") {
    const ultima = await d.capturas.ultimaDelPanel();
    if (ultima && d.ahora() - Date.parse(ultima) < MIN_ENTRE_CAPTURAS_PANEL_MS) {
      return json({ ok: false, tipo: "demasiado_pronto", error: "Se acaban de actualizar. Espera unos minutos antes de volver a pedirlas." }, 429);
    }
  }
  const res = await resolverCredenciales(d.config, d.repo, { conPagina: true });
  if (!res.ok) {
    if (origen !== "panel" && res.error.tipo === "sin_conexion") return json({ ok: true, omitida: "sin_conexion" });
    return json({ ok: false, ...errorMetaAJson(res.error) }, estadoHttpDeError(res.error));
  }
  const cred = res.cred;
  if (!cred.igUserId || !cred.tokenInstagram) {
    return json({ ok: false, ...errorMetaAJson(new ErrorMeta({ tipo: "sin_conexion", mensaje: "Falta la cuenta de Instagram" })) }, 503);
  }
  const limite = d.ahora() + LIMITE_CAPTURA_MS;
  const id = await d.capturas.empezar(origen, cred.igUserId);
  const pagina = cred.paginaId && cred.tokenPagina ? { id: cred.paginaId, cliente: d.crearCliente(cred.tokenPagina, limite) } : null;
  const capturar = (token: string) => capturarMetricas({ cliente: d.crearCliente(token, limite), igUserId: cred.igUserId as string, pagina, almacen: d.almacen, ahora: d.ahora });
  try {
    let r;
    try {
      r = await capturar(cred.tokenInstagram);
    } catch (e) {
      if (!(e instanceof ErrorMeta) || !TIPOS_CREDENCIAL.has(e.tipo) || !cred.tokenInstagramRespaldo) throw e;
      r = await capturar(cred.tokenInstagramRespaldo);
    }
    await d.capturas.terminar(id, { ok: true, dias: r.dias.length, publicaciones: r.publicaciones, avisos: r.avisos.map(sanear) });
    return json({ ok: true, ...r });
  } catch (e) {
    const em = e instanceof ErrorMeta ? e : null;
    const tipo = em ? (/manage_insights/.test(em.message) ? "permiso_insights" : em.tipo) : "interno";
    await d.capturas.terminar(id, { ok: false, errorTipo: tipo, error: em?.message ?? mensajeSaneado(e) }).catch(() => undefined);
    if (em) return json({ ok: false, ...errorMetaAJson(em), tipo }, estadoHttpDeError(em));
    return json({ ok: false, error: "No se pudieron guardar las métricas." }, 500);
  }
}
