// rrss-oauth: vuelta del «Conectar con Facebook». Sin state válido no canjea nada ni redirige a donde diga la
// petición; con él, canjea el código, guarda los tokens CIFRADOS y vuelve al panel que lo pidió. Sin red.
import { describe, expect, it } from "vitest";
import { manejarOauth } from "../oauth";
import { configMeta } from "../../_shared/rrss/config";
import { sha256Hex, descifrar } from "../../_shared/rrss/cifrado";
import { graphFalsa, repoFalso } from "../../_shared/__tests__/rrss-falsos";

const ENV: Record<string, string> = { SUPABASE_URL: "https://gorekooabfhqudeshtgq.supabase.co", META_APP_ID: "123456", META_APP_SECRET: "secreto-de-la-app-de-prueba" };
const env = (n: string) => ENV[n];
const STATE = "s".repeat(43);
const PANEL = "https://admin-cristaleriabv-git-staging-pablo1505.vercel.app";
const pagina = (n: number, ig = true) => ({
  id: `10000000000000${n}`, name: `Página ${n}`, access_token: `EAAPagina${n}TokenLargo1234567890`, tasks: ["CREATE_CONTENT"],
  ...(ig ? { instagram_business_account: { id: `1784140000000000${n}`, username: `cristaleria${n}`, name: "Cristalería", profile_picture_url: "https://cdn.example.com/p.jpg" } } : {}),
});

async function preparar(paginas: unknown[], o: { state?: boolean } = {}) {
  const repo = repoFalso();
  if (o.state !== false) await repo.crearEstado(await sha256Hex(STATE), "usuario-1", PANEL);
  const g = graphFalsa({
    "GET /oauth/access_token": [{ body: { access_token: "EAACortoToken1234567890abcdef" } }, { body: { access_token: "EAALargoToken1234567890abcdef", expires_in: 5_184_000 } }],
    "GET /me/accounts": { body: { data: paginas } },
    "GET /debug_token": { body: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 1_800_000_000, scopes: ["instagram_basic", "instagram_content_publish", "pages_manage_posts"] } } },
  });
  const llamar = (q: string) => manejarOauth(new Request(`https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth?${q}`), { config: configMeta(env), env, repo, fetch: g.fetch });
  return { repo, g, llamar };
}

describe("rrss-oauth", () => {
  it("sin state válido: página explicada, sin redirigir ni llamar a Meta", async () => {
    const { g, llamar } = await preparar([pagina(1)], { state: false });
    for (const q of ["code=abcdefghijkl", `code=abcdefghijkl&state=${STATE}`, "code=abc&state=<script>"]) {
      const r = await llamar(q);
      expect(r.status).toBe(400);
      expect(r.headers.get("Location")).toBeNull();
      expect(await r.text()).toMatch(/El enlace ya no vale/);
    }
    expect(g.llamadas).toHaveLength(0);
  });

  it("con una página con Instagram: canjea, cifra los tokens y vuelve al panel que lo pidió", async () => {
    const { repo, g, llamar } = await preparar([pagina(1), pagina(2, false)]);
    const r = await llamar(`code=AQBcodigoDeFacebook123&state=${STATE}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(`${PANEL}/rrss?tab=conexion&conexion=ok`);
    expect(g.llamadas[0].consulta).toMatchObject({ client_id: "123456", redirect_uri: "https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth", code: "AQBcodigoDeFacebook123" });
    expect(g.llamadas[1].consulta).toMatchObject({ grant_type: "fb_exchange_token", fb_exchange_token: "EAACortoToken1234567890abcdef" });
    expect(repo.cuenta).toMatchObject({ estado: "conectada", origen: "conexion", ig_user_id: "17841400000000001", ig_usuario: "cristaleria1", fb_pagina_id: "100000000000001", conectado_por: "usuario-1" });
    expect(repo.cuenta.acceso_datos_caduca_en).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(repo.cuenta.token_caduca_en).toBeNull();
    expect(repo.tokens.token_pagina).toMatch(/^v1\./);
    expect(JSON.stringify(repo.cuenta)).not.toMatch(/EAA/);
    expect(await descifrar(repo.tokens.token_pagina!, ENV.META_APP_SECRET)).toBe("EAAPagina1TokenLargo1234567890");
    expect(await descifrar(repo.tokens.token_usuario!, ENV.META_APP_SECRET)).toBe("EAALargoToken1234567890abcdef");
    // El state no se puede volver a usar.
    expect((await llamar(`code=AQBcodigoDeFacebook123&state=${STATE}`)).status).toBe(400);
  });

  it("con varias páginas con Instagram: quedan para elegir (sin tokens a la vista)", async () => {
    const { repo, llamar } = await preparar([pagina(1), pagina(2)]);
    const r = await llamar(`code=AQBcodigoDeFacebook123&state=${STATE}`);
    expect(r.headers.get("Location")).toMatch(/conexion=elegir$/);
    expect(repo.cuenta.estado).toBe("eligiendo_pagina");
    expect(repo.cuenta.paginas_candidatas.map((p) => p.id)).toEqual(["100000000000001", "100000000000002"]);
    expect(JSON.stringify(repo.cuenta)).not.toMatch(/EAA/);
    expect(repo.tokens.candidatos).toMatch(/^v1\./);
  });

  it("sin páginas con Instagram, o si la persona cancela", async () => {
    const a = await preparar([pagina(1, false)]);
    expect((await a.llamar(`code=AQBcodigoDeFacebook123&state=${STATE}`)).headers.get("Location")).toMatch(/conexion=sin_instagram$/);
    expect(a.repo.cuenta).toMatchObject({ estado: "error" });
    const b = await preparar([pagina(1)]);
    expect((await b.llamar(`error=access_denied&state=${STATE}`)).headers.get("Location")).toMatch(/conexion=cancelada$/);
    expect(b.g.llamadas).toHaveLength(0);
  });

  it("si Meta falla, vuelve con error y lo guarda explicado (sin el código ni tokens)", async () => {
    const repo = repoFalso();
    await repo.crearEstado(await sha256Hex(STATE), "usuario-1", PANEL);
    const g = graphFalsa({ "GET /oauth/access_token": { status: 400, body: { error: { message: "Invalid verification code format. code=AQBcodigo", code: 100 } } } });
    const r = await manejarOauth(new Request(`https://x.supabase.co/functions/v1/rrss-oauth?code=AQBcodigoDeFacebook123&state=${STATE}`), { config: configMeta(env), env, repo, fetch: g.fetch });
    expect(r.headers.get("Location")).toMatch(/conexion=error$/);
    expect(repo.cuenta.estado).toBe("error");
    expect(repo.cuenta.error).not.toContain("AQBcodigo");
  });
});
