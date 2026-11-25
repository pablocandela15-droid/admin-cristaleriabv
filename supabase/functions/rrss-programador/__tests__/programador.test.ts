// rrss-programador: qué se hace con cada programación según lo que pasó al publicar, una pasada completa (Instagram
// publicada, sin conexión → reintentar, error definitivo → aviso en la campana), el repaso de lo que Meta procesaba,
// el mantenimiento (cubo y aviso de caducidad). Y rrss-publicar («Publicar ahora»). Sin red.
import { describe, expect, it } from "vitest";
import { cierreDeProgramacion, diasFicheros, mantenimiento, pasadaProgramador } from "../programador";
import { manejarPublicar } from "../../rrss-publicar/publicar";
import { ClienteGraph } from "../../_shared/rrss/cliente";
import { configMeta } from "../../_shared/rrss/config";
import { cifrar } from "../../_shared/rrss/cifrado";
import { graphFalsa, medio, pieza, repoFalso, UUID } from "../../_shared/__tests__/rrss-falsos";

const SECRETO = "secreto-de-la-app-de-prueba";
const IG = "17841400000000001";
const ENV: Record<string, string> = { SUPABASE_URL: "https://x.supabase.co", META_APP_ID: "123456", META_APP_SECRET: SECRETO };
const config = configMeta((n) => ENV[n]);
const prog = (p: Partial<{ intentos: number; programada_para: string }> = {}) => ({ intentos: 0, programada_para: new Date(Date.now() - 60_000).toISOString(), ...p });

async function conectado(repo: ReturnType<typeof repoFalso>) {
  repo.cuenta = { ...repo.cuenta, estado: "conectada", origen: "conexion", ig_user_id: IG, fb_pagina_id: "100000000000001" };
  repo.tokens = { token_usuario: await cifrar("EAAUsuarioToken123456789", SECRETO), token_pagina: await cifrar("EAAPaginaToken1234567890", SECRETO), candidatos: null };
}

describe("cierreDeProgramacion", () => {
  it("publicada, procesando (aplazar sin contar intento hasta 2 h), cupo, en curso, errores", () => {
    expect(cierreDeProgramacion(prog(), { piezaId: "p", red: "instagram", estado: "publicada", mediaId: "1", permalink: "https://i" }, Date.now()))
      .toMatchObject({ resultado: "publicada", mediaId: "1" });
    expect(cierreDeProgramacion(prog(), { piezaId: "p", red: "instagram", estado: "procesando" }, Date.now())).toMatchObject({ resultado: "aplazar", esperaSeg: 60 });
    expect(cierreDeProgramacion(prog({ programada_para: new Date(Date.now() - 3 * 3600_000).toISOString() }), { piezaId: "p", red: "instagram", estado: "procesando" }, Date.now()))
      .toMatchObject({ resultado: "reintentar" });
    expect(cierreDeProgramacion(prog(), { piezaId: "p", red: "instagram", estado: "aplazada", esperaSeg: 1800 }, Date.now())).toMatchObject({ resultado: "aplazar", esperaSeg: 1800 });
    expect(cierreDeProgramacion(prog(), { piezaId: "p", red: "instagram", estado: "omitida", motivo: "en_curso" }, Date.now())).toMatchObject({ resultado: "aplazar" });
    expect(cierreDeProgramacion(prog({ intentos: 1 }), { piezaId: "p", red: "instagram", estado: "error", reintentable: true }, Date.now())).toMatchObject({ resultado: "reintentar", esperaSeg: 900 });
    expect(cierreDeProgramacion(prog(), { piezaId: "p", red: "instagram", estado: "error", reintentable: false, error: { error: "Token caducado", tipo: "token", comoArreglarlo: "Renueva" } }, Date.now()))
      .toMatchObject({ resultado: "error", mensaje: "Token caducado Renueva" });
  });
  it("días que se guardan los ficheros de lo publicado", () => {
    expect(diasFicheros(undefined)).toBe(30);
    expect(diasFicheros("7")).toBe(7);
    expect(diasFicheros("0")).toBe(30);
  });
});

describe("pasada del programador", () => {
  it("publica lo vencido con el mismo núcleo y cierra la programación", async () => {
    const repo = repoFalso({ piezas: [pieza()], medios: { [UUID(1)]: [medio(0)] } });
    await conectado(repo);
    repo.programaciones.push({ id: UUID(60), pieza_id: UUID(1), red: "instagram", programada_para: new Date().toISOString(), estado: "programada", intentos: 0, bloqueo_id: "", cierres: [] });
    const g = graphFalsa({
      [`GET /${IG}/content_publishing_limit`]: { body: { data: [{ quota_usage: 0, config: { quota_total: 50 } }] } },
      [`POST /${IG}/media`]: { body: { id: "901" } },
      "GET /901": { body: { status_code: "FINISHED" } },
      [`POST /${IG}/media_publish`]: { body: { id: "17900000000000001" } },
      "GET /17900000000000001": { body: { permalink: "https://www.instagram.com/p/z/" } },
    });
    const r = await pasadaProgramador({ config, repo, ahora: Date.now, intervaloSondeoMs: 1, crearCliente: (t, limite) => new ClienteGraph({ token: t, fetch: g.fetch, limite, dormir: async () => undefined }) });
    expect(r.resultados).toEqual([{ programacionId: UUID(60), piezaId: UUID(1), red: "instagram", resultado: "publicada", mensaje: null }]);
    expect(repo.programaciones[0].cierres[0]).toMatchObject({ resultado: "publicada", mediaId: "17900000000000001" });
    expect(repo.piezas.get(UUID(1))!.estado).toBe("publicada");
  });

  it("sin conexión: reintentar más tarde (sin llamar a Meta); al tercer fallo, aviso en la campana", async () => {
    const repo = repoFalso({ piezas: [pieza()], medios: { [UUID(1)]: [medio(0)] } });
    repo.programaciones.push({ id: UUID(61), pieza_id: UUID(1), red: "instagram", programada_para: new Date().toISOString(), estado: "programada", intentos: 2, bloqueo_id: "", cierres: [] });
    const g = graphFalsa({});
    const r = await pasadaProgramador({ config, repo, ahora: Date.now, crearCliente: (t) => new ClienteGraph({ token: t, fetch: g.fetch }) });
    expect(r.resultados[0]).toMatchObject({ resultado: "reintentar" });
    expect(g.llamadas).toHaveLength(0);
    expect(repo.avisos).toHaveLength(1);
    expect(repo.avisos[0]).toMatchObject({ tipo: "rrss_publicacion_error", enlace: "/rrss?tab=calendario" });
  });

  it("termina lo que Meta estaba procesando aunque no esté programado", async () => {
    const repo = repoFalso({ piezas: [pieza({ estado: "procesando", formato: "reel", proporcion: "9:16", contenedor_id: "700" })], medios: { [UUID(1)]: [medio(0, { tipo: "video", ruta: `subidas/${UUID(9)}/${UUID(800)}.mp4`, duracion_s: 30 })] } });
    await conectado(repo);
    const g = graphFalsa({
      "GET /700": { body: { status_code: "FINISHED" } },
      [`POST /${IG}/media_publish`]: { body: { id: "17900000000000700" } },
      "GET /17900000000000700": { body: { permalink: "https://www.instagram.com/reel/a/" } },
    });
    const r = await pasadaProgramador({ config, repo, ahora: Date.now, crearCliente: (t, limite) => new ClienteGraph({ token: t, fetch: g.fetch, limite }) });
    expect(r.resultados).toEqual([{ programacionId: null, piezaId: UUID(1), red: "instagram", resultado: "publicada", mensaje: null }]);
    expect(g.llamadas.filter((l) => l.metodo === "POST" && l.ruta === `/${IG}/media`)).toHaveLength(0);
  });
});

describe("mantenimiento", () => {
  it("borra del cubo lo que se puede, marca las piezas y avisa (una sola vez) si la conexión caduca pronto", async () => {
    const repo = repoFalso();
    await conectado(repo);
    repo.ficherosParaBorrar = async () => [{ ruta: "subidas/a/1.jpg", motivo: "huerfano" }, { ruta: "subidas/a/2.jpg", motivo: "publicada" }];
    let marcadas: string[] = [];
    repo.marcarMediosBorrados = async (rutas) => { marcadas = rutas; return 1; };
    const ahora = Date.parse("2026-11-25T03:50:00Z");
    const caduca = Math.floor(Date.parse("2026-12-02T00:00:00Z") / 1000);
    const g = graphFalsa({ "GET /debug_token": { body: { data: { is_valid: true, expires_at: 0, data_access_expires_at: caduca, scopes: ["instagram_basic"] } } } });
    const fetchGlobal = globalThis.fetch;
    globalThis.fetch = g.fetch as typeof fetch;
    try {
      const r = await mantenimiento({ config, repo, ahora: () => ahora, crearCliente: (t) => new ClienteGraph({ token: t, fetch: g.fetch }) });
      expect(r).toMatchObject({ ficherosBorrados: 2, piezasMarcadas: 1, conexion: { nivel: "aviso", aviso: true } });
      expect(marcadas).toEqual(["subidas/a/2.jpg"]);
      expect(repo.avisos[0]).toMatchObject({ tipo: "rrss_conexion", enlace: "/rrss?tab=conexion" });
      expect(repo.avisos[0].mensaje).toMatch(/caduca en 6 días/);
      const otra = await mantenimiento({ config, repo, ahora: () => ahora + 3600_000, crearCliente: (t) => new ClienteGraph({ token: t, fetch: g.fetch }) });
      expect(otra.conexion?.aviso).toBe(false);
      expect(repo.avisos).toHaveLength(1);
    } finally {
      globalThis.fetch = fetchGlobal;
    }
  });
});

describe("rrss-publicar", () => {
  const post = (cuerpo: unknown) => new Request("https://x/rrss-publicar", { method: "POST", body: JSON.stringify(cuerpo) });
  const autorizar = async () => ({ ok: true as const, userId: "u" });

  it("sin conexión: 503 explicado, sin llamar a Meta", async () => {
    const repo = repoFalso({ piezas: [pieza()] });
    const g = graphFalsa({});
    const r = await manejarPublicar(post({ piezaIds: [UUID(1)] }), { config, repo, autorizar, crearCliente: (t) => new ClienteGraph({ token: t, fetch: g.fetch }) });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, tipo: "sin_conexion" });
    expect(g.llamadas).toHaveLength(0);
  });

  it("entrada: de 1 a 4 publicaciones con id válido", async () => {
    const repo = repoFalso();
    for (const piezaIds of [[], ["no-es-uuid"], Array.from({ length: 5 }, (_, i) => UUID(i + 1))]) {
      expect((await manejarPublicar(post({ piezaIds }), { config, repo, autorizar, crearCliente: (t) => new ClienteGraph({ token: t }) })).status).toBe(400);
    }
  });

  it("publica Instagram y luego Facebook; si una falla lo dice por red", async () => {
    const repo = repoFalso({
      piezas: [pieza({ id: UUID(2), red: "facebook", caption: "Barandilla de vidrio" }), pieza()],
      medios: { [UUID(1)]: [medio(0)], [UUID(2)]: [medio(0)] },
    });
    await conectado(repo);
    const g = graphFalsa({
      [`GET /${IG}/content_publishing_limit`]: { body: { data: [{ quota_usage: 0, config: { quota_total: 50 } }] } },
      [`POST /${IG}/media`]: { body: { id: "901" } },
      "GET /901": { body: { status_code: "FINISHED" } },
      [`POST /${IG}/media_publish`]: { body: { id: "17900000000000001" } },
      "GET /17900000000000001": { body: { permalink: "https://www.instagram.com/p/z/" } },
      "POST /100000000000001/photos": { status: 403, body: { error: { message: "(#200) requires pages_manage_posts", code: 200 } } },
    });
    const r = await (await manejarPublicar(post({ piezaIds: [UUID(2), UUID(1)] }), { config, repo, autorizar, intervaloSondeoMs: 1,
      crearCliente: (t, limite) => new ClienteGraph({ token: t, fetch: g.fetch, limite, dormir: async () => undefined }) })).json();
    expect(r.ok).toBe(false);
    expect(r.resultados.map((x: { red: string; estado: string }) => [x.red, x.estado])).toEqual([["instagram", "publicada"], ["facebook", "error"]]);
    expect(r.resultados[1].error.tipo).toBe("permisos");
    expect(JSON.stringify(r)).not.toMatch(/EAA/);
  });
});
