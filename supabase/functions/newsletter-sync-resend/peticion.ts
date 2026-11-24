// ============================================================================
// newsletter-sync-resend — autenticación y forma de las respuestas (puro)
// ----------------------------------------------------------------------------
// Portado del panel de referencia. Dos llamadores:
//   · el panel (estado de la configuración y botón «Actualizar lista de envío»):
//     JWT del usuario + «Ver» en Newsletter para el estado y «Editar» para
//     sincronizar (exigirPermiso en index.ts);
//   · pg_cron (newsletter_disparar_sync, una vez al día): sin usuario, con la
//     cabecera x-ocr-secret == OCR_TRABAJOS_SECRET (comparación en tiempo
//     constante; FALLA CERRADO si el secreto no está configurado), como las
//     demás tareas del panel.
// Por eso verify_jwt = false en supabase/config.toml: el cron no trae JWT.
// ============================================================================

import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { nivelCuota, type CanalNewsletter, type NivelCuota } from "../_shared/resend-marketing/config.ts";
import type { PasadaResend } from "../_shared/resend-marketing/repositorio.ts";
import type { ResumenSync } from "../_shared/resend-marketing/sync.ts";

export type Accion = "estado" | "sincronizar";

/** GET = estado. POST {accion: "estado" | "sincronizar"}; sin cuerpo o sin accion, sincronizar (lo que manda el cron). */
export function leerAccion(metodo: string, cuerpo: unknown): Accion | null {
  if (metodo === "GET") return "estado";
  if (cuerpo === null || cuerpo === undefined) return "sincronizar";
  if (typeof cuerpo !== "object") return null;
  const a = (cuerpo as { accion?: unknown }).accion;
  if (a === undefined) return "sincronizar";
  return a === "estado" || a === "sincronizar" ? a : null;
}

export type AutenticacionCron = { es: false } | { es: true; ok: true } | { es: true; ok: false; status: 401 | 500; error: string };

/** ¿Es la llamada de pg_cron? (cabecera x-ocr-secret). Si lo es, ¿vale el secreto? */
export function autenticarCron(cabeceras: { get(nombre: string): string | null }, secreto: string): AutenticacionCron {
  const recibido = cabeceras.get("x-ocr-secret");
  if (recibido === null) return { es: false };
  if (!secreto) return { es: true, ok: false, status: 500, error: "server_misconfigured" };
  if (!recibido || !compararTiempoConstante(recibido, secreto)) return { es: true, ok: false, status: 401, error: "unauthorized" };
  return { es: true, ok: true };
}

/** Lo que el panel enseña en Newsletter › Configuración: qué está y qué falta (nunca los valores de los secretos). */
export interface EstadoNewsletter {
  canal: CanalNewsletter;
  configurado: {
    api_key: boolean;
    webhook_secret: boolean;
    remitente: boolean;
    ia: boolean;
    cron_secret: boolean;
    segment_id: string | null;
  };
  /** En llano: lo que falta para poder enviar (vacío = se puede). */
  faltan: string[];
  limite_contactos: number;
  contactos_resend: number | null;
  nivel_cuota: NivelCuota;
  ultima_pasada: PasadaResend | null;
  ultima_terminada: PasadaResend | null;
  /** URL que hay que dar de alta en Resend › Webhooks. */
  url_webhook: string;
}

export function construirEstado(e: {
  canal: CanalNewsletter;
  apiKey: boolean;
  webhookSecret: boolean;
  remitente: boolean;
  ia: boolean;
  cronSecret: boolean;
  segmentIdEnv: string | null;
  faltan: string[];
  limite: number;
  ultima: PasadaResend | null;
  ultimaTerminada: PasadaResend | null;
  supabaseUrl: string;
}): EstadoNewsletter {
  const ref = e.ultimaTerminada ?? null;
  const contactos = ref?.contactos_resend ?? null;
  return {
    canal: e.canal,
    configurado: {
      api_key: e.apiKey,
      webhook_secret: e.webhookSecret,
      remitente: e.remitente,
      ia: e.ia,
      cron_secret: e.cronSecret,
      segment_id: (e.segmentIdEnv ?? "").trim() || ref?.segment_id || null,
    },
    faltan: e.faltan,
    limite_contactos: e.limite,
    contactos_resend: contactos,
    nivel_cuota: nivelCuota(contactos, e.limite),
    ultima_pasada: e.ultima,
    ultima_terminada: e.ultimaTerminada,
    url_webhook: `${e.supabaseUrl.replace(/\/+$/, "")}/functions/v1/resend-webhook`,
  };
}

/** Lo que se devuelve tras sincronizar (sin emails: solo ids de suscriptor en los errores). */
export function respuestaSincronizacion(r: ResumenSync, pasadaId: string, limite: number) {
  return {
    success: r.estado !== "error",
    pasada_id: pasadaId,
    estado: r.estado,
    segment_id: r.segmentId,
    segmento_creado: r.segmentoCreado,
    contactos_resend: r.contactosResend,
    limite_contactos: limite,
    nivel_cuota: nivelCuota(r.contactosResend, limite),
    destinatarios: r.destinatarios,
    contactos_ajenos: r.ajenos,
    altas: r.altas,
    actualizados: r.actualizados,
    anadidos_segmento: r.anadidosSegmento,
    quitados_segmento: r.quitadosSegmento,
    borrados: r.borrados,
    bajas_resend: r.bajasResend,
    pendientes: r.pendientes,
    bloquea_envio: r.bloqueaEnvio,
    errores: r.errores.slice(0, 20),
    total_errores: r.errores.length,
    error: r.estado === "error" ? r.mensajeError : undefined,
  };
}
