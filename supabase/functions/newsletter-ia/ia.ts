/**
 * Edge Function newsletter-ia — «Crear con IA» de la newsletter. La IA
 * REDACTA el correo y PROPONE su presentación (bloques de las plantillas).
 * Nunca envía nada ni guarda nada: devuelve la propuesta al panel, donde el
 * equipo la revisa, la edita y decide si la guarda como plantilla o la usa (y
 * enviar sigue pidiendo confirmación). Portada del panel de referencia.
 *
 *   POST `${SUPABASE_URL}/functions/v1/newsletter-ia`   Authorization: Bearer <JWT> («Editar» en Newsletter)
 *
 *   { descripcion, tipo?, tono?, imagenes?: string[], base?: { titulo, insignia?, preheader?, bloques } }
 *     → { ok: true, propuesta: { tipo, insignia, titulo, preheader, bloques }, avisos, modelo }
 *
 *   400 entrada · 401/403 sesión o permiso · 429 tope diario (40 por usuario)
 *   502 OpenAI o propuesta no válida · 503 falta OPENAI_API_KEY (tipo «ia_no_disponible») o la migración
 *
 * Como el resto de IA del panel: clave del servidor (claveOpenAI("otros"),
 * OPENAI_API_KEY, nunca en el navegador), modelo elegible en Super Admin ›
 * Servicios › Modelos (ia_modelo_funcion; por defecto NEWSLETTER_IA_MODEL o
 * gpt-4.1-mini) y gasto registrado en «Gasto IA» (registrarUso en el finally).
 * El tope diario lo cuenta newsletter_ia_peticiones (migración 20261124173700).
 * Sin imports https:// ni Deno: las dependencias se inyectan (vitest).
 */
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { parametrosChat } from "../_shared/modelo-funcion.ts";
import { AcumuladorUso, type OpcionesRegistro } from "../_shared/registrar-uso-ia.ts";
import { esTipoNewsletter, textoPlanoDeBloques, urlHttpsSegura, validarBloques, URL_WEB, type TipoNewsletter } from "../_shared/newsletter/bloques.ts";
import { negocioPorDefecto, type DatosNegocio } from "../_shared/newsletter/negocio.ts";
import { ESQUEMA, SISTEMA, TONOS, mensajeUsuario, type Tono } from "./prompts.ts";
import { ErrorPropuesta, normalizarPropuesta } from "./normalizar.ts";

export const FUNCION = "newsletter-ia";
export const MODELO_POR_DEFECTO = "gpt-4.1-mini";
const OPENAI = "https://api.openai.com/v1";
const MS_OPENAI = 60_000;
export const LIMITE_DESCRIPCION = 1500;
export const MAX_IMAGENES = 24;
const MAX_INTENTOS = 2;
const MAX_CUERPO = 64 * 1024;

export class ErrorNewsletterIA extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

// ── Entrada ─────────────────────────────────────────────────────────────────

export interface EntradaIA {
  descripcion: string;
  tipo: TipoNewsletter | null;
  tono: Tono;
  imagenes: string[];
  base: { titulo: string; insignia: string; preheader: string; bloques: unknown[] } | null;
}

export function validarEntrada(raw: unknown): EntradaIA {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const descripcion = typeof c.descripcion === "string" ? c.descripcion.trim() : "";
  if (descripcion.length < 10) throw new ErrorNewsletterIA("Cuéntale a la IA qué quieres comunicar (al menos una frase).");
  if (descripcion.length > LIMITE_DESCRIPCION) throw new ErrorNewsletterIA(`La descripción no puede superar ${LIMITE_DESCRIPCION} caracteres.`);
  const tipo = esTipoNewsletter(c.tipo) ? c.tipo : null;
  const tono: Tono = (TONOS as readonly string[]).includes(c.tono as string) ? (c.tono as Tono) : "cercano";
  const imagenes = (Array.isArray(c.imagenes) ? c.imagenes : [])
    .map((u) => urlHttpsSegura(typeof u === "string" ? u : null))
    .filter((u): u is string => !!u)
    .slice(0, MAX_IMAGENES);
  let base: EntradaIA["base"] = null;
  if (c.base && typeof c.base === "object") {
    const b = c.base as Record<string, unknown>;
    const v = validarBloques(b.bloques);
    if (v.ok) {
      base = {
        titulo: typeof b.titulo === "string" ? b.titulo.slice(0, 150) : "",
        insignia: typeof b.insignia === "string" ? b.insignia.slice(0, 40) : "",
        preheader: typeof b.preheader === "string" ? b.preheader.slice(0, 150) : "",
        bloques: v.bloques,
      };
    }
  }
  return { descripcion, tipo, tono, imagenes, base };
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

export class ErrorOpenAI extends Error {}

type Mensaje = { role: "system" | "user" | "assistant"; content: string };

async function pedir(f: typeof fetch, clave: string, modelo: string, mensajes: Mensaje[], uso: AcumuladorUso): Promise<{ datos: unknown; bruto: string }> {
  let res: Response;
  try {
    res = await f(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        messages: mensajes,
        response_format: { type: "json_schema", json_schema: ESQUEMA },
        ...parametrosChat(modelo, 3000, 0.7),
      }),
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
  if (typeof msg?.refusal === "string" && msg.refusal) throw new ErrorOpenAI("La IA se ha negado a redactar este correo.");
  if (typeof msg?.content !== "string") throw new ErrorOpenAI("OpenAI respondió sin contenido.");
  try {
    return { datos: JSON.parse(msg.content), bruto: msg.content };
  } catch {
    throw new ErrorOpenAI("OpenAI respondió con un JSON que no se puede leer.");
  }
}

// ── Manejador ───────────────────────────────────────────────────────────────

export interface DependenciasNewsletterIA {
  /** Clave de OpenAI (claveOpenAI("otros")); vacía = IA no disponible. */
  clave: string;
  fetch?: typeof fetch;
  cors?: Record<string, string>;
  /** «Editar» en Newsletter (exigirPermiso). */
  autorizar(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }>;
  /** Modelo de la función (ia_modelo_funcion o el de código). */
  modelo(): Promise<string>;
  /** Reserva una petición del tope diario con el JWT del usuario; lanza ErrorNewsletterIA (429 tope, 503 sin migración). */
  reservar(modelo: string): Promise<number | null>;
  marcar(id: number | null, ok: boolean): Promise<void>;
  /** Datos del negocio y web para el prompt. */
  negocio(): Promise<DatosNegocio>;
  registrar(uso: AcumuladorUso, opciones: OpcionesRegistro): Promise<void>;
}

export async function manejarNewsletterIA(request: Request, deps: DependenciasNewsletterIA): Promise<Response> {
  const cors = deps.cors ?? { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
  const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });

  const auth = await deps.autorizar(request);
  if (!auth.ok) return auth.response;

  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json(413, { ok: false, error: "La petición es demasiado grande." });
  let entrada: EntradaIA;
  try {
    entrada = validarEntrada(texto ? JSON.parse(texto) : {});
  } catch (e) {
    if (e instanceof ErrorNewsletterIA) return json(e.estado, { ok: false, error: e.message });
    return json(400, { ok: false, error: "Cuerpo de la petición no válido" });
  }

  if (!deps.clave) return json(503, { ok: false, error: "Falta OPENAI_API_KEY en los secretos de Supabase", tipo: "ia_no_disponible" });
  const f = deps.fetch ?? fetch;
  const modelo = await deps.modelo();
  const negocio = (await deps.negocio().catch(() => null)) ?? negocioPorDefecto(URL_WEB);

  const uso = new AcumuladorUso(FUNCION, modelo, "chat");
  const t0 = Date.now();
  let reserva: number | null = null;
  let ok = false;
  try {
    reserva = await deps.reservar(modelo);
    const fuente = [entrada.descripcion, entrada.base ? `${entrada.base.titulo} ${textoPlanoDeBloques(entrada.base.bloques as never)}` : ""].join(" ");
    const mensajes: Mensaje[] = [
      { role: "system", content: SISTEMA },
      { role: "user", content: mensajeUsuario({ ...entrada, negocio }) },
    ];
    let ultimoError = "";
    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      const { datos, bruto } = await pedir(f, deps.clave, modelo, mensajes, uso);
      try {
        const { propuesta, avisos } = normalizarPropuesta(datos, { fuente, imagenes: entrada.imagenes, tipoPedido: entrada.tipo, web: negocio.web });
        ok = true;
        return json(200, { ok: true, propuesta, avisos, modelo });
      } catch (e) {
        if (!(e instanceof ErrorPropuesta)) throw e;
        ultimoError = e.message;
        mensajes.push({ role: "assistant", content: bruto });
        mensajes.push({ role: "user", content: `La propuesta no vale: ${e.message}. Corrígela respetando el esquema y las reglas.` });
      }
    }
    return json(502, { ok: false, error: `${ultimoError}. Vuelve a intentarlo o cambia la descripción.`, tipo: "propuesta_no_valida" });
  } catch (e) {
    uso.marcarError();
    if (e instanceof ErrorNewsletterIA) return json(e.estado, { ok: false, error: e.message });
    if (e instanceof ErrorOpenAI) return json(502, { ok: false, error: e.message, tipo: "ia_no_disponible" });
    return json(502, { ok: false, error: (e as Error)?.message ?? String(e) });
  } finally {
    await deps.marcar(reserva, ok).catch(() => undefined);
    await deps.registrar(uso, { disparador: `usuario:${auth.userId}`, duracionMs: Date.now() - t0 });
  }
}

/** Traduce el error de PostgREST al reservar una petición del tope diario. */
export function errorReserva(status: number, mensaje: string): ErrorNewsletterIA {
  if (/newsletter_cupo_ia/.test(mensaje)) return new ErrorNewsletterIA("Has llegado al tope de 40 propuestas de la IA por hoy. Mañana se renueva.", 429);
  if (status === 404 || /does not exist|Could not find the table|PGRST205|42P01/i.test(mensaje)) {
    return new ErrorNewsletterIA("Falta aplicar la migración 20261124173700_newsletter en este Supabase.", 503);
  }
  if (status === 401 || status === 403 || /row-level security|permission/i.test(mensaje)) return new ErrorNewsletterIA("Hace falta «Editar» en Newsletter para usar la IA.", 403);
  return new ErrorNewsletterIA(`No se pudo reservar la petición a la IA (${status}).`, 502);
}
