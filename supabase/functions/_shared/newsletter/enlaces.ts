// ============================================================================
// Enlaces del newsletter (confirmación y baja) y ajustes — código PURO
// ----------------------------------------------------------------------------
// Supabase sirve como text/plain el HTML de *.supabase.co/functions/v1/…, así
// que las páginas que ve el suscriptor viven en la web (como en la referencia,
// newsletter-baja/enlace-web.ts):
//   · confirmación:  <web>/newsletter/confirmada?t=<token>   (botón «Confirmar»)
//   · baja:          <web>/newsletter/baja?t=<token>          (botón «Darme de baja»)
// Las páginas hablan en JSON con newsletter-alta y newsletter-baja. Nada se
// confirma ni se da de baja con un GET: los programas de correo y los
// antivirus siguen los enlaces solos, y eso no debe confirmar ni dar de baja a
// nadie. El botón «Cancelar suscripción» nativo de Gmail/Outlook (RFC 8058)
// hace POST directo a newsletter-baja (cabecera List-Unsubscribe).
// ============================================================================

import { URL_WEB } from "./bloques.ts";

export const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Base de la web: newsletter_config.web_url si es https:// válida; si no, la de siempre. */
export function baseWeb(valor: string | null | undefined): string {
  const v = (valor ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(:\d{2,5})?$/i.test(v) ? v : URL_WEB;
}

export function urlConfirmacion(web: string, token: string): string {
  return `${baseWeb(web)}/newsletter/confirmada?${new URLSearchParams({ t: token })}`;
}

export function urlBajaWeb(web: string, token: string): string {
  return `${baseWeb(web)}/newsletter/baja?${new URLSearchParams({ t: token })}`;
}

/** URL del botón nativo «Cancelar suscripción» (POST de Gmail/Outlook): la función, no la web. */
export function urlBajaOneClick(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/newsletter-baja?${new URLSearchParams({ t: token, via: "header" })}`;
}

/** Enlace de baja de la vista previa y de las pruebas: lleva a la página, que dirá que no es un enlace real. */
export function urlBajaMuestra(web: string): string {
  return `${baseWeb(web)}/newsletter/baja?t=prueba`;
}

/**
 * Email a medias para enseñarlo en las páginas de la web («an***@example.com»): quien abre el enlace ve que es
 * su dirección sin que el enlace, si se reenvía, enseñe la dirección completa.
 */
export function enmascararEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, dominio] = [email.slice(0, email.lastIndexOf("@")), email.slice(email.lastIndexOf("@") + 1)];
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${dominio}`;
}

/** Remitente «Nombre <email>» (sin comillas ni saltos que rompan la cabecera). null si falta el email. */
export function remitente(nombre: string | null | undefined, email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e)) return null;
  const n = (nombre ?? "").replace(/[\r\n<>"]+/g, " ").replace(/\s+/g, " ").trim();
  return n ? `${n} <${e}>` : e;
}

/** Fila de newsletter_config que leen las funciones. */
export interface ConfigNewsletter {
  remitente_email: string | null;
  remitente_nombre: string;
  responder_a: string | null;
  canal: "transaccional" | "broadcast";
  email_prueba: string | null;
  limite_transaccional: number;
  web_url: string;
}

export const CONFIG_POR_DEFECTO: ConfigNewsletter = {
  remitente_email: null,
  remitente_nombre: "Cristalería Baix Vinalopó",
  responder_a: null,
  canal: "transaccional",
  email_prueba: null,
  limite_transaccional: 80,
  web_url: URL_WEB,
};

export function configDesdeFila(fila: Partial<ConfigNewsletter> | null | undefined): ConfigNewsletter {
  const f = fila ?? {};
  return {
    remitente_email: typeof f.remitente_email === "string" && f.remitente_email ? f.remitente_email : null,
    remitente_nombre: typeof f.remitente_nombre === "string" && f.remitente_nombre.trim() ? f.remitente_nombre : CONFIG_POR_DEFECTO.remitente_nombre,
    responder_a: typeof f.responder_a === "string" && f.responder_a ? f.responder_a : null,
    canal: f.canal === "broadcast" ? "broadcast" : "transaccional",
    email_prueba: typeof f.email_prueba === "string" && f.email_prueba ? f.email_prueba : null,
    limite_transaccional: typeof f.limite_transaccional === "number" ? f.limite_transaccional : CONFIG_POR_DEFECTO.limite_transaccional,
    web_url: baseWeb(f.web_url),
  };
}

/** Lo que falta para poder enviar correos (en llano, para el panel y las respuestas de las funciones). */
export function faltaParaEnviar(o: { apiKey: boolean; config: ConfigNewsletter }): string[] {
  const faltan: string[] = [];
  if (!o.apiKey) faltan.push("la clave de Resend (secreto RESEND_API_KEY en Supabase)");
  if (!remitente(o.config.remitente_nombre, o.config.remitente_email)) faltan.push("el remitente (Newsletter › Configuración), de un dominio verificado en Resend");
  return faltan;
}
