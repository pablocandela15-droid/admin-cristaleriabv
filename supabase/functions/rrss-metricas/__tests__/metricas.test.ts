// rrss-metricas: el cron sin conexión no llama a Meta, «Actualizar ahora» como mucho cada 5 minutos, la captura
// guarda la cuenta (3 días), los seguidores de la página y las publicaciones enlazadas con sus piezas, y la falta del
// permiso de métricas se explica. Sin red.
import { describe, expect, it } from "vitest";
import { manejarMetricas, type RegistroCapturas } from "../metricas";
import type { Almacen } from "../capturar";
import { ClienteGraph } from "../../_shared/rrss/cliente";
import { configMeta } from "../../_shared/rrss/config";
import { cifrar } from "../../_shared/rrss/cifrado";
import { graphFalsa, repoFalso } from "../../_shared/__tests__/rrss-falsos";

const SECRETO = "secreto-de-la-app-de-prueba";
const IG = "17841400000000001";
const config = configMeta((n) => ({ SUPABASE_URL: "https://x.supabase.co", META_APP_ID: "1", META_APP_SECRET: SECRETO } as Record<string, string>)[n]);
const post = () => new Request("https://x/rrss-metricas", { method: "POST", body: JSON.stringify({ accion: "capturar" }) });

function preparar(rutas: Parameters<typeof graphFalsa>[0], o: { origen?: "cron" | null; ultima?: string | null } = {}) {
  const g = graphFalsa(rutas);
  const repo = repoFalso();
  const guardado: Record<string, Record<string, unknown>[]> = { rrss_metricas_cuenta: [], rrss_metricas_publicacion: [] };
  const almacen: Almacen = {
    async guardar(tabla, filas) { guardado[tabla].push(...filas); },
    async piezasDe(ids) { return new Map(ids.filter((i) => i === "17900000000000001").map((i) => [i, "pieza-1"])); },
  };
  const registro: Array<Record<string, unknown>> = [];
  const capturas: RegistroCapturas = {
    async ultimaDelPanel() { return o.ultima ?? null; },
    async empezar(origen) { registro.push({ origen }); return 1; },
    async terminar(_id, r) { registro.push(r); },
  };
  const ahora = () => Date.parse("2026-11-25T05:10:00Z");
  const llamar = () => manejarMetricas(post(), {
    config, repo, almacen, capturas, ahora,
    origenServidor: () => (o.origen === undefined ? "cron" : o.origen),
    autorizar: async () => ({ ok: true as const, userId: "u" }),
    crearCliente: (t, limite) => new ClienteGraph({ token: t, fetch: g.fetch, limite, ahora }),
  });
  return { g, repo, guardado, registro, llamar };
}

async function conectar(repo: ReturnType<typeof repoFalso>) {
  repo.cuenta = { ...repo.cuenta, estado: "conectada", origen: "conexion", ig_user_id: IG, fb_pagina_id: "100000000000001" };
  repo.tokens = { token_usuario: null, token_pagina: await cifrar("EAAPaginaToken1234567890", SECRETO), candidatos: null };
}

describe("rrss-metricas", () => {
  it("cron sin conexión: no hace nada ni llama a Meta", async () => {
    const { g, registro, llamar } = preparar({});
    expect(await (await llamar()).json()).toEqual({ ok: true, omitida: "sin_conexion" });
    expect(g.llamadas).toHaveLength(0);
    expect(registro).toHaveLength(0);
  });

  it("«Actualizar ahora» desde el panel, como mucho una vez cada 5 minutos", async () => {
    const { llamar } = preparar({}, { origen: null, ultima: "2026-11-25T05:08:00Z" });
    const r = await llamar();
    expect(r.status).toBe(429);
    expect((await r.json()).tipo).toBe("demasiado_pronto");
  });

  it("captura la cuenta, los seguidores de la página y las publicaciones", async () => {
    const insight = (n: number) => ({ body: { data: [{ name: "reach", total_value: { value: n } }, { name: "total_interactions", total_value: { value: 7 } }] } });
    const t = graphFalsa({});
    void t;
    const { repo, guardado, registro, llamar } = preparar({
      [`GET /${IG}/insights`]: (l) => (l.consulta.metric === "profile_views" ? { body: { data: [{ name: "profile_views", total_value: { value: 4 } }] } } : insight(100)),
      [`GET /${IG}`]: { body: { followers_count: 512 } },
      "GET /100000000000001": { body: { followers_count: 900 } },
      [`GET /${IG}/media`]: { body: { data: [{ id: "17900000000000001", caption: "Mampara en Elche #mamparas #elche", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-11-20T11:30:00+0000", permalink: "https://www.instagram.com/p/a/", media_url: "https://cdn.example.com/a.jpg" }] } },
      [`GET /${IG}/stories`]: { body: { data: [] } },
      "GET /17900000000000001/insights": { body: { data: [{ name: "reach", values: [{ value: 300 }] }, { name: "saved", values: [{ value: 5 }] }, { name: "total_interactions", values: [{ value: 30 }] }] } },
    });
    await conectar(repo);
    const r = await (await llamar()).json();
    expect(r).toMatchObject({ ok: true, fechaCaptura: "2026-11-25", dias: ["2026-11-24", "2026-11-23", "2026-11-22"], publicaciones: 1 });
    const cuenta = guardado.rrss_metricas_cuenta;
    expect(cuenta.filter((f) => f.red === "instagram")).toHaveLength(3);
    expect(cuenta[0]).toMatchObject({ fecha: "2026-11-24", cuenta_id: IG, alcance: 100, interacciones: 7, visitas_perfil: 4, seguidores: 512 });
    expect(cuenta[1].seguidores).toBeUndefined();
    expect(cuenta.find((f) => f.red === "facebook")).toMatchObject({ fecha: "2026-11-25", cuenta_id: "100000000000001", seguidores: 900 });
    expect(guardado.rrss_metricas_publicacion[0]).toMatchObject({ media_id: "17900000000000001", pieza_id: "pieza-1", alcance: 300, guardados: 5, interacciones: 30,
      hashtags: ["#mamparas", "#elche"], publicado_local: "2026-11-20T12:30:00" });
    expect(registro[0]).toEqual({ origen: "cron" });
    expect(registro[1]).toMatchObject({ ok: true, dias: 3, publicaciones: 1 });
  });

  it("sin el permiso de métricas: se explica cómo arreglarlo y queda apuntado", async () => {
    const { repo, registro, llamar } = preparar({ [`GET /${IG}/insights`]: { status: 403, body: { error: { message: "(#10) requires instagram_manage_insights permission", code: 10 } } } });
    await conectar(repo);
    const r = await llamar();
    const cuerpo = await r.json();
    expect(r.status).toBe(502);
    expect(cuerpo.tipo).toBe("permiso_insights");
    expect(cuerpo.comoArreglarlo).toMatch(/Renovar conexión/);
    expect(registro[1]).toMatchObject({ ok: false, errorTipo: "permiso_insights" });
  });
});
