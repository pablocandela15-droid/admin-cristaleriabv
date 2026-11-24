// ============================================================================
// enviar-newsletter · envío uno a uno (canal transaccional), prueba y
// confirmaciones — lógica con dependencias inyectadas (se prueba con vitest)
// ----------------------------------------------------------------------------
// Portado del panel de referencia (enviar-newsletter/index.ts, canal
// transaccional) y endurecido:
//   · Solo a suscriptores ACTIVOS (confirmaron su email) y nunca a direcciones
//     suprimidas (rebote, queja, supresión de Resend).
//   · Cada correo lleva su enlace personal de baja en el pie, la cabecera
//     List-Unsubscribe (botón nativo de Gmail/Outlook, RFC 8058) y las
//     etiquetas categoria/suscriptor/envio (estadísticas y bajas automáticas en
//     resend-webhook). Sin pie de baja, ese correo no sale (tieneEnlaceBaja).
//   · Un envío por pulsación: la fila de newsletter_envios se crea ANTES de
//     enviar, con la clave del panel (repetirla no reenvía) y un solo envío
//     «enviando» a la vez; cada correo lleva Idempotency-Key «envío/suscriptor».
//   · Límite de destinatarios (newsletter_config.limite_transaccional) para no
//     agotar la cuota diaria de Resend; con más, canal Broadcast.
//   · Reloj: la función tiene ~150 s; a los 120 s deja de empezar correos y el
//     envío queda «parcial» con lo que falte contado como fallido.
// ============================================================================

import {
  asuntoNewsletter,
  cabecerasBaja,
  limiteTransaccional,
  renderNewsletter,
  textoNewsletter,
  tieneEnlaceBaja,
  type DatosNewsletter,
} from "../_shared/newsletter/plantillas.ts";
import { remitente, urlBajaMuestra, urlBajaOneClick, urlBajaWeb, type ConfigNewsletter } from "../_shared/newsletter/enlaces.ts";
import type { DatosNegocio } from "../_shared/newsletter/negocio.ts";
import { CATEGORIAS, ETIQUETA_CATEGORIA, ETIQUETA_ENVIO, ETIQUETA_SUSCRIPTOR, type ClienteCorreo } from "../_shared/newsletter/servidor.ts";
import { disenoParaHistorial } from "./peticion.ts";

export interface Destinatario {
  id: string;
  email: string;
  nombre: string | null;
  baja_token: string | null;
}

export type EstadoEnvio = "enviando" | "completado" | "parcial" | "fallido";

export interface FilaEnvioNueva {
  asunto: string;
  mensaje: string;
  tipo_newsletter: string;
  diseno: Record<string, unknown>;
  canal: "transaccional" | "broadcast";
  total_destinatarios: number;
  enviado_por: string;
  clave_idempotencia: string;
  resend_broadcast_id?: string | null;
}

export type CreacionEnvio = { ok: true; id: string } | { ok: false; motivo: "duplicado" | "ocupado" };

export interface RepoEnvios {
  /** Envíos «enviando» de hace más de `minutos` (la función murió): se cierran como fallidos. */
  cerrarColgados(minutos: number): Promise<void>;
  /** Suscriptores activos con su token de baja. */
  destinatarios(): Promise<Destinatario[]>;
  suprimidas(): Promise<Set<string>>;
  crearEnvio(fila: FilaEnvioNueva): Promise<CreacionEnvio>;
  terminarEnvio(id: string, d: { estado: EstadoEnvio; exitosos?: number; fallidos?: number; error?: string | null }): Promise<void>;
}

export type ResultadoEnvio =
  | { ok: true; envioId: string; estado: EstadoEnvio; total: number; exitosos: number; fallidos: number; detalles?: string[] }
  | { ok: false; status: number; error: string };

export const MINUTOS_ENVIO_COLGADO = 15;
export const MS_PRESUPUESTO_ENVIO = 120_000;

/** Envía la newsletter a todos los activos, uno a uno. */
export async function enviarTransaccional(op: {
  repo: RepoEnvios;
  cliente: ClienteCorreo;
  datos: DatosNewsletter;
  config: ConfigNewsletter;
  negocio: DatosNegocio;
  supabaseUrl: string;
  usuarioId: string;
  clave: string;
  ahora?: () => number;
  hastaMs?: number;
  log?: (m: string) => void;
}): Promise<ResultadoEnvio> {
  const log = op.log ?? ((m: string) => console.log(m));
  const ahora = op.ahora ?? (() => Date.now());
  const hasta = op.hastaMs ?? ahora() + MS_PRESUPUESTO_ENVIO;
  const from = remitente(op.config.remitente_nombre, op.config.remitente_email);
  if (!from) return { ok: false, status: 503, error: "Falta configurar el remitente (Newsletter › Configuración)." };

  await op.repo.cerrarColgados(MINUTOS_ENVIO_COLGADO);
  const [todos, suprimidas] = await Promise.all([op.repo.destinatarios(), op.repo.suprimidas()]);
  const destinatarios = todos.filter((d) => d.baja_token && !suprimidas.has(d.email.trim().toLowerCase()));
  if (destinatarios.length === 0) return { ok: false, status: 400, error: "No hay suscriptores activos (que hayan confirmado su email) a los que enviar." };

  const limite = limiteTransaccional(op.config.limite_transaccional);
  if (limite !== null && destinatarios.length > limite) {
    return {
      ok: false,
      status: 409,
      error: `Hay ${destinatarios.length} suscriptores y el envío uno a uno está limitado a ${limite} para no agotar la cuota diaria de correos de Resend. Cambia el canal a «Broadcast» en Newsletter › Configuración o, con un plan de pago de Resend, sube el límite.`,
    };
  }

  const asunto = asuntoNewsletter(op.datos.tipo, op.datos.titulo);
  const creado = await op.repo.crearEnvio({
    asunto,
    mensaje: op.datos.mensaje,
    tipo_newsletter: op.datos.tipo,
    diseno: disenoParaHistorial(op.datos),
    canal: "transaccional",
    total_destinatarios: destinatarios.length,
    enviado_por: op.usuarioId,
    clave_idempotencia: op.clave,
  });
  if (!creado.ok) {
    return creado.motivo === "duplicado"
      ? { ok: false, status: 409, error: "Esta newsletter ya se ha enviado (se ha pulsado dos veces). Mírala en el historial." }
      : { ok: false, status: 409, error: "Ya hay otro envío en marcha. Espera a que termine y vuelve a intentarlo." };
  }
  const envioId = creado.id;

  let exitosos = 0;
  let fallidos = 0;
  const detalles: string[] = [];
  let sinTiempo = false;
  for (const d of destinatarios) {
    if (ahora() >= hasta) {
      sinTiempo = true;
      fallidos += destinatarios.length - exitosos - fallidos;
      break;
    }
    try {
      const enlaceBaja = urlBajaWeb(op.config.web_url, d.baja_token!);
      const html = renderNewsletter(op.datos, enlaceBaja, { negocio: op.negocio });
      // Defensa en profundidad: sin pie de baja, ese correo no sale.
      if (!tieneEnlaceBaja(html, enlaceBaja)) throw new Error("pie_baja_ausente");
      const r = await op.cliente.enviarCorreo(
        {
          from,
          to: [d.email],
          subject: asunto,
          html,
          text: textoNewsletter(op.datos, enlaceBaja, { negocio: op.negocio }),
          replyTo: op.config.responder_a,
          headers: cabecerasBaja(urlBajaOneClick(op.supabaseUrl, d.baja_token!)),
          tags: [
            { name: ETIQUETA_CATEGORIA, value: CATEGORIAS.newsletter },
            { name: ETIQUETA_SUSCRIPTOR, value: d.id },
            { name: ETIQUETA_ENVIO, value: envioId },
          ],
        },
        `${envioId}/${d.id}`,
      );
      if (!r.ok) throw new Error(`${r.status} ${r.tipo}: ${r.mensaje}`);
      exitosos++;
    } catch (e) {
      fallidos++;
      const motivo = e instanceof Error ? e.message : String(e);
      if (detalles.length < 10) detalles.push(motivo);
      log(`[enviar-newsletter] fallo enviando a ${d.id}: ${motivo}`);
    }
  }

  const estado: EstadoEnvio = fallidos === 0 ? "completado" : exitosos === 0 ? "fallido" : "parcial";
  const error = sinTiempo
    ? "Se acabó el tiempo de la función antes de terminar: los que faltaban no lo han recibido."
    : fallidos
      ? detalles[0] ?? null
      : null;
  await op.repo.terminarEnvio(envioId, { estado, exitosos, fallidos, error });
  log(`[enviar-newsletter] envío ${envioId}: ${exitosos} enviados, ${fallidos} fallidos (${estado})`);
  if (exitosos === 0) {
    return { ok: false, status: 502, error: `No se pudo enviar a ningún suscriptor (revisa el remitente y el dominio verificado en Resend). ${detalles[0] ?? ""}`.trim() };
  }
  return { ok: true, envioId, estado, total: destinatarios.length, exitosos, fallidos, ...(fallidos ? { detalles } : {}) };
}

/** Destinatarios de una prueba: quien la pide y la dirección de pruebas de los ajustes (sin repetir). */
export function destinatariosPrueba(emailUsuario: string | null, config: ConfigNewsletter): string[] {
  const ok = (e: string | null | undefined) => typeof e === "string" && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e.trim());
  return [...new Set([emailUsuario, config.email_prueba].filter(ok).map((e) => e!.trim().toLowerCase()))];
}

/**
 * Prueba: el mismo correo, con «[PRUEBA]» en el asunto y un enlace de baja de muestra, SOLO a quien la pide y a la
 * dirección de pruebas. No toca el historial ni a ningún suscriptor.
 */
export async function enviarPrueba(op: {
  cliente: ClienteCorreo;
  datos: DatosNewsletter;
  config: ConfigNewsletter;
  negocio: DatosNegocio;
  destinatarios: string[];
}): Promise<{ ok: true; destinatarios: string[] } | { ok: false; status: number; error: string }> {
  const from = remitente(op.config.remitente_nombre, op.config.remitente_email);
  if (!from) return { ok: false, status: 503, error: "Falta configurar el remitente (Newsletter › Configuración)." };
  if (!op.destinatarios.length) return { ok: false, status: 400, error: "Tu usuario no tiene un correo al que mandar la prueba." };
  const enlaceBaja = urlBajaMuestra(op.config.web_url);
  const html = renderNewsletter(op.datos, enlaceBaja, { negocio: op.negocio });
  if (!tieneEnlaceBaja(html, enlaceBaja)) return { ok: false, status: 500, error: "pie_baja_ausente" };
  const r = await op.cliente.enviarCorreo({
    from,
    to: op.destinatarios,
    subject: `[PRUEBA] ${asuntoNewsletter(op.datos.tipo, op.datos.titulo)}`,
    html,
    text: textoNewsletter(op.datos, enlaceBaja, { negocio: op.negocio }),
    replyTo: op.config.responder_a,
    tags: [{ name: ETIQUETA_CATEGORIA, value: CATEGORIAS.prueba }],
  });
  if (!r.ok) return { ok: false, status: 502, error: `Resend respondió ${r.status} (${r.tipo}): ${r.mensaje}` };
  return { ok: true, destinatarios: op.destinatarios };
}

export interface PendienteConfirmar {
  id: string;
  email: string;
  nombre: string | null;
  token: string;
}

/** Correos de confirmación a los pendientes (altas del panel e importaciones): como mucho 50 por pulsación. */
export async function enviarConfirmacionesPendientes(op: {
  preparar(ids: string[] | null, limite: number): Promise<PendienteConfirmar[]>;
  enviar(p: PendienteConfirmar): Promise<boolean>;
  ids: string[] | null;
  limite?: number;
}): Promise<{ ok: true; enviadas: number; fallidas: number }> {
  const pendientes = await op.preparar(op.ids, op.limite ?? 50);
  let enviadas = 0;
  let fallidas = 0;
  for (const p of pendientes) {
    if (await op.enviar(p).catch(() => false)) enviadas++;
    else fallidas++;
  }
  return { ok: true, enviadas, fallidas };
}
