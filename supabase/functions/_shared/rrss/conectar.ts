// ============================================================================
//  RRSS · guardar la conexión con Meta (rrss-oauth y rrss-conexion)
// ----------------------------------------------------------------------------
//  Tras «Conectar con Facebook» hay un token de usuario de larga duración y las
//  páginas que administra (cada una con su token y su cuenta de Instagram). Aquí
//  se cifran y se guardan los tokens (rrss_meta_tokens) y lo que puede ver el
//  panel (rrss_meta_cuenta): cuenta, página, permisos y caducidades. Con varias
//  páginas, quedan como candidatas (sin tokens a la vista) hasta que se elige.
// ============================================================================
import { cifrar, descifrar } from "./cifrado.ts";
import { ClienteGraph, type FuncionFetch, type PaginaMeta } from "./cliente.ts";
import type { ConfigMeta } from "./config.ts";
import { ErrorMeta } from "./errores.ts";
import type { FilaCuenta, RepositorioRrss } from "./repositorio.ts";
import { mensajeSaneado, registrarSecreto } from "./secretos.ts";

export interface DepsConectar {
  config: ConfigMeta;
  repo: RepositorioRrss;
  fetch?: FuncionFetch;
  ahora?: () => number;
}

const segAIso = (s: number | undefined | null): string | null => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);

/** Datos del token (permisos y caducidades) con debug_token; null si no se pueden leer. */
export async function datosToken(token: string, d: DepsConectar): Promise<{ permisos: string[]; caducaEn: string | null; accesoDatosCaducaEn: string | null; valido: boolean } | null> {
  if (!d.config.appId || !d.config.appSecret) return null;
  try {
    const r = await new ClienteGraph({ token, versionApi: d.config.versionApi, fetch: d.fetch, reintentos: 1 }).depurarToken(d.config.appId, d.config.appSecret);
    return {
      permisos: Array.isArray(r.scopes) ? r.scopes.map(String).slice(0, 60) : [],
      caducaEn: segAIso(r.expires_at),
      accesoDatosCaducaEn: segAIso(r.data_access_expires_at),
      valido: r.is_valid === true,
    };
  } catch {
    return null;
  }
}

export interface ResultadoConectar {
  resultado: "ok" | "elegir" | "sin_instagram" | "sin_paginas";
  paginas: number;
}

/** Guarda la conexión con una página ya elegida. */
export async function guardarConPagina(p: { tokenUsuario: string; caducaUsuario: string | null; pagina: PaginaMeta; usuarioId: string }, d: DepsConectar): Promise<void> {
  const ig = p.pagina.instagram;
  if (!ig || !p.pagina.token) throw new ErrorMeta({ tipo: "peticion_invalida", mensaje: "Esa página no tiene cuenta de Instagram profesional vinculada" });
  registrarSecreto(p.pagina.token);
  const infoUsuario = await datosToken(p.tokenUsuario, d);
  const infoPagina = await datosToken(p.pagina.token, d);
  const ahora = new Date((d.ahora ?? Date.now)()).toISOString();
  await d.repo.guardarTokens({
    token_usuario: await cifrar(p.tokenUsuario, d.config.claveTokens),
    token_pagina: await cifrar(p.pagina.token, d.config.claveTokens),
    candidatos: null,
  });
  const cuenta: Partial<FilaCuenta> = {
    estado: "conectada",
    origen: "conexion",
    ig_user_id: ig.id,
    ig_usuario: ig.usuario,
    ig_nombre: ig.nombre,
    ig_foto_url: ig.foto && /^https:\/\//.test(ig.foto) ? ig.foto.slice(0, 2000) : null,
    fb_pagina_id: p.pagina.id,
    fb_pagina_nombre: p.pagina.nombre,
    permisos: infoUsuario?.permisos ?? infoPagina?.permisos ?? [],
    // El de página no caduca; el del usuario (respaldo para Instagram), a los 60 días.
    token_caduca_en: infoPagina?.caducaEn ?? null,
    acceso_datos_caduca_en: infoPagina?.accesoDatosCaducaEn ?? infoUsuario?.accesoDatosCaducaEn ?? null,
    paginas_candidatas: [],
    conectado_por: p.usuarioId,
    conectado_en: ahora,
    comprobado_en: ahora,
    error: null,
    aviso_clave: null,
  };
  await d.repo.guardarCuenta(cuenta);
}

/**
 * Tras el OAuth: guarda la conexión si hay UNA página con Instagram; si hay varias, las deja para elegir (los tokens,
 * cifrados); si no hay ninguna, lo apunta como error.
 */
export async function conectarConToken(p: { tokenUsuario: string; caducaUsuario: string | null; usuarioId: string }, d: DepsConectar): Promise<ResultadoConectar> {
  const cliente = new ClienteGraph({ token: p.tokenUsuario, versionApi: d.config.versionApi, fetch: d.fetch, reintentos: 1 });
  const paginas = await cliente.paginas();
  const conIg = paginas.filter((x) => x.instagram && x.token);
  if (paginas.length === 0 || conIg.length === 0) {
    await d.repo.guardarCuenta({
      estado: "error",
      error: paginas.length === 0
        ? "Tu usuario de Facebook no administra ninguna página (o no diste permiso a ninguna al conectar)."
        : "Ninguna de tus páginas de Facebook tiene una cuenta de Instagram profesional vinculada.",
      paginas_candidatas: [],
    });
    return { resultado: paginas.length === 0 ? "sin_paginas" : "sin_instagram", paginas: paginas.length };
  }
  if (conIg.length === 1) {
    await guardarConPagina({ ...p, pagina: conIg[0] }, d);
    return { resultado: "ok", paginas: 1 };
  }
  await d.repo.guardarTokens({
    candidatos: await cifrar(JSON.stringify({ tokenUsuario: p.tokenUsuario, caducaUsuario: p.caducaUsuario, paginas: conIg }), d.config.claveTokens),
  });
  await d.repo.guardarCuenta({
    estado: "eligiendo_pagina",
    paginas_candidatas: conIg.slice(0, 50).map((x) => ({ id: x.id, nombre: x.nombre, instagram: x.instagram ? { id: x.instagram.id, usuario: x.instagram.usuario } : null })),
    error: null,
  });
  return { resultado: "elegir", paginas: conIg.length };
}

/** Elige una de las páginas candidatas (rrss-conexion, acción elegir_pagina). */
export async function elegirPagina(paginaId: string, usuarioId: string, d: DepsConectar): Promise<void> {
  const tokens = await d.repo.leerTokens();
  if (!tokens.candidatos) throw new ErrorMeta({ tipo: "peticion_invalida", mensaje: "No hay páginas para elegir: vuelve a conectar" });
  let datos: { tokenUsuario: string; caducaUsuario: string | null; paginas: PaginaMeta[] };
  try {
    datos = JSON.parse(await descifrar(tokens.candidatos, d.config.claveTokens));
  } catch (e) {
    throw new ErrorMeta({ tipo: "token", mensaje: mensajeSaneado(e) });
  }
  const pagina = (datos.paginas ?? []).find((x) => x.id === paginaId);
  if (!pagina) throw new ErrorMeta({ tipo: "peticion_invalida", mensaje: "Esa página no está entre las que se pueden elegir" });
  await guardarConPagina({ tokenUsuario: datos.tokenUsuario, caducaUsuario: datos.caducaUsuario, pagina, usuarioId }, d);
}
