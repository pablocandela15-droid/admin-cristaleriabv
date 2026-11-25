// ============================================================================
// PLANTILLAS DEL NEWSLETTER — código PURO (sin Deno, sin red, sin secretos)
// ----------------------------------------------------------------------------
// Portado del panel de referencia (enviar-newsletter/plantillas.ts) con la
// estética de la cristalería. Una sola copia para:
//   · enviar-newsletter (el correo real que sale por Resend), y
//   · el panel (src/components/newsletter/PreviewNewsletter.tsx), que pinta la
//     vista previa con ESTA MISMA función: una vista previa que no es el mismo
//     código acaba mintiendo.
//   Por eso este fichero NO puede importar nada de https:// ni usar Deno.*.
//
// QUÉ GARANTIZA:
//   1. TODO correo lleva el pie de baja y los datos del responsable (RGPD):
//      lo añade la plantilla, no el equipo. No hay forma de quitarlo desde el
//      panel.
//   2. Lo que escribe el equipo (o propone la IA) se ESCAPA antes de meterlo en
//      el HTML: un `<style>` en un texto no esconde el enlace de baja.
//   3. Las imágenes solo se aceptan si son URL https:// válidas; los botones,
//      https:// o tel:.
//   4. `renderNewsletter` falla si no se le da enlace de baja, y
//      enviar-newsletter comprueba con `tieneEnlaceBaja` que el enlace está en
//      el HTML final antes de enviar (defensa en profundidad).
//
// DISEÑO: el de la web pública y el manual de marca (marino, crema y dorado,
// títulos con serifa). Hecho para clientes de correo reales: tablas, estilos en
// línea, ancho fijo de 600 px con `max-width` (Outlook con condicional `mso`),
// texto de vista previa (preheader), textos alternativos, ajustes de móvil por
// media query y colores para modo oscuro.
// ============================================================================

import {
  bloquesDeMensaje,
  esTipoNewsletter,
  plantillaBase,
  textoPlanoDeBloques,
  urlHttpsSegura,
  validarBloques,
  CAMPOS_DATOS,
  LIMITE_INSIGNIA,
  LIMITE_MENSAJE,
  LIMITE_PREHEADER,
  LIMITE_TITULO,
  URL_WEB,
  type Bloque,
  type TipoNewsletter,
} from "./bloques.ts";
import { negocioPorDefecto, type DatosNegocio } from "./negocio.ts";

export type { TipoNewsletter, Bloque };

/** Atributo que marca el pie obligatorio (lo usan los tests y la comprobación previa al envío). */
export const MARCA_PIE_BAJA = 'data-pie-baja="obligatorio"';

export function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DatosNewsletter {
  tipo: TipoNewsletter;
  titulo: string;
  /** Versión de texto (historial). Con bloques, se deriva de ellos si no viene. */
  mensaje: string;
  /** Solo envíos sin bloques: foto de cabecera. */
  imagenUrl?: string | null;
  /** Diseño por bloques. Sin bloques se pinta título + mensaje (+ foto). */
  bloques?: Bloque[] | null;
  /** Etiqueta sobre el título; por defecto la de la plantilla. */
  insignia?: string | null;
  /** Texto que el programa de correo enseña junto al asunto. */
  preheader?: string | null;
}

export type ResultadoValidacion = { ok: true; datos: DatosNewsletter } | { ok: false; error: string };

const unaLinea = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.replace(/[\r\n\t]+/g, " ").trim();
  return t.length > max ? null : t;
};

/** Valida el diseño que manda el panel a enviar-newsletter. */
export function validarPayload(raw: unknown): ResultadoValidacion {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Cuerpo de la petición no válido" };
  const r = raw as Record<string, unknown>;
  const tipo = r.tipo;
  if (!esTipoNewsletter(tipo)) return { ok: false, error: "Tipo de newsletter no válido" };
  const titulo = typeof r.titulo === "string" ? r.titulo.replace(/[\r\n]+/g, " ").trim() : "";
  let mensaje = typeof r.mensaje === "string" ? r.mensaje.trim() : "";

  let bloques: Bloque[] | null = null;
  if (r.bloques !== undefined && r.bloques !== null) {
    const v = validarBloques(r.bloques);
    if (v.ok === false) return { ok: false, error: v.error };
    bloques = v.bloques;
    if (!mensaje) mensaje = textoPlanoDeBloques(bloques);
  }

  if (!titulo || !mensaje) return { ok: false, error: "Campos requeridos: tipo, titulo, mensaje" };
  if (titulo.length > LIMITE_TITULO) return { ok: false, error: `El asunto no puede superar ${LIMITE_TITULO} caracteres` };
  if (mensaje.length > LIMITE_MENSAJE) return { ok: false, error: `El mensaje no puede superar ${LIMITE_MENSAJE} caracteres` };
  let imagenUrl: string | null = null;
  if (r.imagen_url !== undefined && r.imagen_url !== null && r.imagen_url !== "") {
    imagenUrl = urlHttpsSegura(typeof r.imagen_url === "string" ? r.imagen_url : null);
    if (!imagenUrl) return { ok: false, error: "La imagen debe ser una URL https:// válida" };
  }
  const insignia = unaLinea(r.insignia, LIMITE_INSIGNIA);
  if (insignia === null) return { ok: false, error: `La etiqueta no puede superar ${LIMITE_INSIGNIA} caracteres` };
  const preheader = unaLinea(r.preheader, LIMITE_PREHEADER);
  if (preheader === null) return { ok: false, error: `El texto de vista previa no puede superar ${LIMITE_PREHEADER} caracteres` };

  const datos: DatosNewsletter = { tipo, titulo, mensaje, imagenUrl };
  if (bloques) datos.bloques = bloques;
  if (insignia) datos.insignia = insignia;
  if (preheader) datos.preheader = preheader;
  return { ok: true, datos };
}

/** Asunto del correo. Sin saltos de línea (no se pueden colar cabeceras). */
export function asuntoNewsletter(tipo: TipoNewsletter, titulo: string): string {
  const limpio = titulo.replace(/[\r\n]+/g, " ").trim();
  const emoji = plantillaBase(tipo).emoji;
  return emoji ? `${emoji} ${limpio}` : limpio;
}

/** Cabeceras RFC 2369 + RFC 8058: botón nativo «Cancelar suscripción» de Gmail/Outlook/Yahoo (un clic, POST). */
export function cabecerasBaja(urlOneClick: string): Record<string, string> {
  if (!urlOneClick) throw new Error("cabecerasBaja: falta la URL de baja one-click");
  return {
    "List-Unsubscribe": `<${urlOneClick}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// ==================== ESTÉTICA ====================
// Colores de la web pública (marino, crema y dorado) y del manual de marca.
export const COLORES = {
  fondo: "#F8F5EE",
  tarjeta: "#FFFFFF",
  marino: "#0A2A48",
  marinoOscuro: "#061A2E",
  tinta: "#14263B",
  texto: "#3E4A57",
  suave: "#5B6673",
  oro: "#C9A55C",
  /** Dorado oscuro para texto sobre blanco (contraste AA). */
  oroTexto: "#7C5A22",
  borde: "#E4EBF1",
  crema: "#FBF8EF",
  cremaFuerte: "#F2E8C8",
  pieTexto: "#C9D3DD",
  pieEnlace: "#F2E8C8",
} as const;

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const ANCHO = 600;
const ANCHO_CONTENIDO = 520; // 600 − 2 × 40 de margen

const C = COLORES;

/**
 * Pie de baja OBLIGATORIO y datos del responsable (RGPD). Lo mete la plantilla; el equipo no lo toca.
 * Explica por qué recibe el correo (se suscribió y confirmó su email) y da el enlace personal de baja.
 */
export function pieBaja(enlaceBaja: string, negocio: DatosNegocio, colorEnlace: string = C.pieEnlace): string {
  if (!enlaceBaja) throw new Error("pieBaja: falta el enlace de baja");
  const href = escapeHtml(enlaceBaja);
  const privacidad = escapeHtml(`${negocio.web}/privacidad`);
  const responsable = [negocio.nombre, negocio.direccion, negocio.email].filter(Boolean).map((t) => escapeHtml(t!)).join(" · ");
  return `<p ${MARCA_PIE_BAJA} style="margin:0;font-size:12px;line-height:1.6;">
        Recibes este correo porque te suscribiste a las novedades de ${escapeHtml(negocio.nombre)} y confirmaste tu dirección.<br>
        <a href="${href}" class="cbv-enlace-pie" style="color:${colorEnlace};text-decoration:underline;">Darse de baja</a> de estos correos en cualquier momento, con un clic.
      </p>
      <p style="margin:10px 0 0;font-size:11px;line-height:1.6;">
        Responsable del tratamiento: ${responsable}. Tratamos tu email solo para enviarte estas novedades, con tu consentimiento;
        puedes ejercer tus derechos escribiéndonos. Más información en nuestra
        <a href="${privacidad}" style="color:${colorEnlace};text-decoration:underline;">política de privacidad</a>.
      </p>`;
}

/** true si el HTML lleva el pie obligatorio con ESE enlace de baja. */
export function tieneEnlaceBaja(html: string, enlaceBaja: string): boolean {
  if (!html || !enlaceBaja) return false;
  return html.includes(MARCA_PIE_BAJA) && html.includes(`href="${escapeHtml(enlaceBaja)}"`);
}

/** Párrafos: una línea en blanco separa párrafos; un salto simple es <br>. */
function parrafos(textoPlano: string, estilo: string, clase = "cbv-texto"): string {
  return textoPlano
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="${clase}" style="${estilo}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

const P_CUERPO = `margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.7;color:${C.texto};`;

const fila = (contenido: string, padding = "0 40px 24px") =>
  `<tr><td class="cbv-pad" style="padding:${padding};">${contenido}</td></tr>`;

const etiqueta = (t: string) =>
  `<div class="cbv-oro" style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.oroTexto};margin:0 0 10px;">${escapeHtml(t)}</div>`;

function bloqueHtml(b: Bloque): string {
  switch (b.tipo) {
    case "texto":
      return fila(parrafos(b.texto, P_CUERPO), "0 40px 8px");
    case "firma":
      return fila(parrafos(b.texto, `margin:0 0 8px;font-family:${SERIF};font-size:16px;font-style:italic;line-height:1.6;color:${C.tinta};`, "cbv-titulo"), "8px 40px 24px");
    case "imagen": {
      const img = `<img src="${escapeHtml(b.url)}" width="${ANCHO_CONTENIDO}" alt="${escapeHtml(b.alt)}" style="display:block;width:100%;max-width:${ANCHO_CONTENIDO}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:6px;">`;
      const pie = b.pie
        ? `<div class="cbv-suave" style="font-family:${SANS};font-size:13px;font-style:italic;color:${C.suave};text-align:center;padding-top:8px;">${escapeHtml(b.pie)}</div>`
        : "";
      return fila(img + pie);
    }
    case "destacado":
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="cbv-caja" bgcolor="${C.crema}" style="background-color:${C.crema};border:1px solid ${C.borde};border-left:3px solid ${C.oro};border-radius:6px;padding:20px 24px;">
          ${b.titulo ? etiqueta(b.titulo) : ""}
          ${parrafos(b.texto, `margin:0 0 8px;font-family:${SANS};font-size:15px;line-height:1.7;color:${C.texto};`)}
        </td></tr></table>`,
      );
    case "lista": {
      const filas = b.elementos
        .map(
          (p, i) => `<tr>
            <td class="cbv-borde" style="padding:14px 0;${i < b.elementos.length - 1 ? `border-bottom:1px solid ${C.borde};` : ""}vertical-align:top;">
              <div class="cbv-titulo" style="font-family:${SERIF};font-size:17px;line-height:1.4;color:${C.tinta};">${escapeHtml(p.nombre)}</div>
              ${p.descripcion ? `<div class="cbv-suave" style="font-family:${SANS};font-size:14px;line-height:1.5;color:${C.suave};padding-top:4px;">${escapeHtml(p.descripcion)}</div>` : ""}
            </td>
            <td class="cbv-borde" align="right" style="padding:14px 0 14px 16px;${i < b.elementos.length - 1 ? `border-bottom:1px solid ${C.borde};` : ""}vertical-align:top;white-space:nowrap;font-family:${SERIF};font-size:16px;color:${C.oroTexto};">${p.precio ? `<span class="cbv-oro">${escapeHtml(p.precio)}</span>` : ""}</td>
          </tr>`,
        )
        .join("\n");
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cbv-borde" style="border-top:2px solid ${C.oro};">
          ${b.titulo ? `<tr><td colspan="2" style="padding:16px 0 0;text-align:center;">${etiqueta(b.titulo)}</td></tr>` : ""}
          ${filas}
        </table>`,
      );
    }
    case "datos": {
      const filas = CAMPOS_DATOS.filter(([k]) => b[k])
        .map(
          ([k, nombre]) => `<tr><td class="cbv-borde" style="padding:14px 20px;border-bottom:1px solid ${C.borde};">
              <span class="cbv-oro" style="display:block;font-family:${SANS};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.oroTexto};margin-bottom:4px;">${nombre}</span>
              <span class="cbv-titulo" style="font-family:${SANS};font-size:16px;font-weight:600;color:${C.tinta};">${escapeHtml(b[k]!)}</span>
            </td></tr>`,
        )
        .join("\n");
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cbv-caja" style="border:1px solid ${C.borde};border-top:2px solid ${C.oro};border-radius:6px;background-color:${C.tarjeta};">${filas}</table>`,
      );
    }
    case "boton":
      return fila(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto;"><tr>
          <td class="cbv-boton" bgcolor="${C.marino}" style="background-color:${C.marino};border-radius:8px;mso-padding-alt:14px 32px;">
            <a href="${escapeHtml(b.url)}" class="cbv-boton-texto" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:14px;font-weight:bold;letter-spacing:0.5px;color:#FFFFFF;text-decoration:none;">${escapeHtml(b.texto)}</a>
          </td>
        </tr></table>`,
        "8px 40px 24px",
      );
    case "cita":
      return fila(
        `<div style="text-align:center;padding:8px 16px;">
          <div class="cbv-oro" style="font-family:${SERIF};font-size:36px;line-height:1;color:${C.oro};">&ldquo;</div>
          <div class="cbv-titulo" style="font-family:${SERIF};font-size:19px;font-style:italic;line-height:1.6;color:${C.tinta};">${escapeHtml(b.texto).replace(/\n/g, "<br>")}</div>
          ${b.autor ? `<div class="cbv-oro" style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.oroTexto};padding-top:10px;">${escapeHtml(b.autor)}</div>` : ""}
        </div>`,
      );
    case "separador":
      return fila(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="font-size:0;line-height:0;">
          <div style="width:48px;height:1px;background-color:${C.oro};margin:4px auto;font-size:0;line-height:0;">&nbsp;</div>
        </td></tr></table>`,
        "8px 40px 24px",
      );
  }
}

const CSS = `
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    body { margin:0 !important; padding:0 !important; width:100% !important; }
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
    @media only screen and (max-width:620px) {
      .cbv-exterior { padding:16px 8px !important; }
      .cbv-pad { padding-left:24px !important; padding-right:24px !important; }
      .cbv-cab { padding:24px 24px 20px !important; }
      .cbv-h1 { font-size:24px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .cbv-fondo { background-color:#061A2E !important; }
      .cbv-tarjeta { background-color:#0E2740 !important; }
      .cbv-caja { background-color:#12375C !important; border-color:#2E5F8E !important; }
      .cbv-borde { border-color:#2E5F8E !important; }
      .cbv-texto { color:#DCE3EA !important; }
      .cbv-titulo { color:#F8F5EE !important; }
      .cbv-suave { color:#AEB9C4 !important; }
      .cbv-oro { color:#D9B76E !important; }
      .cbv-boton { background-color:#D9B76E !important; }
      .cbv-boton-texto { color:#061A2E !important; }
    }
    [data-ogsc] .cbv-fondo { background-color:#061A2E !important; }
    [data-ogsc] .cbv-tarjeta { background-color:#0E2740 !important; }
    [data-ogsc] .cbv-caja { background-color:#12375C !important; }
    [data-ogsc] .cbv-texto { color:#DCE3EA !important; }
    [data-ogsc] .cbv-titulo { color:#F8F5EE !important; }
    [data-ogsc] .cbv-oro { color:#D9B76E !important; }`;

/** Relleno invisible tras el preheader: evita que el programa de correo enseñe el resto del cuerpo como vista previa. */
const RELLENO_PREHEADER = "&#8199;&#65279;&#847; ".repeat(40);

export interface OpcionesRender {
  /** Datos del responsable para el pie (web_contenido.negocio). Por defecto, solo el nombre y la web. */
  negocio?: DatosNegocio;
}

/** Cabecera y tarjeta comunes a la newsletter y al correo de confirmación. */
export function envolverCorreo(o: { titulo: string; preheader: string; insignia: string | null; cuerpo: string; pie: string; negocio: DatosNegocio }): string {
  const titulo = escapeHtml(o.titulo);
  const web = escapeHtml(o.negocio.web);
  const logo = escapeHtml(`${o.negocio.web}/brand/icon-512.png`);
  const contacto = [
    o.negocio.direccion ? escapeHtml(o.negocio.direccion) : null,
    o.negocio.telefono ? `<a href="tel:${escapeHtml(o.negocio.telefono.tel)}" class="cbv-suave" style="color:${C.suave};text-decoration:none;">${escapeHtml(o.negocio.telefono.display)}</a>` : null,
    `<a href="${web}" class="cbv-oro" style="color:${C.oroTexto};text-decoration:underline;">${escapeHtml(o.negocio.web.replace(/^https:\/\//, ""))}</a>`,
  ].filter(Boolean).join(" · ");
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <title>${titulo}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>${CSS}
  </style>
</head>
<body class="cbv-fondo" style="margin:0;padding:0;background-color:${C.fondo};">
  ${o.preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}${RELLENO_PREHEADER}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cbv-fondo" bgcolor="${C.fondo}" style="background-color:${C.fondo};">
    <tr>
      <td align="center" class="cbv-exterior" style="padding:32px 12px;">
        <!--[if mso]><table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
        <table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" class="cbv-tarjeta" bgcolor="${C.tarjeta}" style="width:100%;max-width:${ANCHO}px;background-color:${C.tarjeta};border-radius:10px;overflow:hidden;">
          <tr>
            <td align="center" class="cbv-cab" bgcolor="${C.marino}" style="padding:28px 40px 22px;background-color:${C.marino};">
              <a href="${web}" style="text-decoration:none;"><img src="${logo}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;margin:0 auto 10px;border:0;border-radius:12px;"></a>
              <div style="font-family:${SERIF};font-size:22px;letter-spacing:0.5px;color:#FFFFFF;">${escapeHtml(o.negocio.nombre)}</div>
              <div style="width:40px;height:2px;background-color:${C.oro};margin:12px auto 0;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          ${o.insignia ? `<tr>
            <td class="cbv-pad" align="center" style="padding:32px 40px 0;">
              <span class="cbv-caja cbv-suave" style="display:inline-block;background-color:${C.crema};border:1px solid ${C.borde};border-radius:999px;color:${C.texto};font-family:${SANS};font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:6px 16px;">${escapeHtml(o.insignia)}</span>
            </td>
          </tr>` : ""}
          <tr>
            <td class="cbv-pad" align="center" style="padding:20px 40px 24px;">
              <h1 class="cbv-h1 cbv-titulo" style="margin:0;font-family:${SERIF};font-size:28px;line-height:1.3;font-weight:normal;color:${C.tinta};">${titulo}</h1>
            </td>
          </tr>
          ${o.cuerpo}
          <tr>
            <td class="cbv-pad cbv-borde" align="center" style="padding:20px 40px;border-top:1px solid ${C.borde};">
              <p class="cbv-suave" style="margin:0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.suave};">${contacto}</p>
            </td>
          </tr>
          <tr>
            <td class="cbv-pad" align="center" bgcolor="${C.marinoOscuro}" style="padding:24px 40px;background-color:${C.marinoOscuro};font-family:${SANS};font-size:12px;line-height:1.6;color:${C.pieTexto};">
              ${o.pie}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * HTML final del newsletter. `enlaceBaja` es obligatorio: el enlace personal del suscriptor (envío real), el
 * marcador de Resend (Broadcast) o uno de muestra (vista previa del panel y prueba).
 */
export function renderNewsletter(datos: DatosNewsletter, enlaceBaja: string, opciones: OpcionesRender = {}): string {
  if (!enlaceBaja) throw new Error("renderNewsletter: falta el enlace de baja (es obligatorio en todo envío)");
  const negocio = opciones.negocio ?? negocioPorDefecto(URL_WEB);
  const base = plantillaBase(datos.tipo);
  const bloques = datos.bloques?.length ? datos.bloques : bloquesDeMensaje(datos.tipo, datos.mensaje, urlHttpsSegura(datos.imagenUrl));
  return envolverCorreo({
    titulo: datos.titulo,
    preheader: (datos.preheader ?? "").trim() || base.preheader,
    insignia: (datos.insignia ?? "").trim() || base.insignia,
    cuerpo: bloques.map(bloqueHtml).join("\n          "),
    pie: pieBaja(enlaceBaja, negocio),
    negocio,
  });
}

/** Versión de texto (parte text/plain del correo): mejor entrega y lectores de pantalla. Con el enlace de baja. */
export function textoNewsletter(datos: DatosNewsletter, enlaceBaja: string, opciones: OpcionesRender = {}): string {
  const negocio = opciones.negocio ?? negocioPorDefecto(URL_WEB);
  const cuerpo = datos.bloques?.length ? textoPlanoDeBloques(datos.bloques) : datos.mensaje;
  return [
    datos.titulo,
    "",
    cuerpo,
    "",
    "—",
    `Recibes este correo porque te suscribiste a las novedades de ${negocio.nombre} y confirmaste tu dirección.`,
    `Darse de baja: ${enlaceBaja}`,
    `Responsable: ${[negocio.nombre, negocio.direccion, negocio.email].filter(Boolean).join(" · ")}. Política de privacidad: ${negocio.web}/privacidad`,
  ].join("\n");
}

// ==================== LÍMITE DEL ENVÍO TRANSACCIONAL ====================
// El canal transaccional manda un correo por suscriptor (POST /emails). En el plan gratuito de Resend eso cuenta
// contra la cuota de 100 correos al día y 3.000 al mes: el límite (newsletter_config.limite_transaccional, 80 por
// defecto) deja margen para las confirmaciones. Más suscriptores: canal Broadcast o un plan de pago.
export const LIMITE_TRANSACCIONAL_POR_DEFECTO = 80;

/** Límite de destinatarios por envío transaccional; 0 = sin límite (null). */
export function limiteTransaccional(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor) || valor < 0) return LIMITE_TRANSACCIONAL_POR_DEFECTO;
  return valor === 0 ? null : Math.floor(valor);
}
