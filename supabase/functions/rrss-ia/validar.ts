/**
 * Validadores de lo que propone la IA de RRSS (lógica pura, probada en __tests__). Como en el panel de referencia
 * (_shared/instagram/validar-ia.ts): lo que se puede arreglar se arregla y se avisa (emojis de más, correos,
 * teléfonos, enlaces, hashtags genéricos o repetidos, longitudes); lo que no, descarta la propuesta con su motivo
 * (precios, ofertas o garantías que no ha dicho la persona, temas de restaurante, datos personales).
 */

export const MAX_GANCHO = 90;
export const MAX_CAPTION = 2000;
export const MAX_ALT = 600;
export const MAX_HASHTAGS_INSTAGRAM = 15;
export const MAX_HASHTAGS_FACEBOOK = 3;

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_TELEFONO = /(?:\+34[\s.-]?)?(?:[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|[6789]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})\b/g;
const RE_URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const RE_EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const RE_PRECIO = /\d+(?:[.,]\d+)?\s?(?:€|euros?\b)|€\s?\d+/i;
const RE_PROMESA = /\b(subvenci[oó]n|financiaci[oó]n|sin intereses|garant[ií]a de \d+|\d+\s?años de garant[ií]a|descuentos?|rebajas?|ofertas?|promoci[oó]n(es)?|2x1|gratis)\b/i;
const RE_RESTAURANTE = /\b(restaurante|carta de|men[uú] del d[ií]a|tapas?|platos? del d[ií]a|reserva(r)? (mesa|tu mesa)|vinos?|c[oó]ctel(es)?|gastronom[ií]a)\b/i;
const RE_TOPICOS = /(calidad inmejorable|los mejores precios|l[ií]deres del sector|experiencia [uú]nica|no te lo pierdas|para todos los gustos|te sorprender[aá]|somos tu mejor opci[oó]n)/i;

const HASHTAGS_GENERICOS = new Set(["#love", "#instagood", "#photooftheday", "#happy", "#follow", "#followme", "#like4like", "#picoftheday", "#instadaily", "#beautiful", "#fashion", "#tbt"]);

/** Quita correos y teléfonos (datos personales) de un texto de la persona antes de mandarlo a la IA o guardarlo. */
export function anonimizar(texto: string): string {
  return (texto ?? "")
    .replace(RE_EMAIL, "[correo]")
    .replace(/\b[0-9]{8}[A-Za-z]\b|\b[XYZxyz][0-9]{7}[A-Za-z]\b/g, "[documento]")
    .replace(/\bES\d{2}(?:\s?\d{4}){5}\b/gi, "[cuenta]")
    .replace(RE_TELEFONO, "[teléfono]")
    .trim();
}

/** Hashtags limpios: con «#», sin espacios, sin genéricos, sin repetir (sin distinguir mayúsculas). */
export function limpiarHashtags(lista: unknown, max: number, avisos: string[]): string[] {
  const salida: string[] = [];
  const vistos = new Set<string>();
  let genericos = 0;
  for (const h of Array.isArray(lista) ? lista : []) {
    if (typeof h !== "string") continue;
    const limpio = `#${h.trim().replace(/^#+/, "").replace(/[\s#.,;:!?¡¿"'()]+/g, "")}`.slice(0, 60);
    if (limpio.length < 3) continue;
    const clave = limpio.toLocaleLowerCase("es");
    if (HASHTAGS_GENERICOS.has(clave)) {
      genericos++;
      continue;
    }
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  if (genericos) avisos.push(`Se han quitado ${genericos} hashtag(s) genérico(s).`);
  if (salida.length > max) {
    avisos.push(`Se han dejado ${max} hashtags (como mucho).`);
    return salida.slice(0, max);
  }
  return salida;
}

/** Recorta en la última frase o palabra completa. */
export function recortar(texto: string, max: number): string {
  const t = texto.trim();
  if (Array.from(t).length <= max) return t;
  const corto = Array.from(t).slice(0, max).join("");
  const fin = Math.max(corto.lastIndexOf(". "), corto.lastIndexOf("\n"));
  if (fin > max * 0.6) return corto.slice(0, fin + 1).trim();
  const esp = corto.lastIndexOf(" ");
  return `${(esp > max * 0.6 ? corto.slice(0, esp) : corto).trim()}…`;
}

export interface OpcionesTexto {
  /** Lo que dijo la persona: lo que aparezca aquí (precios, ofertas) sí se puede usar. */
  fuente: string;
  emojis: boolean;
  palabrasEvitar?: readonly string[];
}

/** Arregla un texto (emojis, correos, teléfonos, enlaces) y devuelve los motivos por los que no vale (vacío = vale). */
export function revisarTexto(texto: string, o: OpcionesTexto, avisos: string[]): { texto: string; motivos: string[] } {
  let t = String(texto ?? "");
  const motivos: string[] = [];
  if (RE_EMAIL.test(t) || RE_TELEFONO.test(t)) {
    t = t.replace(RE_EMAIL, "").replace(RE_TELEFONO, "");
    avisos.push("Se han quitado correos o teléfonos del texto.");
  }
  RE_EMAIL.lastIndex = 0;
  RE_TELEFONO.lastIndex = 0;
  if (RE_URL.test(t)) {
    t = t.replace(RE_URL, "");
    avisos.push("Se han quitado los enlaces (en Instagram no se pueden pulsar).");
  }
  RE_URL.lastIndex = 0;
  const emojis = t.match(RE_EMOJI) ?? [];
  if (!o.emojis && emojis.length) {
    t = t.replace(RE_EMOJI, "");
    avisos.push("Se han quitado los emojis (están desactivados en el estilo).");
  } else if (emojis.length > 2) {
    let n = 0;
    t = t.replace(RE_EMOJI, (m) => (++n <= 2 ? m : ""));
    avisos.push("Se han dejado dos emojis como mucho.");
  }
  t = t.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  const fuente = (o.fuente ?? "").toLocaleLowerCase("es");
  const precio = RE_PRECIO.exec(t);
  if (precio && !fuente.includes(precio[0].toLocaleLowerCase("es").replace(/\s/g, "")) && !fuente.includes(precio[0].toLocaleLowerCase("es"))) {
    motivos.push(`Precio que no ha dicho nadie (${precio[0]}).`);
  }
  const promesa = RE_PROMESA.exec(t);
  if (promesa && !fuente.includes(promesa[0].toLocaleLowerCase("es"))) motivos.push(`Promete algo que no ha dicho nadie («${promesa[0]}»).`);
  const restaurante = RE_RESTAURANTE.exec(t);
  if (restaurante) motivos.push(`Habla de algo que no es de una cristalería («${restaurante[0]}»).`);
  const topico = RE_TOPICOS.exec(t);
  if (topico) motivos.push(`Usa un tópico prohibido («${topico[0]}»).`);
  for (const p of o.palabrasEvitar ?? []) {
    const limpia = p.trim().toLocaleLowerCase("es");
    if (limpia && t.toLocaleLowerCase("es").includes(limpia)) motivos.push(`Usa una palabra a evitar («${p.trim()}»).`);
  }
  return { texto: t, motivos };
}

export interface VarianteTexto {
  enfoque: "trabajo" | "problema" | "consejo";
  gancho: string;
  caption: string;
  hashtags: string[];
  altText: string;
  avisos: string[];
}

/** Normaliza las variantes de «textos». Devuelve las que valen y las descartadas con su motivo. */
export function normalizarTextos(
  datos: unknown,
  o: OpcionesTexto & { red: "instagram" | "facebook" },
): { variantes: VarianteTexto[]; descartadas: Array<{ motivos: string[] }> } {
  const lista = (datos && typeof datos === "object" && Array.isArray((datos as { variantes?: unknown }).variantes)
    ? (datos as { variantes: unknown[] }).variantes : []).slice(0, 3);
  const variantes: VarianteTexto[] = [];
  const descartadas: Array<{ motivos: string[] }> = [];
  for (const v of lista) {
    const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const avisos: string[] = [];
    const cap = revisarTexto(String(x.caption ?? ""), o, avisos);
    const gan = revisarTexto(String(x.gancho ?? ""), { ...o, emojis: false }, []);
    const motivos = [...cap.motivos];
    let caption = cap.texto;
    if (Array.from(caption).length > MAX_CAPTION) {
      caption = recortar(caption, MAX_CAPTION);
      avisos.push("El texto era demasiado largo y se ha recortado.");
    }
    if (caption.length < 20) motivos.push("El texto está vacío o es demasiado corto.");
    if (motivos.length) {
      descartadas.push({ motivos: [...new Set(motivos)] });
      continue;
    }
    // El texto lleva los hashtags aparte: si la IA los metió dentro, se sacan.
    const dentro = caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? [];
    if (dentro.length) caption = caption.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").replace(/[ \t]{2,}/g, " ").trim();
    const hashtags = limpiarHashtags([...(Array.isArray(x.hashtags) ? x.hashtags : []), ...dentro.map((h) => h.trim())],
      o.red === "facebook" ? MAX_HASHTAGS_FACEBOOK : MAX_HASHTAGS_INSTAGRAM, avisos);
    const enfoque = x.enfoque === "problema" || x.enfoque === "consejo" ? x.enfoque : "trabajo";
    variantes.push({
      enfoque,
      gancho: recortar(gan.texto || caption.split("\n")[0], MAX_GANCHO),
      caption,
      hashtags,
      altText: recortar(revisarTexto(String(x.alt_text ?? ""), { ...o, emojis: false }, []).texto, MAX_ALT),
      avisos: [...new Set(avisos)],
    });
  }
  return { variantes, descartadas };
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATOS = new Set(["foto", "carrusel", "reel", "story"]);
const SERVICIOS = new Set(["mamparas", "espejos", "cerramientos", "aluminio", "barandillas", "armarios", "domino", "otros"]);

export interface Idea {
  fecha: string;
  titulo: string;
  idea: string;
  formato: string;
  servicio: string;
  gancho: string;
  comoGrabarlo: string;
  motivo: string;
}

/** Normaliza las ideas de la semana: fechas dentro del rango, formatos y servicios conocidos, textos revisados. */
export function normalizarIdeas(datos: unknown, o: OpcionesTexto & { desde: string; hasta: string }): { ideas: Idea[]; descartadas: Array<{ motivos: string[] }> } {
  const lista = (datos && typeof datos === "object" && Array.isArray((datos as { ideas?: unknown }).ideas) ? (datos as { ideas: unknown[] }).ideas : []).slice(0, 7);
  const ideas: Idea[] = [];
  const descartadas: Array<{ motivos: string[] }> = [];
  for (const v of lista) {
    const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const motivos: string[] = [];
    const campos = ["titulo", "idea", "gancho", "como_grabarlo", "motivo"].map((k) => revisarTexto(String(x[k] ?? ""), { ...o, emojis: false }, []));
    for (const c of campos) motivos.push(...c.motivos);
    const fecha = typeof x.fecha === "string" && RE_FECHA.test(x.fecha) && x.fecha >= o.desde && x.fecha <= o.hasta ? x.fecha : null;
    if (!fecha) motivos.push("Fecha fuera de la semana.");
    if (!campos[1].texto) motivos.push("Sin idea.");
    if (motivos.length) {
      descartadas.push({ motivos: [...new Set(motivos)] });
      continue;
    }
    ideas.push({
      fecha: fecha as string,
      titulo: recortar(campos[0].texto, 100),
      idea: recortar(campos[1].texto, 500),
      formato: FORMATOS.has(String(x.formato)) ? String(x.formato) : "foto",
      servicio: SERVICIOS.has(String(x.servicio)) ? String(x.servicio) : "otros",
      gancho: recortar(campos[2].texto, MAX_GANCHO),
      comoGrabarlo: recortar(campos[3].texto, 700),
      motivo: recortar(campos[4].texto, 300),
    });
  }
  ideas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { ideas, descartadas };
}

export interface PiezaCampana {
  fecha: string;
  hora: string;
  formato: string;
  servicio: string;
  titulo: string;
  idea: string;
  caption: string;
  hashtags: string[];
  porQue: string;
  fase: string;
}

export interface Campana {
  titulo: string;
  objetivo: string;
  publico: string;
  mensaje: string;
  razonamiento: string;
  fases: Array<{ nombre: string; desde: string; hasta: string; objetivo: string }>;
  piezas: PiezaCampana[];
}

/** Normaliza una campaña: piezas dentro de las fechas, textos revisados; las que no valen se descartan. */
export function normalizarCampana(datos: unknown, o: OpcionesTexto & { desde: string; hasta: string; maxPiezas: number }): { campana: Campana | null; descartadas: Array<{ donde: string; motivos: string[] }>; avisos: string[] } {
  const x = (datos && typeof datos === "object" ? datos : {}) as Record<string, unknown>;
  const avisos: string[] = [];
  const descartadas: Array<{ donde: string; motivos: string[] }> = [];
  const general = ["titulo", "objetivo", "publico", "mensaje", "razonamiento"].map((k) => revisarTexto(String(x[k] ?? ""), { ...o, emojis: false }, []));
  const motivosGenerales = general.flatMap((g) => g.motivos);
  if (motivosGenerales.length || !general[0].texto) {
    descartadas.push({ donde: "campaña", motivos: motivosGenerales.length ? [...new Set(motivosGenerales)] : ["Sin título."] });
    return { campana: null, descartadas, avisos };
  }
  const fases = (Array.isArray(x.fases) ? x.fases : []).slice(0, 4).map((f) => {
    const y = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    return {
      nombre: recortar(String(y.nombre ?? ""), 80),
      desde: typeof y.desde === "string" && RE_FECHA.test(y.desde) ? y.desde : o.desde,
      hasta: typeof y.hasta === "string" && RE_FECHA.test(y.hasta) ? y.hasta : o.hasta,
      objetivo: recortar(revisarTexto(String(y.objetivo ?? ""), { ...o, emojis: false }, []).texto, 300),
    };
  }).filter((f) => f.nombre);
  const piezas: PiezaCampana[] = [];
  (Array.isArray(x.piezas) ? x.piezas : []).forEach((p, i) => {
    const y = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const av: string[] = [];
    const formato = FORMATOS.has(String(y.formato)) ? String(y.formato) : "foto";
    const cap = revisarTexto(String(y.caption ?? ""), o, av);
    const idea = revisarTexto(String(y.idea ?? ""), { ...o, emojis: false }, []);
    const motivos = [...cap.motivos, ...idea.motivos];
    const fecha = typeof y.fecha === "string" && RE_FECHA.test(y.fecha) && y.fecha >= o.desde && y.fecha <= o.hasta ? y.fecha : null;
    if (!fecha) motivos.push("Fecha fuera de la campaña.");
    if (motivos.length) {
      descartadas.push({ donde: `pieza ${i + 1}`, motivos: [...new Set(motivos)] });
      return;
    }
    avisos.push(...av);
    piezas.push({
      fecha: fecha as string,
      hora: typeof y.hora === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(y.hora) ? y.hora : "13:00",
      formato,
      servicio: SERVICIOS.has(String(y.servicio)) ? String(y.servicio) : "otros",
      titulo: recortar(revisarTexto(String(y.titulo ?? ""), { ...o, emojis: false }, []).texto || `Publicación ${i + 1}`, 100),
      idea: recortar(idea.texto, 500),
      caption: formato === "story" ? "" : recortar(cap.texto.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").trim(), MAX_CAPTION),
      hashtags: formato === "story" ? [] : limpiarHashtags(y.hashtags, MAX_HASHTAGS_INSTAGRAM, av),
      porQue: recortar(revisarTexto(String(y.porQue ?? ""), { ...o, emojis: false }, []).texto, 300),
      fase: recortar(String(y.fase ?? ""), 80),
    });
  });
  if (piezas.length > o.maxPiezas) avisos.push(`Se han dejado ${o.maxPiezas} piezas.`);
  const campana: Campana = {
    titulo: recortar(general[0].texto, 150),
    objetivo: recortar(general[1].texto, 500),
    publico: recortar(general[2].texto, 300),
    mensaje: recortar(general[3].texto, 300),
    razonamiento: recortar(general[4].texto, 800),
    fases,
    piezas: piezas.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`)).slice(0, o.maxPiezas),
  };
  return { campana: campana.piezas.length ? campana : null, descartadas, avisos: [...new Set(avisos)] };
}

export interface PropuestaEstilo {
  resumen: string;
  cambios: string[];
  guia: string;
  hashtagsBase: string[];
  ctas: string[];
  palabrasEvitar: string[];
}

/** Normaliza la propuesta de «aprender»: lo que cabe en rrss_ajustes (guía ≤ 4000, ≤ 15 hashtags, ≤ 8 CTA…). */
export function normalizarAprender(datos: unknown, o: OpcionesTexto): { propuesta: PropuestaEstilo | null; motivos: string[] } {
  const x = (datos && typeof datos === "object" ? datos : {}) as Record<string, unknown>;
  const guia = revisarTexto(String(x.guia ?? ""), { ...o, emojis: false, palabrasEvitar: [] }, []);
  const resumen = revisarTexto(String(x.resumen ?? ""), { ...o, emojis: false, palabrasEvitar: [] }, []);
  const motivos = [...guia.motivos, ...resumen.motivos];
  if (guia.texto.length < 40) motivos.push("La guía propuesta está vacía o es demasiado corta.");
  if (motivos.length) return { propuesta: null, motivos: [...new Set(motivos)] };
  const textos = (v: unknown, max: number, largo: number) =>
    [...new Set((Array.isArray(v) ? v : []).filter((t): t is string => typeof t === "string").map((t) => recortar(t.replace(RE_EMOJI, ""), largo)).filter((t) => t.length > 0))].slice(0, max);
  return {
    propuesta: {
      resumen: recortar(resumen.texto, 1500),
      cambios: textos(x.cambios, 6, 300),
      guia: recortar(guia.texto, 4000),
      hashtagsBase: limpiarHashtags(x.hashtags_base, 12, []),
      ctas: textos(x.ctas, 5, 120),
      palabrasEvitar: textos(x.palabras_evitar, 20, 60),
    },
    motivos: [],
  };
}
