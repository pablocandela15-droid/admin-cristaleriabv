// @vitest-environment node
// rrss-ia: sin clave no llama a OpenAI; textos de cristalería (con las fotos que ve la IA), ideas, campañas guardadas
// como propuesta y «aprender» (con datos suficientes); los validadores quitan correos, teléfonos y emojis de más y
// descartan precios, ofertas o temas de restaurante que nadie ha pedido. Sin red.
import { describe, expect, it, vi } from "vitest";

// registrar-uso-ia.ts importa supabase-js por URL (Deno): aquí no hace falta (el registro va simulado).
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: vi.fn() }));

import { errorReserva, manejarIA, type DependenciasIA } from "../ia";
import { anonimizar, limpiarHashtags, normalizarCampana, normalizarTextos, revisarTexto } from "../validar";
import { sistemaTextos, REGLAS_COMUNES } from "../prompts";
import type { AcumuladorUso } from "../../_shared/registrar-uso-ia";

const post = (cuerpo: unknown) => new Request("https://x/rrss-ia", { method: "POST", body: JSON.stringify(cuerpo) });

function openAIFalso(respuestas: unknown[]) {
  const peticiones: Array<{ messages: Array<{ role: string; content: unknown }>; response_format: { json_schema: { name: string } } }> = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    peticiones.push(JSON.parse(String(init?.body)));
    const r = respuestas.length > 1 ? respuestas.shift() : respuestas[0];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status: 200 });
  }) as typeof fetch;
  return { fetch, peticiones };
}

function deps(extra: Partial<DependenciasIA> = {}): DependenciasIA & { reservas: string[]; campanas: unknown[]; registrado: AcumuladorUso[] } {
  const reservas: string[] = [];
  const campanas: unknown[] = [];
  const registrado: AcumuladorUso[] = [];
  return {
    reservas, campanas, registrado,
    clave: "sk-prueba",
    autorizar: async () => ({ ok: true, userId: "usuario-1" }),
    modelo: async () => "gpt-4.1-mini",
    reservar: async (accion) => { reservas.push(accion); return reservas.length; },
    marcar: async () => undefined,
    contexto: async () => ({
      estilo: { zona: "Elche y el Baix Vinalopó", tono: "cercano", guia: "Cristalería de barrio con taller propio.", hashtags_base: ["#cristaleria", "#elche"], ctas: ["Pide presupuesto sin compromiso"], palabras_evitar: ["barato"], emojis: true },
      negocio: { nombre: "Cristalería Baix Vinalopó", web: "https://cristaleriabv.vercel.app", municipio: "Elche" },
      queFunciona: null,
      ganchosRecientes: ["Mampara nueva en un baño de Elche"],
    }),
    fechasEntre: async () => [{ clave: "navidad", titulo: "Navidad" }],
    publicacionesRecientes: async () => [],
    firmar: async (rutas) => rutas.map((r) => `https://x.supabase.co/storage/v1/object/sign/rrss/${r}?token=abc`),
    guardarCampana: async (c) => { campanas.push(c); return "campana-1"; },
    registrar: async (uso) => { registrado.push(uso); },
    ahora: () => Date.parse("2026-11-25T10:00:00Z"),
    ...extra,
  };
}

const variante = (p: Record<string, unknown> = {}) => ({ enfoque: "trabajo", gancho: "Mampara de cristal templado en Elche", caption: "Mampara de cristal templado en Elche. Hoja fija y perfil negro: el baño gana luz y se limpia en un momento. Pide presupuesto sin compromiso.", hashtags: ["#mamparas", "elche", "#love", "#Mamparas"], alt_text: "Mampara de ducha con perfil negro", ...p });

describe("rrss-ia", () => {
  it("sin OPENAI_API_KEY: 503 «ia_no_disponible» sin reservar ni llamar", async () => {
    const d = deps({ clave: "" });
    const r = await manejarIA(post({ accion: "textos", red: "instagram", formato: "foto" }), d);
    expect(r.status).toBe(503);
    expect((await r.json()).tipo).toBe("ia_no_disponible");
    expect(d.reservas).toEqual([]);
  });

  it("entrada: acción, red y formato; las historias no llevan texto; descripción acotada", async () => {
    const d = deps();
    expect((await manejarIA(post({ accion: "otra" }), d)).status).toBe(400);
    expect((await manejarIA(post({ accion: "textos", red: "tiktok", formato: "foto" }), d)).status).toBe(400);
    expect((await manejarIA(post({ accion: "textos", red: "instagram", formato: "story" }), d)).status).toBe(400);
    expect((await manejarIA(post({ accion: "textos", red: "instagram", formato: "foto", descripcion: "x".repeat(801) }), d)).status).toBe(400);
  });

  it("textos: tres variantes de cristalería, la IA ve las fotos, se limpian los hashtags y se registra el gasto", async () => {
    const o = openAIFalso([{ variantes: [variante(), variante({ enfoque: "problema" }), variante({ enfoque: "consejo" })] }]);
    const d = deps({ fetch: o.fetch });
    const ruta = "subidas/00000000-0000-4000-8000-000000000009/00000000-0000-4000-8000-000000000701.jpg";
    const r = await (await manejarIA(post({ accion: "textos", red: "instagram", formato: "foto", servicio: "mamparas", descripcion: "Mampara en Elche, llamadme al 612 345 678", rutas: [ruta, "../malo.jpg"] }), d)).json();
    expect(r.ok).toBe(true);
    expect(r.variantes).toHaveLength(3);
    expect(r.variantes[0].hashtags).toEqual(["#mamparas", "#elche"]);
    const usuario = o.peticiones[0].messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(usuario.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(usuario[0].text).toContain("mamparas de ducha y baño");
    expect(usuario[0].text).not.toContain("612 345 678");
    expect(o.peticiones[0].messages[0].content).toMatch(/cristalería de Elche/);
    expect(o.peticiones[0].response_format.json_schema.name).toBe("textos_rrss");
    expect(d.reservas).toEqual(["textos"]);
    expect(d.registrado).toHaveLength(1);
  });

  it("si nada vale, reintenta una vez con los motivos y si sigue mal responde 422 con lo descartado", async () => {
    const mala = { variantes: [variante({ caption: "Mampara a 199 € solo esta semana, ¡oferta! Pide presupuesto sin compromiso." })] };
    const o = openAIFalso([mala]);
    const r = await manejarIA(post({ accion: "textos", red: "instagram", formato: "foto" }), deps({ fetch: o.fetch }));
    expect(r.status).toBe(422);
    const cuerpo = await r.json();
    expect(cuerpo.descartadas[0].motivos.join(" ")).toMatch(/Precio que no ha dicho nadie/);
    expect(o.peticiones).toHaveLength(2);
    expect(String(o.peticiones[1].messages.at(-1)?.content)).toMatch(/No vale/);
  });

  it("campaña: se guarda como propuesta con sus piezas dentro de las fechas", async () => {
    const campana = {
      titulo: "Baños nuevos antes de Navidad", objetivo: "Más presupuestos de mamparas", publico: "Familias de Elche", mensaje: "Un baño más fácil de limpiar", razonamiento: "Antes de las visitas de Navidad.",
      fases: [{ nombre: "Inspiración", desde: "2026-11-26", hasta: "2026-12-02", objetivo: "Enseñar trabajos" }],
      piezas: [
        { fecha: "2026-11-27", hora: "13:00", formato: "foto", servicio: "mamparas", titulo: "Antes y después", idea: "Foto del baño", caption: "De bañera a ducha con mampara fija. Pide presupuesto sin compromiso.", hashtags: ["#mamparas"], porQue: "Inspira", fase: "Inspiración" },
        { fecha: "2027-03-01", hora: "13:00", formato: "foto", servicio: "mamparas", titulo: "Fuera", idea: "x", caption: "Fuera de fechas", hashtags: [], porQue: "x", fase: "x" },
      ],
    };
    const d = deps({ fetch: openAIFalso([campana]).fetch });
    const r = await (await manejarIA(post({ accion: "campana", semanas: 2, piezasPorSemana: 2, descripcion: "Empujar mamparas" }), d)).json();
    expect(r).toMatchObject({ ok: true, campanaId: "campana-1" });
    expect(r.campana.piezas).toHaveLength(1);
    expect(r.descartadas[0]).toMatchObject({ donde: "pieza 2", motivos: ["Fecha fuera de la campaña."] });
    expect(d.campanas[0]).toMatchObject({ desde: "2026-11-26", hasta: "2026-12-09", peticion: "Empujar mamparas" });
  });

  it("ideas de la semana (se toma su lunes) y «aprender» con pocos datos", async () => {
    const ideas = { ideas: [{ fecha: "2026-12-01", titulo: "Montaje", idea: "Reel del montaje de una mampara", formato: "reel", servicio: "mamparas", gancho: "Así se monta una mampara", como_grabarlo: "Plano general y detalle del perfil", motivo: "Temporada de reformas" }] };
    const r = await (await manejarIA(post({ accion: "ideas", semana: "2026-12-03" }), deps({ fetch: openAIFalso([ideas]).fetch }))).json();
    expect(r).toMatchObject({ ok: true, desde: "2026-11-30", hasta: "2026-12-06" });
    expect(r.ideas[0]).toMatchObject({ formato: "reel", comoGrabarlo: "Plano general y detalle del perfil" });
    const a = await manejarIA(post({ accion: "aprender" }), deps({ fetch: openAIFalso([{}]).fetch }));
    expect(a.status).toBe(422);
    expect((await a.json()).tipo).toBe("faltan_datos");
  });

  it("aprender con datos: propone guía, hashtags y CTA (no los aplica)", async () => {
    const pubs = Array.from({ length: 8 }, (_, i) => ({ fecha: "2026-11-01", formato: i < 4 ? "reel" : "foto", caption: `Trabajo ${i}`, alcance: 500, tasa: i < 4 ? 9 : 4 }));
    const propuesta = { resumen: "Los reels funcionan mejor: 9 % frente a 4 %.", cambios: ["Más reels de montajes"], guia: "Cristalería de barrio con taller propio en Elche: enseñamos montajes en vídeo y explicamos qué problema resolvemos.", hashtags_base: ["#cristaleria", "#elche", "#mamparas"], ctas: ["Pide presupuesto sin compromiso"], palabras_evitar: [] };
    const r = await (await manejarIA(post({ accion: "aprender" }), deps({ fetch: openAIFalso([propuesta]).fetch, publicacionesRecientes: async () => pubs }))).json();
    expect(r).toMatchObject({ ok: true, publicaciones: 8, propuesta: { hashtagsBase: ["#cristaleria", "#elche", "#mamparas"] } });
  });

  it("el tope diario y la falta de migración se explican", () => {
    expect(errorReserva(400, "P0001 rrss_cupo_ia: tope diario por usuario")).toMatchObject({ estado: 429 });
    expect(errorReserva(404, "relation does not exist")).toMatchObject({ estado: 503 });
    expect(errorReserva(403, "new row violates row-level security policy")).toMatchObject({ estado: 403 });
  });
});

describe("validadores y prompts", () => {
  it("anonimiza lo que escribe la persona", () => {
    expect(anonimizar("Llama a ana@example.com o al 612 345 678, DNI 12345678Z")).toBe("Llama a [correo] o al [teléfono], DNI [documento]");
  });
  it("hashtags con #, sin genéricos ni repetidos", () => {
    const avisos: string[] = [];
    expect(limpiarHashtags(["mamparas", "#Mamparas", "#love", "#elche ", "#", "baix vinalopó"], 15, avisos)).toEqual(["#mamparas", "#elche", "#baixvinalopó"]);
    expect(avisos[0]).toMatch(/genérico/);
  });
  it("revisa los textos: quita lo que se puede y rechaza lo que no", () => {
    const avisos: string[] = [];
    const o = { fuente: "precio 199 € esta semana", emojis: false, palabrasEvitar: ["barato"] };
    expect(revisarTexto("Mampara a 199 € ✨ en www.example.com", o, avisos)).toEqual({ texto: "Mampara a 199 € en", motivos: [] });
    expect(avisos.join(" ")).toMatch(/enlaces.*emojis/);
    expect(revisarTexto("Con 5 años de garantía", o, []).motivos[0]).toMatch(/Promete/);
    expect(revisarTexto("Ven a probar nuestra carta de tapas", o, []).motivos.join(" ")).toMatch(/no es de una cristalería/);
    expect(revisarTexto("Un trabajo barato", o, []).motivos[0]).toMatch(/palabra a evitar/);
    expect(revisarTexto("Mampara en el Baix Vinalopó con vinilo al ácido", o, []).motivos).toEqual([]);
  });
  it("las variantes sacan los hashtags del texto y respetan el máximo de Facebook", () => {
    const n = normalizarTextos({ variantes: [variante({ caption: "Cerramiento de terraza en Santa Pola: más espacio todo el año. #cerramientos #santapola" })] }, { fuente: "", emojis: true, red: "facebook" });
    expect(n.variantes[0].caption).toBe("Cerramiento de terraza en Santa Pola: más espacio todo el año.");
    expect(n.variantes[0].hashtags.length).toBeLessThanOrEqual(3);
  });
  it("campaña sin piezas válidas no vale", () => {
    expect(normalizarCampana({ titulo: "x", objetivo: "", publico: "", mensaje: "", razonamiento: "", fases: [], piezas: [] }, { fuente: "", emojis: true, desde: "2026-11-26", hasta: "2026-12-09", maxPiezas: 4 }).campana).toBeNull();
  });
  it("los prompts son de cristalería y prohíben lo de restaurante", () => {
    const s = sistemaTextos({ red: "instagram", formato: "foto", emojis: false });
    expect(s).toMatch(/mamparas/);
    expect(s).toMatch(/NUNCA uses emojis/);
    expect(REGLAS_COMUNES.join(" ")).toMatch(/nada de comida, restaurantes, reservas/);
  });
});
