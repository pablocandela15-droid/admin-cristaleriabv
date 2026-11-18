// ============================================================================
//  avisos-telegram · lógica pura (sin Deno ni red), probada con vitest en
//  supabase/functions/avisos-telegram/__tests__/logica.test.ts
// ============================================================================

/** Límite de Telegram para el texto de sendMessage. */
export const LIMITE_TELEGRAM = 4096;
/** Tras estos fallos, un aviso ya no se reintenta al momento (sale igual en el resumen). */
export const MAX_FALLOS = 3;
/** Frases por tipo en el resumen. */
export const FRASES_POR_TIPO = 4;
/** Tope de avisos «al momento» por hora y por día (configurable: tope_hora y tope_dia). El resto, en el panel. */
export const TOPE_HORA = 10;
export const TOPE_DIA = 30;
export const TEXTO_PRUEBA = "Prueba de avisos de Cristalería BV";
export const SIN_CONFIGURAR = "Telegram sin configurar";
export const ZONA = "Europe/Madrid";
/** Nombre del negocio en la cabecera del resumen. */
export const NOMBRE_NEGOCIO = "Cristalería BV";

export interface ConfigTelegram {
  activo: boolean;
  chat_id: string | null;
  hora_resumen: number;
  tipos_al_momento: string[];
  silencio_activo: boolean;
  silencio_desde: number;
  silencio_hasta: number;
  activo_desde: string | null;
  resumen_ultimo_dia: string | null;
  tope_hora?: number;
  tope_dia?: number;
}

export interface Aviso {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  referencia_tipo: string | null;
  referencia_id?: string | null;
  created_at: string;
  caduca_en?: string | null;
  datos?: Record<string, unknown> | null;
}

export interface Envio {
  aviso_id: string | null;
  ok: boolean;
}

/** Nombre de cada tipo de aviso (mismas etiquetas que src/lib/avisos.ts). */
export const ETIQUETA_TIPO: Record<string, string> = {
  peticion_urgente: "Peticiones urgentes",
  sistema: "Sistema",
};

export const etiquetaTipo = (tipo: string): string => ETIQUETA_TIPO[tipo] ?? tipo.replace(/_/g, " ");

/** Tipos que nunca van a Telegram: los técnicos de super admin (modelos de IA). */
export const tipoExcluido = (tipo: string): boolean => tipo.startsWith("ia_modelo");

/** Hora (0–23) en Madrid. */
export function horaMadrid(fecha: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hourCycle: "h23" }).format(fecha);
  return Number(h) % 24;
}

/** Día (AAAA-MM-DD) en Madrid. */
export function diaMadrid(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

/** ¿Es hora de silencio? desde = hasta → nunca. Igual que avisos_telegram_en_silencio (SQL). */
export function enSilencio(hora: number, desde: number, hasta: number): boolean {
  if (desde === hasta) return false;
  if (desde > hasta) return hora >= desde || hora < hasta;
  return hora >= desde && hora < hasta;
}

export function silencioAhora(cfg: Pick<ConfigTelegram, "silencio_activo" | "silencio_desde" | "silencio_hasta">, ahora: Date): boolean {
  return cfg.silencio_activo && enSilencio(horaMadrid(ahora), cfg.silencio_desde, cfg.silencio_hasta);
}

const campanaApagada = (a: Aviso): boolean => a.datos?.campana === false;

/**
 * Avisos que hay que mandar al momento: tipo marcado, de las últimas 24 h y posteriores a la activación, sin
 * caducar, no excluidos, con campana, sin envío correcto y con menos de MAX_FALLOS fallos. Orden: más antiguo
 * primero. Misma regla que avisos_telegram_hay_pendientes (SQL).
 */
export function pendientesDeEnvio(
  avisos: Aviso[], envios: Envio[], cfg: Pick<ConfigTelegram, "tipos_al_momento" | "activo_desde">, ahora: Date,
): Aviso[] {
  const desde = Math.max(ahora.getTime() - 24 * 3600_000, cfg.activo_desde ? Date.parse(cfg.activo_desde) : ahora.getTime());
  const enviados = new Set<string>();
  const fallos = new Map<string, number>();
  for (const e of envios) {
    if (!e.aviso_id) continue;
    if (e.ok) enviados.add(e.aviso_id);
    else fallos.set(e.aviso_id, (fallos.get(e.aviso_id) ?? 0) + 1);
  }
  return avisos
    .filter((a) => cfg.tipos_al_momento.includes(a.tipo))
    .filter((a) => Date.parse(a.created_at) > desde)
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo) && !campanaApagada(a))
    .filter((a) => !enviados.has(a.id) && (fallos.get(a.id) ?? 0) < MAX_FALLOS)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/**
 * Topes contra la inundación: a lo sumo `topes.hora` avisos por hora y `topes.dia` por día (contando lo ya
 * mandado). Lo que sobra no se manda suelto: va en una línea «…y N más, en el panel».
 */
export function aplicarTopes<T>(lista: T[], usados: { hora: number; dia: number }, topes: { hora: number; dia: number }): { enviar: T[]; resto: T[] } {
  const libres = Math.max(0, Math.min(topes.hora - usados.hora, topes.dia - usados.dia));
  return { enviar: lista.slice(0, libres), resto: lista.slice(libres) };
}

/** Línea para los avisos que no caben por el tope. */
export function notaTope(restantes: number, panelUrl?: string | null): string {
  const url = enlacePanel(panelUrl, "/avisos");
  return `…y ${restantes} ${restantes === 1 ? "aviso más" : "avisos más"} (hay demasiados seguidos: el resto, en el panel).${url ? `
Ver: ${url}` : ""}`;
}

/** Recorta a `max` caracteres (contando como Telegram, en UTF-16) con «…» al final. */
export function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

const limpio = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

// ─── Plantillas cortas (14/11/2026) ─────────────────────────────────────────
//  Todos los avisos concisos y claros: 2-4 líneas. Cada aviso suelto sale así:
//    1. Título (qué es)
//    2. Qué ha pasado (una frase)
//    3. Qué hacer
//    4. Enlace al panel
//  El resumen diario usa solo la línea 2 de cada aviso.

/** Largo máximo de la línea «qué ha pasado». */
export const MAX_FRASE = 220;

/** Primera frase de un texto (hasta el primer «. » seguido de mayúscula), recortada a `max`. */
export function primeraFrase(texto: string, max = MAX_FRASE): string {
  const t = limpio(texto);
  // Corta en «. » + Mayúscula que no abre una palabra en MAYÚSCULAS (no ante un nombre en MAYÚSCULAS).
  const m = t.match(/^(.+?[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«](?![A-ZÁÉÍÓÚÑ]{2}))/);
  return recortar(m ? m[1] : t, max);
}

/** Línea 2: qué ha pasado (una frase corta). También es la frase del resumen. */
export function fraseAviso(a: Aviso): string {
  const tg = limpio(a.datos?.texto_telegram);
  if (tg) return primeraFrase(tg);
  const titulo = limpio(a.titulo);
  const mensaje = limpio(a.mensaje);
  if (mensaje && mensaje !== titulo) return primeraFrase(mensaje);
  return recortar(titulo || etiquetaTipo(a.tipo), MAX_FRASE);
}

/** Línea 3: qué hacer, por tipo (null si no hay nada que hacer). */
const QUE_HACER: Record<string, string> = {
  peticion_urgente: "míralo en Super Admin › Tickets.",
};

export function queHacer(a: Aviso): string | null {
  return QUE_HACER[a.tipo] ?? null;
}

/** Ruta del panel para un aviso (subconjunto de rutaDeAviso en src/lib/avisos.ts). */
export function rutaPanel(a: Pick<Aviso, "tipo" | "referencia_tipo" | "referencia_id" | "datos">): string {
  if (a.referencia_tipo === "peticion") {
    return a.referencia_id ? `/super-admin/tickets?ticket=${encodeURIComponent(a.referencia_id)}` : "/super-admin/tickets";
  }
  const enlace = typeof a.datos?.enlace === "string" ? a.datos.enlace : null;
  if (enlace && enlace.startsWith("/")) return enlace;
  return "/avisos";
}

/** URL absoluta del panel, o null si no hay PANEL_URL válida. */
export function enlacePanel(base: string | null | undefined, ruta: string): string | null {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/i.test(b)) return null;
  return `${b}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;
}

/** Línea 1: el título del aviso (corto). */
export function tituloAviso(a: Aviso): string {
  return recortar(limpio(a.titulo) || etiquetaTipo(a.tipo), 90);
}

/** Texto de un aviso suelto (al momento): 2-4 líneas (título, qué ha pasado, qué hacer y enlace). */
export function mensajeAviso(a: Aviso, panelUrl?: string | null): string {
  const url = enlacePanel(panelUrl, rutaPanel(a));
  const pie = url ? `\nVer: ${url}` : "";
  const titulo = tituloAviso(a);
  const frase = fraseAviso(a);
  const hacer = queHacer(a);
  const lineas = [titulo, ...(frase && frase !== titulo ? [frase] : []), ...(hacer ? [`Qué hacer: ${hacer}`] : [])];
  return recortar(lineas.join("\n"), LIMITE_TELEGRAM - pie.length) + pie;
}

/**
 * Agrupa textos en mensajes de hasta `max` caracteres, separados por una línea en blanco.
 * Devuelve qué índices van en cada mensaje (para registrar cada aviso con su envío).
 */
export function agruparEnMensajes(textos: string[], max = LIMITE_TELEGRAM): { texto: string; indices: number[] }[] {
  const salida: { texto: string; indices: number[] }[] = [];
  for (let i = 0; i < textos.length; i++) {
    const t = recortar(textos[i], max);
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.texto.length + 2 + t.length <= max) {
      ultimo.texto += `\n\n${t}`;
      ultimo.indices.push(i);
    } else {
      salida.push({ texto: t, indices: [i] });
    }
  }
  return salida;
}

/** Fecha corta «martes 11/11» en Madrid. */
function fechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, weekday: "long", day: "2-digit", month: "2-digit" }).format(fecha).replace(",", "");
}

export interface Resumen {
  /** Vacío si no hay nada que contar: entonces no se manda mensaje. */
  texto: string;
  total: number;
}

/**
 * Resumen diario: avisos de las últimas 24 h (sin los excluidos, caducados ni con la campana apagada),
 * agrupados por tipo (más numeroso primero), con el número y hasta FRASES_POR_TIPO frases (las más
 * recientes). Nunca pasa de LIMITE_TELEGRAM: si no cabe, corta por grupos y lo dice. Sin nada que contar,
 * `texto` va vacío (no se manda «sin avisos»).
 */
export function construirResumen(avisos: Aviso[], ahora: Date, panelUrl?: string | null): Resumen {
  const desde = ahora.getTime() - 24 * 3600_000;
  const validos = avisos
    .filter((a) => Date.parse(a.created_at) > desde && Date.parse(a.created_at) <= ahora.getTime())
    .filter((a) => !tipoExcluido(a.tipo) && !campanaApagada(a))
    .filter((a) => !a.caduca_en || Date.parse(a.caduca_en) > ahora.getTime())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const url = enlacePanel(panelUrl, "/avisos");
  const pie = url ? `\n\nVer todo: ${url}` : "";
  if (validos.length === 0) return { texto: "", total: 0 };
  const cabecera = `Avisos de ${NOMBRE_NEGOCIO} · ${fechaCorta(ahora)}`;
  const grupos = new Map<string, Aviso[]>();
  for (const a of validos) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const ordenados = [...grupos.entries()].sort((x, y) => y[1].length - x[1].length || etiquetaTipo(x[0]).localeCompare(etiquetaTipo(y[0]), "es"));

  let cuerpo = `${cabecera}\nÚltimas 24 h: ${validos.length} ${validos.length === 1 ? "aviso" : "avisos"}.`;
  const avisoCorte = "\n\n(No cabe todo: el resto, en el panel.)";
  for (let g = 0; g < ordenados.length; g++) {
    const [tipo, lista] = ordenados[g];
    const frases = lista.slice(0, FRASES_POR_TIPO).map((a) => `• ${fraseAviso(a)}`);
    const resto = lista.length - frases.length;
    const bloque = `\n\n${etiquetaTipo(tipo)} (${lista.length})\n${frases.join("\n")}${resto > 0 ? `\n…y ${resto} más.` : ""}`;
    const reserva = (g < ordenados.length - 1 ? avisoCorte.length : 0) + pie.length;
    if (cuerpo.length + bloque.length + reserva > LIMITE_TELEGRAM) {
      // Si ni el primer grupo cabe entero, va recortado; si no, se corta aquí.
      if (g === 0) cuerpo = recortar(cuerpo + bloque, LIMITE_TELEGRAM - avisoCorte.length - pie.length);
      cuerpo += avisoCorte;
      break;
    }
    cuerpo += bloque;
  }
  return { texto: recortar(cuerpo + pie, LIMITE_TELEGRAM), total: validos.length };
}

/** Quita el token de cualquier texto de error (la URL de la API lo lleva). */
export function errorSaneado(texto: string): string {
  return texto.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot…").slice(0, 300);
}

/** Cuerpo de sendMessage: texto plano (sin parse_mode, no hay nada que escapar) y sin vista previa. */
export function cuerpoSendMessage(chatId: string, texto: string): Record<string, unknown> {
  return { chat_id: chatId, text: recortar(texto, LIMITE_TELEGRAM), link_preview_options: { is_disabled: true } };
}

export type Accion = "pendientes" | "resumen" | "probar" | "fallos";
export const esAccion = (v: unknown): v is Accion => v === "pendientes" || v === "resumen" || v === "probar" || v === "fallos";
