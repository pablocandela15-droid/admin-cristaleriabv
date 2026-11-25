// ============================================================================
// Correo de confirmación de la suscripción (doble opt-in) — código PURO
// ----------------------------------------------------------------------------
// Lo mandan newsletter-alta (alta desde la web) y enviar-newsletter (acción
// «confirmaciones», para las altas del panel y las importaciones). Misma
// estética que la newsletter (envolverCorreo). El enlace lleva a la página de
// la web, que pide pulsar «Confirmar»: abrir el enlace no confirma nada (los
// programas de correo y los antivirus siguen los enlaces solos).
// ============================================================================

import { envolverCorreo, escapeHtml } from "./plantillas.ts";
import type { DatosNegocio } from "./negocio.ts";

export interface CorreoConfirmacion {
  asunto: string;
  html: string;
  texto: string;
}

export function correoConfirmacion(o: { enlace: string; nombre?: string | null; negocio: DatosNegocio }): CorreoConfirmacion {
  if (!o.enlace) throw new Error("correoConfirmacion: falta el enlace");
  const saludo = o.nombre?.trim() ? `Hola, ${o.nombre.trim()}:` : "Hola:";
  const href = escapeHtml(o.enlace);
  const negocio = escapeHtml(o.negocio.nombre);
  const cuerpo = `<tr><td class="cbv-pad" style="padding:0 40px 8px;">
            <p class="cbv-texto" style="margin:0 0 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#3E4A57;">${escapeHtml(saludo)}</p>
            <p class="cbv-texto" style="margin:0 0 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#3E4A57;">Hemos recibido una petición para enviarte por correo las novedades y ofertas de ${negocio}. Para empezar a recibirlas, confirma que esta dirección es tuya:</p>
          </td></tr>
          <tr><td class="cbv-pad" style="padding:8px 40px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto;"><tr>
              <td class="cbv-boton" bgcolor="#0A2A48" style="background-color:#0A2A48;border-radius:8px;mso-padding-alt:14px 32px;">
                <a href="${href}" class="cbv-boton-texto" style="display:inline-block;padding:14px 32px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">Confirmar mi suscripción</a>
              </td>
            </tr></table>
          </td></tr>
          <tr><td class="cbv-pad" style="padding:0 40px 24px;">
            <p class="cbv-suave" style="margin:0 0 12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#5B6673;">Si el botón no funciona, copia este enlace en el navegador:<br><a href="${href}" style="color:#7C5A22;word-break:break-all;">${href}</a></p>
            <p class="cbv-suave" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#5B6673;">El enlace caduca en 7 días. Si no has pedido esta suscripción, ignora este correo: no te apuntaremos ni te volveremos a escribir.</p>
          </td></tr>`;
  const pie = `<p style="margin:0;font-size:11px;line-height:1.6;">Te escribimos solo para confirmar tu suscripción. Responsable: ${[o.negocio.nombre, o.negocio.direccion, o.negocio.email]
    .filter(Boolean)
    .map((t) => escapeHtml(t!))
    .join(" · ")}. <a href="${escapeHtml(`${o.negocio.web}/privacidad`)}" style="color:#F2E8C8;text-decoration:underline;">Política de privacidad</a>.</p>`;
  return {
    asunto: `Confirma tu suscripción a las novedades de ${o.negocio.nombre}`,
    html: envolverCorreo({ titulo: "Confirma tu suscripción", preheader: "Un clic y empezarás a recibir nuestras novedades.", insignia: null, cuerpo, pie, negocio: o.negocio }),
    texto: [
      saludo,
      "",
      `Hemos recibido una petición para enviarte por correo las novedades y ofertas de ${o.negocio.nombre}.`,
      "Para empezar a recibirlas, confirma que esta dirección es tuya abriendo este enlace y pulsando «Confirmar»:",
      o.enlace,
      "",
      "El enlace caduca en 7 días. Si no has pedido esta suscripción, ignora este correo: no te apuntaremos ni te volveremos a escribir.",
      "",
      `${o.negocio.nombre} · ${o.negocio.web}/privacidad`,
    ].join("\n"),
  };
}
