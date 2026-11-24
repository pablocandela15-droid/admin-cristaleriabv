// ============================================================================
// Textos de la sección Newsletter para el equipo (puro, portado del panel de referencia)
// ----------------------------------------------------------------------------
// Aquí viven las frases que el cliente lee cuando algo falla o cuando hay que
// contar un número. Reglas de redacción: español llano, sin nombres de
// servicios ni siglas técnicas; el detalle técnico se queda en la consola o en
// un desplegable «Detalle técnico», nunca en el texto principal.
// ============================================================================

export const MENSAJE_NO_DISPONIBLE = "El envío de newsletter no está disponible ahora mismo. Avisa al equipo técnico.";

/** 1.000 (el idioma es-ES no agrupa los números de cuatro cifras por defecto). */
export function formatoNumero(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function plural(n: number, singular: string, pluralTxt: string): string {
  return `${formatoNumero(n)} ${n === 1 ? singular : pluralTxt}`;
}

export function textoSuscriptores(n: number): string {
  return plural(n, "suscriptor", "suscriptores");
}

// Palabras que delatan un mensaje pensado para el equipo técnico.
const JERGA = /resend|broadcast|segment|api[_ ]?key|edge function|non-2xx|failed to send|webhook|secret|NEWSLETTER_|RESEND_|unauthorized|pie_baja_ausente/i;

/**
 * Convierte el motivo que devuelve el servidor en una frase comprensible para
 * el personal. Lo que ya está escrito en llano (p. ej. «El título no puede
 * superar 120 caracteres») se deja tal cual; lo técnico se traduce.
 */
export function textoErrorCliente(bruto: string | null | undefined, porDefecto = MENSAJE_NO_DISPONIBLE): string {
  const t = (bruto ?? "").trim();
  if (!t) return porDefecto;

  if (/falta configurar|no_configurado|remitente \(newsletter/i.test(t)) {
    return "Falta configurar el envío de correos. Mira Newsletter › Configuración: ahí pone qué falta.";
  }
  if (/no tienes permiso|sin permiso|forbidden|permiso/i.test(t) && !/segment/i.test(t)) {
    return "No tienes permiso para enviar newsletters. Pídeselo a quien administra el panel.";
  }
  if (/unauthorized|sesión/i.test(t)) return "Tu sesión ha caducado. Vuelve a entrar en el panel e inténtalo de nuevo.";
  if (/se está sincronizando|otro newsletter|espera un minuto/i.test(t)) {
    return "Se está actualizando la lista de envío o ya hay otro envío en marcha. Espera un minuto y vuelve a intentarlo.";
  }
  if (/no se sabe si el newsletter ha salido/i.test(t)) {
    return "No se sabe si la newsletter ha salido. Avisa al equipo técnico antes de volver a enviarla, para no mandarla dos veces.";
  }
  if (/podría llegar a quien se ha dado de baja|antes de enviar/i.test(t)) {
    return "No se ha enviado nada porque no se pudo actualizar la lista de envío. Pulsa «Actualizar lista de envío» en Suscriptores y vuelve a intentarlo.";
  }
  if (/contactos en resend|plan admite|límite de contactos/i.test(t)) {
    return "Se ha llegado al máximo de contactos del plan (1.000). No se puede enviar hasta liberar contactos o ampliar el plan. Avisa al equipo técnico.";
  }
  if (/uno a uno está limitado|cuota diaria/i.test(t)) {
    return "Hay demasiados suscriptores para enviar uno a uno. Cambia el canal a «Broadcast» en Newsletter › Configuración o avisa al equipo técnico.";
  }
  if (/ya se ha enviado|pulsado dos veces/i.test(t)) return "Esta newsletter ya se ha enviado. Mírala en Estadísticas › Historial.";
  if (/otro envío en marcha/i.test(t)) return "Ya hay otro envío en marcha. Espera a que termine y vuelve a intentarlo.";
  if (/no hay suscriptores activos/i.test(t)) return "No hay suscriptores activos (que hayan confirmado su email) a los que enviar.";
  if (/no tiene un correo al que mandar la prueba/i.test(t)) return "Tu usuario no tiene correo: pon una dirección de pruebas en Newsletter › Configuración.";
  if (/dominio verificado|remitente/i.test(t)) {
    return "No se pudo enviar a ningún suscriptor. Avisa al equipo técnico para revisar el correo de envío.";
  }
  if (JERGA.test(t)) return porDefecto;
  return t;
}
