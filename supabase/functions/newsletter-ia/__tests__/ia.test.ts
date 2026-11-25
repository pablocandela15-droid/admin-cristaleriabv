// @vitest-environment node
/**
 * Edge Function newsletter-ia sin red (portado del panel de referencia): permiso, tope diario y OpenAI simulados.
 * Comprueba que la IA solo PROPONE (no envía ni guarda), la separación de instrucciones (sistema / DATOS / USUARIO),
 * la limpieza de la propuesta (fotos solo de la galería, botones solo a la web, cifras inventadas avisadas), el tope
 * diario, el estado «sin clave», el registro del gasto y que la clave nunca sale.
 */
import { describe, expect, it, vi } from "vitest";

// registrar-uso-ia.ts importa supabase-js por URL (Deno): aquí no hace falta (el registro va simulado).
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { errorReserva, manejarNewsletterIA, validarEntrada, MODELO_POR_DEFECTO, type DependenciasNewsletterIA } from "../ia.ts";
import { normalizarPropuesta, cifras, limpiarFormato, recortar } from "../normalizar.ts";
import { ESQUEMA, SISTEMA, mensajeUsuario } from "../prompts.ts";
import { URL_PRESUPUESTO, validarBloques } from "../../_shared/newsletter/bloques.ts";
import { negocioPorDefecto } from "../../_shared/newsletter/negocio.ts";

const WEB = "https://cristaleriabv.vercel.app";
const CLAVE = "sk-clave-de-openai-de-pruebas-0123456789";
const FOTO = "https://demo.supabase.co/storage/v1/object/public/web-fotos/albumes/a/mampara.webp";

const resp = (estado: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const respuestaModelo = (datos: unknown) => resp(200, { choices: [{ message: { content: JSON.stringify(datos) } }], usage: { prompt_tokens: 1800, completion_tokens: 600 } });

const nulo = { titulo: null, texto: null, url: null, alt: null, autor: null, fecha: null, horario: null, lugar: null, precio: null, elementos: null };
const PROPUESTA = {
  tipo: "oferta",
  insignia: "Oferta",
  titulo: "Mamparas a medida este mes",
  preheader: "Medición gratis en Crevillente hasta el 30 de noviembre.",
  bloques: [
    { ...nulo, tipo: "texto", texto: "Este mes renovamos mamparas con una oferta especial." },
    { ...nulo, tipo: "imagen", url: FOTO, alt: "Mampara de ducha" },
    { ...nulo, tipo: "lista", titulo: "En oferta", elementos: [{ nombre: "Mampara fija", descripcion: "Vidrio templado", precio: "desde 200 €" }] },
    { ...nulo, tipo: "datos", fecha: "Hasta el 30 de noviembre", lugar: "Baix Vinalopó" },
    { ...nulo, tipo: "boton", texto: "Pedir presupuesto", url: URL_PRESUPUESTO },
    { ...nulo, tipo: "firma", texto: "Un saludo,\nEl equipo de Cristalería Baix Vinalopó" },
  ],
  faltan: [],
};

function montar(e: { permiso?: boolean; cupo?: "ok" | "lleno" | "sin_tabla"; clave?: string; openai?: (cuerpo: Record<string, unknown>, n: number) => Response } = {}) {
  const llamadas: Array<{ url: string; cuerpo: Record<string, unknown>; auth: string | null }> = [];
  let n = 0;
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const cuerpo = typeof init.body === "string" ? JSON.parse(init.body) : {};
    llamadas.push({ url: String(entrada), cuerpo, auth: new Headers(init.headers).get("Authorization") });
    return e.openai ? e.openai(cuerpo, n++) : respuestaModelo(PROPUESTA);
  }) as unknown as typeof fetch;
  const marcados: Array<[number | null, boolean]> = [];
  const registrar = vi.fn(async () => {});
  const deps: DependenciasNewsletterIA = {
    clave: e.clave ?? CLAVE,
    fetch: f,
    autorizar: async () => (e.permiso === false ? { ok: false, response: resp(403, { success: false, error: "No tienes permiso para esta acción." }) } : { ok: true, userId: "usuario-1" }),
    modelo: async () => MODELO_POR_DEFECTO,
    reservar: async () => {
      if (e.cupo === "lleno") throw errorReserva(400, "P0001 newsletter_cupo_ia: has llegado al tope");
      if (e.cupo === "sin_tabla") throw errorReserva(404, "PGRST205 Could not find the table");
      return 7;
    },
    marcar: async (id, ok) => void marcados.push([id, ok]),
    negocio: async () => negocioPorDefecto(WEB),
    registrar,
  };
  return { deps, llamadas, marcados, registrar };
}

const pedir = (cuerpo: unknown, d: DependenciasNewsletterIA) =>
  manejarNewsletterIA(new Request("https://demo.supabase.co/functions/v1/newsletter-ia", { method: "POST", body: JSON.stringify(cuerpo) }), d);
const PETICION = { descripcion: "Oferta de mamparas este mes, medición gratis en Crevillente. Mampara fija desde 200 €.", tono: "cercano", imagenes: [FOTO] };

describe("newsletter-ia · manejador", () => {
  it("devuelve una propuesta válida con los bloques de las plantillas, sin enviar ni guardar nada", async () => {
    const m = montar();
    const r = await pedir(PETICION, m.deps);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.propuesta.titulo).toBe("Mamparas a medida este mes");
    expect(validarBloques(j.propuesta.bloques).ok).toBe(true);
    expect(j.modelo).toBe(MODELO_POR_DEFECTO);
    expect(m.llamadas.map((l) => l.url)).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(m.marcados).toEqual([[7, true]]);
    expect(m.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ disparador: "usuario:usuario-1" }));
  });

  it("separa instrucciones, datos y petición del usuario, con salida JSON estricta; la clave solo va a OpenAI", async () => {
    const m = montar();
    const r = await pedir(PETICION, m.deps);
    const cuerpo = m.llamadas[0].cuerpo as { messages: Array<{ role: string; content: string }>; response_format: { type: string } };
    expect(cuerpo.messages[0]).toEqual({ role: "system", content: SISTEMA });
    expect(cuerpo.messages[1].content).toContain("<<<DATOS");
    expect(cuerpo.messages[1].content).toContain("<<<USUARIO");
    expect(cuerpo.response_format.type).toBe("json_schema");
    expect(m.llamadas[0].auth).toBe(`Bearer ${CLAVE}`);
    expect(await r.text()).not.toContain(CLAVE);
  });

  it("sin «Editar» en Newsletter: 403 y no llama a la IA", async () => {
    const m = montar({ permiso: false });
    expect((await pedir(PETICION, m.deps)).status).toBe(403);
    expect(m.llamadas).toHaveLength(0);
  });

  it("tope diario: 429 sin llamar a la IA; sin migración: 503", async () => {
    const lleno = montar({ cupo: "lleno" });
    expect((await pedir(PETICION, lleno.deps)).status).toBe(429);
    expect(lleno.llamadas).toHaveLength(0);
    expect((await pedir(PETICION, montar({ cupo: "sin_tabla" }).deps)).status).toBe(503);
  });

  it("sin OPENAI_API_KEY: 503 «ia_no_disponible» sin gastar el tope", async () => {
    const m = montar({ clave: "" });
    const r = await pedir(PETICION, m.deps);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ tipo: "ia_no_disponible" });
    expect(m.marcados).toEqual([]);
  });

  it("descripción vacía o enorme: 400 sin llamar a la IA", async () => {
    const m = montar();
    expect((await pedir({ descripcion: "corta" }, m.deps)).status).toBe(400);
    expect((await pedir({ descripcion: "x".repeat(1501) }, m.deps)).status).toBe(400);
    expect(m.llamadas).toHaveLength(0);
  });

  it("si la primera propuesta no vale, pide una corrección; si tampoco, 502 y queda marcada como fallida", async () => {
    const mala = { ...PROPUESTA, titulo: "" };
    const m = montar({ openai: (_c, n) => respuestaModelo(n === 0 ? mala : PROPUESTA) });
    expect((await pedir(PETICION, m.deps)).status).toBe(200);
    expect(m.llamadas).toHaveLength(2);
    const nunca = montar({ openai: () => respuestaModelo(mala) });
    expect((await pedir(PETICION, nunca.deps)).status).toBe(502);
    expect(nunca.marcados).toEqual([[7, false]]);
  });

  it("OpenAI sin saldo: 502 con el motivo en llano", async () => {
    const m = montar({ openai: () => resp(429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }) });
    const r = await pedir(PETICION, m.deps);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/sin saldo/);
  });
});

describe("newsletter-ia · normalizar la propuesta", () => {
  const ctx = { fuente: PETICION.descripcion, imagenes: [FOTO], tipoPedido: null };

  it("quita fotos que no son de la galería y cambia botones que salen de la web", () => {
    const { propuesta, avisos } = normalizarPropuesta({
      ...PROPUESTA,
      bloques: [...PROPUESTA.bloques, { ...nulo, tipo: "imagen", url: "https://otra.example.com/x.jpg", alt: "x" }, { ...nulo, tipo: "boton", texto: "Ir", url: "https://otra.example.com/" }],
    }, ctx);
    expect(propuesta.bloques.filter((b) => b.tipo === "imagen")).toHaveLength(1);
    expect(propuesta.bloques.filter((b) => b.tipo === "boton").map((b) => (b as { url: string }).url)).toEqual([URL_PRESUPUESTO, URL_PRESUPUESTO]);
    expect(avisos.join(" ")).toMatch(/foto que no era de la galería/);
    expect(avisos.join(" ")).toMatch(/fuera de la web de la cristalería/);
  });

  it("con otra web en los ajustes, sus enlaces valen y el respaldo apunta a ella", () => {
    const { propuesta } = normalizarPropuesta({ ...PROPUESTA, bloques: [{ ...nulo, tipo: "boton", texto: "Ir", url: "https://otra.example.com/" }, { ...nulo, tipo: "boton", texto: "Web", url: "https://nueva.example.com/trabajos" }] },
      { ...ctx, web: "https://nueva.example.com" });
    expect(propuesta.bloques.map((b) => (b as { url: string }).url)).toEqual(["https://nueva.example.com/presupuesto", "https://nueva.example.com/trabajos"]);
  });

  it("avisa de precios o porcentajes que no estaban en la petición y de huecos", () => {
    const { avisos } = normalizarPropuesta({ ...PROPUESTA, preheader: "Un 15 % de descuento [fecha]", faltan: ["la fecha"] }, ctx);
    expect(avisos.join(" ")).toMatch(/«15%»/);
    expect(avisos.join(" ")).not.toMatch(/«200€»/);
    expect(avisos.join(" ")).toMatch(/Falta completar: la fecha/);
  });

  it("limpia Markdown y HTML, recorta y quita separadores sobrantes; sin asunto no vale", () => {
    const { propuesta } = normalizarPropuesta({
      ...PROPUESTA,
      bloques: [{ ...nulo, tipo: "separador" }, { ...nulo, tipo: "texto", texto: "**Hola** <b>ya</b>\n# Título" }, { ...nulo, tipo: "separador" }, { ...nulo, tipo: "separador" }],
    }, ctx);
    expect(propuesta.bloques).toEqual([{ tipo: "texto", texto: "Hola ya\nTítulo" }]);
    expect(() => normalizarPropuesta({ ...PROPUESTA, titulo: " " }, ctx)).toThrow(/asunto/);
    expect(() => normalizarPropuesta({ ...PROPUESTA, bloques: [] }, ctx)).toThrow(/no es válida/);
    expect(normalizarPropuesta({ ...PROPUESTA, tipo: "menu" }, { ...ctx, tipoPedido: "aviso" }).propuesta.tipo).toBe("aviso");
  });

  it("ayudantes", () => {
    expect(cifras("200 € y 12,50 euros, un 15%")).toEqual(["200€", "12,50€", "15%"]);
    expect(limpiarFormato("__a__")).toBe("a");
    expect(recortar("abcdef", 4)).toBe("abc…");
  });
});

describe("newsletter-ia · entrada y prompts", () => {
  it("valida la entrada: tono por defecto, solo imágenes https y diseño base válido", () => {
    const e = validarEntrada({ descripcion: "Aviso de vacaciones en agosto", tono: "raro", imagenes: ["http://x.example.com/a.jpg", FOTO, 3], base: { titulo: "T", bloques: [{ tipo: "texto", texto: "x" }] } });
    expect(e).toMatchObject({ tono: "cercano", imagenes: [FOTO], base: { titulo: "T" } });
  });

  it("el prompt es de cristalería, prohíbe inventar datos y HTML, y el esquema es estricto", () => {
    expect(SISTEMA).toMatch(/cristalería y aluminio/);
    expect(SISTEMA).toMatch(/No inventes datos/);
    expect(SISTEMA).toMatch(/Nada de HTML/);
    for (const palabra of ["restaurante", "reserva", "carta", "menú", "platos"]) expect(SISTEMA.toLowerCase()).not.toContain(palabra);
    expect(ESQUEMA.strict).toBe(true);
    const u = mensajeUsuario({ descripcion: "hola", tipo: null, tono: "cercano", imagenes: [FOTO], base: null, negocio: negocioPorDefecto(WEB) });
    expect(u).toContain(`${WEB}/presupuesto`);
    expect(u).toContain(FOTO);
  });
});
