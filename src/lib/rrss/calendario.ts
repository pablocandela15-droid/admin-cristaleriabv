/**
 * RRSS · lógica pura de la programación y del calendario (sin React ni Supabase, se prueba sola), portada del panel
 * de referencia (instagram/programar/logica.ts): hora de Madrid ↔ instante, validación de la fecha (las mismas
 * reglas que las RPC de 20261125100000_rrss), aviso de ±30 min en la misma red y rejilla del calendario.
 *
 * Las fechas de calendario («día») son cadenas "AAAA-MM-DD" del calendario de
 * Madrid; los instantes, ISO en UTC. Todo pasa por Intl con la zona
 * Europe/Madrid, así que da igual en qué zona esté el dispositivo.
 */

export const ZONA_HORARIA = "Europe/Madrid";
export const MARGEN_MINIMO_MIN = 10;
export const MAXIMO_DIAS = 75;
export const VENTANA_CONFLICTO_MIN = 30;

export type EstadoProgramacion = "programada" | "publicando" | "publicada" | "error" | "cancelada";
export type VistaCalendario = "semana" | "mes";

const MS_MIN = 60_000;
const MS_DIA = 86_400_000;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(\d{2}):(\d{2})$/;

const formateador = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dos = (n: number) => String(n).padStart(2, "0");

/** Fecha ("AAAA-MM-DD") y hora ("HH:mm") de Madrid de un instante. */
export function utcAMadrid(instante: Date | string | number): { fecha: string; hora: string } {
  const d = instante instanceof Date ? instante : new Date(instante);
  const p: Record<string, string> = {};
  for (const parte of formateador.formatToParts(d)) p[parte.type] = parte.value;
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/** Desfase de Madrid respecto a UTC en ese instante, en minutos (60 o 120). */
function desfaseMin(ms: number): number {
  const { fecha, hora } = utcAMadrid(ms);
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  return Math.round((Date.UTC(y, m - 1, d, h, mi) - Math.floor(ms / MS_MIN) * MS_MIN) / MS_MIN);
}

/**
 * Instante de una fecha y hora de Madrid. null si el formato no vale o si esa
 * hora no existe (el salto de las 02:00 a las 03:00 de finales de marzo). En
 * la hora repetida de finales de octubre se toma la primera (horario de verano).
 */
export function madridAUtc(fecha: string, hora: string): Date | null {
  const f = FECHA.exec(fecha);
  const h = HORA.exec(hora);
  if (!f || !h) return null;
  const [y, m, d, hh, mm] = [Number(f[1]), Number(f[2]), Number(f[3]), Number(h[1]), Number(h[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const pared = Date.UTC(y, m - 1, d, hh, mm);
  const candidatos = new Set([desfaseMin(pared - 3 * 3_600_000), desfaseMin(pared + 3 * 3_600_000), desfaseMin(pared)]);
  const validos = [...candidatos]
    .map((off) => pared - off * MS_MIN)
    .filter((t) => {
      const v = utcAMadrid(t);
      return v.fecha === fecha && v.hora === hora;
    })
    .sort((a, b) => a - b);
  return validos.length ? new Date(validos[0]) : null;
}

export type ResultadoValidacion = { ok: true; instante: Date } | { ok: false; error: string };

/** Valida la fecha y hora (de Madrid) elegidas: ≥ ahora + 10 min y ≤ ahora + 75 días. */
export function validarProgramacion(fecha: string, hora: string, ahora: Date = new Date()): ResultadoValidacion {
  if (!fecha || !hora) return { ok: false, error: "Elige la fecha y la hora" };
  const instante = madridAUtc(fecha, hora);
  if (!instante) {
    return FECHA.test(fecha) && HORA.test(hora)
      ? { ok: false, error: "Esa hora no existe en Madrid (es el cambio de hora); elige otra" }
      : { ok: false, error: "La fecha o la hora no son válidas" };
  }
  if (instante.getTime() <= ahora.getTime()) return { ok: false, error: "Esa fecha ya ha pasado" };
  if (instante.getTime() < ahora.getTime() + MARGEN_MINIMO_MIN * MS_MIN) {
    return { ok: false, error: `Hay que programarla con al menos ${MARGEN_MINIMO_MIN} minutos de margen` };
  }
  if (instante.getTime() > ahora.getTime() + MAXIMO_DIAS * MS_DIA) {
    return { ok: false, error: `Como mucho se puede programar a ${MAXIMO_DIAS} días vista` };
  }
  return { ok: true, instante };
}

export interface ProgramacionBasica {
  id: string;
  pieza_id: string;
  red: string;
  programada_para: string;
  estado: EstadoProgramacion | string;
}

/** Otras programaciones activas de la misma red a ±30 min (sin contar la propia pieza). */
export function conflictosCercanos<T extends ProgramacionBasica>(lista: readonly T[], red: string, instante: Date, piezaId: string | null): T[] {
  const t = instante.getTime();
  return lista.filter(
    (p) =>
      p.red === red &&
      (p.estado === "programada" || p.estado === "publicando") &&
      p.pieza_id !== piezaId &&
      Math.abs(new Date(p.programada_para).getTime() - t) <= VENTANA_CONFLICTO_MIN * MS_MIN,
  );
}

// ─── Calendario ─────────────────────────────────────────────────────────────

function aMs(dia: string): number {
  const [y, m, d] = dia.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function deMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

export function sumarDias(dia: string, n: number): string {
  return deMs(aMs(dia) + n * MS_DIA);
}

/** Día de la semana empezando en lunes (0 = lunes … 6 = domingo). */
export function diaSemana(dia: string): number {
  return (new Date(aMs(dia)).getUTCDay() + 6) % 7;
}

export function hoyMadrid(ahora: Date = new Date()): string {
  return utcAMadrid(ahora).fecha;
}

export function inicioSemana(dia: string): string {
  return sumarDias(dia, -diaSemana(dia));
}

/** Los 7 días (lunes a domingo) de la semana de `dia`. */
export function diasSemana(dia: string): string[] {
  const lunes = inicioSemana(dia);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** 6 semanas (42 días) desde el lunes de la semana del día 1 del mes de `dia`. */
export function diasMes(dia: string): string[] {
  const lunes = inicioSemana(`${dia.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => sumarDias(lunes, i));
}

export function diasVista(vista: VistaCalendario, dia: string): string[] {
  return vista === "semana" ? diasSemana(dia) : diasMes(dia);
}

/** Rango de instantes [desde, hasta) que cubre la vista (de medianoche a medianoche de Madrid). */
export function rangoVista(vista: VistaCalendario, dia: string): { desde: Date; hasta: Date } {
  const dias = diasVista(vista, dia);
  return {
    desde: madridAUtc(dias[0], "00:00") as Date,
    hasta: madridAUtc(sumarDias(dias[dias.length - 1], 1), "00:00") as Date,
  };
}

/** Día de referencia tras avanzar (+1) o retroceder (−1) una semana o un mes. */
export function moverVista(vista: VistaCalendario, dia: string, paso: number): string {
  if (vista === "semana") return sumarDias(dia, 7 * paso);
  const [y, m] = dia.split("-").map(Number);
  const total = y * 12 + (m - 1) + paso;
  return `${Math.floor(total / 12)}-${dos((total % 12) + 1)}-01`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export function tituloVista(vista: VistaCalendario, dia: string): string {
  if (vista === "mes") {
    const [y, m] = dia.split("-").map(Number);
    return `${MESES[m - 1]} de ${y}`;
  }
  const dias = diasSemana(dia);
  const [y1, m1, d1] = dias[0].split("-").map(Number);
  const [y2, m2, d2] = dias[6].split("-").map(Number);
  if (y1 !== y2) return `${d1} ${MESES_CORTOS[m1 - 1]} ${y1} – ${d2} ${MESES_CORTOS[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MESES_CORTOS[m1 - 1]} – ${d2} ${MESES_CORTOS[m2 - 1]} ${y2}`;
  return `${d1}–${d2} ${MESES_CORTOS[m2 - 1]} ${y2}`;
}

/** «lun 10 nov, 13:30» en hora de Madrid. */
export function textoInstante(instante: Date | string): string {
  const { fecha, hora } = utcAMadrid(instante);
  const [, m, d] = fecha.split("-").map(Number);
  return `${DIAS_CORTOS[diaSemana(fecha)]} ${d} ${MESES_CORTOS[m - 1]}, ${hora}`;
}

// ─── Eventos del calendario ─────────────────────────────────────────────────

export interface PiezaCalendario {
  id: string;
  grupo_id: string;
  red: string;
  formato: string;
  titulo: string | null;
  caption: string;
  estado: string;
  fecha_prevista: string | null;
  publicada_at: string | null;
  permalink: string | null;
  error: string | null;
}

export interface ProgramacionCalendario extends ProgramacionBasica {
  intentos: number;
  ultimo_error: string | null;
}

export interface EventoCalendario {
  clave: string;
  /** programada (pendiente, publicándose o con error), publicada o borrador (fecha prevista, sin programar). */
  tipo: "programada" | "publicada" | "borrador";
  estado: string;
  instante: string;
  dia: string;
  hora: string;
  piezaId: string;
  programacionId: string | null;
  red: string;
  pieza: PiezaCalendario | null;
  intentos: number;
  error: string | null;
}

const ESTADOS_VISIBLES = new Set(["programada", "publicando", "error"]);

/**
 * Eventos del calendario: programaciones pendientes, publicándose o con error (en su hora), piezas publicadas (en
 * publicada_at) y borradores con fecha prevista que aún no tienen programación (a las 12:00 de ese día). Las
 * canceladas no salen. Ordenados por instante.
 */
export function construirEventos(programaciones: readonly ProgramacionCalendario[], piezas: readonly PiezaCalendario[]): EventoCalendario[] {
  const porId = new Map(piezas.map((p) => [p.id, p]));
  const conProgramacion = new Set<string>();
  const eventos: EventoCalendario[] = [];
  for (const g of programaciones) {
    if (!ESTADOS_VISIBLES.has(g.estado)) continue;
    conProgramacion.add(g.pieza_id);
    const { fecha, hora } = utcAMadrid(g.programada_para);
    eventos.push({ clave: `prog-${g.id}`, tipo: "programada", estado: g.estado, instante: g.programada_para, dia: fecha, hora, piezaId: g.pieza_id,
      programacionId: g.id, red: g.red, pieza: porId.get(g.pieza_id) ?? null, intentos: g.intentos, error: g.ultimo_error });
  }
  for (const p of piezas) {
    if (p.estado === "publicada" && p.publicada_at) {
      const { fecha, hora } = utcAMadrid(p.publicada_at);
      eventos.push({ clave: `pub-${p.id}`, tipo: "publicada", estado: "publicada", instante: p.publicada_at, dia: fecha, hora, piezaId: p.id,
        programacionId: null, red: p.red, pieza: p, intentos: 0, error: null });
    } else if (p.fecha_prevista && !conProgramacion.has(p.id) && (p.estado === "borrador" || p.estado === "lista" || p.estado === "error")) {
      const instante = (madridAUtc(p.fecha_prevista, "12:00") ?? new Date(`${p.fecha_prevista}T12:00:00Z`)).toISOString();
      eventos.push({ clave: `bor-${p.id}`, tipo: "borrador", estado: "borrador", instante, dia: p.fecha_prevista, hora: "", piezaId: p.id,
        programacionId: null, red: p.red, pieza: p, intentos: 0, error: p.error });
    }
  }
  return eventos.sort((a, b) => a.instante.localeCompare(b.instante) || a.red.localeCompare(b.red));
}

/** Eventos agrupados por día de Madrid. */
export function agruparPorDia(eventos: readonly EventoCalendario[]): Map<string, EventoCalendario[]> {
  const m = new Map<string, EventoCalendario[]>();
  for (const e of eventos) m.set(e.dia, [...(m.get(e.dia) ?? []), e]);
  return m;
}

/** Valor inicial del diálogo «Programar»: el instante dado o mañana a las 13:00 (hora de Madrid). */
export function valorInicial(inicial: Date | string | null | undefined, ahora: Date = new Date()): { fecha: string; hora: string } {
  if (inicial) {
    const t = new Date(inicial);
    if (!Number.isNaN(t.getTime()) && t.getTime() > ahora.getTime() + MARGEN_MINIMO_MIN * MS_MIN) return utcAMadrid(t);
  }
  return { fecha: sumarDias(hoyMadrid(ahora), 1), hora: "13:00" };
}

/** Límites del selector de fecha (hoy y +75 días, en Madrid). */
export function limitesFecha(ahora: Date = new Date()): { min: string; max: string } {
  const hoy = hoyMadrid(ahora);
  return { min: hoy, max: sumarDias(hoy, MAXIMO_DIAS) };
}
