// ============================================================================
// RESEND-WEBHOOK · procesar un evento ya verificado (lógica con dependencias inyectadas)
// ----------------------------------------------------------------------------
// Portado del panel de referencia (resend-webhook/index.ts) sin lo de las
// reservas. Orden:
//   1. Archivar en email_eventos (INCONDICIONAL y lo primero: es la base de las
//      estadísticas). El svix-id evita guardarlo dos veces si Resend reintenta.
//   2. Rebote permanente, queja o supresión → la dirección a
//      direcciones_email_suprimidas (no se le vuelve a escribir).
//   3. Baja automática del newsletter (newsletter_registrar_baja).
//   4. contact.deleted → desvincular resend_contact_id.
// Los pasos 2-4 son best-effort: un fallo queda en el log y la respuesta sigue
// siendo 200 (el evento ya está archivado). Un 5xx haría que Resend reintente.
// ============================================================================

import {
  decidirBajaNewsletter,
  decidirDesvinculoContacto,
  destinatarioArchivo,
  idArchivoEvento,
  metadatosDe,
  supresionDe,
  type DecisionBajaNewsletter,
} from "./newsletter.ts";

export interface EventoResend {
  type: string;
  created_at?: string;
  data?: Record<string, unknown> & {
    from?: string;
    subject?: string;
    click?: { link?: string; timestamp?: string };
    bounce?: { message?: string; type?: string };
  };
}

export interface FilaEvento {
  email_id: string;
  tipo_evento: string;
  email_destinatario: string | null;
  timestamp_evento: string | null;
  metadata: Record<string, unknown>;
  svix_id: string | null;
}

export interface RepoWebhook {
  /** Inserta en email_eventos; false si ya estaba (mismo svix-id). Lanza si falla. */
  archivar(fila: FilaEvento): Promise<boolean>;
  suprimir(s: { email: string; motivo: string; detalle: string | null; origen_email_id: string | null }): Promise<void>;
  /** RPC newsletter_registrar_baja: filas dadas de baja. */
  darDeBaja(d: DecisionBajaNewsletter): Promise<number>;
  desvincularContacto(contactId: string): Promise<void>;
}

export interface ResultadoWebhook {
  archivado: boolean;
  duplicado: boolean;
  tipo: string;
  suprimida: boolean;
  bajas: number;
  desvinculado: boolean;
}

const corto = (v: unknown, max: number): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

/** Fila de email_eventos para un evento (sin el cuerpo del correo: solo lo que sirve para las cifras). */
export function filaEvento(evento: EventoResend, svixId: string | null): FilaEvento {
  const data = evento.data ?? {};
  const metadata: Record<string, unknown> = {
    ...(corto(data.from, 320) ? { from: corto(data.from, 320) } : {}),
    ...(corto(data.subject, 200) ? { subject: corto(data.subject, 200) } : {}),
    ...metadatosDe(evento),
  };
  if (data.click?.link) metadata.click_link = corto(data.click.link, 2000);
  if (data.bounce?.message) metadata.bounce_message = corto(data.bounce.message, 500);
  const fecha = typeof evento.created_at === "string" && !Number.isNaN(Date.parse(evento.created_at)) ? evento.created_at : null;
  return {
    email_id: idArchivoEvento(evento).slice(0, 200),
    tipo_evento: (evento.type ?? "desconocido").replace(/^email\./, "").slice(0, 60),
    email_destinatario: destinatarioArchivo(evento)?.slice(0, 320) ?? null,
    timestamp_evento: fecha,
    metadata,
    svix_id: svixId ? svixId.slice(0, 200) : null,
  };
}

export async function procesarEvento(
  evento: EventoResend,
  svixId: string | null,
  repo: RepoWebhook,
  log: (m: string) => void = console.log,
): Promise<ResultadoWebhook> {
  const fila = filaEvento(evento, svixId);
  const nuevo = await repo.archivar(fila);
  const r: ResultadoWebhook = { archivado: true, duplicado: !nuevo, tipo: fila.tipo_evento, suprimida: false, bajas: 0, desvinculado: false };
  if (!nuevo) return r; // ya procesado en un intento anterior

  const s = supresionDe(evento);
  if (s) {
    try {
      await repo.suprimir({ email: s.email, motivo: s.motivo, detalle: s.detalle, origen_email_id: typeof evento.data?.email_id === "string" ? evento.data.email_id : null });
      r.suprimida = true;
    } catch (e) {
      log(`[resend-webhook] no se pudo suprimir la dirección (evento archivado): ${e instanceof Error ? e.message : e}`);
    }
  }

  const baja = decidirBajaNewsletter(evento);
  if (baja) {
    try {
      r.bajas = await repo.darDeBaja(baja);
      if (r.bajas) log(`[resend-webhook] newsletter: ${r.bajas} baja(s) (${baja.origen})`);
    } catch (e) {
      log(`[resend-webhook] no se pudo dar de baja (evento archivado): ${e instanceof Error ? e.message : e}`);
    }
  }

  const contacto = decidirDesvinculoContacto(evento);
  if (contacto) {
    try {
      await repo.desvincularContacto(contacto);
      r.desvinculado = true;
    } catch (e) {
      log(`[resend-webhook] no se pudo desvincular el contacto borrado: ${e instanceof Error ? e.message : e}`);
    }
  }
  return r;
}
