// ============================================================================
// Newsletter · piezas de servidor comunes a las funciones (sin imports https://)
// ----------------------------------------------------------------------------
// Leer los ajustes (newsletter_config) y los datos del negocio (web_contenido ›
// negocio) con la service role, y mandar el correo de confirmación. El cliente
// de Supabase y el de Resend se inyectan: se prueba con dobles en vitest.
// ============================================================================

import { configDesdeFila, remitente, urlConfirmacion, type ConfigNewsletter } from "./enlaces.ts";
import { negocioDesdeContenido, type DatosNegocio } from "./negocio.ts";
import { correoConfirmacion } from "./confirmacion.ts";
import type { CorreoResend, ResultadoResend } from "../resend-marketing/cliente.ts";

// deno-lint-ignore no-explicit-any
type ClienteSupabase = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- supabase-js sin importar https:// (testeable)

export const COLUMNAS_CONFIG = "remitente_email, remitente_nombre, responder_a, canal, email_prueba, limite_transaccional, web_url";

/** Etiquetas que van en cada correo y vuelven en los webhooks de Resend (resend-webhook/newsletter.ts). */
export const ETIQUETA_CATEGORIA = "categoria";
export const ETIQUETA_SUSCRIPTOR = "suscriptor";
export const ETIQUETA_ENVIO = "envio";
export const CATEGORIAS = {
  newsletter: "newsletter",
  confirmacion: "newsletter_confirmacion",
  prueba: "newsletter_prueba",
} as const;

export interface Ajustes {
  config: ConfigNewsletter;
  negocio: DatosNegocio;
}

/** Ajustes y datos del negocio. Lanza si no se puede leer newsletter_config (sin ella no se envía nada). */
export async function leerAjustes(db: ClienteSupabase): Promise<Ajustes> {
  const [c, n] = await Promise.all([
    db.from("newsletter_config").select(COLUMNAS_CONFIG).eq("id", 1).maybeSingle(),
    db.from("web_contenido").select("valor").eq("clave", "negocio").maybeSingle(),
  ]);
  if (c.error) throw new Error(`newsletter_config: ${c.error.message ?? c.error}`);
  const config = configDesdeFila(c.data);
  // Sin el bloque «negocio» (o sin la web editable), el pie lleva solo el nombre y la web.
  const negocio = negocioDesdeContenido(n.error ? null : n.data?.valor, config.web_url);
  return { config, negocio };
}

export interface ClienteCorreo {
  enviarCorreo(c: CorreoResend, idempotencia?: string): Promise<ResultadoResend<{ id: string }>>;
}

/** Manda el correo de confirmación (doble opt-in). true si Resend lo aceptó. */
export async function enviarConfirmacion(
  cliente: ClienteCorreo,
  o: { id: string; email: string; nombre: string | null; token: string; config: ConfigNewsletter; negocio: DatosNegocio },
  log: (m: string) => void = console.log,
): Promise<boolean> {
  const from = remitente(o.config.remitente_nombre, o.config.remitente_email);
  if (!from) return false;
  const c = correoConfirmacion({ enlace: urlConfirmacion(o.config.web_url, o.token), nombre: o.nombre, negocio: o.negocio });
  const r = await cliente.enviarCorreo(
    {
      from,
      to: [o.email],
      subject: c.asunto,
      html: c.html,
      text: c.texto,
      replyTo: o.config.responder_a,
      tags: [
        { name: ETIQUETA_CATEGORIA, value: CATEGORIAS.confirmacion },
        { name: ETIQUETA_SUSCRIPTOR, value: o.id },
      ],
    },
    // Una por token: si se reintenta la misma, Resend no la manda dos veces.
    `confirmacion/${o.id}/${o.token.slice(0, 16)}`,
  );
  if (!r.ok) log(`[newsletter] Resend rechazó la confirmación de ${o.id}: ${r.status} ${r.tipo}: ${r.mensaje}`);
  return r.ok;
}
