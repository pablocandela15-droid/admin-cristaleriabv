/**
 * RRSS · errores de la Graph API de Meta (Instagram y páginas de Facebook)
 * traducidos a castellano, con un «cómo arreglarlo» para cada caso. Portado
 * del panel de referencia (_shared/instagram/errores.ts) y adaptado a la
 * conexión de este panel (botón «Conectar con Facebook» o token de usuario del
 * sistema en los secretos).
 *
 * Las respuestas de error de Meta tienen la forma
 *   { error: { message, type, code, error_subcode, fbtrace_id } }
 * La tabla de códigos sale de la documentación oficial de Content Publishing
 * y de Graph API (errores 190, 10/200-299, 4/17/32/613/80002, 2207xxx…).
 *
 * Todo el texto que viene de Meta se sanea antes de guardarlo.
 */
import { sanear } from "./secretos.ts";

export type TipoErrorMeta =
  | "token"
  | "sesion"
  | "permisos"
  | "app_bloqueada"
  | "cuenta_no_profesional"
  | "limite_llamadas"
  | "limite_publicacion"
  | "spam"
  | "cuenta_restringida"
  | "imagen_demasiado_grande"
  | "formato_imagen"
  | "relacion_aspecto"
  | "caption_demasiado_largo"
  | "url_no_descargable"
  | "contenedor_no_listo"
  | "contenedor_inexistente"
  | "contenedor_error"
  | "contenedor_caducado"
  | "contenedor_ya_publicado"
  | "contenedor_tiempo_agotado"
  | "medio_caducado"
  | "peticion_invalida"
  | "sin_conexion"
  | "sin_pagina"
  | "validacion"
  | "dudoso"
  | "transitorio"
  | "red"
  | "tiempo_agotado"
  | "respuesta_inesperada"
  | "desconocido";

interface Texto {
  mensaje: string;
  comoArreglarlo: string;
  reintentable: boolean;
}

export const RENOVAR_CONEXION =
  "En RRSS › Conexión pulsa «Renovar conexión» y acepta todos los permisos que pide Facebook. Si usáis un token de " +
  "usuario del sistema (secreto IG_ACCESS_TOKEN), genera otro en Meta Business Suite → Configuración del negocio → " +
  "Usuarios del sistema → «Generar token» (caducidad «Nunca») y cámbialo en Supabase → Edge Functions → Secrets. " +
  "Detalle en docs/RRSS.md.";

const PERMISOS_NECESARIOS =
  "instagram_basic, instagram_content_publish, instagram_manage_insights, pages_show_list, pages_read_engagement y pages_manage_posts";

const TEXTOS: Record<TipoErrorMeta, Texto> = {
  token: { mensaje: "El token de acceso de Meta no es válido", comoArreglarlo: RENOVAR_CONEXION, reintentable: false },
  sesion: { mensaje: "La sesión del token de Meta no es válida (error 102)", comoArreglarlo: RENOVAR_CONEXION, reintentable: false },
  permisos: {
    mensaje: "Al token le faltan permisos para esta operación",
    comoArreglarlo: `Vuelve a conectar y marca todos los permisos (${PERMISOS_NECESARIOS}). Comprueba también que tu usuario de Facebook administra la página y que la cuenta de Instagram está vinculada a ella.`,
    reintentable: false,
  },
  // OAuthException 200 «API access blocked.»: la app entera (no un permiso del token).
  app_bloqueada: {
    mensaje: "Meta ha bloqueado el acceso de la app a la API",
    comoArreglarlo:
      "Entra en developers.facebook.com → tu app y revisa las «Acciones requeridas», las alertas y que la app siga activa. Si sigue bloqueada, crea una app nueva y cambia META_APP_ID y META_APP_SECRET (y vuelve a conectar).",
    reintentable: false,
  },
  cuenta_no_profesional: {
    mensaje: "La cuenta de Instagram no es profesional (empresa o creador)",
    comoArreglarlo:
      "En la app de Instagram: Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional (Empresa) y vincúlala a la página de Facebook de la cristalería. Después, «Renovar conexión».",
    reintentable: false,
  },
  limite_llamadas: {
    mensaje: "Se ha superado el límite de llamadas a la API de Meta",
    comoArreglarlo: "Espera un rato antes de reintentar y no repitas la acción en bucle. Si se repite, mira el uso de la API en developers.facebook.com → tu app → Panel.",
    reintentable: false,
  },
  limite_publicacion: {
    mensaje: "Se ha alcanzado el límite de publicaciones de Instagram en 24 horas",
    comoArreglarlo: "Espera a que pase la ventana de 24 horas («Comprobar conexión» enseña cuántas quedan). Lo programado se publica solo cuando vuelva a haber cupo.",
    reintentable: false,
  },
  spam: {
    mensaje: "Instagram ha marcado la acción como posible spam",
    comoArreglarlo: "Deja de publicar durante unas horas, evita textos o fotos repetidos y mira en la app de Instagram si hay avisos en la cuenta.",
    reintentable: false,
  },
  cuenta_restringida: {
    mensaje: "La cuenta de Instagram está restringida o bloqueada para publicar",
    comoArreglarlo: "Entra en la app de Instagram con la cuenta y resuelve el aviso (verificación, apelación…). Mientras siga restringida no se puede publicar.",
    reintentable: false,
  },
  imagen_demasiado_grande: {
    mensaje: "La foto supera los 8 MB",
    comoArreglarlo: "Vuelve a elegir la foto: el panel la recorta a 1080 px de ancho. Si es un vídeo, expórtalo con menos calidad.",
    reintentable: false,
  },
  formato_imagen: {
    mensaje: "Formato de imagen no admitido",
    comoArreglarlo: "Instagram solo acepta JPEG por la API. Vuelve a añadir la foto desde el panel (la convierte a JPEG).",
    reintentable: false,
  },
  relacion_aspecto: {
    mensaje: "La proporción de la foto o el vídeo no es válida",
    comoArreglarlo: "Fotos entre 4:5 (vertical) y 1,91:1 (apaisada); historias y reels, 9:16. Cambia el recorte y vuelve a intentarlo.",
    reintentable: false,
  },
  caption_demasiado_largo: {
    mensaje: "El texto es demasiado largo",
    comoArreglarlo: "Como mucho 2200 caracteres, 30 hashtags y 20 menciones.",
    reintentable: false,
  },
  url_no_descargable: {
    mensaje: "Meta no ha podido descargar la foto o el vídeo",
    comoArreglarlo:
      "El panel le da a Meta un enlace temporal al fichero. Vuelve a intentarlo; si se repite, comprueba en Supabase → Storage que el fichero sigue en el cubo «rrss» y que el vídeo pesa menos de 50 MB.",
    reintentable: false,
  },
  contenedor_no_listo: {
    mensaje: "Meta todavía no ha terminado de preparar la publicación",
    comoArreglarlo: "No hace falta hacer nada: el panel lo vuelve a intentar solo en unos minutos.",
    reintentable: false,
  },
  contenedor_inexistente: {
    mensaje: "La publicación preparada en Meta no existe o ha caducado",
    comoArreglarlo: "Se preparan de nuevo al volver a publicar (caducan a las 24 horas).",
    reintentable: true,
  },
  contenedor_error: {
    mensaje: "Instagram no ha podido procesar la foto o el vídeo",
    comoArreglarlo:
      "Fotos: JPEG de 320 a 1440 px de ancho. Vídeos: MP4 en H.264 con sonido AAC, de 3 s a 15 min (historias y carrusel, hasta 60 s). Exporta el vídeo de nuevo («Más compatible» en el iPhone) y vuelve a publicar.",
    reintentable: false,
  },
  contenedor_caducado: {
    mensaje: "La publicación preparada en Meta ha caducado",
    comoArreglarlo: "Caducan a las 24 horas. Vuelve a publicarla.",
    reintentable: false,
  },
  contenedor_ya_publicado: {
    mensaje: "Esa publicación ya había salido en Instagram",
    comoArreglarlo: "No hace falta hacer nada.",
    reintentable: false,
  },
  contenedor_tiempo_agotado: {
    mensaje: "Meta está tardando en procesar la publicación",
    comoArreglarlo: "No hace falta hacer nada: el programador la termina sola en unos minutos.",
    reintentable: false,
  },
  medio_caducado: {
    mensaje: "El fichero subido a Meta ha caducado",
    comoArreglarlo: "Vuelve a publicarla.",
    reintentable: false,
  },
  peticion_invalida: {
    mensaje: "Meta no acepta la petición o no da acceso a esa cuenta o página",
    comoArreglarlo: "Pulsa «Comprobar conexión» en RRSS › Conexión: dice qué cuenta y qué página ve el panel. Si no son las de la cristalería, «Renovar conexión» y elige la página correcta.",
    reintentable: false,
  },
  sin_conexion: {
    mensaje: "RRSS no está conectado con Instagram y Facebook",
    comoArreglarlo: "En RRSS › Conexión sigue los pasos para conectar la cuenta (docs/RRSS.md).",
    reintentable: false,
  },
  sin_pagina: {
    mensaje: "No hay página de Facebook conectada",
    comoArreglarlo: "Conecta la página en RRSS › Conexión («Renovar conexión» y elige la página) o pon FB_PAGE_ID en los secretos si usáis un token de usuario del sistema.",
    reintentable: false,
  },
  validacion: {
    mensaje: "A la publicación le falta algo",
    comoArreglarlo: "Ábrela, corrige lo que dice y vuelve a intentarlo.",
    reintentable: false,
  },
  dudoso: {
    mensaje: "No se sabe si la publicación ha salido en Facebook",
    comoArreglarlo: "Mira la página de Facebook antes de repetirla: puede que ya esté publicada. Si no está, vuelve a publicarla.",
    reintentable: false,
  },
  transitorio: {
    mensaje: "Error temporal de Meta",
    comoArreglarlo: "Se reintenta solo. Si sigue fallando, espera unos minutos y vuelve a intentarlo.",
    reintentable: true,
  },
  red: {
    mensaje: "No se pudo conectar con Meta",
    comoArreglarlo: "Vuelve a intentarlo en unos minutos.",
    reintentable: true,
  },
  tiempo_agotado: {
    mensaje: "Meta tardó demasiado en responder",
    comoArreglarlo: "Vuelve a intentarlo en unos minutos.",
    reintentable: true,
  },
  respuesta_inesperada: {
    mensaje: "Respuesta inesperada de Meta",
    comoArreglarlo: "Comprueba META_API_VERSION (por defecto v26.0) y vuelve a intentarlo. Si persiste, avisa a quien lleva la parte técnica.",
    reintentable: false,
  },
  desconocido: {
    mensaje: "Error no catalogado de Meta",
    comoArreglarlo: "Lee el mensaje de Meta. Si no se entiende, envía una petición desde «Nueva petición» con la hora y la publicación.",
    reintentable: false,
  },
};

/** Detalle de los subcódigos del error 190. */
const SUBCODIGOS_TOKEN: Record<number, { detalle: string; arreglo?: string }> = {
  458: { detalle: "la app ya no está autorizada (se quitó en Configuración → Integraciones comerciales)" },
  459: { detalle: "la cuenta tiene un punto de control de seguridad pendiente", arreglo: "Entra en Facebook con la cuenta administradora y resuelve el aviso." },
  460: { detalle: "se cambió la contraseña de Facebook y el token quedó invalidado" },
  463: { detalle: "el token ha caducado" },
  464: { detalle: "el usuario no está confirmado o tiene un punto de control", arreglo: "Resuelve el aviso en Facebook." },
  467: { detalle: "el token no es válido (revocado o se quitó el acceso)" },
  492: { detalle: "el usuario ya no tiene rol sobre la página", arreglo: "Comprueba en la página de Facebook que tu usuario sigue siendo administrador." },
};

export interface DatosErrorGraph {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
}

export interface ParametrosErrorMeta {
  tipo: TipoErrorMeta;
  mensaje?: string;
  comoArreglarlo?: string;
  reintentable?: boolean;
  codigo?: number | null;
  subcodigo?: number | null;
  estadoHttp?: number | null;
  fbtraceId?: string | null;
  detalleMeta?: string | null;
  minutosParaRecuperar?: number | null;
}

export class ErrorMeta extends Error {
  override readonly name = "ErrorMeta";
  readonly tipo: TipoErrorMeta;
  readonly comoArreglarlo: string;
  readonly reintentable: boolean;
  readonly codigo: number | null;
  readonly subcodigo: number | null;
  readonly estadoHttp: number | null;
  readonly fbtraceId: string | null;
  /** Texto original de Meta, ya saneado. */
  readonly detalleMeta: string | null;
  readonly minutosParaRecuperar: number | null;

  constructor(p: ParametrosErrorMeta) {
    const base = TEXTOS[p.tipo];
    super(sanear(p.mensaje ?? base.mensaje));
    this.tipo = p.tipo;
    this.comoArreglarlo = sanear(p.comoArreglarlo ?? base.comoArreglarlo);
    this.reintentable = p.reintentable ?? base.reintentable;
    this.codigo = p.codigo ?? null;
    this.subcodigo = p.subcodigo ?? null;
    this.estadoHttp = p.estadoHttp ?? null;
    this.fbtraceId = p.fbtraceId ?? null;
    this.detalleMeta = p.detalleMeta ? sanear(p.detalleMeta) : null;
    this.minutosParaRecuperar = p.minutosParaRecuperar ?? null;
  }
}

/** Minutos que Meta pide esperar (cabecera X-Business-Use-Case-Usage, entradas de Instagram o páginas). */
export function leerEsperaMeta(cabeceras: Headers | null | undefined): number | null {
  const crudo = cabeceras?.get("x-business-use-case-usage");
  if (!crudo) return null;
  try {
    const datos = JSON.parse(crudo) as Record<string, Array<Record<string, unknown>>>;
    let minutos: number | null = null;
    for (const lista of Object.values(datos)) {
      if (!Array.isArray(lista)) continue;
      for (const uso of lista) {
        const espera = Number(uso.estimated_time_to_regain_access);
        if (Number.isFinite(espera) && espera > 0) minutos = Math.max(minutos ?? 0, espera);
      }
    }
    return minutos;
  } catch {
    return null;
  }
}

const TRANSITORIOS_SUB = new Set([2207001, 2207003, 2207032]);

/** OAuthException 200 con «API access blocked.»: Meta ha bloqueado la app entera. */
export function esAppBloqueada(codigo: number | null, mensaje: string): boolean {
  return codigo === 200 && /api access blocked/i.test(mensaje);
}

/** Clasifica un código/subcódigo de Meta en un tipo de error. */
export function clasificarError(codigo: number | null, subcodigo: number | null, mensaje: string, estadoHttp: number | null): TipoErrorMeta {
  const c = codigo;
  const s = subcodigo;
  if (s === 2207042 || c === 9) return "limite_publicacion";
  if (s === 2207051) return "spam";
  if (s === 2207050 || c === 25) return "cuenta_restringida";
  if (s === 2207004 || c === 36000) return "imagen_demasiado_grande";
  if (s === 2207005 || c === 36001) return "formato_imagen";
  if (s === 2207009 || c === 36003) return "relacion_aspecto";
  if (s === 2207010 || c === 36004) return "caption_demasiado_largo";
  if (s === 2207052 || c === 9004) return "url_no_descargable";
  if (s === 2207027 || c === 9007) return "contenedor_no_listo";
  if (s === 2207008 || c === 24) return "contenedor_inexistente";
  if (s === 2207020) return "medio_caducado";
  if ((s !== null && TRANSITORIOS_SUB.has(s)) || c === -1 || c === -2 || c === 1 || c === 2) return "transitorio";
  if (c === 190) return "token";
  if (c === 102) return "sesion";
  if (c === 10 && /not\s+(a\s+)?(business|creator)|business or creator|professional account|cuenta profesional/i.test(mensaje)) {
    return "cuenta_no_profesional";
  }
  if (esAppBloqueada(c, mensaje)) return "app_bloqueada";
  if (c === 10 || (c !== null && c >= 200 && c <= 299)) return "permisos";
  if (c === 4 || c === 17 || c === 32 || c === 613 || (c !== null && c >= 80000 && c <= 80099)) return "limite_llamadas";
  if (c === 100) return "peticion_invalida";
  if (estadoHttp !== null && estadoHttp >= 500) return "transitorio";
  return "desconocido";
}

/** Convierte una respuesta de error de la Graph API en ErrorMeta. */
export function mapearErrorGraph(entrada: { estadoHttp: number; cuerpo: unknown; cabeceras?: Headers | null }): ErrorMeta {
  const cuerpo = entrada.cuerpo as { error?: DatosErrorGraph } | null | undefined;
  const e: DatosErrorGraph = (cuerpo && typeof cuerpo === "object" && cuerpo.error) || {};
  const codigo = typeof e.code === "number" ? e.code : null;
  const subcodigo = typeof e.error_subcode === "number" ? e.error_subcode : null;
  const mensajeMeta = [e.message, e.error_user_msg].filter(Boolean).join(" — ");
  const tipo = clasificarError(codigo, subcodigo, mensajeMeta, entrada.estadoHttp);
  const base = TEXTOS[tipo];
  const espera = leerEsperaMeta(entrada.cabeceras);

  let mensaje = base.mensaje;
  let comoArreglarlo = base.comoArreglarlo;
  if (tipo === "token" && subcodigo !== null && SUBCODIGOS_TOKEN[subcodigo]) {
    const sub = SUBCODIGOS_TOKEN[subcodigo];
    mensaje = `${mensaje}: ${sub.detalle}`;
    if (sub.arreglo) comoArreglarlo = `${sub.arreglo} ${RENOVAR_CONEXION}`;
  }
  if (tipo === "limite_llamadas" && espera) comoArreglarlo = `Espera unos ${espera} min antes de reintentar. ${comoArreglarlo}`;
  const textoMeta = mensajeMeta ? sanear(mensajeMeta).slice(0, 400) : null;
  const sufijo = textoMeta ? ` — Meta dice: «${textoMeta}»` : entrada.estadoHttp ? ` (HTTP ${entrada.estadoHttp})` : "";
  const reintentable = tipo === "desconocido" && e.is_transient === true ? true : base.reintentable;

  return new ErrorMeta({
    tipo,
    mensaje: `${mensaje}${sufijo}`,
    comoArreglarlo,
    reintentable,
    codigo,
    subcodigo,
    estadoHttp: entrada.estadoHttp,
    fbtraceId: e.fbtrace_id ?? null,
    detalleMeta: textoMeta,
    minutosParaRecuperar: espera,
  });
}

/** Busca un subcódigo 2207xxx dentro del texto de `status` de un contenedor en ERROR. */
export function tipoDesdeTextoEstado(texto: string | undefined): TipoErrorMeta | null {
  const m = /\b(2207\d{3})\b/.exec(texto ?? "");
  if (!m) return null;
  const tipo = clasificarError(null, Number(m[1]), texto ?? "", null);
  return tipo === "desconocido" ? null : tipo;
}

export function textoDeTipo(tipo: TipoErrorMeta): Readonly<Texto> {
  return TEXTOS[tipo];
}

/** Errores tras los que no se sabe si Meta llegó a publicar (nunca se repite a ciegas). */
export const TIPOS_DUDOSOS: ReadonlySet<TipoErrorMeta> = new Set(["tiempo_agotado", "red", "transitorio", "desconocido", "respuesta_inesperada"]);

/** Errores de credenciales: Meta no hizo nada (se puede probar con otro token sin riesgo). */
export const TIPOS_CREDENCIAL: ReadonlySet<TipoErrorMeta> = new Set(["token", "sesion", "permisos"]);

/** Cuerpo JSON (saneado) de un ErrorMeta para las respuestas de las funciones. */
export function errorMetaAJson(e: ErrorMeta): { error: string; tipo: TipoErrorMeta; comoArreglarlo: string; codigo: number | null; fbtraceId: string | null } {
  return { error: sanear(e.message), tipo: e.tipo, comoArreglarlo: sanear(e.comoArreglarlo), codigo: e.codigo, fbtraceId: e.fbtraceId };
}

/** Estado HTTP con el que la función responde a un error de Meta. */
export function estadoHttpDeError(e: ErrorMeta): number {
  switch (e.tipo) {
    case "limite_publicacion":
    case "limite_llamadas":
    case "spam":
      return 429;
    case "imagen_demasiado_grande":
    case "formato_imagen":
    case "relacion_aspecto":
    case "caption_demasiado_largo":
    case "url_no_descargable":
    case "contenedor_error":
    case "validacion":
      return 422;
    case "sin_conexion":
    case "sin_pagina":
    case "transitorio":
    case "red":
    case "tiempo_agotado":
    case "app_bloqueada":
      return 503;
    default:
      return 502;
  }
}
