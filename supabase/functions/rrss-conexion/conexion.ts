/**
 * Edge Function rrss-conexion — la conexión de RRSS con Instagram y Facebook.
 *
 *   GET  o POST {accion:"estado"}            «Ver» en RRSS. Lo que hay guardado y qué falta configurar, SIN llamar a
 *                                            Meta (se pide al abrir la página).
 *   POST {accion:"comprobar"}                «Ver». Pregunta a Meta (debug_token, perfil de Instagram, cupo de 24 h,
 *                                            página): comprobaciones en llano con cómo arreglar cada fallo. Actualiza
 *                                            permisos, caducidades y perfil guardados.
 *   POST {accion:"iniciar", origen}          «Editar». Crea el state (de un solo uso, 15 min) y devuelve la URL del
 *                                            diálogo de Facebook. `origen` = el panel al que volver (lista cerrada).
 *   POST {accion:"elegir_pagina", paginaId}  «Editar». Elige una de las páginas candidatas.
 *   POST {accion:"desconectar"}              «Editar». Borra los tokens (y quita el permiso de la app en Meta si se
 *                                            puede).
 *
 * Nada de lo que responde lleva tokens ni valores de secretos (json() sanea).
 * Sin configurar (META_APP_ID / META_APP_SECRET) no llama a Meta: lo dice.
 * Sin Deno ni imports remotos: las dependencias se inyectan (vitest).
 */
import { aleatorio, sha256Hex } from "../_shared/rrss/cifrado.ts";
import { estadoCaducidad, type EstadoCaducidad } from "../_shared/rrss/caducidad.ts";
import { ClienteGraph, type FuncionFetch } from "../_shared/rrss/cliente.ts";
import { faltaParaConectar, panelPermitido, PERMISOS_INSTAGRAM, PERMISOS_META, redirectUri, urlDialogo, usaSecretos, type ConfigMeta, type LectorEnv } from "../_shared/rrss/config.ts";
import { datosToken, elegirPagina } from "../_shared/rrss/conectar.ts";
import { resolverCredenciales } from "../_shared/rrss/credenciales.ts";
import { ErrorMeta, errorMetaAJson, estadoHttpDeError } from "../_shared/rrss/errores.ts";
import { json, leerCuerpo } from "../_shared/rrss/http.ts";
import type { FilaCuenta, RepositorioRrss } from "../_shared/rrss/repositorio.ts";
import { mensajeSaneado } from "../_shared/rrss/secretos.ts";

type Autorizacion = { ok: true; userId: string } | { ok: false; response: Response };

export interface DependenciasConexion {
  config: ConfigMeta;
  env: LectorEnv;
  repo: RepositorioRrss;
  autorizar(req: Request, modo: "view" | "edit"): Promise<Autorizacion>;
  iaDisponible: boolean;
  cronConfigurado: boolean;
  fetch?: FuncionFetch;
  ahora?: () => number;
}

export interface Comprobacion {
  nombre: string;
  estado: "ok" | "aviso" | "falla";
  detalle: string;
  comoArreglarlo?: string;
}

const ACCIONES = ["estado", "comprobar", "iniciar", "elegir_pagina", "desconectar"] as const;
type Accion = (typeof ACCIONES)[number];

/** Estado de la conexión para el panel (sin tokens ni valores de secretos). */
export function construirEstado(cuenta: FilaCuenta, d: Pick<DependenciasConexion, "config" | "iaDisponible" | "cronConfigurado">, ahora: number) {
  const secretos = usaSecretos(d.config);
  const faltan = faltaParaConectar(d.config);
  const permisos = cuenta.permisos ?? [];
  const caducidad: EstadoCaducidad = estadoCaducidad({ tokenCaducaEn: cuenta.token_caduca_en, accesoDatosCaducaEn: cuenta.acceso_datos_caduca_en }, ahora);
  const conectada = secretos || cuenta.estado === "conectada";
  return {
    ok: true,
    modo: secretos ? "secretos" : cuenta.origen === "conexion" ? "conexion" : null,
    estado: secretos ? (cuenta.origen === "secretos" && cuenta.estado === "error" ? "error" : "conectada") : cuenta.estado,
    conectada,
    configuracion: {
      appId: Boolean(d.config.appId),
      appSecret: Boolean(d.config.appSecret),
      configId: Boolean(d.config.configId),
      tokenSistema: Boolean(d.config.tokenSistema),
      igUserIdSistema: Boolean(d.config.igUserIdSistema),
      paginaSistema: Boolean(d.config.paginaSistema),
      ia: d.iaDisponible,
      cron: d.cronConfigurado,
    },
    faltan,
    puedeConectar: faltan.length === 0,
    redirectUri: d.config.supabaseUrl ? redirectUri(d.config) : null,
    versionApi: d.config.versionApi,
    permisosNecesarios: [...PERMISOS_META],
    cuenta: cuenta.ig_user_id || cuenta.fb_pagina_id
      ? { igUserId: cuenta.ig_user_id, usuario: cuenta.ig_usuario, nombre: cuenta.ig_nombre, foto: cuenta.ig_foto_url,
          paginaId: cuenta.fb_pagina_id, paginaNombre: cuenta.fb_pagina_nombre }
      : null,
    permisos,
    faltanPermisos: permisos.length ? PERMISOS_META.filter((p) => p !== "business_management" && !permisos.includes(p)) : [],
    caducidad: { ...caducidad, tokenCaducaEn: cuenta.token_caduca_en, accesoDatosCaducaEn: cuenta.acceso_datos_caduca_en },
    comprobadoEn: cuenta.comprobado_en,
    conectadoEn: cuenta.conectado_en,
    error: cuenta.error,
    candidatas: cuenta.estado === "eligiendo_pagina" ? cuenta.paginas_candidatas ?? [] : [],
    facebook: Boolean(secretos ? d.config.paginaSistema : cuenta.fb_pagina_id),
  };
}

export async function manejarConexion(req: Request, d: DependenciasConexion): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const cuerpo = await leerCuerpo(req);
  if (cuerpo === null) return json({ ok: false, error: "Cuerpo de la petición no válido" }, 400);
  const accion = (req.method === "GET" ? "estado" : (cuerpo.accion ?? "estado")) as Accion;
  if (!ACCIONES.includes(accion)) return json({ ok: false, error: `accion no válida (${ACCIONES.join(" | ")})` }, 400);
  const auth = await d.autorizar(req, accion === "estado" || accion === "comprobar" ? "view" : "edit");
  if (!auth.ok) return auth.response;
  const ahora = (d.ahora ?? Date.now)();

  if (accion === "estado") {
    return json(construirEstado(await d.repo.leerCuenta(), d, ahora));
  }

  if (accion === "iniciar") {
    if (usaSecretos(d.config)) {
      return json({ ok: false, error: "Se está usando el token de usuario del sistema de los secretos (IG_ACCESS_TOKEN): no hace falta conectar." }, 409);
    }
    const faltan = faltaParaConectar(d.config);
    if (faltan.length) return json({ ok: false, tipo: "configuracion", error: `Falta configurar en Supabase: ${faltan.join(", ")}`, faltan }, 503);
    const panel = panelPermitido(typeof cuerpo.origen === "string" ? cuerpo.origen : null, d.env);
    if (!panel) return json({ ok: false, error: "Este panel no está en la lista de paneles permitidos (PANEL_URL / PANEL_URL_DEMO)." }, 400);
    const state = aleatorio(32);
    await d.repo.crearEstado(await sha256Hex(state), auth.userId, panel);
    return json({ ok: true, url: urlDialogo(d.config, state), redirectUri: redirectUri(d.config) });
  }

  if (accion === "elegir_pagina") {
    const paginaId = typeof cuerpo.paginaId === "string" && /^[0-9]{1,30}$/.test(cuerpo.paginaId) ? cuerpo.paginaId : null;
    if (!paginaId) return json({ ok: false, error: "Falta la página" }, 400);
    try {
      await elegirPagina(paginaId, auth.userId, { config: d.config, repo: d.repo, fetch: d.fetch, ahora: d.ahora });
    } catch (e) {
      if (e instanceof ErrorMeta) return json({ ok: false, ...errorMetaAJson(e) }, e.tipo === "peticion_invalida" ? 400 : estadoHttpDeError(e));
      throw e;
    }
    return json(construirEstado(await d.repo.leerCuenta(), d, ahora));
  }

  if (accion === "desconectar") {
    let revocada = false;
    if (!usaSecretos(d.config)) {
      const cred = await resolverCredenciales(d.config, d.repo).catch(() => null);
      const tokenUsuario = cred && cred.ok ? (cred.cred.tokenInstagramRespaldo ?? null) : null;
      if (tokenUsuario) {
        // Quita el permiso de la app en Meta (si falla, se borra igual en el panel).
        revocada = await new ClienteGraph({ token: tokenUsuario, versionApi: d.config.versionApi, fetch: d.fetch, reintentos: 0, timeoutMs: 8_000 })
          .peticion("DELETE", "/me/permissions").then(() => true, () => false);
      }
    }
    await d.repo.guardarTokens({ token_usuario: null, token_pagina: null, candidatos: null });
    await d.repo.guardarCuenta({
      estado: "sin_conectar", origen: null, ig_user_id: null, ig_usuario: null, ig_nombre: null, ig_foto_url: null,
      fb_pagina_id: null, fb_pagina_nombre: null, permisos: [], token_caduca_en: null, acceso_datos_caduca_en: null,
      paginas_candidatas: [], conectado_por: null, conectado_en: null, comprobado_en: null, error: null, aviso_clave: null,
    });
    return json({ ...construirEstado(await d.repo.leerCuenta(), d, ahora), revocada });
  }

  // accion === "comprobar"
  return json(await comprobar(d, ahora));
}

/** Pregunta a Meta y actualiza lo guardado. Nunca lanza por un fallo de Meta: lo devuelve explicado. */
export async function comprobar(d: DependenciasConexion, ahora: number) {
  const comprobaciones: Comprobacion[] = [];
  const secretos = usaSecretos(d.config);
  let cuenta = await d.repo.leerCuenta();
  if (!secretos && cuenta.estado !== "conectada") {
    comprobaciones.push({ nombre: "Conexión", estado: "falla", detalle: "RRSS no está conectado.",
      comoArreglarlo: faltaParaConectar(d.config).length
        ? `Primero hay que poner en Supabase ${faltaParaConectar(d.config).join(" y ")} (docs/RRSS.md).`
        : "Pulsa «Conectar con Facebook»." });
    return { ...construirEstado(cuenta, d, ahora), comprobaciones, cuota: null };
  }
  const res = await resolverCredenciales(d.config, d.repo, { conPagina: true, fetch: d.fetch });
  if (!res.ok) {
    comprobaciones.push({ nombre: "Credenciales", estado: "falla", detalle: res.error.message, comoArreglarlo: res.error.comoArreglarlo });
    if (!secretos) await d.repo.guardarCuenta({ estado: res.error.tipo === "token" ? "caducada" : "error", error: res.error.message, comprobado_en: new Date(ahora).toISOString() });
    else await d.repo.guardarCuenta({ origen: "secretos", estado: "error", error: res.error.message, comprobado_en: new Date(ahora).toISOString() });
    return { ...construirEstado(await d.repo.leerCuenta(), d, ahora), comprobaciones, cuota: null };
  }
  const cred = res.cred;
  const cliente = (t: string) => new ClienteGraph({ token: t, versionApi: d.config.versionApi, fetch: d.fetch, reintentos: 1, timeoutMs: 12_000 });
  const cambios: Partial<FilaCuenta> = { comprobado_en: new Date(ahora).toISOString() };
  let errorGrave: string | null = null;

  // Token: permisos y caducidad (necesita META_APP_ID y META_APP_SECRET).
  const token = cred.tokenInstagram as string;
  const info = await datosToken(token, { config: d.config, repo: d.repo, fetch: d.fetch });
  if (!info) {
    comprobaciones.push({ nombre: "Token", estado: "aviso", detalle: "No se ha podido leer la caducidad ni los permisos del token.",
      comoArreglarlo: "Pon META_APP_ID y META_APP_SECRET en los secretos de Supabase para que el panel pueda comprobarlo." });
  } else {
    const faltanIg = PERMISOS_INSTAGRAM.filter((p) => !info.permisos.includes(p));
    if (!info.valido) {
      errorGrave = "Meta dice que el token ya no es válido.";
      comprobaciones.push({ nombre: "Token", estado: "falla", detalle: errorGrave, comoArreglarlo: "Pulsa «Renovar conexión»." });
    } else {
      comprobaciones.push({ nombre: "Token", estado: "ok", detalle: info.caducaEn ? `Válido hasta el ${info.caducaEn.slice(0, 10)}.` : "Válido y sin caducidad." });
    }
    comprobaciones.push(faltanIg.length
      ? { nombre: "Permisos", estado: "falla", detalle: `Faltan ${faltanIg.join(", ")}.`, comoArreglarlo: "Pulsa «Renovar conexión» y acepta todos los permisos." }
      : { nombre: "Permisos", estado: "ok", detalle: `${info.permisos.length} permisos concedidos.` });
    cambios.permisos = info.permisos;
    if (!secretos) {
      cambios.token_caduca_en = info.caducaEn;
      cambios.acceso_datos_caduca_en = info.accesoDatosCaducaEn ?? cuenta.acceso_datos_caduca_en;
    } else {
      cambios.token_caduca_en = info.caducaEn;
      cambios.acceso_datos_caduca_en = null;
    }
  }

  // Instagram: perfil y cupo de publicación.
  let cuota: { usadas: number; total: number | null; restantes: number | null } | null = null;
  if (cred.igUserId) {
    try {
      const perfil = await cliente(token).perfil(cred.igUserId);
      cambios.ig_user_id = perfil.id;
      cambios.ig_usuario = perfil.usuario;
      cambios.ig_nombre = perfil.nombre;
      cambios.ig_foto_url = perfil.foto && /^https:\/\//.test(perfil.foto) ? perfil.foto.slice(0, 2000) : null;
      comprobaciones.push({ nombre: "Instagram", estado: "ok", detalle: `@${perfil.usuario ?? perfil.id}${perfil.seguidores !== null ? ` · ${perfil.seguidores} seguidores` : ""}.` });
      try {
        cuota = await cliente(token).limitePublicacion(cred.igUserId);
        comprobaciones.push({ nombre: "Cupo de 24 h", estado: cuota.restantes === 0 ? "aviso" : "ok",
          detalle: cuota.total !== null ? `${cuota.usadas} de ${cuota.total} publicaciones usadas.` : `${cuota.usadas} publicaciones en 24 h.` });
      } catch (e) {
        comprobaciones.push({ nombre: "Cupo de 24 h", estado: "aviso", detalle: mensajeSaneado(e) });
      }
    } catch (e) {
      const em = e instanceof ErrorMeta ? e : null;
      errorGrave = errorGrave ?? (em?.message ?? mensajeSaneado(e));
      comprobaciones.push({ nombre: "Instagram", estado: "falla", detalle: em?.message ?? mensajeSaneado(e), comoArreglarlo: em?.comoArreglarlo });
    }
  } else {
    comprobaciones.push({ nombre: "Instagram", estado: "falla", detalle: "No hay cuenta de Instagram.", comoArreglarlo: "Vincula la cuenta profesional a la página de Facebook y «Renovar conexión»." });
  }

  // Página de Facebook.
  if (cred.paginaId && cred.tokenPagina) {
    try {
      const seguidores = await cliente(cred.tokenPagina).fbSeguidores(cred.paginaId);
      comprobaciones.push({ nombre: "Página de Facebook", estado: "ok", detalle: `${cuenta.fb_pagina_nombre ?? cred.paginaId}${seguidores !== null ? ` · ${seguidores} seguidores` : ""}.` });
      if (info && !info.permisos.includes("pages_manage_posts")) {
        comprobaciones.push({ nombre: "Publicar en Facebook", estado: "aviso", detalle: "Falta el permiso pages_manage_posts: no se podrá publicar en la página.",
          comoArreglarlo: "Pulsa «Renovar conexión» y acepta todos los permisos." });
      }
      if (secretos) cambios.fb_pagina_id = cred.paginaId;
    } catch (e) {
      const em = e instanceof ErrorMeta ? e : null;
      comprobaciones.push({ nombre: "Página de Facebook", estado: "aviso", detalle: em?.message ?? mensajeSaneado(e), comoArreglarlo: em?.comoArreglarlo });
    }
  } else {
    comprobaciones.push({ nombre: "Página de Facebook", estado: "aviso", detalle: "Sin página conectada: solo se publica en Instagram.",
      comoArreglarlo: secretos ? "Pon FB_PAGE_ID en los secretos de Supabase." : "«Renovar conexión» y elige la página." });
  }

  const cad = estadoCaducidad({ tokenCaducaEn: cambios.token_caduca_en ?? cuenta.token_caduca_en, accesoDatosCaducaEn: cambios.acceso_datos_caduca_en ?? cuenta.acceso_datos_caduca_en }, ahora);
  if (cad.nivel !== "ok") comprobaciones.push({ nombre: "Caducidad", estado: cad.nivel === "caducado" ? "falla" : "aviso", detalle: cad.texto });
  if (secretos) cambios.origen = "secretos";
  cambios.estado = errorGrave ? (cad.nivel === "caducado" ? "caducada" : "error") : cad.nivel === "caducado" ? "caducada" : "conectada";
  cambios.error = errorGrave;
  if (!secretos || cambios.origen === "secretos") await d.repo.guardarCuenta(cambios);
  cuenta = await d.repo.leerCuenta();
  return { ...construirEstado(cuenta, d, ahora), comprobaciones, cuota };
}
