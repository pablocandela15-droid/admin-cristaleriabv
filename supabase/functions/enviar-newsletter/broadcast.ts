// ============================================================================
// enviar-newsletter en modo BROADCAST (Resend Marketing) — lógica sin Deno
// ----------------------------------------------------------------------------
// Portado del panel de referencia. Se activa con el canal «broadcast»
// (Newsletter › Configuración; por defecto, transaccional). index.ts sincroniza
// la tabla con Resend DENTRO del cerrojo de newsletter_sincronizaciones_resend
// y, si la pasada lo permite (`puedeEnviarBroadcast`), llama a `enviarBroadcast`.
//
// Mismo HTML que el envío uno a uno y que la vista previa del panel; lo único
// que cambia es el enlace del pie, que es el marcador {{{RESEND_UNSUBSCRIBE_URL}}}:
// Resend lo sustituye por un enlace único por destinatario a su página de baja
// y pone él mismo las cabeceras List-Unsubscribe. La baja que se haga allí
// vuelve a la tabla por el webhook contact.updated (resend-webhook) y por la
// reconciliación diaria (newsletter-sync-resend).
//
// Orden pensado para no enviar dos veces ni perder el rastro:
//   1. crear el Broadcast como BORRADOR (send:false),
//   2. apuntarlo en newsletter_envios (canal 'broadcast', resend_broadcast_id, 'enviando'),
//   3. enviarlo,
//   4. 'completado' (Resend lo ha aceptado y lo reparte él) o 'fallido'.
//   Si el paso 3 no contesta claro (red/5xx), se pregunta a Resend por el
//   estado del Broadcast antes de decir nada: reintentarlo a ciegas podría
//   mandarlo dos veces.
// ============================================================================

import { asuntoNewsletter, renderNewsletter, tieneEnlaceBaja, type DatosNewsletter } from "../_shared/newsletter/plantillas.ts";
import type { DatosNegocio } from "../_shared/newsletter/negocio.ts";
import { MARCADOR_BAJA_RESEND } from "../_shared/resend-marketing/config.ts";
import type { ResultadoResend } from "../_shared/resend-marketing/cliente.ts";
import type { ResumenSync } from "../_shared/resend-marketing/sync.ts";
import { disenoParaHistorial } from "./peticion.ts";
import type { RepoEnvios } from "./envio.ts";

export interface ClienteBroadcast {
  crearBroadcast(b: { segmentId: string; from: string; subject: string; html: string; name: string; replyTo?: string | null }): Promise<ResultadoResend<{ id: string }>>;
  enviarBroadcast(id: string): Promise<ResultadoResend<{ id: string }>>;
  obtenerBroadcast(id: string): Promise<ResultadoResend<{ id: string; status?: string }>>;
}

export type Veredicto = { ok: true } | { ok: false; status: number; error: string };

/** ¿Se puede enviar el Broadcast después de esta pasada de sincronización? */
export function puedeEnviarBroadcast(r: ResumenSync, limiteContactos: number): Veredicto {
  if (r.estado === "error") {
    return { ok: false, status: 502, error: `No se pudo sincronizar con Resend antes de enviar: ${r.mensajeError ?? "error desconocido"}. No se ha enviado nada.` };
  }
  if (r.bloqueaEnvio) {
    const motivo = r.pendientes > 0 ? `quedan ${r.pendientes} cambios por pasar a Resend` : "no se pudo quitar de Resend a algún dado de baja";
    return {
      ok: false,
      status: 409,
      error: `No se ha enviado: ${motivo} y la newsletter podría llegar a quien se ha dado de baja. Pulsa «Actualizar lista de envío» en Suscriptores y vuelve a enviarla.`,
    };
  }
  if (r.contactosResend !== null && r.contactosResend > limiteContactos) {
    return {
      ok: false,
      status: 409,
      error: `Hay ${r.contactosResend} contactos en Resend y el plan admite ${limiteContactos}: Resend no deja enviar Broadcasts por encima del límite. Borra contactos que no sean del newsletter en Resend o sube de plan (y NEWSLETTER_LIMITE_CONTACTOS).`,
    };
  }
  if (!r.destinatarios) return { ok: false, status: 400, error: "No hay suscriptores activos en Resend a los que enviar" };
  return { ok: true };
}

export type ResultadoBroadcast =
  | { ok: true; broadcastId: string; envioId: string | null }
  | { ok: false; status: number; error: string; broadcastId?: string; envioId?: string | null };

function textoError(r: { status: number; tipo: string; mensaje: string }): string {
  if (r.status === 403 && /contacts quota/i.test(r.mensaje)) return "Resend no deja enviar: se ha superado el límite de contactos del plan de marketing.";
  if (r.status === 401 || (r.status === 403 && /api key|restricted/i.test(r.mensaje))) {
    return `La clave de Resend no sirve para Broadcasts (necesita «Full access»): ${r.mensaje}`;
  }
  if (r.status === 403 && /domain/i.test(r.mensaje)) return `El remitente no es de un dominio verificado en Resend: ${r.mensaje}`;
  return `Resend respondió ${r.status} (${r.tipo}): ${r.mensaje}`;
}

export async function enviarBroadcast(op: {
  cliente: ClienteBroadcast;
  repo: Pick<RepoEnvios, "crearEnvio" | "terminarEnvio">;
  datos: DatosNewsletter;
  negocio: DatosNegocio;
  from: string;
  replyTo?: string | null;
  segmentId: string;
  destinatarios: number;
  usuarioId: string;
  clave: string;
  ahora?: () => Date;
}): Promise<ResultadoBroadcast> {
  const html = renderNewsletter(op.datos, MARCADOR_BAJA_RESEND, { negocio: op.negocio });
  // Defensa en profundidad, como en el envío uno a uno: sin pie de baja no sale.
  if (!tieneEnlaceBaja(html, MARCADOR_BAJA_RESEND)) return { ok: false, status: 500, error: "pie_baja_ausente" };

  const subject = asuntoNewsletter(op.datos.tipo, op.datos.titulo);
  const fecha = (op.ahora ?? (() => new Date()))().toISOString().slice(0, 16).replace("T", " ");
  const creado = await op.cliente.crearBroadcast({
    segmentId: op.segmentId,
    from: op.from,
    subject,
    html,
    name: `Newsletter ${op.datos.tipo} ${fecha} UTC`,
    replyTo: op.replyTo ?? null,
  });
  if (!creado.ok || !creado.data?.id) {
    return { ok: false, status: 502, error: creado.ok ? "Resend no devolvió el id del Broadcast" : textoError(creado) };
  }
  const broadcastId = creado.data.id;

  const fila = await op.repo.crearEnvio({
    asunto: subject,
    mensaje: op.datos.mensaje,
    tipo_newsletter: op.datos.tipo,
    diseno: disenoParaHistorial(op.datos),
    canal: "broadcast",
    total_destinatarios: op.destinatarios,
    enviado_por: op.usuarioId,
    clave_idempotencia: op.clave,
    resend_broadcast_id: broadcastId,
  });
  if (!fila.ok) {
    // El borrador se queda en Resend sin enviar (no llega a nadie).
    return fila.motivo === "duplicado"
      ? { ok: false, status: 409, error: "Esta newsletter ya se ha enviado (se ha pulsado dos veces). Mírala en el historial.", broadcastId }
      : { ok: false, status: 409, error: "Ya hay otro envío en marcha. Espera a que termine y vuelve a intentarlo.", broadcastId };
  }
  const envioId = fila.id;
  const marcar = (estado: "completado" | "fallido", error: string | null = null) =>
    op.repo.terminarEnvio(envioId, { estado, exitosos: estado === "completado" ? op.destinatarios : 0, fallidos: 0, error });

  const enviado = await op.cliente.enviarBroadcast(broadcastId);
  if (enviado.ok) {
    await marcar("completado");
    return { ok: true, broadcastId, envioId };
  }

  // Respuesta dudosa (red caída, 5xx): ¿salió o no?
  if (enviado.status === 0 || enviado.status >= 500) {
    const estado = await op.cliente.obtenerBroadcast(broadcastId);
    if (estado.ok && estado.data?.status && estado.data.status !== "draft") {
      await marcar("completado");
      return { ok: true, broadcastId, envioId };
    }
    if (estado.ok && estado.data?.status === "draft") {
      await marcar("fallido", textoError(enviado));
      return { ok: false, status: 502, error: `${textoError(enviado)}. El Broadcast no ha salido (sigue como borrador).`, broadcastId, envioId };
    }
    return {
      ok: false,
      status: 502,
      error: `No se sabe si la newsletter ha salido (${textoError(enviado)}). Mírala en Resend → Broadcasts antes de volver a enviarla.`,
      broadcastId,
      envioId,
    };
  }

  await marcar("fallido", textoError(enviado));
  return { ok: false, status: 502, error: textoError(enviado), broadcastId, envioId };
}
