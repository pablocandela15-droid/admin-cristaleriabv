// ============================================================================
// BAJA AUTOMÁTICA DEL NEWSLETTER DESDE LOS EVENTOS DE RESEND — lógica pura
// ----------------------------------------------------------------------------
// Portado del panel de referencia. index.ts hace el I/O; aquí solo se decide
// QUÉ suscriptor dar de baja y con qué `origen_baja`.
//
// Qué eventos dan de baja (newsletter_suscriptores.estado = 'baja') y por qué:
//   · email.complained  -> 'queja_spam'. Marcó un correo nuestro como spam:
//     quien hace eso no quiere más correos, y seguir escribiéndole hunde la
//     reputación del dominio (Resend exige < 0,08 % de quejas).
//   · email.bounced     -> 'rebote_permanente'. Resend solo emite este evento
//     con rebotes PERMANENTES (los temporales son email.delivery_delayed); si
//     viniera bounce.type = "Transient" se ignora por prudencia.
//   · email.suppressed  -> 'suprimido_resend'. Resend ni lo intenta: la
//     dirección está en su lista de supresión.
//   · contact.updated con unsubscribed = true -> 'resend_baja_nativa'. Baja
//     desde la página de preferencias de Resend (canal Broadcast). Red de
//     seguridad si se pierde: la reconciliación de newsletter-sync-resend.
//   · contact.deleted -> NO es una baja: solo se desvincula resend_contact_id
//     (`decidirDesvinculoContacto`).
// Vale también para los pendientes (p. ej. el correo de confirmación rebota).
//
// NUNCA reactiva: ningún evento de Resend activa a nadie. La única vía es el
// enlace de confirmación (doble opt-in), y la base de datos lo impone
// (newsletter_suscriptores_proteger, migración 20261124173700).
// ============================================================================

export type OrigenBajaWebhook = "queja_spam" | "rebote_permanente" | "suprimido_resend" | "resend_baja_nativa";

export interface DecisionBajaNewsletter {
  email: string;
  origen: OrigenBajaWebhook;
  /** id de newsletter_suscriptores si el correo lo llevaba en la etiqueta `suscriptor` (enviar-newsletter la pone). */
  suscriptorId: string | null;
}

export interface EventoResendMinimo {
  type?: unknown;
  data?: Record<string, unknown> | null;
}

/** Etiquetas que llevan los correos del newsletter (Resend las devuelve en `data.tags`; _shared/newsletter/servidor.ts). */
export const ETIQUETA_CATEGORIA = "categoria";
export const VALOR_CATEGORIA_NEWSLETTER = "newsletter";
export const ETIQUETA_SUSCRIPTOR = "suscriptor";
export const ETIQUETA_ENVIO = "envio";

/** Newsletter, confirmación o prueba: las categorías que pone el panel (todas empiezan por «newsletter»). */
export function esCategoriaNewsletter(valor: string | undefined): boolean {
  return typeof valor === "string" && /^newsletter(_[a-z]+)?$/.test(valor);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resend manda `tags` como objeto {nombre: valor} en los webhooks; se acepta también el formato array del envío. */
export function leerEtiquetas(tags: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string") {
        const valor = (t as { value?: unknown }).value;
        if (typeof valor === "string") out[(t as { name: string }).name] = valor;
      }
    }
  } else if (tags && typeof tags === "object") {
    for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

export function normalizarEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const v = email.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

/**
 * Patrón de ILIKE que solo casa con ESE email, sin distinguir mayúsculas:
 * escapa los comodines de LIKE (`%`, `_`) y la barra de escape. Lo usa el
 * respaldo de resend-webhook si la RPC newsletter_registrar_baja fallara.
 * Devuelve null si el email lleva `*`: PostgREST convierte `*` en `%` dentro de
 * like/ilike y no hay forma de escaparlo, así que podría dar de baja a otros.
 */
export function patronIlikeExacto(email: string): string | null {
  if (email.includes("*")) return null;
  return email.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Saca la dirección de "Nombre <a@b.c>" o "a@b.c". */
function direccionDe(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = valor.match(/<([^>]+)>/);
  return normalizarEmail(m ? m[1] : valor);
}

function primerDestinatario(to: unknown): string | null {
  if (Array.isArray(to)) return direccionDe(to[0]);
  return direccionDe(to);
}

/** `null` si el evento no implica dar de baja a nadie del newsletter. */
export function decidirBajaNewsletter(evento: EventoResendMinimo): DecisionBajaNewsletter | null {
  const tipo = typeof evento?.type === "string" ? evento.type : "";
  const data = (evento?.data ?? {}) as Record<string, unknown>;

  if (tipo === "contact.updated") {
    if (data.unsubscribed !== true) return null;
    const email = normalizarEmail(data.email);
    return email ? { email, origen: "resend_baja_nativa", suscriptorId: null } : null;
  }

  let origen: OrigenBajaWebhook | null = null;
  if (tipo === "email.complained") origen = "queja_spam";
  else if (tipo === "email.suppressed") origen = "suprimido_resend";
  else if (tipo === "email.bounced") {
    const bounce = data.bounce as { type?: unknown } | undefined;
    const tipoRebote = typeof bounce?.type === "string" ? bounce.type.toLowerCase() : "";
    if (tipoRebote === "transient") return null;
    origen = "rebote_permanente";
  }
  if (!origen) return null;

  const email = primerDestinatario(data.to);
  if (!email) return null;

  const etiquetas = leerEtiquetas(data.tags);
  const candidato = etiquetas[ETIQUETA_SUSCRIPTOR];
  const suscriptorId =
    esCategoriaNewsletter(etiquetas[ETIQUETA_CATEGORIA]) && candidato && UUID_RE.test(candidato) ? candidato : null;

  return { email, origen, suscriptorId };
}

/**
 * `email_eventos.email_id` es NOT NULL y los eventos contact.* / suppression.*
 * no traen email_id (tumbaban el INSERT con 500 y Resend reintentaba sin fin).
 * Se archivan con un id sintético "<tipo>:<id>".
 */
export function idArchivoEvento(evento: EventoResendMinimo): string {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  if (typeof data.email_id === "string" && data.email_id) return data.email_id;
  const tipo = typeof evento?.type === "string" ? evento.type : "desconocido";
  const id = typeof data.id === "string" && data.id ? data.id : "sin-id";
  return `${tipo}:${id}`;
}

/** Destinatario para archivar: `to[0]` en eventos de correo, `email` en los de contacto/supresión. */
export function destinatarioArchivo(evento: EventoResendMinimo): string | null {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  if (Array.isArray(data.to) && typeof data.to[0] === "string") return data.to[0];
  if (typeof data.email === "string") return data.email;
  return null;
}

/**
 * contact.deleted -> id del contacto a desvincular de newsletter_suscriptores
 * (resend_contact_id = NULL). No da de baja a nadie. `null` para el resto.
 */
export function decidirDesvinculoContacto(evento: EventoResendMinimo): string | null {
  if (evento?.type !== "contact.deleted") return null;
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  return typeof data.id === "string" && data.id.trim() ? data.id.trim() : null;
}

/** Los eventos de correo de un Broadcast traen `broadcast_id`: se archiva para las estadísticas por envío. */
export function broadcastIdDe(evento: EventoResendMinimo): string | null {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  return typeof data.broadcast_id === "string" && data.broadcast_id ? data.broadcast_id : null;
}

/**
 * Lo que se archiva en email_eventos.metadata además de from/subject: la categoría, el envío y el suscriptor de las
 * etiquetas (estadísticas por envío y supresión RGPD), y el Broadcast. Ids solo si tienen forma de uuid.
 */
export function metadatosDe(evento: EventoResendMinimo): Record<string, string> {
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  const etiquetas = leerEtiquetas(data.tags);
  const out: Record<string, string> = {};
  const categoria = etiquetas[ETIQUETA_CATEGORIA];
  if (categoria && /^[A-Za-z0-9_-]{1,40}$/.test(categoria)) out.categoria = categoria;
  const envio = etiquetas[ETIQUETA_ENVIO];
  if (envio && UUID_RE.test(envio)) out.envio_id = envio.toLowerCase();
  const suscriptor = etiquetas[ETIQUETA_SUSCRIPTOR];
  if (suscriptor && UUID_RE.test(suscriptor)) out.suscriptor_id = suscriptor.toLowerCase();
  const broadcast = broadcastIdDe(evento);
  if (broadcast) out.broadcast_id = broadcast.slice(0, 120);
  return out;
}

/** Dirección que se suprime (no se le vuelve a escribir) por un rebote, una queja o una supresión de Resend. */
export function supresionDe(evento: EventoResendMinimo): { email: string; motivo: "bounced" | "complained" | "suppressed"; detalle: string | null } | null {
  const tipo = typeof evento?.type === "string" ? evento.type : "";
  const data = (evento?.data ?? {}) as Record<string, unknown>;
  let motivo: "bounced" | "complained" | "suppressed" | null = null;
  if (tipo === "email.complained") motivo = "complained";
  else if (tipo === "email.suppressed") motivo = "suppressed";
  else if (tipo === "email.bounced") {
    const bounce = data.bounce as { type?: unknown; message?: unknown } | undefined;
    if (typeof bounce?.type === "string" && bounce.type.toLowerCase() === "transient") return null;
    motivo = "bounced";
  }
  if (!motivo) return null;
  const email = primerDestinatario(data.to);
  if (!email) return null;
  const bounce = data.bounce as { message?: unknown } | undefined;
  return { email, motivo, detalle: typeof bounce?.message === "string" ? bounce.message.slice(0, 500) : null };
}
