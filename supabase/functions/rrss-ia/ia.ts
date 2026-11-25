/**
 * Edge Function rrss-ia — la IA de RRSS para la cristalería. Solo PROPONE: nunca publica ni programa nada.
 *
 *   POST ${SUPABASE_URL}/functions/v1/rrss-ia   Authorization: Bearer <JWT> («Editar» en RRSS)
 *
 *   { accion: "textos", red, formato, servicio?, tono?, descripcion?, rutas?: ["subidas/…"] (fotos que ve la IA, ≤ 3) }
 *     → { ok, variantes: [{ enfoque, gancho, caption, hashtags, altText, avisos }], descartadas, avisos, modelo }
 *   { accion: "ideas", semana?: "AAAA-MM-DD" (se toma su lunes), cuantas?: 3-7, descripcion? }
 *     → { ok, desde, hasta, ideas: [{ fecha, titulo, idea, formato, servicio, gancho, comoGrabarlo, motivo }], fechas, descartadas }
 *   { accion: "campana", descripcion?, desde?, semanas?: 2-4, piezasPorSemana?: 1-5 }
 *     → { ok, campanaId, campana: { titulo, objetivo, publico, mensaje, razonamiento, fases, piezas }, descartadas, avisos }
 *       (se guarda como PROPUESTA en rrss_campanas; aceptarla crea borradores: rrss_aceptar_campana)
 *   { accion: "aprender" }
 *     → { ok, propuesta: { resumen, cambios, guia, hashtagsBase, ctas, palabrasEvitar }, publicaciones }
 *       (el panel la enseña y la persona decide si la aplica al estilo)
 *
 *   400 entrada · 401/403 · 422 nada pasó los validadores (ni al segundo intento) o faltan datos para aprender ·
 *   429 tope diario (80 por usuario, 300 entre todos) · 502 OpenAI · 503 falta OPENAI_API_KEY (tipo «ia_no_disponible»)
 *   o la migración.
 *
 * Como el resto de IA del panel: clave del servidor (claveOpenAI("otros")), modelo elegible en Super Admin › Servicios
 * (ia_modelo_funcion; por defecto RRSS_IA_MODEL o gpt-4.1-mini, que ve imágenes) y gasto en ia_uso (registrarUso en
 * el finally). Lo que escribe la persona se anonimiza (sin correos, teléfonos, DNI ni IBAN) antes de enviarlo o
 * guardarlo. Sin imports https:// ni Deno: las dependencias se inyectan (vitest).
 */
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { parametrosChat } from "../_shared/modelo-funcion.ts";
import { AcumuladorUso, type OpcionesRegistro } from "../_shared/registrar-uso-ia.ts";
import { esFormato, esRed, esServicio, nombreServicioRrss, SERVICIOS_RRSS } from "../_shared/rrss/formatos.ts";
import { json, leerCuerpo } from "../_shared/rrss/http.ts";
import { bloqueDatos, bloqueUsuario, DESCRIPCION_TONO, ESQUEMAS, NOMBRE_SERVICIO, sistemaAprender, sistemaCampana, sistemaIdeas, sistemaTextos, TONOS, type Tono } from "./prompts.ts";
import { anonimizar, normalizarAprender, normalizarCampana, normalizarIdeas, normalizarTextos, type OpcionesTexto } from "./validar.ts";

export const FUNCION = "rrss-ia";
export const MODELO_POR_DEFECTO = "gpt-4.1-mini";
const OPENAI = "https://api.openai.com/v1";
const MS_OPENAI = 70_000;
const MAX_INTENTOS = 2;
export const MAX_DESCRIPCION = 800;
export const MAX_FOTOS = 3;
export const MIN_PUBLICACIONES_APRENDER = 6;
const RE_RUTA = /^subidas\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type AccionIA = "textos" | "ideas" | "campana" | "aprender";

export class ErrorIA extends Error {
  constructor(mensaje: string, readonly estado = 400, readonly tipo?: string) {
    super(mensaje);
  }
}

export interface EstiloIA {
  zona: string;
  tono: Tono;
  guia: string;
  hashtags_base: string[];
  ctas: string[];
  palabras_evitar: string[];
  emojis: boolean;
}

export interface ContextoIA {
  estilo: EstiloIA;
  negocio: { nombre: string; web: string; municipio: string | null };
  /** «Qué funciona» (rrss_que_funciona) o null si no hay datos. */
  queFunciona: unknown;
  ganchosRecientes: string[];
}

export interface PublicacionAprender {
  fecha: string | null;
  formato: string;
  caption: string;
  alcance: number | null;
  tasa: number | null;
}

export interface DependenciasIA {
  /** Clave de OpenAI; vacía = IA no disponible. */
  clave: string;
  fetch?: typeof fetch;
  autorizar(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }>;
  modelo(): Promise<string>;
  /** Reserva una petición del tope diario con el JWT del usuario; lanza ErrorIA (429 tope, 503 sin migración). */
  reservar(accion: AccionIA, modelo: string): Promise<number | null>;
  marcar(id: number | null, ok: boolean): Promise<void>;
  contexto(): Promise<ContextoIA>;
  fechasEntre(desde: string, hasta: string): Promise<Array<Record<string, unknown>>>;
  publicacionesRecientes(): Promise<PublicacionAprender[]>;
  /** URL firmadas (pocos minutos) de fotos del cubo para que la IA las vea. */
  firmar(rutas: string[]): Promise<string[]>;
  /** Guarda la campaña como propuesta (con el JWT del usuario); devuelve su id. */
  guardarCampana(c: { titulo: string; objetivo: string; peticion: string; desde: string; hasta: string; propuesta: unknown; modelo: string }): Promise<string>;
  registrar(uso: AcumuladorUso, opciones: OpcionesRegistro): Promise<void>;
  ahora?: () => number;
}

type Parte = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } };
type Mensaje = { role: "system" | "user" | "assistant"; content: string | Parte[] };

class ErrorOpenAI extends Error {}

async function pedir(f: typeof fetch, clave: string, modelo: string, mensajes: Mensaje[], esquema: unknown, uso: AcumuladorUso): Promise<{ datos: unknown; bruto: string }> {
  let res: Response;
  try {
    res = await f(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({ model: modelo, messages: mensajes, response_format: { type: "json_schema", json_schema: esquema }, ...parametrosChat(modelo, 4000, 0.7) }),
      signal: AbortSignal.timeout(MS_OPENAI),
    });
  } catch (e) {
    uso.sumar(undefined);
    throw new ErrorOpenAI(`No se pudo hablar con OpenAI: ${(e as Error)?.message ?? e}`);
  }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    uso.sumar(undefined);
    throw new ErrorOpenAI(motivoErrorOpenAI(res.status, cuerpo));
  }
  const j = (await res.json().catch(() => null)) as { usage?: unknown; choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> } | null;
  uso.sumar((j?.usage ?? undefined) as Parameters<AcumuladorUso["sumar"]>[0]);
  const msg = j?.choices?.[0]?.message;
  if (typeof msg?.refusal === "string" && msg.refusal) throw new ErrorOpenAI("La IA se ha negado a hacer esta propuesta.");
  if (typeof msg?.content !== "string") throw new ErrorOpenAI("OpenAI respondió sin contenido.");
  try {
    return { datos: JSON.parse(msg.content), bruto: msg.content };
  } catch {
    throw new ErrorOpenAI("OpenAI respondió con un JSON que no se puede leer.");
  }
}

const fechaIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function lunesDe(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return sumarDias(fecha, -((dia + 6) % 7));
}
const entero = (v: unknown, min: number, max: number, def: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export async function manejarIA(req: Request, d: DependenciasIA): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const auth = await d.autorizar(req);
  if (!auth.ok) return auth.response;
  const cuerpo = await leerCuerpo(req);
  if (cuerpo === null) return json({ ok: false, error: "Cuerpo de la petición no válido" }, 400);
  const accion = cuerpo.accion as AccionIA;
  if (!["textos", "ideas", "campana", "aprender"].includes(accion)) return json({ ok: false, error: "accion no válida (textos | ideas | campana | aprender)" }, 400);
  const descripcionCruda = typeof cuerpo.descripcion === "string" ? cuerpo.descripcion.trim() : "";
  if (descripcionCruda.length > MAX_DESCRIPCION) return json({ ok: false, error: `Como mucho ${MAX_DESCRIPCION} caracteres.` }, 400);
  const descripcion = anonimizar(descripcionCruda);
  const rutas = Array.isArray(cuerpo.rutas) ? cuerpo.rutas.filter((r): r is string => typeof r === "string" && RE_RUTA.test(r)).slice(0, MAX_FOTOS) : [];
  if (accion === "textos" && (!esRed(cuerpo.red) || !esFormato(cuerpo.formato))) return json({ ok: false, error: "Falta la red o el formato" }, 400);
  if (accion === "textos" && cuerpo.formato === "story") return json({ ok: false, error: "Las historias no llevan texto." }, 400);
  if (!d.clave) return json({ ok: false, tipo: "ia_no_disponible", error: "La IA no está disponible: falta OPENAI_API_KEY en los secretos de Supabase." }, 503);

  const f = d.fetch ?? fetch;
  const ahora = (d.ahora ?? Date.now)();
  const modelo = await d.modelo();
  const uso = new AcumuladorUso(FUNCION, modelo, rutas.length ? "vision" : "chat");
  const t0 = Date.now();
  let reserva: number | null = null;
  let ok = false;
  try {
    reserva = await d.reservar(accion, modelo);
    const ctx = await d.contexto();
    const tono: Tono = TONOS.includes(cuerpo.tono as Tono) ? (cuerpo.tono as Tono) : ctx.estilo.tono;
    const estilo = { ...ctx.estilo, tono: DESCRIPCION_TONO[tono] };
    const opciones: OpcionesTexto = { fuente: descripcion, emojis: ctx.estilo.emojis, palabrasEvitar: ctx.estilo.palabras_evitar };
    const servicios = SERVICIOS_RRSS.map((s) => ({ slug: s.slug, nombre: NOMBRE_SERVICIO[s.slug] ?? s.nombre }));

    const conReintento = async <T>(sistema: string, usuario: Mensaje, esquema: unknown, normalizar: (datos: unknown) => { valido: boolean; resultado: T; motivos: string[] }): Promise<T | null> => {
      const mensajes: Mensaje[] = [{ role: "system", content: sistema }, usuario];
      let ultimo: T | null = null;
      for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        const { datos, bruto } = await pedir(f, d.clave, modelo, mensajes, esquema, uso);
        const n = normalizar(datos);
        ultimo = n.resultado;
        if (n.valido) return n.resultado;
        mensajes.push({ role: "assistant", content: bruto });
        mensajes.push({ role: "user", content: `No vale: ${n.motivos.slice(0, 6).join(" ")} Corrígelo respetando el esquema y las reglas.` });
      }
      return ultimo;
    };

    if (accion === "textos") {
      const red = cuerpo.red as "instagram" | "facebook";
      const servicio = esServicio(cuerpo.servicio) ? cuerpo.servicio : null;
      const fotos = rutas.length ? await d.firmar(rutas).catch(() => []) : [];
      const datos = { estilo, negocio: ctx.negocio, trabajo: servicio ? NOMBRE_SERVICIO[servicio] : null, formato: cuerpo.formato, red, que_funciona: ctx.queFunciona, ganchos_recientes: ctx.ganchosRecientes };
      const texto = `${bloqueDatos(datos)}\n\n${bloqueUsuario(descripcion)}`;
      const usuario: Mensaje = { role: "user", content: fotos.length ? [{ type: "text", text: texto }, ...fotos.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "low" as const } }))] : texto };
      const r = await conReintento(sistemaTextos({ red, formato: String(cuerpo.formato), emojis: ctx.estilo.emojis }), usuario, ESQUEMAS.textos, (x) => {
        const n = normalizarTextos(x, { ...opciones, red });
        return { valido: n.variantes.length > 0, resultado: n, motivos: n.descartadas.flatMap((v) => v.motivos) };
      });
      if (!r || r.variantes.length === 0) return json({ ok: false, tipo: "propuesta_no_valida", error: "Ninguna propuesta pasó las comprobaciones. Cambia lo que le cuentas y vuelve a intentarlo.", descartadas: r?.descartadas ?? [] }, 422);
      ok = true;
      return json({ ok: true, accion, variantes: r.variantes, descartadas: r.descartadas, avisos: [], modelo, servicio: nombreServicioRrss(servicio) });
    }

    if (accion === "ideas") {
      const base = typeof cuerpo.semana === "string" && RE_FECHA.test(cuerpo.semana) ? cuerpo.semana : fechaIso(ahora + 86_400_000);
      const desde = lunesDe(base);
      const hasta = sumarDias(desde, 6);
      if (desde > sumarDias(fechaIso(ahora), 63)) return json({ ok: false, error: "Como mucho, ideas para dentro de 8 semanas." }, 400);
      const cuantas = entero(cuerpo.cuantas, 3, 7, 4);
      const fechas = await d.fechasEntre(desde, hasta).catch(() => []);
      const datos = { estilo, negocio: ctx.negocio, semana: { desde, hasta }, servicios, fechas, que_funciona: ctx.queFunciona, ganchos_recientes: ctx.ganchosRecientes };
      const r = await conReintento(sistemaIdeas({ cuantas }), { role: "user", content: `${bloqueDatos(datos)}\n\n${bloqueUsuario(descripcion)}` }, ESQUEMAS.ideas, (x) => {
        const n = normalizarIdeas(x, { ...opciones, desde, hasta });
        return { valido: n.ideas.length > 0, resultado: n, motivos: n.descartadas.flatMap((v) => v.motivos) };
      });
      if (!r || r.ideas.length === 0) return json({ ok: false, tipo: "propuesta_no_valida", error: "Ninguna idea pasó las comprobaciones. Vuelve a intentarlo.", descartadas: r?.descartadas ?? [] }, 422);
      ok = true;
      return json({ ok: true, accion, desde, hasta, ideas: r.ideas, fechas, descartadas: r.descartadas, modelo });
    }

    if (accion === "campana") {
      const manana = fechaIso(ahora + 86_400_000);
      const desde = typeof cuerpo.desde === "string" && RE_FECHA.test(cuerpo.desde) && cuerpo.desde >= fechaIso(ahora) && cuerpo.desde <= sumarDias(fechaIso(ahora), 60) ? cuerpo.desde : manana;
      const semanas = entero(cuerpo.semanas, 2, 4, 3);
      const piezasPorSemana = entero(cuerpo.piezasPorSemana, 1, 5, 3);
      const hasta = sumarDias(desde, semanas * 7 - 1);
      const fechas = await d.fechasEntre(desde, hasta).catch(() => []);
      const datos = { estilo, negocio: ctx.negocio, desde, hasta, servicios, fechas, que_funciona: ctx.queFunciona, ganchos_recientes: ctx.ganchosRecientes };
      const r = await conReintento(sistemaCampana({ semanas, piezasPorSemana, emojis: ctx.estilo.emojis }), { role: "user", content: `${bloqueDatos(datos)}\n\n${bloqueUsuario(descripcion)}` }, ESQUEMAS.campana, (x) => {
        const n = normalizarCampana(x, { ...opciones, desde, hasta, maxPiezas: semanas * piezasPorSemana });
        return { valido: n.campana !== null, resultado: n, motivos: n.descartadas.flatMap((v) => v.motivos) };
      });
      if (!r || !r.campana) return json({ ok: false, tipo: "propuesta_no_valida", error: "La campaña propuesta no pasó las comprobaciones. Vuelve a intentarlo.", descartadas: r?.descartadas ?? [] }, 422);
      const campanaId = await d.guardarCampana({ titulo: r.campana.titulo, objetivo: r.campana.objetivo, peticion: descripcion.slice(0, 600), desde, hasta, propuesta: r.campana, modelo });
      ok = true;
      return json({ ok: true, accion, campanaId, campana: r.campana, descartadas: r.descartadas, avisos: r.avisos, modelo });
    }

    // accion === "aprender"
    const publicaciones = (await d.publicacionesRecientes()).slice(0, 40);
    if (publicaciones.filter((p) => p.alcance !== null).length < MIN_PUBLICACIONES_APRENDER) {
      throw new ErrorIA(`Hacen falta al menos ${MIN_PUBLICACIONES_APRENDER} publicaciones con métricas para aprender de ellas. Publica unas cuantas y actualiza las métricas.`, 422, "faltan_datos");
    }
    const datos = { estilo: { ...ctx.estilo, tono: DESCRIPCION_TONO[ctx.estilo.tono] }, negocio: ctx.negocio, publicaciones, que_funciona: ctx.queFunciona };
    const r = await conReintento(sistemaAprender(), { role: "user", content: bloqueDatos(datos) }, ESQUEMAS.aprender, (x) => {
      const n = normalizarAprender(x, { ...opciones, fuente: `${opciones.fuente} ${ctx.estilo.guia}` });
      return { valido: n.propuesta !== null, resultado: n, motivos: n.motivos };
    });
    if (!r || !r.propuesta) return json({ ok: false, tipo: "propuesta_no_valida", error: "La propuesta de estilo no pasó las comprobaciones. Vuelve a intentarlo.", motivos: r?.motivos ?? [] }, 422);
    ok = true;
    return json({ ok: true, accion, propuesta: r.propuesta, publicaciones: publicaciones.length, modelo });
  } catch (e) {
    uso.marcarError();
    if (e instanceof ErrorIA) return json({ ok: false, error: e.message, ...(e.tipo ? { tipo: e.tipo } : {}) }, e.estado);
    if (e instanceof ErrorOpenAI) return json({ ok: false, error: e.message, tipo: "ia_no_disponible" }, 502);
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 502);
  } finally {
    await d.marcar(reserva, ok).catch(() => undefined);
    await d.registrar(uso, { disparador: `usuario:${auth.userId}`, duracionMs: Date.now() - t0 });
  }
}

/** Traduce el error de PostgREST al reservar una petición del tope diario. */
export function errorReserva(status: number, mensaje: string): ErrorIA {
  if (/rrss_cupo_ia/.test(mensaje)) return new ErrorIA("Se ha llegado al tope de peticiones a la IA de hoy (80 por persona, 300 entre todos). Mañana se renueva.", 429);
  if (status === 404 || /does not exist|Could not find the table|PGRST205|42P01/i.test(mensaje)) {
    return new ErrorIA("Falta aplicar la migración 20261125100000_rrss en este Supabase.", 503);
  }
  if (status === 401 || status === 403 || /row-level security|permission/i.test(mensaje)) return new ErrorIA("Hace falta «Editar» en RRSS para usar la IA.", 403);
  return new ErrorIA(`No se pudo reservar la petición a la IA (${status}).`, 502);
}
