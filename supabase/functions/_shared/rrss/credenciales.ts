// ============================================================================
//  RRSS · credenciales de Meta para publicar y medir
// ----------------------------------------------------------------------------
//  Dos maneras (docs/RRSS.md):
//    · secretos: IG_ACCESS_TOKEN (token de usuario del sistema, no caduca) +
//      IG_USER_ID y, para Facebook, FB_PAGE_ID (el token de la página se pide a
//      Meta con el del sistema). Si están, mandan: es lo que hacía el panel de
//      referencia.
//    · conexión: lo que guardó «Conectar con Facebook» (tokens cifrados en
//      rrss_meta_tokens, cuenta y página en rrss_meta_cuenta). Instagram va con
//      el token de la página (no caduca) y, si Meta lo rechazara por permisos,
//      con el del usuario (60 días); Facebook, con el de la página.
//  Los tokens solo viven en memoria de la función: nunca salen en respuestas.
// ============================================================================
import { descifrar, ErrorCifrado } from "./cifrado.ts";
import { ClienteGraph, type FuncionFetch } from "./cliente.ts";
import { usaSecretos, type ConfigMeta } from "./config.ts";
import { ErrorMeta } from "./errores.ts";
import type { RepositorioRrss } from "./repositorio.ts";
import { registrarSecreto } from "./secretos.ts";

export interface Credenciales {
  origen: "secretos" | "conexion";
  igUserId: string | null;
  paginaId: string | null;
  /** Token para Instagram. */
  tokenInstagram: string | null;
  /** Otro token con el que probar si Meta rechaza el primero por credenciales (null si no hay). */
  tokenInstagramRespaldo: string | null;
  /** Token de la página de Facebook (null si no hay página o no se pidió). */
  tokenPagina: string | null;
}

export type ResultadoCredenciales = { ok: true; cred: Credenciales } | { ok: false; error: ErrorMeta };

export interface OpcionesCredenciales {
  /** Hace falta el token de la página (publicar en Facebook o medir la página). */
  conPagina?: boolean;
  fetch?: FuncionFetch;
}

export async function resolverCredenciales(config: ConfigMeta, repo: RepositorioRrss, o: OpcionesCredenciales = {}): Promise<ResultadoCredenciales> {
  if (usaSecretos(config)) {
    registrarSecreto(config.tokenSistema);
    let tokenPagina: string | null = null;
    if (o.conPagina && config.paginaSistema) {
      try {
        tokenPagina = await new ClienteGraph({ token: config.tokenSistema, versionApi: config.versionApi, fetch: o.fetch, reintentos: 1 })
          .tokenDePagina(config.paginaSistema);
      } catch (e) {
        if (e instanceof ErrorMeta) return { ok: false, error: e };
        throw e;
      }
    }
    return {
      ok: true,
      cred: {
        origen: "secretos",
        igUserId: config.igUserIdSistema,
        paginaId: config.paginaSistema || null,
        tokenInstagram: config.tokenSistema,
        tokenInstagramRespaldo: null,
        tokenPagina,
      },
    };
  }
  const cuenta = await repo.leerCuenta();
  if (cuenta.estado !== "conectada" || cuenta.origen !== "conexion") {
    return { ok: false, error: new ErrorMeta({ tipo: "sin_conexion" }) };
  }
  const tokens = await repo.leerTokens();
  let usuario: string | null = null;
  let pagina: string | null = null;
  try {
    usuario = tokens.token_usuario ? await descifrar(tokens.token_usuario, config.claveTokens) : null;
    pagina = tokens.token_pagina ? await descifrar(tokens.token_pagina, config.claveTokens) : null;
  } catch (e) {
    if (e instanceof ErrorCifrado) return { ok: false, error: new ErrorMeta({ tipo: "token", mensaje: e.message }) };
    throw e;
  }
  registrarSecreto(usuario);
  registrarSecreto(pagina);
  const tokenInstagram = pagina ?? usuario;
  if (!tokenInstagram) return { ok: false, error: new ErrorMeta({ tipo: "sin_conexion", mensaje: "La conexión no tiene ningún token guardado" }) };
  return {
    ok: true,
    cred: {
      origen: "conexion",
      igUserId: cuenta.ig_user_id,
      paginaId: cuenta.fb_pagina_id,
      tokenInstagram,
      tokenInstagramRespaldo: pagina && usuario && usuario !== pagina ? usuario : null,
      tokenPagina: pagina,
    },
  };
}
