// ============================================================================
//  Logs web · explicación en sencillo (para quien no es técnico)
// ----------------------------------------------------------------------------
//  Frases cortas en español llano a partir de los DATOS de una incidencia:
//  qué pasa, a quién afecta, desde cuándo y qué hacer; qué hizo el cliente
//  (de su recorrido); tareas programadas con nombre llano; y los errores de
//  «versión antigua tras publicar». Las usan el ticket de Linear (arriba del
//  todo) y el panel (bloque «En pocas palabras» de incidencias y sesiones).
//
//  Aquí no entra ningún texto de los logs (mensajes, pilas, rutas
//  desconocidas): solo cifras, fechas y nombres conocidos. Lo que venga de los
//  logs lo añade quien llama, con su propio escapado (en el ticket, como
//  código). Sin Deno ni imports remotos: lo comparten funciones y panel.
// ============================================================================

export interface DatosSencillos {
  tipo: string;
  fuente: string;
  gravedad: string;
  ocurrencias: number;
  ocurrencias_24h: number;
  sesiones_afectadas: number;
  primera_vez: string;
  ultima_vez: string;
  rutas: Array<{ ruta: string; n: number }>;
  version_primera: string | null;
  version_ultima: string | null;
  reabierta_veces: number;
}

/** Qué es cada tipo de error, dicho en llano (sin el detalle concreto). */
export const TIPO_SENCILLO: Record<string, string> = {
  error_js: "un fallo en el código de la página",
  error_promesa: "un fallo en el código de la página (una operación que no terminó bien)",
  error_recurso: "una imagen, un estilo o un fichero de la página no cargó",
  error_peticion: "la web pidió datos al servidor y no obtuvo respuesta (o recibió un error)",
  error_react: "una parte de la página no se pudo mostrar",
  error_404: "alguien abrió una dirección de la web que no existe",
  error_servidor: "una función del servidor falló",
  error_integracion: "una tarea automática o la conexión con otro servicio falló",
  error_despliegue: "una publicación de la web en Vercel falló",
};

const PAGINAS: Array<[RegExp, string]> = [
  [/^\/?$/, "la portada"],
  [/^\/presupuesto/, "la calculadora de presupuestos"],
  [/^\/servicios\/mamparas/, "la página de mamparas"],
  [/^\/servicios\/espejos/, "la página de espejos"],
  [/^\/servicios\/cerramientos/, "la página de cerramientos"],
  [/^\/servicios\/aluminio/, "la página de aluminio"],
  [/^\/servicios\/barandillas/, "la página de barandillas"],
  [/^\/servicios\/armarios/, "la página de armarios"],
  [/^\/servicios\/domino/, "la página de paneles Dominó"],
  [/^\/servicios\/otros/, "la página de otros trabajos"],
  [/^\/servicios\/?$/, "la lista de servicios"],
  [/^\/servicios\/[^/]+/, "la página de un servicio"],
  [/^\/trabajos/, "los trabajos (fotos)"],
  [/^\/contacto/, "contacto"],
  [/^\/nosotros/, "«Quiénes somos»"],
  [/^\/(privacidad|cookies|aviso-legal)/, "los textos legales"],
  [/^\/super-admin|^\/panel|^\/admin/, "el panel"],
];

/** Nombre llano de una página conocida de la web («/servicios/mamparas» → «la página de mamparas»), o null. */
export function nombrePagina(ruta: string | null | undefined): string | null {
  if (ruta === null || ruta === undefined) return null;
  const sinIdioma = ruta.replace(/^\/(en|fr)(?=\/|$)/, "") || "/";
  const limpia = sinIdioma.split(/[?#]/)[0];
  for (const [re, nombre] of PAGINAS) if (re.test(limpia)) return nombre;
  return null;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export const esDeNavegador = (fuente: string) => fuente === "navegador";

/** «A quién afecta», solo con cifras (sin textos de los logs). */
export function aQuienAfectaSencillo(i: DatosSencillos): string {
  if (!esDeNavegador(i.fuente)) {
    return `No le sale a un cliente en pantalla: es del servidor. Ha pasado ${plural(i.ocurrencias, "vez", "veces")} (${i.ocurrencias_24h} en las últimas 24 h).`;
  }
  if (i.sesiones_afectadas === 0) return "A nadie de verdad: solo lo han provocado robots o pruebas automáticas.";
  const hoy = i.ocurrencias_24h > 0 ? `${plural(i.ocurrencias_24h, "vez", "veces")} en las últimas 24 h` : "ninguna vez en las últimas 24 h";
  const critico = i.gravedad === "critico" ? " Es grave: puede impedir que lleguen solicitudes de presupuesto." : "";
  return `A ${plural(i.sesiones_afectadas, "visitante", "visitantes")} (${plural(i.ocurrencias, "vez", "veces")} en total; ${hoy}).${critico}`;
}

/** «Desde cuándo»: primera y última vez, versión y reapariciones. */
export function desdeCuandoSencillo(i: DatosSencillos, fecha: (iso: string) => string): string {
  const version = i.version_primera ? ` (versión ${i.version_primera}${i.version_ultima && i.version_ultima !== i.version_primera ? `; sigue en la ${i.version_ultima}` : ""})` : "";
  const reabierta = i.reabierta_veces > 0 ? ` Volvió ${plural(i.reabierta_veces, "vez", "veces")} después de darse por resuelta.` : "";
  return `Desde el ${fecha(i.primera_vez)}${version}. La última vez, el ${fecha(i.ultima_vez)}.${reabierta}`;
}

/** «Qué hacer» cuando no hay una causa conocida ni propuesta de la IA. */
export function queHacerPorDefecto(i: DatosSencillos): string {
  if (i.tipo === "error_404") return "Revisar si algún enlace (de la web, Google o una campaña) apunta a esa dirección y corregirlo o redirigirlo.";
  if (i.tipo === "error_despliegue") return "Abrir el despliegue en Vercel, leer por qué falló la publicación y volver a publicar cuando esté corregido.";
  if (!esDeNavegador(i.fuente)) return "Revisar los registros de esa función o tarea a la hora indicada y corregir la causa; luego marcar la incidencia como resuelta.";
  return "Reproducirlo con los pasos de abajo, corregirlo y, cuando se publique el arreglo, marcar la incidencia como resuelta (si vuelve, se reabre sola).";
}

/** Primera letra en mayúscula. */
export const conMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

// ─── Tareas programadas (pg_cron) dichas en llano ───────────────────────────
export interface TareaSencilla {
  nombre: string;
  /** «retoma la lectura de facturas atascadas» (para «La tarea que …»). */
  que: string;
  /** Qué se nota en la cristalería si falla; null si no se nota nada. */
  consecuencia: string | null;
  conocida: boolean;
}

const TAREAS: Record<string, [string, string | null]> = {
  "reanudar-trabajos-ocr": ["retoma la lectura de facturas atascadas", "las facturas pueden tardar más en leerse"],
  "clasificar-productos": ["clasifica los productos de las facturas", "algunos productos pueden tardar más en clasificarse"],
  "limpiar-pendientes-ocr": ["borra las piezas de las facturas ya leídas", null],
  "avisos-telegram-pendientes": ["manda los avisos pendientes por Telegram", "algún aviso de Telegram puede llegar tarde"],
  "avisos-telegram-resumen": ["manda el resumen por Telegram", "el resumen de Telegram puede llegar tarde"],
  "avisos-telegram-fallos": ["avisa por Telegram de los fallos internos", "algún aviso de fallo puede llegar tarde"],
  "avisos-telegram-vigilante": ["vigila que los avisos de Telegram funcionen", null],
  "ia-modelos-openai": ["actualiza la lista de modelos de IA", null],
  "sincronizar-costes-openai": ["trae el gasto real de OpenAI", "las cifras de gasto de IA pueden ir con retraso"],
  "procesar-logs-web": ["agrupa los errores de la web y prepara los tickets", "los avisos de errores pueden ir con retraso"],
  "sync-trafico-web": ["trae las visitas de la web desde Vercel", "las cifras de Tráfico web pueden ir con retraso"],
};

export function tareaSencilla(nombre: string): TareaSencilla {
  const t = TAREAS[nombre];
  return t ? { nombre, que: t[0], consecuencia: t[1], conocida: true } : { nombre, que: `«${nombre}»`, consecuencia: null, conocida: false };
}

/** Nombres de tarea de una incidencia: los de las muestras, el de las propiedades o el del objetivo «cron:…». */
export function tareasDe(d: { tareas?: string[] | null; objetivo?: string | null; propiedades?: Record<string, unknown> | null }): string[] {
  const salida = new Set<string>();
  for (const t of d.tareas ?? []) if (t) salida.add(t);
  const prop = d.propiedades?.tarea;
  if (typeof prop === "string" && prop) salida.add(prop);
  const m = /^cron:(.+)$/.exec(d.objetivo ?? "");
  if (m && m[1] !== "*") salida.add(m[1]);
  return [...salida];
}

export const listaTareas = (nombres: string[]) => nombres.map(tareaSencilla);

/** «Qué falló» cuando no hay causa conocida ni explicación de la IA. */
export function queFalloGenerico(d: { tipo: string; fuente: string; rutas?: Array<{ ruta: string }>; objetivo?: string | null; tareas?: string[] | null; propiedades?: Record<string, unknown> | null }): string {
  const tareas = listaTareas(tareasDe(d));
  if (d.tipo === "error_integracion" && tareas.length) {
    const t = tareas[0];
    const mas = tareas.length > 1 ? ` (y ${tareas.length - 1} ${tareas.length === 2 ? "tarea más" : "tareas más"})` : "";
    return `Falló la tarea automática que ${t.que}${mas}.${t.consecuencia ? ` Consecuencia: ${t.consecuencia}.` : ""}`;
  }
  const base = conMayuscula(TIPO_SENCILLO[d.tipo] ?? "un fallo de la web");
  const pagina = esDeNavegador(d.fuente) ? nombrePagina(d.rutas?.[0]?.ruta) : null;
  return `${base}${pagina ? ` en ${pagina}` : ""}.`;
}

// ─── «Qué hizo el cliente» a partir de los eventos de su sesión ─────────────
export interface EventoRecorrido {
  id?: number;
  tipo: string;
  categoria: string;
  accion: string | null;
  ruta: string | null;
  objetivo: string | null;
  valor?: number | null;
  propiedades?: Record<string, unknown> | null;
}

const ORIGEN: Record<string, string> = {
  buscador: "desde un buscador (Google…)",
  red_social: "desde una red social",
  qr: "con un código QR",
  campana: "desde una campaña",
  enlace: "desde un enlace de otra web",
};
const CONTACTO: Record<string, string> = {
  telefono: "pulsó para llamar",
  whatsapp: "pulsó para escribir por WhatsApp",
  email: "pulsó para mandar un correo",
  mapa: "abrió el mapa",
  red_social: "abrió una red social",
};
const FORMULARIO: Record<string, string> = {
  presupuesto: " de solicitud de presupuesto",
  contacto: " de contacto",
  visita: " de visita técnica",
};

const conObjetivo = (o: string | null) => (o ? ` «${o.slice(0, 60)}»` : "");

/** Una frase por paso (en su orden); null = no se cuenta (técnico, scroll…). La clave agrupa repeticiones seguidas. */
function paso(e: EventoRecorrido, primeraPagina: boolean): { clave: string; texto: (n: number) => string } | null {
  const p = e.propiedades ?? {};
  switch (e.tipo) {
    case "pagina_vista": {
      const nombre = nombrePagina(e.ruta) ?? (e.ruta ? `la página ${e.ruta.slice(0, 60)}` : "la web");
      const origen = primeraPagina && typeof p.origen_tipo === "string" && ORIGEN[p.origen_tipo] ? ` ${ORIGEN[p.origen_tipo]}` : "";
      return { clave: `pagina:${nombre}`, texto: () => `${primeraPagina ? "entró en" : "fue a"} ${nombre}${origen}` };
    }
    case "calculadora": {
      if (e.accion === "categoria") return { clave: `calc:c:${e.objetivo ?? ""}`, texto: () => `eligió${conObjetivo(e.objetivo)} en la calculadora` };
      if (e.accion === "calculado") {
        const precio = typeof e.valor === "number" && e.valor > 0 ? ` (${Math.round(e.valor)} €)` : "";
        return { clave: "calc:p", texto: (n) => (n === 1 ? `calculó un precio${precio}` : `calculó ${n} precios`) };
      }
      if (e.accion === "inicio") return { clave: "calc:i", texto: () => "abrió la calculadora" };
      return null;
    }
    case "media": return { clave: e.tipo, texto: () => "vio fotos de los trabajos" };
    case "clic": return e.objetivo ? { clave: `clic:${e.objetivo}`, texto: () => `pulsó${conObjetivo(e.objetivo)}` } : null;
    case "contacto": return { clave: `contacto:${e.accion}`, texto: () => CONTACTO[e.accion ?? ""] ?? "pulsó un botón de contacto" };
    case "chat": return e.accion === "abrir" ? { clave: e.tipo, texto: () => "abrió el asistente" } : e.accion === "mensaje" ? { clave: "chat:m", texto: () => "escribió al asistente" } : null;
    case "formulario": {
      const de = FORMULARIO[e.objetivo ?? ""] ?? "";
      if (e.accion === "inicio") return { clave: `form:i:${de}`, texto: () => `empezó a rellenar el formulario${de}` };
      if (e.accion === "envio") return { clave: `form:e:${de}`, texto: () => `envió el formulario${de}` };
      if (e.accion === "error_validacion") return { clave: `form:v:${de}`, texto: () => "le faltó algún dato del formulario" };
      if (e.accion === "abandono") return { clave: `form:a:${de}`, texto: () => `dejó el formulario${de} a medias` };
      return null;
    }
    case "presupuesto_solicitado": return { clave: e.tipo, texto: () => "envió la solicitud de presupuesto (llegó al panel)" };
    case "presupuesto_rechazado": return { clave: e.tipo, texto: () => "intentó enviar la solicitud de presupuesto, pero no se aceptó" };
    case "contacto_enviado": return { clave: e.tipo, texto: () => (e.accion === "whatsapp" ? "abrió WhatsApp con su mensaje ya escrito" : "envió el formulario de contacto") };
    default: return null;
  }
}

/** Junta frases: «a, b y c». */
export function enumerar(frases: string[]): string {
  if (frases.length <= 1) return frases[0] ?? "";
  return `${frases.slice(0, -1).join(", ")} y ${frases[frases.length - 1]}`;
}

/**
 * «Entró en la portada, eligió «Mamparas» en la calculadora y calculó un precio»: lo que hizo el
 * cliente, en orden, con las repeticiones seguidas juntas. Solo actividad
 * (sin errores ni detalles técnicos); como mucho `max` pasos (los últimos).
 * Devuelve null si no hay nada que contar.
 */
export function resumirRecorrido(eventos: EventoRecorrido[], max = 7): string | null {
  const grupos: Array<{ clave: string; n: number; texto: (n: number) => string }> = [];
  let vistaAlguna = false;
  for (const e of eventos) {
    if (e.categoria === "error" || e.categoria === "tecnico") continue;
    const p = paso(e, !vistaAlguna && e.tipo === "pagina_vista");
    if (e.tipo === "pagina_vista") vistaAlguna = true;
    if (!p) continue;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === p.clave) ultimo.n++;
    else grupos.push({ ...p, n: 1 });
  }
  if (!grupos.length) return null;
  const frases = grupos.map((g) => g.texto(g.n));
  const recortado = frases.length > max ? ["…", ...frases.slice(-max)] : frases;
  const texto = recortado[0] === "…" ? `… ${enumerar(recortado.slice(1))}` : enumerar(recortado);
  return `${conMayuscula(texto)}.`;
}

// ─── Errores de «versión antigua tras publicar» ──────────────────────────────
export type ClaseTrasPublicar = "sin_impacto" | "sin_datos" | "sin_conexion" | "repetido";

/** Etiqueta de cada ocurrencia (web_eventos.tras_publicar). Solo «repetido» cuenta para los tickets. */
export const TEXTO_TRAS_PUBLICAR: Record<ClaseTrasPublicar, string> = {
  sin_impacto: "esperado tras publicar · sin impacto",
  sin_datos: "esperado tras publicar · sin datos de después",
  sin_conexion: "sin conexión del visitante · no cuenta",
  repetido: "no se arregló al recargar · revisar",
};

/** Qué decidió la web ante un error de carga (`accion`, si la web lo manda), en llano. */
export const TEXTO_ACCION_RECARGA: Record<string, string> = {
  recuperado_tras_recarga: "se recargó sola con la versión nueva",
  recarga_sin_efecto: "se recargó pero siguió con la misma versión",
  aviso_version_nueva: "se le pidió tocar «Actualizar»",
  sin_version_nueva: "no había versión nueva (red o fichero que falta)",
  sin_conexion: "sin conexión: no se recargó",
};

/**
 * «¿Afecta?» de una incidencia de versión antigua, con sus cifras.
 * `tras`: las que no cuentan (se arreglaron solas, sin datos o sin conexión);
 * `repetidas`: no se arreglaron al recargar; `otras`: fallos de carga sin
 * versión nueva (red o fichero que falta), que cuentan como un error normal.
 */
export function afectaTrasPublicar(tras: number, repetidas: number, extra: { sinDatos?: number; sinConexion?: number; otras?: number } = {}): string {
  const otras = extra.otras ?? 0;
  const notaOtras = otras > 0 ? ` Además, ${plural(otras, "vez", "veces")} no había versión nueva (la red o un fichero que falta): ${otras === 1 ? "esa cuenta" : "esas cuentan"} como un error normal.` : "";
  if (repetidas > 0) {
    const quien = repetidas === 1 ? "a esa persona no le funcionó" : "a esas personas no les funcionó";
    const resto = tras === 0 ? "" : tras === 1 ? " La otra vez se arregló sola al recargar." : ` Las otras ${tras} veces se arreglaron solas al recargar.`;
    return `Sí, a veces: ${plural(repetidas, "vez", "veces")} no se arregló al recargar (volvió a fallar o siguió con la versión antigua), así que ${quien}.${resto}${notaOtras}`;
  }
  if (tras === 0) return otras > 0 ? `Puede: ${plural(otras, "vez", "veces")} no se pudo cargar una parte de la web y no era por una publicación (la red o un fichero que falta).` : "No.";
  const detalles = [
    extra.sinDatos ? `de ${extra.sinDatos} no hay datos de después: el navegador del visitante no deja medir` : "",
    extra.sinConexion ? `${extra.sinConexion} ${extra.sinConexion === 1 ? "fue" : "fueron"} sin conexión del visitante` : "",
  ].filter(Boolean);
  const entre = detalles.length ? ` (${detalles.join("; ")})` : "";
  return `No: ${tras === 1 ? "fue una página antigua abierta" : `las ${tras} veces fueron páginas antiguas abiertas`} durante una publicación y se recargó sola${entre}.${notaOtras}`;
}
