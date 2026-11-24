// ============================================================================
// NEWSLETTER · DISEÑO POR BLOQUES — código PURO (sin Deno, sin red, sin secretos)
// ----------------------------------------------------------------------------
// Portado del panel de referencia (Newsletter, «Crear con IA» y plantillas) y
// adaptado a la cristalería: plantillas de novedades, ofertas, campañas de
// temporada, trabajos recientes, consejos y avisos. Nada de restaurante.
//
// Un correo es una lista de BLOQUES (texto, foto, caja destacada, lista de
// productos o servicios, fechas y datos, botón, cita, separador, firma). Las
// plantillas son bloques de partida; la IA (newsletter-ia) propone bloques; el
// equipo los edita en el panel; y _shared/newsletter/plantillas.ts los pinta
// con la estética de la marca. Nunca hay HTML libre: todo es texto plano que se
// escapa al pintarlo.
//
// Lo usan: enviar-newsletter (validar y pintar el correo real), newsletter-ia
// (normalizar la propuesta de la IA) y el panel (editor y vista previa). Por
// eso no puede importar nada de https:// ni usar Deno.*.
// ============================================================================

export type TipoNewsletter = "novedades" | "oferta" | "temporada" | "trabajos" | "consejos" | "aviso" | "personalizada";

export const TIPOS_NEWSLETTER: readonly TipoNewsletter[] = [
  "novedades",
  "oferta",
  "temporada",
  "trabajos",
  "consejos",
  "aviso",
  "personalizada",
];

export function esTipoNewsletter(v: unknown): v is TipoNewsletter {
  return typeof v === "string" && (TIPOS_NEWSLETTER as readonly string[]).includes(v);
}

/** Una fila de la lista (producto, servicio o trabajo): nombre, línea corta y precio opcional. */
export interface ElementoLista {
  nombre: string;
  descripcion?: string;
  precio?: string;
}

export type Bloque =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagen"; url: string; alt: string; pie?: string }
  | { tipo: "destacado"; titulo?: string; texto: string }
  | { tipo: "lista"; titulo?: string; elementos: ElementoLista[] }
  | { tipo: "datos"; fecha?: string; horario?: string; lugar?: string; precio?: string }
  | { tipo: "boton"; texto: string; url: string }
  | { tipo: "cita"; texto: string; autor?: string }
  | { tipo: "separador" }
  | { tipo: "firma"; texto: string };

export type TipoBloque = Bloque["tipo"];

export const TIPOS_BLOQUE: readonly TipoBloque[] = ["texto", "imagen", "destacado", "lista", "datos", "boton", "cita", "separador", "firma"];

export const NOMBRE_BLOQUE: Record<TipoBloque, string> = {
  texto: "Texto",
  imagen: "Foto",
  destacado: "Caja destacada",
  lista: "Lista de productos o servicios",
  datos: "Fechas y condiciones",
  boton: "Botón",
  cita: "Opinión o cita",
  separador: "Separador",
  firma: "Firma",
};

/** Etiquetas de los campos del bloque «datos» (en el correo y en el editor). */
export const CAMPOS_DATOS = [
  ["fecha", "Fechas"],
  ["horario", "Horario"],
  ["lugar", "Zona"],
  ["precio", "Precio"],
] as const;

// ── Límites ─────────────────────────────────────────────────────────────────

export const LIMITE_TITULO = 150;
export const LIMITE_MENSAJE = 5000;
export const LIMITE_URL = 2000;
export const LIMITE_INSIGNIA = 40;
export const LIMITE_PREHEADER = 150;
export const MAX_BLOQUES = 20;
export const MAX_ELEMENTOS = 12;
export const LIMITE_TEXTO_BLOQUE = 2000;
export const LIMITE_CORTO = 120;
/** Texto total de todos los bloques (un correo más largo no se lee y pesa). */
export const LIMITE_TEXTO_TOTAL = 8000;

/** La web de la cristalería (proyecto cristaleriabv de Vercel). Con dominio propio, cámbiala en Newsletter › Configuración. */
export const URL_WEB = "https://cristaleriabv.vercel.app";
export const URL_PRESUPUESTO = `${URL_WEB}/presupuesto`;
export const URL_TRABAJOS = `${URL_WEB}/trabajos`;
export const URL_SERVICIOS = `${URL_WEB}/servicios`;
export const URL_CONTACTO = `${URL_WEB}/contacto`;

/** Dominios de la web (los mismos que acepta la ingesta de Logs web). Lo único a lo que puede enlazar la IA. */
export const DOMINIOS_PROPIOS = ["cristaleriabv.vercel.app", "cristaleriabaixvinalopo.es"] as const;

// ── URLs ────────────────────────────────────────────────────────────────────

/** Solo URLs https:// bien formadas; cualquier otra cosa (javascript:, data:, http:, basura) se descarta. */
export function urlHttpsSegura(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (!v || v.length > LIMITE_URL) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Enlace de un botón: https:// o tel: (llamar para pedir presupuesto). */
export function urlBotonSegura(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (/^tel:\+?[0-9 ]{6,20}$/.test(v)) return v.replace(/ /g, "");
  return urlHttpsSegura(v);
}

/** ¿Es un enlace a la web de la cristalería (o un teléfono)? Lo único que puede proponer la IA. */
export function esEnlacePropio(url: string, extra: readonly string[] = []): boolean {
  if (url.startsWith("tel:")) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return [...DOMINIOS_PROPIOS, ...extra.map((d) => d.toLowerCase())].some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ── Validación ──────────────────────────────────────────────────────────────

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // Sin caracteres de control (salvo saltos de línea y tabuladores).
  // eslint-disable-next-line no-control-regex
  const limpio = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (limpio.length > max) return null;
  return limpio;
};

const opcional = (v: unknown, max: number): string | undefined | null => {
  if (v === undefined || v === null || v === "") return undefined;
  const t = texto(v, max);
  if (t === null) return null;
  return t || undefined;
};

export type ResultadoBloques = { ok: true; bloques: Bloque[] } | { ok: false; error: string };

/**
 * Valida y limpia una lista de bloques que llega del panel, de la IA o de una
 * plantilla guardada. Devuelve un error en llano (lo lee el equipo) si algo no
 * vale; nunca deja pasar HTML (se escapa al pintar) ni enlaces que no sean
 * https:// o tel:.
 */
export function validarBloques(raw: unknown): ResultadoBloques {
  if (!Array.isArray(raw)) return { ok: false, error: "El diseño del correo no es válido" };
  if (raw.length === 0) return { ok: false, error: "El correo no tiene ningún bloque" };
  if (raw.length > MAX_BLOQUES) return { ok: false, error: `El correo no puede tener más de ${MAX_BLOQUES} bloques` };
  const bloques: Bloque[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (!r || typeof r !== "object" || typeof r.tipo !== "string" || !(TIPOS_BLOQUE as readonly string[]).includes(r.tipo)) {
      return { ok: false, error: `El bloque ${n} no es válido` };
    }
    const nombre = NOMBRE_BLOQUE[r.tipo as TipoBloque].toLowerCase();
    const largo = (campo: string) => ({ ok: false as const, error: `El bloque ${n} (${nombre}): ${campo} es demasiado largo o no es válido` });
    switch (r.tipo as TipoBloque) {
      case "texto":
      case "firma": {
        const t = texto(r.texto, LIMITE_TEXTO_BLOQUE);
        if (t === null) return largo("el texto");
        if (!t) return { ok: false, error: `El bloque ${n} (${nombre}) está vacío` };
        total += t.length;
        bloques.push({ tipo: r.tipo as "texto" | "firma", texto: t });
        break;
      }
      case "imagen": {
        const url = urlHttpsSegura(typeof r.url === "string" ? r.url : null);
        if (!url) return { ok: false, error: `El bloque ${n} (foto) necesita una imagen https:// válida` };
        const alt = texto(r.alt ?? "", LIMITE_CORTO);
        const pie = opcional(r.pie, LIMITE_CORTO);
        if (alt === null) return largo("el texto alternativo");
        if (pie === null) return largo("el pie de foto");
        bloques.push({ tipo: "imagen", url, alt: alt || "Trabajo de Cristalería Baix Vinalopó", ...(pie ? { pie } : {}) });
        break;
      }
      case "destacado": {
        const t = texto(r.texto, LIMITE_TEXTO_BLOQUE);
        const titulo = opcional(r.titulo, LIMITE_CORTO);
        if (t === null) return largo("el texto");
        if (titulo === null) return largo("el título");
        if (!t) return { ok: false, error: `El bloque ${n} (caja destacada) está vacío` };
        total += t.length + (titulo?.length ?? 0);
        bloques.push({ tipo: "destacado", texto: t, ...(titulo ? { titulo } : {}) });
        break;
      }
      case "lista": {
        if (!Array.isArray(r.elementos)) return largo("la lista");
        if (r.elementos.length > MAX_ELEMENTOS) return { ok: false, error: `El bloque ${n} (lista) admite hasta ${MAX_ELEMENTOS} elementos` };
        const titulo = opcional(r.titulo, LIMITE_CORTO);
        if (titulo === null) return largo("el título");
        const elementos: ElementoLista[] = [];
        for (const p of r.elementos as Array<Record<string, unknown> | null>) {
          if (!p || typeof p !== "object") return largo("un elemento");
          const nombreElemento = texto(p.nombre, LIMITE_CORTO);
          const descripcion = opcional(p.descripcion, 300);
          const precio = opcional(p.precio, 30);
          if (nombreElemento === null || descripcion === null || precio === null) return largo("un elemento");
          if (!nombreElemento) continue; // filas vacías del editor: se ignoran
          total += nombreElemento.length + (descripcion?.length ?? 0);
          elementos.push({ nombre: nombreElemento, ...(descripcion ? { descripcion } : {}), ...(precio ? { precio } : {}) });
        }
        if (!elementos.length) return { ok: false, error: `El bloque ${n} (lista) no tiene ningún elemento` };
        bloques.push({ tipo: "lista", elementos, ...(titulo ? { titulo } : {}) });
        break;
      }
      case "datos": {
        const campos = { fecha: opcional(r.fecha, 80), horario: opcional(r.horario, 60), lugar: opcional(r.lugar, LIMITE_CORTO), precio: opcional(r.precio, 60) };
        for (const [k, v] of Object.entries(campos)) if (v === null) return largo(k);
        const limpio = Object.fromEntries(Object.entries(campos).filter(([, v]) => v)) as Record<string, string>;
        if (!Object.keys(limpio).length) return { ok: false, error: `El bloque ${n} (fechas y condiciones) está vacío` };
        bloques.push({ tipo: "datos", ...limpio });
        break;
      }
      case "boton": {
        const t = texto(r.texto, 40);
        if (t === null || !t) return { ok: false, error: `El bloque ${n} (botón) necesita un texto corto` };
        const url = urlBotonSegura(typeof r.url === "string" ? r.url : null);
        if (!url) return { ok: false, error: `El bloque ${n} (botón) necesita un enlace https:// (o tel:) válido` };
        bloques.push({ tipo: "boton", texto: t, url });
        break;
      }
      case "cita": {
        const t = texto(r.texto, 600);
        const autor = opcional(r.autor, 80);
        if (t === null || !t) return { ok: false, error: `El bloque ${n} (opinión o cita) está vacío o es demasiado largo` };
        if (autor === null) return largo("el autor");
        total += t.length;
        bloques.push({ tipo: "cita", texto: t, ...(autor ? { autor } : {}) });
        break;
      }
      case "separador":
        bloques.push({ tipo: "separador" });
        break;
    }
  }
  if (total > LIMITE_TEXTO_TOTAL) return { ok: false, error: `El correo es demasiado largo (máximo ${LIMITE_TEXTO_TOTAL} caracteres de texto)` };
  if (!bloques.some((b) => b.tipo !== "separador")) return { ok: false, error: "El correo no tiene contenido" };
  return { ok: true, bloques };
}

// ── Texto plano (historial, versión de texto y respaldo) ────────────────────

/** Versión de texto del correo: se guarda en el historial (newsletter_envios.mensaje) y va como parte text/plain. */
export function textoPlanoDeBloques(bloques: readonly Bloque[]): string {
  const partes: string[] = [];
  for (const b of bloques) {
    switch (b.tipo) {
      case "texto":
      case "firma":
        partes.push(b.texto);
        break;
      case "destacado":
        partes.push([b.titulo, b.texto].filter(Boolean).join("\n"));
        break;
      case "lista":
        partes.push(
          [b.titulo, ...b.elementos.map((p) => `· ${p.nombre}${p.precio ? ` (${p.precio})` : ""}${p.descripcion ? `: ${p.descripcion}` : ""}`)]
            .filter(Boolean)
            .join("\n"),
        );
        break;
      case "datos":
        partes.push(
          CAMPOS_DATOS.map(([k, etiqueta]) => (b[k] ? `${etiqueta}: ${b[k]}` : ""))
            .filter(Boolean)
            .join("\n"),
        );
        break;
      case "boton":
        partes.push(`${b.texto}: ${b.url}`);
        break;
      case "cita":
        partes.push(`«${b.texto}»${b.autor ? ` — ${b.autor}` : ""}`);
        break;
      case "imagen":
        if (b.pie) partes.push(b.pie);
        break;
      case "separador":
        break;
    }
  }
  return partes.filter((p) => p.trim()).join("\n\n").slice(0, LIMITE_MENSAJE);
}

// ── Catálogo de plantillas ──────────────────────────────────────────────────

export interface PlantillaBase {
  tipo: TipoNewsletter;
  nombre: string;
  descripcion: string;
  /** Etiqueta pequeña sobre el título del correo («Oferta»). */
  insignia: string;
  /** Emoji del asunto (vacío = sin emoji). */
  emoji: string;
  titulo: string;
  preheader: string;
  bloques: Bloque[];
}

export const FIRMA = "Un saludo,\nEl equipo de Cristalería Baix Vinalopó";

/**
 * Plantillas de partida. Los textos son de ejemplo: el equipo los cambia (o la
 * IA los redacta) antes de enviar. Los huecos «[…]» marcan lo que hay que
 * completar: el panel avisa antes de enviar si queda alguno.
 */
export const PLANTILLAS_BASE: readonly PlantillaBase[] = [
  {
    tipo: "novedades",
    nombre: "Novedades",
    descripcion: "Una novedad del taller: un servicio nuevo, un material, un cambio de horario…",
    insignia: "Novedades",
    emoji: "",
    titulo: "Novedades de Cristalería Baix Vinalopó",
    preheader: "Te contamos lo último del taller.",
    bloques: [
      { tipo: "texto", texto: "Hola:\n\nQueremos contarte las últimas novedades de Cristalería Baix Vinalopó." },
      { tipo: "destacado", titulo: "Lo nuevo", texto: "[Cuenta aquí la novedad en dos o tres frases.]" },
      { tipo: "boton", texto: "Calcular mi presupuesto", url: URL_PRESUPUESTO },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "oferta",
    nombre: "Oferta o promoción",
    descripcion: "Un descuento o una promoción para quienes reciben la newsletter",
    insignia: "Oferta",
    emoji: "",
    titulo: "Una oferta especial para ti",
    preheader: "Solo para quienes reciben nuestras novedades.",
    bloques: [
      { tipo: "texto", texto: "Tenemos una propuesta especial preparada para ti." },
      {
        tipo: "lista",
        titulo: "En oferta",
        elementos: [
          { nombre: "[Producto o servicio]", descripcion: "[Qué incluye]", precio: "[precio]" },
          { nombre: "[Producto o servicio]", descripcion: "[Qué incluye]", precio: "[precio]" },
        ],
      },
      { tipo: "datos", fecha: "Hasta el [fecha]", lugar: "Baix Vinalopó" },
      { tipo: "boton", texto: "Pedir presupuesto", url: URL_PRESUPUESTO },
      { tipo: "texto", texto: "Oferta válida hasta la fecha indicada. Medición e instalación según presupuesto." },
    ],
  },
  {
    tipo: "temporada",
    nombre: "Campaña de temporada",
    descripcion: "Cerramientos antes del invierno, mosquiteras en verano, mamparas para renovar el baño…",
    insignia: "Temporada",
    emoji: "",
    titulo: "Prepara tu casa para la nueva temporada",
    preheader: "Es buen momento para hacerlo: te lo explicamos.",
    bloques: [
      { tipo: "texto", texto: "Con el cambio de estación es el mejor momento para [cerrar la terraza / poner mosquiteras / renovar ventanas]." },
      { tipo: "destacado", titulo: "Por qué ahora", texto: "[Una o dos razones: ahorro, confort, plazos de fabricación…]" },
      {
        tipo: "lista",
        titulo: "Lo que hacemos",
        elementos: [
          { nombre: "Cerramientos de aluminio", descripcion: "A medida, con el acabado que elijas" },
          { nombre: "Mosquiteras", descripcion: "Enrollables, correderas o plisadas" },
        ],
      },
      { tipo: "boton", texto: "Calcular mi presupuesto", url: URL_PRESUPUESTO },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "trabajos",
    nombre: "Trabajos recientes",
    descripcion: "Fotos y detalles de los últimos trabajos del taller",
    insignia: "Trabajos recientes",
    emoji: "",
    titulo: "Así han quedado nuestros últimos trabajos",
    preheader: "Mamparas, espejos y cerramientos hechos a medida este mes.",
    bloques: [
      { tipo: "texto", texto: "Estas semanas hemos terminado trabajos de los que estamos muy contentos. Te enseñamos algunos." },
      { tipo: "imagen", url: `${URL_WEB}/brand/icon-512.png`, alt: "Trabajo reciente de Cristalería Baix Vinalopó", pie: "[Qué es y dónde]" },
      { tipo: "cita", texto: "[Opinión del cliente, con su permiso.]", autor: "[Nombre], [población]" },
      { tipo: "boton", texto: "Ver más trabajos", url: URL_TRABAJOS },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "consejos",
    nombre: "Consejos y mantenimiento",
    descripcion: "Cómo limpiar la mampara, cuidar el aluminio, elegir un vidrio…",
    insignia: "Consejos",
    emoji: "",
    titulo: "Un consejo para que tus cristales duren más",
    preheader: "Trucos sencillos del taller para el día a día.",
    bloques: [
      { tipo: "texto", texto: "[Presenta el consejo en una frase.]" },
      {
        tipo: "lista",
        titulo: "Paso a paso",
        elementos: [
          { nombre: "[Primer paso]", descripcion: "[Cómo hacerlo]" },
          { nombre: "[Segundo paso]", descripcion: "[Cómo hacerlo]" },
        ],
      },
      { tipo: "destacado", titulo: "Ojo con", texto: "[Lo que conviene evitar.]" },
      { tipo: "boton", texto: "Consúltanos", url: URL_CONTACTO },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "aviso",
    nombre: "Aviso",
    descripcion: "Vacaciones, cambio de horario, cierre por festivo…",
    insignia: "Aviso",
    emoji: "",
    titulo: "Aviso importante",
    preheader: "Información sobre nuestro horario.",
    bloques: [
      { tipo: "texto", texto: "Te informamos de que [motivo del aviso]." },
      { tipo: "datos", fecha: "[Del … al …]", horario: "[Horario]" },
      { tipo: "texto", texto: "Para cualquier urgencia puedes escribirnos y te contestaremos en cuanto volvamos." },
      { tipo: "firma", texto: FIRMA },
    ],
  },
  {
    tipo: "personalizada",
    nombre: "En blanco",
    descripcion: "Empieza desde cero con tus propios bloques",
    insignia: "Cristalería Baix Vinalopó",
    emoji: "",
    titulo: "",
    preheader: "",
    bloques: [{ tipo: "texto", texto: "" }],
  },
];

export function plantillaBase(tipo: TipoNewsletter): PlantillaBase {
  return PLANTILLAS_BASE.find((p) => p.tipo === tipo) ?? PLANTILLAS_BASE[0];
}

/** Bloques de un envío sin bloques (solo título y mensaje): se pinta con la estética de la plantilla. */
export function bloquesDeMensaje(tipo: TipoNewsletter, mensaje: string, imagenUrl: string | null): Bloque[] {
  const bloques: Bloque[] = [];
  if (imagenUrl) bloques.push({ tipo: "imagen", url: imagenUrl, alt: "Trabajo de Cristalería Baix Vinalopó" });
  bloques.push(tipo === "oferta" ? { tipo: "destacado", titulo: "La oferta", texto: mensaje } : { tipo: "texto", texto: mensaje });
  if (tipo !== "aviso") bloques.push({ tipo: "boton", texto: "Calcular mi presupuesto", url: URL_PRESUPUESTO });
  bloques.push({ tipo: "firma", texto: FIRMA });
  return bloques;
}
