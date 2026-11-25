// ============================================================================
//  RRSS · publicar una pieza con su reserva (rrss-publicar y rrss-programador)
// ----------------------------------------------------------------------------
//  reservar (cerrojo) → leer sus ficheros → núcleo (motor.ts) → cerrar la pieza
//  con el resultado. Si algo falla al cerrar, la reserva caduca sola y la
//  siguiente pasada lo retoma sin publicar dos veces (ver la migración).
// ============================================================================
import type { ClienteGraph } from "./cliente.ts";
import type { Credenciales } from "./credenciales.ts";
import { errorMetaAJson, textoDeTipo, type TipoErrorMeta } from "./errores.ts";
import { publicarPieza, type ResultadoMotor } from "./motor.ts";
import type { RepositorioRrss } from "./repositorio.ts";
import { registro, sanear } from "./secretos.ts";

export interface DependenciasPublicacion {
  repo: RepositorioRrss;
  cred: Credenciales;
  crearCliente(token: string): ClienteGraph;
  ahora: () => number;
  limite: number;
  /** La publica el programador (su programación es la que manda). */
  programada: boolean;
  leaseSeg?: number;
  intervaloSondeoMs?: number;
}

export interface ResultadoPublicacion {
  piezaId: string;
  red: string | null;
  /** publicada | procesando | error | aplazada (cuota) | omitida (no se pudo reservar) */
  estado: "publicada" | "procesando" | "error" | "aplazada" | "omitida";
  motivo?: string;
  mediaId?: string | null;
  permalink?: string | null;
  mensaje?: string;
  error?: { error: string; tipo: TipoErrorMeta; comoArreglarlo: string };
  esperaSeg?: number;
  /** Error que se puede reintentar (red, Meta caído…). */
  reintentable?: boolean;
}

const REINTENTABLES: ReadonlySet<TipoErrorMeta> = new Set(["transitorio", "red", "tiempo_agotado", "contenedor_inexistente"]);

const MOTIVOS: Record<string, string> = {
  no_existe: "Esa publicación ya no existe.",
  publicada: "Ya estaba publicada.",
  en_curso: "Ya se está publicando (otra pestaña o el programador). Espera un momento.",
  programada: "Está programada: cancela la programación en el calendario antes de publicarla ahora.",
  cortada: "La publicación en Facebook se cortó a mitad: mira la página antes de repetirla.",
  no_lista: "Todavía es un borrador: complétala antes de publicarla.",
};

export async function publicarConReserva(piezaId: string, d: DependenciasPublicacion): Promise<ResultadoPublicacion> {
  const res = await d.repo.reservar(piezaId, d.leaseSeg ?? 180, d.programada);
  if (!res.ok) {
    if (res.motivo === "publicada") {
      return { piezaId, red: null, estado: "publicada", motivo: "publicada", mediaId: res.mediaId ?? null, permalink: res.permalink ?? null, mensaje: MOTIVOS.publicada };
    }
    return { piezaId, red: null, estado: "omitida", motivo: res.motivo, mensaje: MOTIVOS[res.motivo] ?? res.motivo };
  }
  const reserva = res.reserva;
  const pieza = res.pieza;
  let r: ResultadoMotor;
  try {
    const medios = await d.repo.leerMedios(piezaId);
    r = await publicarPieza(pieza, medios, {
      cred: d.cred,
      reserva,
      progreso: (a) => d.repo.progreso(piezaId, reserva, a),
      urlFirmada: (ruta, seg) => d.repo.urlFirmada(ruta, seg),
      crearCliente: d.crearCliente,
      ahora: d.ahora,
      limite: d.limite,
      intervaloSondeoMs: d.intervaloSondeoMs,
    });
  } catch (e) {
    // Fallo nuestro (base de datos, URL firmada…): no se sabe si Meta llegó a hacer algo; se suelta la reserva sin
    // publicar y, si había contenedor, el siguiente intento lo mira antes de crear otro.
    registro("error", "rrss", `publicar ${piezaId}`, e);
    await d.repo.cerrar(piezaId, reserva, "liberar").catch(() => undefined);
    return { piezaId, red: pieza.red, estado: "error", reintentable: true, mensaje: "No se pudo terminar por un fallo del panel. Vuelve a intentarlo.",
      error: { error: "Fallo del panel al publicar", tipo: "transitorio", comoArreglarlo: textoDeTipo("transitorio").comoArreglarlo } };
  }

  if (r.tipo === "publicada") {
    await d.repo.cerrar(piezaId, reserva, "publicada", { mediaId: r.mediaId, permalink: r.permalink, aviso: r.aviso ?? null });
    return { piezaId, red: pieza.red, estado: "publicada", mediaId: r.mediaId, permalink: r.permalink, ...(r.aviso ? { mensaje: r.aviso } : {}) };
  }
  if (r.tipo === "procesando") {
    await d.repo.cerrar(piezaId, reserva, "procesando");
    return { piezaId, red: pieza.red, estado: "procesando", mensaje: r.mensaje };
  }
  if (r.tipo === "aplazar") {
    if (d.programada) {
      await d.repo.cerrar(piezaId, reserva, "liberar");
    } else {
      await d.repo.cerrar(piezaId, reserva, "error", { error: r.mensaje, tipo: "limite_publicacion", comoArreglarlo: textoDeTipo("limite_publicacion").comoArreglarlo });
    }
    return { piezaId, red: pieza.red, estado: "aplazada", mensaje: sanear(r.mensaje), esperaSeg: r.esperaSeg };
  }
  const json = errorMetaAJson(r.error);
  const reintentable = REINTENTABLES.has(r.error.tipo);
  if (d.programada && reintentable) {
    await d.repo.cerrar(piezaId, reserva, "liberar");
  } else {
    await d.repo.cerrar(piezaId, reserva, "error", { ...json, limpiarContenedor: r.limpiarContenedor ?? false });
  }
  return { piezaId, red: pieza.red, estado: "error", reintentable, error: { error: json.error, tipo: json.tipo, comoArreglarlo: json.comoArreglarlo }, mensaje: json.error };
}
