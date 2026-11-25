// RRSS · núcleo de publicación (motor.ts + publicacion.ts) contra una Graph API falsa: Instagram (foto, carrusel con
// vídeo, reel que se queda procesando, contenedor ya publicado, media_publish que se corta, cupo agotado, token de
// respaldo) y Facebook (foto, varias fotos, vídeo, publicación dudosa). Nunca se publica dos veces y el token no sale.
import { describe, expect, it } from "vitest";
import { ClienteGraph } from "../rrss/cliente";
import type { Credenciales } from "../rrss/credenciales";
import { publicarConReserva } from "../rrss/publicacion";
import { graphFalsa, medio, pieza, repoFalso, UUID } from "./rrss-falsos";

const IG = "17841400000000001";
const PAGINA = "100000000000001";
const cred = (p: Partial<Credenciales> = {}): Credenciales => ({
  origen: "conexion", igUserId: IG, paginaId: PAGINA, tokenInstagram: "EAAPaginaToken1234567890abcdef", tokenInstagramRespaldo: null,
  tokenPagina: "EAAPaginaToken1234567890abcdef", ...p,
});

function preparar(rutas: Parameters<typeof graphFalsa>[0], opciones: { piezas?: ReturnType<typeof pieza>[]; medios?: Record<string, ReturnType<typeof medio>[]>; cred?: Credenciales; programada?: boolean } = {}) {
  const g = graphFalsa(rutas);
  const repo = repoFalso({ piezas: opciones.piezas ?? [pieza()], medios: opciones.medios ?? { [UUID(1)]: [medio(0)] } });
  let reloj = 1_000_000;
  const ahora = () => reloj;
  const dormir = async (ms: number) => { reloj += ms; };
  const limite = reloj + 110_000;
  const publicar = (id = UUID(1)) => publicarConReserva(id, {
    repo, cred: opciones.cred ?? cred(), ahora, limite, programada: opciones.programada ?? false, intervaloSondeoMs: 5_000,
    crearCliente: (token) => new ClienteGraph({ token, fetch: g.fetch, ahora, dormir, limite, esperaBaseMs: 10 }),
  });
  return { g, repo, publicar };
}

const cupo = { body: { data: [{ quota_usage: 2, config: { quota_total: 50 } }] } };

describe("Instagram", () => {
  it("foto: contenedor con URL firmada, FINISHED, media_publish y enlace; todo guardado", async () => {
    const { g, repo, publicar } = preparar({
      [`GET /${IG}/content_publishing_limit`]: cupo,
      [`POST /${IG}/media`]: { body: { id: "900001" } },
      "GET /900001": { body: { status_code: "FINISHED" } },
      [`POST /${IG}/media_publish`]: { body: { id: "17900000000000001" } },
      "GET /17900000000000001": { body: { permalink: "https://www.instagram.com/p/abc/" } },
    });
    const r = await publicar();
    expect(r).toMatchObject({ estado: "publicada", mediaId: "17900000000000001", permalink: "https://www.instagram.com/p/abc/" });
    const crear = g.llamadas.find((l) => l.metodo === "POST" && l.ruta === `/${IG}/media`)!;
    expect(crear.cuerpo.image_url).toMatch(/\/object\/sign\/rrss\/subidas\//);
    expect(crear.cuerpo.caption).toBe("Mampara a medida en Elche #mamparas");
    expect(crear.auth).toBe("Bearer EAAPaginaToken1234567890abcdef");
    expect(repo.piezas.get(UUID(1))).toMatchObject({ estado: "publicada", contenedor_id: "900001", media_id: "17900000000000001", reserva_id: null });
    expect(g.llamadas.filter((l) => l.ruta.endsWith("/media_publish"))).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("EAAPagina");
  });

  it("carrusel con un vídeo: un hijo por elemento (en orden), espera a todos y publica el carrusel", async () => {
    const id = UUID(1);
    const { g, repo, publicar } = preparar({
      [`GET /${IG}/content_publishing_limit`]: cupo,
      [`POST /${IG}/media`]: [{ body: { id: "801" } }, { body: { id: "802" } }, { body: { id: "803" } }],
      "GET /801": { body: { status_code: "FINISHED" } },
      "GET /802": [{ body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "FINISHED" } }],
      "GET /803": { body: { status_code: "FINISHED" } },
      [`POST /${IG}/media_publish`]: { body: { id: "17900000000000002" } },
      "GET /17900000000000002": { body: { permalink: "https://www.instagram.com/p/car/" } },
    }, { piezas: [pieza({ formato: "carrusel" })], medios: { [id]: [medio(0, { alt_text: "Mampara corredera" }), medio(1, { tipo: "video", ruta: `subidas/${UUID(9)}/${UUID(801)}.mp4`, duracion_s: 20 })] } });
    const r = await publicar();
    expect(r.estado).toBe("publicada");
    const posts = g.llamadas.filter((l) => l.metodo === "POST" && l.ruta === `/${IG}/media`).map((l) => l.cuerpo);
    expect(posts[0]).toMatchObject({ is_carousel_item: "true", alt_text: "Mampara corredera" });
    expect(posts[1]).toMatchObject({ is_carousel_item: "true", media_type: "VIDEO" });
    expect(posts[2]).toMatchObject({ media_type: "CAROUSEL", children: "801,802", caption: "Mampara a medida en Elche #mamparas" });
    expect(repo.piezas.get(id)).toMatchObject({ hijos: ["801", "802"], contenedor_id: "803" });
  });

  it("reel que Meta aún procesa al acabarse el tiempo: queda «procesando» con el contenedor guardado", async () => {
    const id = UUID(1);
    const { g, repo, publicar } = preparar({
      [`GET /${IG}/content_publishing_limit`]: cupo,
      [`POST /${IG}/media`]: { body: { id: "700" } },
      "GET /700": { body: { status_code: "IN_PROGRESS" } },
    }, { piezas: [pieza({ formato: "reel", proporcion: "9:16" })], medios: { [id]: [medio(0, { tipo: "video", ruta: `subidas/${UUID(9)}/${UUID(800)}.mp4`, duracion_s: 30, portada_ms: 1500 })] } });
    const r = await publicar();
    expect(r.estado).toBe("procesando");
    expect(g.llamadas.find((l) => l.metodo === "POST")!.cuerpo).toMatchObject({ media_type: "REELS", share_to_feed: "true", thumb_offset: "1500" });
    expect(repo.piezas.get(id)).toMatchObject({ estado: "procesando", contenedor_id: "700", reserva_id: null });
    expect(g.llamadas.some((l) => l.ruta.endsWith("/media_publish"))).toBe(false);
  });

  it("si la pieza ya tenía contenedor y Meta lo da por PUBLICADO, se recupera sin volver a publicar", async () => {
    const { g, repo, publicar } = preparar({
      "GET /555": { body: { status_code: "PUBLISHED" } },
      [`GET /${IG}/media`]: { body: { data: [{ id: "17900000000000555", caption: "Mampara a medida en Elche #mamparas", timestamp: new Date(1_000_000).toISOString(), permalink: "https://www.instagram.com/p/ya/" }] } },
    }, { piezas: [pieza({ estado: "procesando", contenedor_id: "555" })] });
    const r = await publicar();
    expect(r).toMatchObject({ estado: "publicada", mediaId: "17900000000000555" });
    expect(g.llamadas.some((l) => l.metodo === "POST")).toBe(false);
    expect(repo.piezas.get(UUID(1))!.media_id).toBe("17900000000000555");
  });

  it("media_publish que se corta: mira el contenedor y, si ya salió, no repite", async () => {
    const { g, publicar } = preparar({
      [`GET /${IG}/content_publishing_limit`]: cupo,
      [`POST /${IG}/media`]: { body: { id: "901" } },
      "GET /901": [{ body: { status_code: "FINISHED" } }, { body: { status_code: "PUBLISHED" } }],
      [`POST /${IG}/media_publish`]: { body: new TypeError("fetch failed") },
      [`GET /${IG}/media`]: { body: { data: [{ id: "17900000000000901", caption: "Mampara a medida en Elche #mamparas", timestamp: new Date(1_000_000).toISOString(), permalink: "https://www.instagram.com/p/x/" }] } },
    });
    const r = await publicar();
    expect(r).toMatchObject({ estado: "publicada", mediaId: "17900000000000901" });
    expect(g.llamadas.filter((l) => l.ruta.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("cupo de 24 h agotado: se aplaza sin crear nada (a mano queda en error explicado; programada, vuelve a «lista»)", async () => {
    const lleno = { body: { data: [{ quota_usage: 50, config: { quota_total: 50 } }] } };
    const a = preparar({ [`GET /${IG}/content_publishing_limit`]: lleno });
    expect(await a.publicar()).toMatchObject({ estado: "aplazada" });
    expect(a.g.llamadas.some((l) => l.metodo === "POST")).toBe(false);
    expect(a.repo.piezas.get(UUID(1))!.estado).toBe("error");
    const b = preparar({ [`GET /${IG}/content_publishing_limit`]: lleno }, { programada: true });
    await b.publicar();
    expect(b.repo.piezas.get(UUID(1))!.estado).toBe("lista");
  });

  it("si Meta rechaza el token de página por permisos, prueba una vez con el de usuario", async () => {
    const { g, publicar } = preparar({
      [`GET /${IG}/content_publishing_limit`]: (l) => l.auth?.includes("Pagina")
        ? { status: 400, body: { error: { message: "Missing permission", code: 10 } } } : cupo,
      [`POST /${IG}/media`]: { body: { id: "902" } },
      "GET /902": { body: { status_code: "FINISHED" } },
      [`POST /${IG}/media_publish`]: { body: { id: "17900000000000902" } },
      "GET /17900000000000902": { body: { permalink: "https://www.instagram.com/p/y/" } },
    }, { cred: cred({ tokenInstagramRespaldo: "EAAUsuarioToken1234567890abcdef" }) });
    const r = await publicar();
    expect(r.estado).toBe("publicada");
    expect(g.llamadas.find((l) => l.ruta.endsWith("/media_publish"))!.auth).toContain("Usuario");
  });

  it("un contenedor en ERROR deja la pieza en error explicado y sin contenedor (el siguiente intento crea otro)", async () => {
    const { repo, publicar } = preparar({
      [`GET /${IG}/content_publishing_limit`]: cupo,
      [`POST /${IG}/media`]: { body: { id: "903" } },
      "GET /903": { body: { status_code: "ERROR", status: "Error: 2207052 Media download has failed" } },
    });
    const r = await publicar();
    expect(r.estado).toBe("error");
    expect(r.error?.tipo).toBe("contenedor_error");
    expect(repo.piezas.get(UUID(1))).toMatchObject({ estado: "error", contenedor_id: null });
  });

  it("una pieza incompleta no llama a Meta", async () => {
    const { g, publicar } = preparar({}, { medios: { [UUID(1)]: [] } });
    const r = await publicar();
    expect(r).toMatchObject({ estado: "error", error: { tipo: "validacion" } });
    expect(g.llamadas).toHaveLength(0);
  });

  it("ya reservada o programada: no se toca", async () => {
    const a = preparar({}, { piezas: [pieza({ reserva_id: "otra" })] });
    expect(await a.publicar()).toMatchObject({ estado: "omitida", motivo: "en_curso" });
    const b = preparar({});
    b.repo.programaciones.push({ id: UUID(50), pieza_id: UUID(1), red: "instagram", programada_para: "", estado: "programada", intentos: 0, bloqueo_id: "", cierres: [] });
    expect(await b.publicar()).toMatchObject({ estado: "omitida", motivo: "programada" });
    expect(a.g.llamadas.length + b.g.llamadas.length).toBe(0);
  });
});

describe("Facebook", () => {
  const fb = (p = {}) => pieza({ id: UUID(2), red: "facebook", caption: "Cerramiento de terraza en Santa Pola", ...p });

  it("foto: POST /photos con el texto y el enlace de la publicación", async () => {
    const { g, publicar } = preparar({
      [`POST /${PAGINA}/photos`]: { body: { id: "400", post_id: `${PAGINA}_500` } },
      [`GET /${PAGINA}_500`]: { body: { permalink_url: "https://www.facebook.com/100000000000001/posts/500" } },
    }, { piezas: [fb()], medios: { [UUID(2)]: [medio(0)] } });
    const r = await publicar(UUID(2));
    expect(r).toMatchObject({ estado: "publicada", mediaId: `${PAGINA}_500`, permalink: "https://www.facebook.com/100000000000001/posts/500" });
    expect(g.llamadas[0].cuerpo).toMatchObject({ message: "Cerramiento de terraza en Santa Pola", published: "true" });
  });

  it("varias fotos: sin publicar (temporales) y luego una publicación con todas", async () => {
    const { g, repo, publicar } = preparar({
      [`POST /${PAGINA}/photos`]: [{ body: { id: "41" } }, { body: { id: "42" } }],
      [`POST /${PAGINA}/feed`]: { body: { id: `${PAGINA}_600` } },
      [`GET /${PAGINA}_600`]: { body: { permalink_url: "/100000000000001/posts/600" } },
    }, { piezas: [fb({ formato: "carrusel" })], medios: { [UUID(2)]: [medio(0), medio(1)] } });
    const r = await publicar(UUID(2));
    expect(r).toMatchObject({ estado: "publicada", permalink: "https://www.facebook.com/100000000000001/posts/600" });
    expect(g.llamadas.filter((l) => l.ruta.endsWith("/photos")).map((l) => l.cuerpo.published)).toEqual(["false", "false"]);
    expect(g.llamadas.find((l) => l.ruta.endsWith("/feed"))!.cuerpo).toMatchObject({ "attached_media[0]": '{"media_fbid":"41"}', "attached_media[1]": '{"media_fbid":"42"}' });
    expect(repo.piezas.get(UUID(2))!.hijos).toEqual(["41", "42"]);
  });

  it("vídeo: POST /videos con la URL firmada", async () => {
    const { g, publicar } = preparar({
      [`POST /${PAGINA}/videos`]: { body: { id: "777" } },
      "GET /777": { body: {} },
    }, { piezas: [fb({ formato: "reel", proporcion: "9:16" })], medios: { [UUID(2)]: [medio(0, { tipo: "video", ruta: `subidas/${UUID(9)}/${UUID(900)}.mp4`, duracion_s: 40 })] } });
    expect(await publicar(UUID(2))).toMatchObject({ estado: "publicada", mediaId: "777" });
    expect(g.llamadas[0].cuerpo.file_url).toMatch(/\.mp4\?token=/);
  });

  it("si la publicación se corta (red), no se repite: error «dudoso» pidiendo mirarlo en la página", async () => {
    const { g, repo, publicar } = preparar({ [`POST /${PAGINA}/photos`]: { body: new TypeError("fetch failed") } }, { piezas: [fb()], medios: { [UUID(2)]: [medio(0)] } });
    const r = await publicar(UUID(2));
    expect(r).toMatchObject({ estado: "error", error: { tipo: "dudoso" } });
    expect(r.error?.comoArreglarlo).toMatch(/Mira la página de Facebook/);
    expect(g.llamadas.filter((l) => l.ruta.endsWith("/photos"))).toHaveLength(1);
    expect(repo.piezas.get(UUID(2))!.estado).toBe("error");
  });

  it("sin página conectada: error explicado, sin llamar a Meta", async () => {
    const { g, publicar } = preparar({}, { piezas: [fb()], medios: { [UUID(2)]: [medio(0)] }, cred: cred({ paginaId: null, tokenPagina: null }) });
    expect(await publicar(UUID(2))).toMatchObject({ estado: "error", error: { tipo: "sin_pagina" } });
    expect(g.llamadas).toHaveLength(0);
  });
});
