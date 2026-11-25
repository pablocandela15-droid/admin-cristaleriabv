// rrss-conexion: estado sin llamar a Meta, «Conectar» (permiso, lista de paneles, state de un solo uso), elegir
// página, comprobar (explicado, nunca con tokens) y desconectar. Sin red.
import { describe, expect, it } from "vitest";
import { manejarConexion } from "../conexion";
import { configMeta } from "../../_shared/rrss/config";
import { cifrar } from "../../_shared/rrss/cifrado";
import { graphFalsa, repoFalso } from "../../_shared/__tests__/rrss-falsos";

const SECRETO = "secreto-de-la-app-de-prueba";
const BASE: Record<string, string> = { SUPABASE_URL: "https://gorekooabfhqudeshtgq.supabase.co" };
const CONFIG: Record<string, string> = { ...BASE, META_APP_ID: "123456", META_APP_SECRET: SECRETO };
const permitir = (modo = "edit") => async (_r: Request, m: "view" | "edit") =>
  m === "edit" && modo !== "edit" ? { ok: false as const, response: new Response(JSON.stringify({ error: "No tienes permiso" }), { status: 403 }) } : { ok: true as const, userId: "usuario-1" };

function deps(vars: Record<string, string>, extra: Partial<Parameters<typeof manejarConexion>[1]> = {}) {
  const env = (n: string) => vars[n];
  return { config: configMeta(env), env, repo: repoFalso(), autorizar: permitir(), iaDisponible: false, cronConfigurado: false, ...extra };
}
const post = (cuerpo: unknown) => new Request("https://x.supabase.co/functions/v1/rrss-conexion", { method: "POST", body: JSON.stringify(cuerpo) });

describe("rrss-conexion", () => {
  it("sin configurar: estado «sin conectar» con lo que falta (nombres de secretos), sin llamar a Meta", async () => {
    const g = graphFalsa({});
    const d = deps(BASE, { fetch: g.fetch });
    const r = await (await manejarConexion(new Request("https://x/rrss-conexion"), d)).json();
    expect(r).toMatchObject({ ok: true, estado: "sin_conectar", conectada: false, puedeConectar: false, faltan: ["META_APP_ID", "META_APP_SECRET"],
      redirectUri: "https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth", configuracion: { ia: false, cron: false } });
    const c = await (await manejarConexion(post({ accion: "comprobar" }), d)).json();
    expect(c.comprobaciones[0]).toMatchObject({ nombre: "Conexión", estado: "falla" });
    expect(c.comprobaciones[0].comoArreglarlo).toMatch(/META_APP_ID/);
    expect(g.llamadas).toHaveLength(0);
    const i = await manejarConexion(post({ accion: "iniciar", origen: "https://admin-cristaleriabv.vercel.app" }), d);
    expect(i.status).toBe(503);
  });

  it("«Conectar» exige «Editar», un panel de la lista y devuelve el diálogo con un state de un solo uso", async () => {
    const soloVer = deps(CONFIG, { autorizar: permitir("view") });
    expect((await manejarConexion(post({ accion: "iniciar", origen: "https://admin-cristaleriabv.vercel.app" }), soloVer)).status).toBe(403);
    const d = deps(CONFIG);
    expect((await manejarConexion(post({ accion: "iniciar", origen: "https://evil.example.com" }), d)).status).toBe(400);
    const r = await (await manejarConexion(post({ accion: "iniciar", origen: "https://admin-cristaleriabv.vercel.app/rrss" }), d)).json();
    const u = new URL(r.url);
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.searchParams.get("client_id")).toBe("123456");
    expect(u.searchParams.get("redirect_uri")).toBe("https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth");
    const state = u.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...d.repo.estados.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...d.repo.estados.keys()][0]).not.toBe(state);
    expect([...d.repo.estados.values()][0]).toMatchObject({ usuario_id: "usuario-1", volver_a: "https://admin-cristaleriabv.vercel.app" });
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  it("con el token de usuario del sistema no hace falta conectar", async () => {
    const d = deps({ ...CONFIG, IG_ACCESS_TOKEN: "EAASistemaToken1234567890abc", IG_USER_ID: "17841400000000001" });
    const r = await (await manejarConexion(new Request("https://x/rrss-conexion"), d)).json();
    expect(r).toMatchObject({ modo: "secretos", conectada: true });
    expect(JSON.stringify(r)).not.toContain("EAASistema");
    expect((await manejarConexion(post({ accion: "iniciar", origen: "https://admin-cristaleriabv.vercel.app" }), d)).status).toBe(409);
  });

  it("elegir una de las páginas candidatas", async () => {
    const d = deps(CONFIG, { fetch: graphFalsa({ "GET /debug_token": { body: { data: { is_valid: true, expires_at: 0, scopes: ["instagram_basic"] } } } }).fetch });
    d.repo.tokens.candidatos = await cifrar(JSON.stringify({ tokenUsuario: "EAAUsuario123456789012345", caducaUsuario: null, paginas: [
      { id: "100000000000002", nombre: "Cristalería", token: "EAAPagina2Token1234567890", tareas: [], instagram: { id: "17841400000000002", usuario: "cristaleria", nombre: null, foto: null } },
    ] }), SECRETO);
    d.repo.cuenta.estado = "eligiendo_pagina";
    expect((await manejarConexion(post({ accion: "elegir_pagina", paginaId: "999" }), d)).status).toBe(400);
    const r = await (await manejarConexion(post({ accion: "elegir_pagina", paginaId: "100000000000002" }), d)).json();
    expect(r).toMatchObject({ estado: "conectada", cuenta: { usuario: "cristaleria", paginaId: "100000000000002" } });
    expect(d.repo.tokens.candidatos).toBeNull();
  });

  it("comprobar: pregunta a Meta y lo explica en llano (y guarda permisos y caducidades)", async () => {
    const g = graphFalsa({
      "GET /debug_token": { body: { data: { is_valid: true, expires_at: 0, data_access_expires_at: Math.floor(Date.parse("2026-12-01T00:00:00Z") / 1000), scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"] } } },
      "GET /17841400000000001": { body: { id: "17841400000000001", username: "cristaleria", followers_count: 321 } },
      "GET /17841400000000001/content_publishing_limit": { body: { data: [{ quota_usage: 3, config: { quota_total: 50 } }] } },
      "GET /100000000000001": { body: { followers_count: 800 } },
    });
    const d = deps(CONFIG, { fetch: g.fetch, ahora: () => Date.parse("2026-11-25T10:00:00Z") });
    d.repo.cuenta = { ...d.repo.cuenta, estado: "conectada", origen: "conexion", ig_user_id: "17841400000000001", fb_pagina_id: "100000000000001", fb_pagina_nombre: "Cristalería" };
    d.repo.tokens = { token_usuario: await cifrar("EAAUsuarioToken123456789", SECRETO), token_pagina: await cifrar("EAAPaginaToken1234567890", SECRETO), candidatos: null };
    const r = await (await manejarConexion(post({ accion: "comprobar" }), d)).json();
    const por = Object.fromEntries(r.comprobaciones.map((c: { nombre: string; estado: string }) => [c.nombre, c.estado]));
    expect(por).toMatchObject({ Token: "ok", Permisos: "ok", Instagram: "ok", "Cupo de 24 h": "ok", "Página de Facebook": "ok", "Publicar en Facebook": "aviso", Caducidad: "aviso" });
    expect(r.cuota).toEqual({ usadas: 3, total: 50, restantes: 47 });
    expect(r.caducidad.nivel).toBe("aviso");
    expect(d.repo.cuenta.ig_usuario).toBe("cristaleria");
    expect(JSON.stringify(r)).not.toMatch(/EAA/);
  });

  it("desconectar borra los tokens y lo que se veía de la cuenta", async () => {
    const d = deps(CONFIG, { fetch: graphFalsa({ "DELETE /me/permissions": { body: { success: true } } }).fetch });
    d.repo.cuenta = { ...d.repo.cuenta, estado: "conectada", origen: "conexion", ig_user_id: "1", ig_usuario: "x" };
    d.repo.tokens = { token_usuario: await cifrar("EAAUsuarioToken123456789", SECRETO), token_pagina: await cifrar("EAAPaginaToken1234567890", SECRETO), candidatos: null };
    const r = await (await manejarConexion(post({ accion: "desconectar" }), d)).json();
    expect(r).toMatchObject({ estado: "sin_conectar", cuenta: null, revocada: true });
    expect(d.repo.tokens).toEqual({ token_usuario: null, token_pagina: null, candidatos: null });
  });
});
