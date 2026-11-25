/**
 * Edge Function rrss-programador — publica lo programado que ya ha vencido, termina lo que Meta estaba procesando y
 * hace el mantenimiento diario. La API de Instagram no programa publicaciones: lo hace esto (como en el panel de
 * referencia, instagram-programador).
 *
 *   La llama pg_cron (rrss_disparar, migración 20261125100000_rrss) con net.http_post y la cabecera x-ocr-secret
 *   (= OCR_TRABAJOS_SECRET, comparada en tiempo constante; sin el secreto, rechaza todo) o la service role.
 *
 *   POST {accion:"programar"} (por defecto)   cada 5 min, solo si rrss_hay_trabajo()
 *     1. rrss_programador_reclamar → UNA vencida con bloqueo (dos pasadas nunca cogen la misma; un bloqueo caducado no
 *        se vuelve a publicar a ciegas: lo cierra la propia RPC).
 *     2. El MISMO núcleo que «Publicar ahora» (publicarConReserva, con service role).
 *     3. rrss_programador_cerrar: publicada · aplazar (cuota o Meta aún procesa; no cuenta intento) · reintentar
 *        (red, Meta caído, sin conexión: 5 min y 15 min; al 3.º, error) · error (definitivo: aviso en la campana).
 *     4. Después, las piezas «procesando» sin programación (publicadas a mano con vídeo): se terminan.
 *   POST {accion:"mantenimiento"}            03:50 UTC
 *     · Cubo: borra las subidas de más de 24 h que ninguna pieza usa y los ficheros de lo publicado hace más de
 *       RRSS_DIAS_FICHEROS (30) días, y marca esas piezas.
 *     · Conexión: comprueba el token con Meta (debug_token), guarda permisos y caducidades y avisa en la campana si
 *       caduca en menos de 14 días o ya no vale.
 *
 *   Tiempo: límite global de 110 s por pasada (la función tiene 150 s); no se reclama otra programación sin 60 s por
 *   delante. Sin Deno ni imports remotos (vitest).
 */
import { estadoCaducidad } from "../_shared/rrss/caducidad.ts";
import type { ClienteGraph } from "../_shared/rrss/cliente.ts";
import { usaSecretos, type ConfigMeta } from "../_shared/rrss/config.ts";
import { datosToken } from "../_shared/rrss/conectar.ts";
import { resolverCredenciales, type Credenciales, type ResultadoCredenciales } from "../_shared/rrss/credenciales.ts";
import { publicarConReserva, type ResultadoPublicacion } from "../_shared/rrss/publicacion.ts";
import type { FilaProgramacion, RepositorioRrss } from "../_shared/rrss/repositorio.ts";
import { mensajeSaneado, registro } from "../_shared/rrss/secretos.ts";

export const ETIQUETA = "rrss-programador";
export const LIMITE_PASADA_MS = 110_000;
export const MIN_PARA_PUBLICAR_MS = 60_000;
export const MAX_POR_PASADA = 4;
export const MAX_PROCESANDO_POR_PASADA = 4;
/** Esperas tras el 1.er y el 2.º fallo (el 3.º deja la programación en error). */
export const ESPERAS_REINTENTO_SEG = [5 * 60, 15 * 60] as const;
/** Meta aún procesa: se mira en la siguiente pasada. */
export const ESPERA_PROCESANDO_SEG = 60;
/** Cuánto se aplaza sin contar intento mientras Meta procesa (desde la hora programada). */
export const ESPERA_MAX_PROCESANDO_MS = 2 * 60 * 60_000;
export const BLOQUEO_SEG = 600;
export const DIAS_FICHEROS_POR_DEFECTO = 30;

export interface DependenciasProgramador {
  config: ConfigMeta;
  repo: RepositorioRrss;
  crearCliente(token: string, limite: number): ClienteGraph;
  ahora: () => number;
  diasFicheros?: number;
  intervaloSondeoMs?: number;
}

export interface ResultadoPasada {
  programacionId: string | null;
  piezaId: string;
  red: string | null;
  resultado: "publicada" | "reintentar" | "aplazar" | "error" | "procesando" | "omitida";
  mensaje: string | null;
}

/** Días que conserva el cubo los ficheros de lo publicado (RRSS_DIAS_FICHEROS, 1-365). */
export function diasFicheros(valor: string | undefined): number {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : DIAS_FICHEROS_POR_DEFECTO;
}

type Cierre = { resultado: "publicada" | "reintentar" | "aplazar" | "error"; mensaje?: string | null; mediaId?: string | null; permalink?: string | null; esperaSeg?: number };

/** Qué hacer con la programación según lo que pasó al publicar su pieza. */
export function cierreDeProgramacion(prog: Pick<FilaProgramacion, "intentos" | "programada_para">, r: ResultadoPublicacion, ahora: number): Cierre {
  const espera = ESPERAS_REINTENTO_SEG[Math.min(prog.intentos, ESPERAS_REINTENTO_SEG.length - 1)];
  switch (r.estado) {
    case "publicada":
      return { resultado: "publicada", mediaId: r.mediaId ?? null, permalink: r.permalink ?? null, mensaje: r.mensaje ?? null };
    case "procesando":
      return ahora - Date.parse(prog.programada_para) > ESPERA_MAX_PROCESANDO_MS
        ? { resultado: "reintentar", mensaje: "Meta lleva demasiado tiempo procesando el vídeo.", esperaSeg: espera }
        : { resultado: "aplazar", mensaje: r.mensaje ?? "Meta aún está procesando.", esperaSeg: ESPERA_PROCESANDO_SEG };
    case "aplazada":
      return { resultado: "aplazar", mensaje: r.mensaje ?? "Cupo agotado.", esperaSeg: r.esperaSeg ?? 30 * 60 };
    case "omitida":
      if (r.motivo === "en_curso") return { resultado: "aplazar", mensaje: r.mensaje ?? null, esperaSeg: ESPERA_PROCESANDO_SEG };
      return { resultado: "error", mensaje: r.mensaje ?? "No se pudo publicar." };
    case "error":
    default:
      return r.reintentable
        ? { resultado: "reintentar", mensaje: r.mensaje ?? "Error al publicar", esperaSeg: espera }
        : { resultado: "error", mensaje: [r.error?.error, r.error?.comoArreglarlo].filter(Boolean).join(" ") || r.mensaje || "Error al publicar" };
  }
}

export async function pasadaProgramador(d: DependenciasProgramador): Promise<{ procesadas: number; resultados: ResultadoPasada[] }> {
  const inicio = d.ahora();
  const limite = inicio + LIMITE_PASADA_MS;
  const resultados: ResultadoPasada[] = [];
  const credenciales = new Map<string, ResultadoCredenciales>();
  const credPara = async (red: string): Promise<ResultadoCredenciales> => {
    const clave = red === "facebook" ? "facebook" : "instagram";
    if (!credenciales.has(clave)) credenciales.set(clave, await resolverCredenciales(d.config, d.repo, { conPagina: clave === "facebook" }));
    return credenciales.get(clave) as ResultadoCredenciales;
  };
  const publicar = (piezaId: string, cred: Credenciales, programada: boolean) => publicarConReserva(piezaId, {
    repo: d.repo, cred, crearCliente: (t) => d.crearCliente(t, limite - 5_000), ahora: d.ahora, limite: limite - 5_000,
    programada, leaseSeg: 240, intervaloSondeoMs: d.intervaloSondeoMs,
  });

  // 1. Lo programado que ha vencido.
  for (let n = 0; n < MAX_POR_PASADA && limite - d.ahora() > MIN_PARA_PUBLICAR_MS; n++) {
    const prog = await d.repo.reclamarProgramacion(BLOQUEO_SEG);
    if (!prog) break;
    const cred = await credPara(prog.red);
    let cierre: Cierre;
    if (!cred.ok) {
      cierre = { resultado: "reintentar", mensaje: `${cred.error.message}. ${cred.error.comoArreglarlo}`, esperaSeg: ESPERAS_REINTENTO_SEG[1] };
      resultados.push({ programacionId: prog.id, piezaId: prog.pieza_id, red: prog.red, resultado: "reintentar", mensaje: cred.error.message });
    } else {
      const r = await publicar(prog.pieza_id, cred.cred, true);
      cierre = cierreDeProgramacion(prog, r, d.ahora());
      resultados.push({ programacionId: prog.id, piezaId: prog.pieza_id, red: prog.red, resultado: cierre.resultado, mensaje: cierre.mensaje ?? null });
    }
    try {
      await d.repo.cerrarProgramacion(prog.id, prog.bloqueo_id, cierre.resultado, cierre);
    } catch (e) {
      registro("error", ETIQUETA, `cerrar la programación ${prog.id}`, e);
      continue;
    }
    const fallida = cierre.resultado === "error" || (cierre.resultado === "reintentar" && prog.intentos + 1 >= 3);
    if (fallida) {
      await d.repo.crearAviso({
        tipo: "rrss_publicacion_error",
        titulo: `No se pudo publicar en ${prog.red === "facebook" ? "Facebook" : "Instagram"} lo programado`,
        mensaje: (cierre.mensaje ?? "Error al publicar").slice(0, 400),
        clave: `rrss-error:${prog.id}:${prog.intentos}`,
        enlace: "/rrss?tab=calendario",
        prioridad: "alta",
      }).catch((e) => registro("warn", ETIQUETA, "no se pudo crear el aviso", e));
    }
  }

  // 2. Lo que Meta estaba procesando (o se quedó «publicando») sin programación pendiente.
  if (limite - d.ahora() > MIN_PARA_PUBLICAR_MS) {
    const ids = await d.repo.piezasProcesando(MAX_PROCESANDO_POR_PASADA * 2);
    let hechas = 0;
    for (const id of ids) {
      if (hechas >= MAX_PROCESANDO_POR_PASADA || limite - d.ahora() < MIN_PARA_PUBLICAR_MS) break;
      const pieza = await d.repo.leerPieza(id);
      if (!pieza) continue;
      const cred = await credPara(pieza.red);
      if (!cred.ok) continue;
      const r = await publicar(id, cred.cred, false);
      if (r.estado === "omitida") continue;
      hechas++;
      resultados.push({ programacionId: null, piezaId: id, red: pieza.red, resultado: r.estado === "aplazada" ? "aplazar" : r.estado === "procesando" ? "procesando" : r.estado === "publicada" ? "publicada" : "error", mensaje: r.mensaje ?? null });
    }
  }
  return { procesadas: resultados.length, resultados };
}

export interface ResultadoMantenimiento {
  ficherosBorrados: number;
  piezasMarcadas: number;
  conexion: { estado: string; nivel: string; aviso: boolean } | null;
  avisos: string[];
}

export async function mantenimiento(d: DependenciasProgramador): Promise<ResultadoMantenimiento> {
  const avisos: string[] = [];
  // Cubo.
  let ficherosBorrados = 0;
  let piezasMarcadas = 0;
  try {
    const lista = await d.repo.ficherosParaBorrar(24, d.diasFicheros ?? DIAS_FICHEROS_POR_DEFECTO);
    if (lista.length) {
      const borrados = await d.repo.borrarFicheros(lista.map((f) => f.ruta));
      ficherosBorrados = borrados.length;
      const publicadas = lista.filter((f) => f.motivo === "publicada" && borrados.includes(f.ruta)).map((f) => f.ruta);
      piezasMarcadas = await d.repo.marcarMediosBorrados(publicadas);
    }
  } catch (e) {
    avisos.push(`Limpieza del cubo: ${mensajeSaneado(e)}`);
  }

  // Conexión: comprobar el token y avisar si caduca.
  let conexion: ResultadoMantenimiento["conexion"] = null;
  try {
    const cuenta = await d.repo.leerCuenta();
    const secretos = usaSecretos(d.config);
    if (secretos || cuenta.estado === "conectada" || cuenta.estado === "caducada") {
      const cred = await resolverCredenciales(d.config, d.repo);
      const ahora = d.ahora();
      let tokenCaducaEn = cuenta.token_caduca_en;
      let accesoDatosCaducaEn = cuenta.acceso_datos_caduca_en;
      let valido = cred.ok;
      let error: string | null = cred.ok ? null : cred.error.message;
      if (cred.ok && cred.cred.tokenInstagram) {
        const info = await datosToken(cred.cred.tokenInstagram, { config: d.config, repo: d.repo });
        if (info) {
          valido = info.valido;
          tokenCaducaEn = info.caducaEn;
          accesoDatosCaducaEn = secretos ? null : (info.accesoDatosCaducaEn ?? accesoDatosCaducaEn);
          if (!info.valido) error = "Meta dice que el token ya no es válido.";
          await d.repo.guardarCuenta({
            permisos: info.permisos, token_caduca_en: tokenCaducaEn, acceso_datos_caduca_en: accesoDatosCaducaEn,
            comprobado_en: new Date(ahora).toISOString(), ...(secretos ? { origen: "secretos" as const } : {}),
            estado: valido ? "conectada" : "caducada", error,
          });
        }
      }
      const cad = estadoCaducidad({ tokenCaducaEn, accesoDatosCaducaEn }, ahora);
      const nivel = !valido ? "caducado" : cad.nivel;
      let aviso = false;
      if (nivel === "aviso" || nivel === "caducado") {
        const clave = `rrss-conexion:${nivel}:${(cad.fecha ?? new Date(ahora).toISOString()).slice(0, 10)}`;
        if (clave !== cuenta.aviso_clave) {
          aviso = await d.repo.crearAviso({
            tipo: "rrss_conexion",
            titulo: nivel === "caducado" ? "La conexión con Instagram y Facebook ya no funciona" : "La conexión con Instagram y Facebook caduca pronto",
            mensaje: (error ? `${error} ` : "") + cad.texto,
            clave,
            enlace: "/rrss?tab=conexion",
            prioridad: nivel === "caducado" ? "alta" : "normal",
          });
          await d.repo.guardarCuenta({ aviso_clave: clave });
        }
      }
      conexion = { estado: valido ? "conectada" : "caducada", nivel, aviso };
    }
  } catch (e) {
    avisos.push(`Comprobación de la conexión: ${mensajeSaneado(e)}`);
  }
  return { ficherosBorrados, piezasMarcadas, conexion, avisos };
}
