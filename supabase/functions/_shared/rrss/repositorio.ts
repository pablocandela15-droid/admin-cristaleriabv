// ============================================================================
//  RRSS · acceso a la base de datos desde las funciones (service role)
// ----------------------------------------------------------------------------
//  Todo lo que las funciones leen y escriben en las tablas de RRSS pasa por
//  aquí (migración 20261125100000_rrss). El cliente de supabase-js se inyecta
//  (con el envoltorio de auditoría de cada función); las pruebas usan un doble
//  de la interfaz `RepositorioRrss`. Los textos que vienen de Meta llegan ya
//  saneados.
// ============================================================================
import type { FormatoPieza, Red, TipoMedio } from "./formatos.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any;

export interface FilaCuenta {
  estado: "sin_conectar" | "eligiendo_pagina" | "conectada" | "caducada" | "error";
  origen: "conexion" | "secretos" | null;
  ig_user_id: string | null;
  ig_usuario: string | null;
  ig_nombre: string | null;
  ig_foto_url: string | null;
  fb_pagina_id: string | null;
  fb_pagina_nombre: string | null;
  permisos: string[];
  token_caduca_en: string | null;
  acceso_datos_caduca_en: string | null;
  paginas_candidatas: Array<{ id: string; nombre: string | null; instagram: { id: string; usuario: string | null } | null }>;
  conectado_por: string | null;
  conectado_en: string | null;
  comprobado_en: string | null;
  error: string | null;
  aviso_clave: string | null;
}

export interface FilaTokens {
  token_usuario: string | null;
  token_pagina: string | null;
  candidatos: string | null;
}

export interface FilaPieza {
  id: string;
  grupo_id: string;
  red: Red;
  formato: FormatoPieza;
  proporcion: string;
  caption: string;
  servicio: string | null;
  estado: string;
  contenedor_id: string | null;
  hijos: string[];
  media_id: string | null;
  permalink: string | null;
  publicada_at: string | null;
  publicacion_iniciada_at: string | null;
  procesando_desde: string | null;
  medios_borrados_at: string | null;
  reserva_id: string | null;
}

export interface FilaMedio {
  id: string;
  pieza_id: string;
  orden: number;
  tipo: TipoMedio;
  ruta: string;
  alt_text: string;
  portada_ms: number | null;
  duracion_s: number | null;
  bytes: number | null;
}

export interface FilaProgramacion {
  id: string;
  pieza_id: string;
  red: Red;
  programada_para: string;
  estado: string;
  intentos: number;
  bloqueo_id: string;
}

export type ResultadoReserva =
  | { ok: true; reserva: string; pieza: FilaPieza }
  | { ok: false; motivo: "no_existe" | "publicada" | "en_curso" | "programada" | "cortada" | "no_lista"; mediaId?: string | null; permalink?: string | null };

export interface AvanceMotor {
  contenedor?: string | null;
  hijos?: string[];
  mediaId?: string | null;
  permalink?: string | null;
  limpiar?: boolean;
}

export interface RepositorioRrss {
  leerCuenta(): Promise<FilaCuenta>;
  guardarCuenta(parcial: Partial<FilaCuenta>): Promise<void>;
  leerTokens(): Promise<FilaTokens>;
  guardarTokens(parcial: Partial<FilaTokens>): Promise<void>;
  crearEstado(hash: string, usuarioId: string, volverA: string): Promise<void>;
  usarEstado(hash: string): Promise<{ usuario_id: string; volver_a: string } | null>;
  leerPieza(id: string): Promise<FilaPieza | null>;
  leerMedios(piezaId: string): Promise<FilaMedio[]>;
  reservar(piezaId: string, leaseSeg: number, programada: boolean): Promise<ResultadoReserva>;
  progreso(piezaId: string, reserva: string, a: AvanceMotor): Promise<boolean>;
  cerrar(piezaId: string, reserva: string, resultado: "publicada" | "procesando" | "error" | "liberar", datos?: Record<string, unknown>): Promise<void>;
  reclamarProgramacion(leaseSeg: number): Promise<FilaProgramacion | null>;
  cerrarProgramacion(id: string, bloqueo: string, resultado: "publicada" | "reintentar" | "aplazar" | "error",
    d?: { mensaje?: string | null; mediaId?: string | null; permalink?: string | null; esperaSeg?: number }): Promise<void>;
  piezasProcesando(limite: number): Promise<string[]>;
  urlFirmada(ruta: string, segundos: number): Promise<string>;
  /** Ficheros del cubo que se pueden borrar (rrss_ficheros_para_borrar). */
  ficherosParaBorrar(horas: number, dias: number): Promise<Array<{ ruta: string; motivo: string }>>;
  /** Borra ficheros del cubo por la API de Storage (de 100 en 100); devuelve los borrados. */
  borrarFicheros(rutas: string[]): Promise<string[]>;
  marcarMediosBorrados(rutas: string[]): Promise<number>;
  /** Aviso en la campana (no se repite: `clave` única). Devuelve false si ya existía. */
  crearAviso(a: { tipo: string; titulo: string; mensaje: string; clave: string; enlace: string; prioridad?: "alta" | "normal" }): Promise<boolean>;
}

function fallo(contexto: string, error: { message?: string; code?: string } | null): never {
  throw new Error(`${contexto}: ${error?.message ?? "error de la base de datos"}`);
}

export function crearRepositorio(sb: ClienteSupabase): RepositorioRrss {
  return {
    async leerCuenta() {
      const { data, error } = await sb.from("rrss_meta_cuenta").select("*").eq("id", 1).maybeSingle();
      if (error) fallo("leer rrss_meta_cuenta", error);
      return (data ?? { estado: "sin_conectar", origen: null, permisos: [], paginas_candidatas: [] }) as FilaCuenta;
    },
    async guardarCuenta(parcial) {
      const { error } = await sb.from("rrss_meta_cuenta").update({ ...parcial, actualizado_en: new Date().toISOString() }).eq("id", 1);
      if (error) fallo("guardar rrss_meta_cuenta", error);
    },
    async leerTokens() {
      const { data, error } = await sb.from("rrss_meta_tokens").select("token_usuario, token_pagina, candidatos").eq("id", 1).maybeSingle();
      if (error) fallo("leer rrss_meta_tokens", error);
      return (data ?? { token_usuario: null, token_pagina: null, candidatos: null }) as FilaTokens;
    },
    async guardarTokens(parcial) {
      const { error } = await sb.from("rrss_meta_tokens").update({ ...parcial, actualizado_en: new Date().toISOString() }).eq("id", 1);
      if (error) fallo("guardar rrss_meta_tokens", error);
    },
    async crearEstado(hash, usuarioId, volverA) {
      const { error } = await sb.from("rrss_oauth_estados").insert({ hash, usuario_id: usuarioId, volver_a: volverA });
      if (error) fallo("guardar el state", error);
    },
    async usarEstado(hash) {
      const { data, error } = await sb.rpc("rrss_oauth_usar_estado", { p_hash: hash });
      if (error) fallo("gastar el state", error);
      const fila = Array.isArray(data) ? data[0] : data;
      return fila?.usuario_id ? { usuario_id: String(fila.usuario_id), volver_a: String(fila.volver_a) } : null;
    },
    async leerPieza(id) {
      const { data, error } = await sb.from("rrss_piezas").select("*").eq("id", id).maybeSingle();
      if (error) fallo("leer la pieza", error);
      return (data ?? null) as FilaPieza | null;
    },
    async leerMedios(piezaId) {
      const { data, error } = await sb.from("rrss_medios").select("id, pieza_id, orden, tipo, ruta, alt_text, portada_ms, duracion_s, bytes")
        .eq("pieza_id", piezaId).order("orden");
      if (error) fallo("leer los ficheros", error);
      return ((data ?? []) as FilaMedio[]).map((m) => ({ ...m, duracion_s: m.duracion_s === null ? null : Number(m.duracion_s), bytes: m.bytes === null ? null : Number(m.bytes) }));
    },
    async reservar(piezaId, leaseSeg, programada) {
      const { data, error } = await sb.rpc("rrss_pieza_reservar", { p_pieza: piezaId, p_lease_seg: leaseSeg, p_programada: programada });
      if (error) fallo("reservar la pieza", error);
      return data as ResultadoReserva;
    },
    async progreso(piezaId, reserva, a) {
      const { data, error } = await sb.rpc("rrss_pieza_progreso", {
        p_pieza: piezaId, p_reserva: reserva, p_contenedor: a.contenedor ?? null, p_hijos: a.hijos ?? null,
        p_media_id: a.mediaId ?? null, p_permalink: a.permalink ?? null, p_limpiar: a.limpiar ?? false,
      });
      if (error) fallo("guardar el avance", error);
      return data === true;
    },
    async cerrar(piezaId, reserva, resultado, datos = {}) {
      const { error } = await sb.rpc("rrss_pieza_cerrar", { p_pieza: piezaId, p_reserva: reserva, p_resultado: resultado, p_datos: datos });
      if (error) fallo("cerrar la publicación", error);
    },
    async reclamarProgramacion(leaseSeg) {
      const { data, error } = await sb.rpc("rrss_programador_reclamar", { p_lease_seg: leaseSeg });
      if (error) fallo("reclamar una programación", error);
      const fila = Array.isArray(data) ? data[0] : data;
      return (fila?.id ? fila : null) as FilaProgramacion | null;
    },
    async cerrarProgramacion(id, bloqueo, resultado, d = {}) {
      const { error } = await sb.rpc("rrss_programador_cerrar", {
        p_id: id, p_bloqueo: bloqueo, p_resultado: resultado, p_mensaje: d.mensaje ?? null, p_media_id: d.mediaId ?? null,
        p_permalink: d.permalink ?? null, p_espera_seg: d.esperaSeg ?? 0,
      });
      if (error) fallo("cerrar la programación", error);
    },
    async piezasProcesando(limite) {
      const { data, error } = await sb.from("rrss_piezas").select("id").or("estado.eq.procesando,estado.eq.publicando")
        .order("updated_at").limit(limite);
      if (error) fallo("leer las piezas en proceso", error);
      return ((data ?? []) as Array<{ id: string }>).map((p) => p.id);
    },
    async ficherosParaBorrar(horas, dias) {
      const { data, error } = await sb.rpc("rrss_ficheros_para_borrar", { p_horas: horas, p_dias: dias, p_limite: 500 });
      if (error) fallo("buscar ficheros para borrar", error);
      return ((data ?? []) as Array<{ ruta: string; motivo: string }>).filter((f) => typeof f.ruta === "string");
    },
    async borrarFicheros(rutas) {
      const borrados: string[] = [];
      for (let i = 0; i < rutas.length; i += 100) {
        const tanda = rutas.slice(i, i + 100);
        const { data, error } = await sb.storage.from("rrss").remove(tanda);
        if (error) fallo("borrar ficheros del cubo", error);
        for (const o of (data ?? []) as Array<{ name?: string }>) if (o?.name) borrados.push(o.name);
      }
      return borrados;
    },
    async marcarMediosBorrados(rutas) {
      if (rutas.length === 0) return 0;
      const { data, error } = await sb.rpc("rrss_marcar_medios_borrados", { p_rutas: rutas });
      if (error) fallo("marcar ficheros borrados", error);
      return Number(data ?? 0);
    },
    async crearAviso(a) {
      const { error } = await sb.from("notificaciones_dashboard").insert({
        tipo: a.tipo, titulo: a.titulo.slice(0, 200), mensaje: a.mensaje.slice(0, 500), clave: a.clave.slice(0, 200),
        prioridad: a.prioridad ?? "normal", origen: "rrss", datos: { enlace: a.enlace },
      });
      if (error?.code === "23505") return false;
      if (error) fallo("crear el aviso", error);
      return true;
    },
    async urlFirmada(ruta, segundos) {
      const { data, error } = await sb.storage.from("rrss").createSignedUrl(ruta, segundos);
      if (error || !data?.signedUrl) fallo(`firmar ${ruta}`, error);
      return String(data.signedUrl);
    },
  };
}
