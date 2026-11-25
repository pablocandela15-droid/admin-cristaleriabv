/**
 * Edge Function rrss-oauth — vuelta del diálogo «Conectar con Facebook».
 *
 *   GET ${SUPABASE_URL}/functions/v1/rrss-oauth?code=…&state=…   (o ?error=…&state=…)
 *
 * Es la «URL de redirección de OAuth válida» de la app de Meta. Pública
 * (verify_jwt = false): la llama el navegador de quien conecta, al volver de
 * Facebook, sin sesión del panel. Su protección es el `state`: aleatorio, de un
 * solo uso, 15 minutos, ligado al usuario que pulsó «Conectar» (con «Editar» en
 * RRSS) y al panel al que se vuelve; en la base solo está su sha256
 * (rrss_oauth_usar_estado). Sin state válido no se canjea nada y no se
 * redirige a ningún sitio que diga la petición.
 *
 *   1. code → token de usuario (corto) → de larga duración (60 días).
 *   2. Páginas que administra con su token y su Instagram: una → conectada;
 *      varias → el panel pide elegir; ninguna → error explicado.
 *   3. Vuelve al panel: /rrss?tab=conexion&conexion=ok|elegir|cancelada|sin_instagram|sin_paginas|error.
 *
 * Nada de lo que devuelve lleva tokens: van cifrados a rrss_meta_tokens.
 * Sin Deno ni imports remotos: las dependencias se inyectan (vitest).
 */
import { sha256Hex } from "../_shared/rrss/cifrado.ts";
import { ClienteGraph, type FuncionFetch } from "../_shared/rrss/cliente.ts";
import { faltaParaConectar, panelPorDefecto, redirectUri, type ConfigMeta, type LectorEnv } from "../_shared/rrss/config.ts";
import { conectarConToken } from "../_shared/rrss/conectar.ts";
import { ErrorMeta } from "../_shared/rrss/errores.ts";
import type { RepositorioRrss } from "../_shared/rrss/repositorio.ts";
import { registro, sanear } from "../_shared/rrss/secretos.ts";

export interface DependenciasOauth {
  config: ConfigMeta;
  env: LectorEnv;
  repo: RepositorioRrss;
  fetch?: FuncionFetch;
  ahora?: () => number;
}

const RE_STATE = /^[A-Za-z0-9_-]{32,128}$/;
const RE_CODIGO = /^[A-Za-z0-9_\-.#]{10,2048}$/;

function volver(panel: string, resultado: string): Response {
  const u = new URL("/rrss", panel);
  u.searchParams.set("tab", "conexion");
  u.searchParams.set("conexion", resultado);
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

/** Página mínima cuando no hay state válido (no se sabe a qué panel volver: se ofrece el de producción). */
function paginaSinEstado(panel: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conexión con Facebook</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937}a{color:#1d4ed8}</style></head>
<body><h1>El enlace ya no vale</h1><p>Este enlace de conexión ha caducado o ya se usó. Vuelve al panel y pulsa otra vez «Conectar con Facebook».</p>
<p><a href="${panel}/rrss?tab=conexion">Volver al panel</a></p></body></html>`;
  return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function manejarOauth(req: Request, d: DependenciasOauth): Promise<Response> {
  if (req.method !== "GET") return new Response("Método no permitido", { status: 405 });
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const defecto = panelPorDefecto(d.env);
  if (!RE_STATE.test(state)) return paginaSinEstado(defecto);
  const datos = await d.repo.usarEstado(await sha256Hex(state));
  if (!datos) return paginaSinEstado(defecto);
  const panel = datos.volver_a;

  if (url.searchParams.get("error") || !url.searchParams.get("code")) {
    // La persona canceló en Facebook (error=access_denied) o no llegó el código.
    return volver(panel, "cancelada");
  }
  const codigo = url.searchParams.get("code") ?? "";
  if (!RE_CODIGO.test(codigo) || faltaParaConectar(d.config).length > 0) {
    await d.repo.guardarCuenta({ estado: "error", error: "Falta configurar la app de Meta (META_APP_ID y META_APP_SECRET)." }).catch(() => undefined);
    return volver(panel, "error");
  }
  try {
    const app = new ClienteGraph({ token: `${d.config.appId}|${d.config.appSecret}`, versionApi: d.config.versionApi, fetch: d.fetch, reintentos: 1 });
    const corto = await app.canjearCodigo({ appId: d.config.appId, appSecret: d.config.appSecret, redirectUri: redirectUri(d.config), codigo });
    const largo = await app.tokenLargo({ appId: d.config.appId, appSecret: d.config.appSecret, tokenCorto: corto });
    const r = await conectarConToken({ tokenUsuario: largo.token, caducaUsuario: largo.caducaEn, usuarioId: datos.usuario_id },
      { config: d.config, repo: d.repo, fetch: d.fetch, ahora: d.ahora });
    registro("info", "rrss-oauth", `conexión: ${r.resultado} (${r.paginas} páginas)`);
    return volver(panel, r.resultado);
  } catch (e) {
    const mensaje = e instanceof ErrorMeta ? `${e.message}. ${e.comoArreglarlo}` : "No se pudo completar la conexión con Facebook.";
    registro("error", "rrss-oauth", "fallo al conectar", e);
    await d.repo.guardarCuenta({ estado: "error", error: sanear(mensaje).slice(0, 1000) }).catch(() => undefined);
    return volver(panel, "error");
  }
}
