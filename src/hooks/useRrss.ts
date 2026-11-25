// ============================================================================
//  RRSS (Marketing › RRSS): datos y acciones del panel
// ----------------------------------------------------------------------------
//  Portado del panel de referencia (useProgramacionInstagram, api de Instagram,
//  métricas, campañas, IA) y adaptado a la cristalería:
//    · conexión con Meta: Edge Function rrss-conexion (estado sin llamar a Meta,
//      comprobar, conectar, elegir página, desconectar). Los tokens nunca llegan
//      aquí: el panel solo ve cuenta, página, permisos y caducidades;
//    · publicaciones (rrss_piezas + rrss_medios, una pieza por red y el mismo
//      grupo), ficheros en el cubo privado «rrss» (URL firmadas para verlos);
//    · fotos de Web › Fotos (rrss_fotos_web, bucket público web-fotos);
//    · publicar ahora (rrss-publicar) y programar (RPC rrss_programar…);
//    · IA (rrss-ia), campañas, fechas señaladas, estilo y métricas (tablas con su
//      RLS y rrss_que_funciona; «Actualizar ahora» con rrss-metricas).
//  Sin tipos generados para estas tablas (migración 20261125100000): se accede
//  con el cliente sin tipar, como en Newsletter.
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EstadoCaducidad } from "../../supabase/functions/_shared/rrss/caducidad";
import type { FormatoPieza, Proporcion, Red, TipoMedio } from "../../supabase/functions/_shared/rrss/formatos";
import type { FilaMetricaCuenta } from "../../supabase/functions/_shared/rrss/resumen";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tablas sin tipos generados (migración 20261125100000)
const db = supabase as any;

export const CLAVES_RRSS = {
  conexion: ["rrss-conexion"],
  piezas: ["rrss-piezas"],
  programaciones: ["rrss-programaciones"],
  fotosWeb: ["rrss-fotos-web"],
  ajustes: ["rrss-ajustes"],
  campanas: ["rrss-campanas"],
  metricas: ["rrss-metricas"],
  urls: ["rrss-urls"],
} as const;

/** El motivo real de un 4xx/5xx de una Edge Function (viene en el cuerpo, en `error.context`). */
export async function cuerpoErrorFuncion(error: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      return (await (ctx as Response).clone().json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export class ErrorRrss extends Error {
  constructor(mensaje: string, readonly cuerpo: Record<string, unknown> | null = null) {
    super(mensaje);
  }
  get tipo(): string | null {
    return typeof this.cuerpo?.tipo === "string" ? this.cuerpo.tipo : null;
  }
  get comoArreglarlo(): string | null {
    return typeof this.cuerpo?.comoArreglarlo === "string" ? this.cuerpo.comoArreglarlo : null;
  }
}

async function invocar<T>(funcion: string, body: unknown, porDefecto: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcion, { body: body as Record<string, unknown> });
  if (error) {
    const cuerpo = await cuerpoErrorFuncion(error);
    const msg = (typeof cuerpo?.error === "string" && cuerpo.error) || (error as { message?: string }).message || porDefecto;
    throw new ErrorRrss(/Failed to send|non-2xx|FunctionsFetchError/i.test(msg) && !cuerpo ? `${porDefecto} (¿está desplegada la función ${funcion}?)` : msg, cuerpo);
  }
  return data as T;
}

/** Error de una RPC o tabla del panel en llano. */
function mensajeBd(error: { message?: string; code?: string } | null, porDefecto = "No se pudo completar la acción."): string {
  const m = error?.message ?? "";
  if (error?.code === "42501" || /Editar|row-level security/.test(m)) return "No tienes permiso (hace falta «Editar» en RRSS).";
  if (/does not exist|PGRST202|PGRST205|42883|42P01/.test(m)) return "RRSS todavía no está instalado en la base de datos. Avisa al equipo técnico.";
  return m || porDefecto;
}

// ── Conexión ─────────────────────────────────────────────────────────────────

export interface CuentaConexion {
  igUserId: string | null;
  usuario: string | null;
  nombre: string | null;
  foto: string | null;
  paginaId: string | null;
  paginaNombre: string | null;
}

export interface Comprobacion {
  nombre: string;
  estado: "ok" | "aviso" | "falla";
  detalle: string;
  comoArreglarlo?: string;
}

export interface EstadoConexion {
  ok: boolean;
  modo: "secretos" | "conexion" | null;
  estado: "sin_conectar" | "eligiendo_pagina" | "conectada" | "caducada" | "error";
  conectada: boolean;
  configuracion: { appId: boolean; appSecret: boolean; configId: boolean; tokenSistema: boolean; igUserIdSistema: boolean; paginaSistema: boolean; ia: boolean; cron: boolean };
  faltan: string[];
  puedeConectar: boolean;
  redirectUri: string | null;
  versionApi: string;
  permisosNecesarios: string[];
  cuenta: CuentaConexion | null;
  permisos: string[];
  faltanPermisos: string[];
  caducidad: EstadoCaducidad & { tokenCaducaEn: string | null; accesoDatosCaducaEn: string | null };
  comprobadoEn: string | null;
  conectadoEn: string | null;
  error: string | null;
  candidatas: Array<{ id: string; nombre: string | null; instagram: { id: string; usuario: string | null } | null }>;
  facebook: boolean;
  comprobaciones?: Comprobacion[];
  cuota?: { usadas: number; total: number | null; restantes: number | null } | null;
}

/** Estado de la conexión (sin llamar a Meta). Se pide al entrar y se guarda 5 minutos. */
export function useConexionRrss() {
  return useQuery({
    queryKey: CLAVES_RRSS.conexion,
    queryFn: () => invocar<EstadoConexion>("rrss-conexion", { accion: "estado" }, "No se pudo leer la conexión de RRSS"),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useAccionConexion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { accion: "comprobar" | "desconectar" } | { accion: "elegir_pagina"; paginaId: string }) =>
      invocar<EstadoConexion>("rrss-conexion", p, "No se pudo completar la acción"),
    onSuccess: (data) => qc.setQueryData(CLAVES_RRSS.conexion, data),
  });
}

/** «Conectar con Facebook»: pide la URL del diálogo (con su state) y lleva allí al navegador. */
export function useIniciarConexion() {
  return useMutation({
    mutationFn: async () => {
      const r = await invocar<{ url: string }>("rrss-conexion", { accion: "iniciar", origen: window.location.origin }, "No se pudo empezar la conexión");
      if (!/^https:\/\/www\.facebook\.com\//.test(r.url)) throw new ErrorRrss("La dirección de Facebook no es válida.");
      window.location.assign(r.url);
      return r;
    },
  });
}

// ── Publicaciones ────────────────────────────────────────────────────────────

export type EstadoPieza = "borrador" | "lista" | "publicando" | "procesando" | "publicada" | "error";

export interface MedioRrss {
  id?: string;
  pieza_id?: string;
  orden: number;
  tipo: TipoMedio;
  ruta: string;
  origen: "subida" | "web_fotos";
  web_foto_id: string | null;
  ancho: number | null;
  alto: number | null;
  duracion_s: number | null;
  bytes: number | null;
  alt_text: string;
  portada_ms: number | null;
}

export interface PiezaRrss {
  id: string;
  grupo_id: string;
  red: Red;
  formato: FormatoPieza;
  proporcion: Proporcion;
  titulo: string | null;
  caption: string;
  servicio: string | null;
  estado: EstadoPieza;
  origen: "panel" | "campana";
  campana_id: string | null;
  fecha_prevista: string | null;
  idea: string | null;
  media_id: string | null;
  permalink: string | null;
  publicada_at: string | null;
  procesando_desde: string | null;
  error: string | null;
  error_tipo: string | null;
  como_arreglarlo: string | null;
  medios_borrados_at: string | null;
  created_at: string;
  updated_at: string;
  rrss_medios: MedioRrss[];
}

const COLUMNAS_PIEZA = "id, grupo_id, red, formato, proporcion, titulo, caption, servicio, estado, origen, campana_id, fecha_prevista, idea, media_id, " +
  "permalink, publicada_at, procesando_desde, error, error_tipo, como_arreglarlo, medios_borrados_at, created_at, updated_at, " +
  "rrss_medios(id, pieza_id, orden, tipo, ruta, origen, web_foto_id, ancho, alto, duracion_s, bytes, alt_text, portada_ms)";

/** Publicaciones (las 400 últimas), con sus ficheros en orden. Se refresca sola cada 30 s si hay algo en marcha. */
export function usePiezasRrss() {
  return useQuery({
    queryKey: CLAVES_RRSS.piezas,
    queryFn: async (): Promise<PiezaRrss[]> => {
      const { data, error } = await db.from("rrss_piezas").select(COLUMNAS_PIEZA).order("updated_at", { ascending: false }).limit(400);
      if (error) throw new Error(mensajeBd(error));
      return ((data ?? []) as PiezaRrss[]).map((p) => ({ ...p, rrss_medios: [...(p.rrss_medios ?? [])].sort((a, b) => a.orden - b.orden) }));
    },
    refetchInterval: (q) => ((q.state.data as PiezaRrss[] | undefined)?.some((p) => p.estado === "publicando" || p.estado === "procesando") ? 30_000 : false),
  });
}

function useInvalidarPiezas() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: CLAVES_RRSS.piezas });
    qc.invalidateQueries({ queryKey: CLAVES_RRSS.programaciones });
  };
}

export interface DatosGrupo {
  /** Grupo que se edita (null = nuevo). */
  grupoId: string | null;
  redes: Red[];
  formato: FormatoPieza;
  proporcion: Proporcion;
  titulo: string;
  caption: string;
  servicio: string | null;
  estado: "borrador" | "lista";
  medios: MedioRrss[];
}

/**
 * Guarda una publicación en todas sus redes (una pieza por red, mismo grupo y mismos ficheros). Quita la red que se
 * desmarque (si aún no se publicó). Devuelve las piezas guardadas.
 */
export function useGuardarGrupo() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: async (d: DatosGrupo): Promise<PiezaRrss[]> => {
      const existentes: PiezaRrss[] = [];
      if (d.grupoId) {
        const { data, error } = await db.from("rrss_piezas").select(COLUMNAS_PIEZA).eq("grupo_id", d.grupoId);
        if (error) throw new Error(mensajeBd(error));
        existentes.push(...((data ?? []) as PiezaRrss[]));
      }
      const grupo = d.grupoId ?? crypto.randomUUID();
      const ids: string[] = [];
      for (const red of d.redes) {
        const fila = {
          red, formato: d.formato, proporcion: d.formato === "story" || d.formato === "reel" ? "9:16" : d.proporcion,
          titulo: d.titulo.trim() || null, caption: d.formato === "story" ? "" : d.caption, servicio: d.servicio, estado: d.estado,
        };
        const previa = existentes.find((p) => p.red === red);
        let id: string;
        if (previa) {
          const { error } = await db.from("rrss_piezas").update(fila).eq("id", previa.id);
          if (error) throw new Error(mensajeBd(error));
          id = previa.id;
          const { error: e2 } = await db.from("rrss_medios").delete().eq("pieza_id", id);
          if (e2) throw new Error(mensajeBd(e2));
        } else {
          const { data, error } = await db.from("rrss_piezas").insert({ ...fila, grupo_id: grupo }).select("id").single();
          if (error) throw new Error(mensajeBd(error));
          id = data.id as string;
        }
        if (d.medios.length) {
          const filas = d.medios.map((m, i) => ({
            pieza_id: id, orden: i, tipo: m.tipo, ruta: m.ruta, origen: m.origen, web_foto_id: m.web_foto_id, ancho: m.ancho, alto: m.alto,
            duracion_s: m.duracion_s, bytes: m.bytes, alt_text: m.alt_text.slice(0, 1000), portada_ms: m.portada_ms,
          }));
          const { error } = await db.from("rrss_medios").insert(filas);
          if (error) throw new Error(mensajeBd(error));
        }
        ids.push(id);
      }
      for (const sobra of existentes.filter((p) => !d.redes.includes(p.red) && ["borrador", "lista", "error"].includes(p.estado))) {
        const { error } = await db.from("rrss_piezas").delete().eq("id", sobra.id);
        if (error) throw new Error(mensajeBd(error));
      }
      const { data, error } = await db.from("rrss_piezas").select(COLUMNAS_PIEZA).in("id", ids);
      if (error) throw new Error(mensajeBd(error));
      return data as PiezaRrss[];
    },
    onSettled: invalidar,
  });
}

export function useBorrarPieza() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("rrss_piezas").delete().eq("id", id);
      if (error) throw new Error(mensajeBd(error));
    },
    onSettled: invalidar,
  });
}

/** Vuelve a «lista» una pieza con error (para reintentar). */
export function useMarcarLista() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("rrss_piezas").update({ estado: "lista" }).eq("id", id);
      if (error) throw new Error(mensajeBd(error));
    },
    onSettled: invalidar,
  });
}

export interface ResultadoPublicacion {
  piezaId: string;
  red: Red | null;
  estado: "publicada" | "procesando" | "error" | "aplazada" | "omitida";
  motivo?: string;
  permalink?: string | null;
  mensaje?: string;
  error?: { error: string; tipo: string; comoArreglarlo: string };
}

/** «Publicar ahora»: las piezas del grupo (Instagram primero). */
export function usePublicarAhora() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: (piezaIds: string[]) => invocar<{ ok: boolean; resultados: ResultadoPublicacion[] }>("rrss-publicar", { piezaIds }, "No se pudo publicar"),
    onSettled: invalidar,
  });
}

// ── Ficheros ─────────────────────────────────────────────────────────────────

/** Sube un fichero ya preparado (JPEG recortado o vídeo) a subidas/<usuario>/<uuid>.<ext> del cubo privado. */
export async function subirFichero(blob: Blob, ext: "jpg" | "mp4" | "mov"): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user?.id) throw new Error("Tu sesión ha caducado: vuelve a entrar.");
  const ruta = `subidas/${u.user.id}/${crypto.randomUUID()}.${ext}`;
  const tipo = ext === "jpg" ? "image/jpeg" : ext === "mp4" ? "video/mp4" : "video/quicktime";
  const { error } = await supabase.storage.from("rrss").upload(ruta, blob, { contentType: tipo, upsert: false, cacheControl: "3600" });
  if (error) {
    if (/row-level security|403|Unauthorized/i.test(error.message)) throw new Error("No tienes permiso para subir ficheros (hace falta «Editar» en RRSS).");
    if (/exceeded|too large|413/i.test(error.message)) throw new Error("El fichero pasa de 50 MB.");
    throw new Error(`No se pudo subir el fichero: ${error.message}`);
  }
  return ruta;
}

/** URL firmadas (1 h) de los ficheros del cubo privado para verlos en el panel. */
export function useUrlsFirmadas(rutas: string[]) {
  const unicas = [...new Set(rutas.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...CLAVES_RRSS.urls, unicas],
    enabled: unicas.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from("rrss").createSignedUrls(unicas, 3600);
      if (error) throw new Error(error.message);
      const salida: Record<string, string> = {};
      for (const f of data ?? []) if (f.path && f.signedUrl) salida[f.path] = f.signedUrl;
      return salida;
    },
  });
}

export interface FotoWeb {
  id: string;
  ruta: string;
  titulo: string | null;
  alt: string;
  ancho: number | null;
  alto: number | null;
  servicio: string | null;
  album: string | null;
  visible_en_web: boolean;
  creado_en: string;
}

/** Fotos de Web › Fotos (por tipo de trabajo), aunque no se vea esa sección. */
export function useFotosWeb(activo = true) {
  return useQuery({
    queryKey: CLAVES_RRSS.fotosWeb,
    enabled: activo,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FotoWeb[]> => {
      const { data, error } = await db.rpc("rrss_fotos_web");
      if (error) throw new Error(mensajeBd(error));
      return (data ?? []) as FotoWeb[];
    },
  });
}

/** URL pública de una foto de la web (bucket público web-fotos). */
export function urlFotoWeb(ruta: string): string {
  return supabase.storage.from("web-fotos").getPublicUrl(ruta).data.publicUrl;
}

// ── Programación ─────────────────────────────────────────────────────────────

export interface ProgramacionRrss {
  id: string;
  pieza_id: string;
  red: Red;
  programada_para: string;
  estado: "programada" | "publicando" | "publicada" | "error" | "cancelada";
  intentos: number;
  ultimo_error: string | null;
  permalink: string | null;
}

/** Programaciones de los últimos 60 días y las futuras (sin las canceladas). Cada minuto. */
export function useProgramacionesRrss() {
  return useQuery({
    queryKey: CLAVES_RRSS.programaciones,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ProgramacionRrss[]> => {
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { data, error } = await db.from("rrss_programaciones").select("id, pieza_id, red, programada_para, estado, intentos, ultimo_error, permalink")
        .neq("estado", "cancelada").gte("programada_para", desde).order("programada_para").limit(500);
      if (error) throw new Error(mensajeBd(error));
      return (data ?? []) as ProgramacionRrss[];
    },
  });
}

export interface RespuestaProgramar {
  ok: boolean;
  requiereConfirmacion?: boolean;
  conflictos?: Array<{ id: string; piezaId: string; programadaPara: string }>;
}

export function useProgramar() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: async (p: { piezaIds: string[]; instante: Date; confirmar?: boolean }): Promise<RespuestaProgramar> => {
      for (const id of p.piezaIds) {
        const { data, error } = await db.rpc("rrss_programar", { p_pieza_id: id, p_para: p.instante.toISOString(), p_confirmar_conflicto: p.confirmar ?? false });
        if (error) throw new Error(mensajeBd(error));
        if (data && data.ok === false) return data as RespuestaProgramar;
      }
      return { ok: true };
    },
    onSettled: invalidar,
  });
}

export function useReprogramar() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: async (p: { id: string; instante: Date; confirmar?: boolean }): Promise<RespuestaProgramar> => {
      const { data, error } = await db.rpc("rrss_reprogramar", { p_id: p.id, p_para: p.instante.toISOString(), p_confirmar_conflicto: p.confirmar ?? false });
      if (error) throw new Error(mensajeBd(error));
      return data as RespuestaProgramar;
    },
    onSettled: invalidar,
  });
}

export function useCancelarProgramacion() {
  const invalidar = useInvalidarPiezas();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("rrss_cancelar_programacion", { p_id: id });
      if (error) throw new Error(mensajeBd(error));
    },
    onSettled: invalidar,
  });
}

// ── Estilo ───────────────────────────────────────────────────────────────────

export interface AjustesRrss {
  zona: string;
  tono: "cercano" | "profesional" | "tecnico";
  guia: string;
  hashtags_base: string[];
  ctas: string[];
  palabras_evitar: string[];
  facebook_por_defecto: boolean;
  emojis: boolean;
  aprendido_en: string | null;
  aprendido_resumen: string | null;
  version: number;
  actualizado_en: string;
}

export function useAjustesRrss() {
  return useQuery({
    queryKey: CLAVES_RRSS.ajustes,
    queryFn: async (): Promise<AjustesRrss | null> => {
      const { data, error } = await db.from("rrss_ajustes").select("*").eq("id", 1).maybeSingle();
      if (error) throw new Error(mensajeBd(error));
      return (data ?? null) as AjustesRrss | null;
    },
  });
}

export function useGuardarAjustes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Partial<Omit<AjustesRrss, "version" | "actualizado_en">>) => {
      const { error } = await db.from("rrss_ajustes").update(a).eq("id", 1);
      if (error) throw new Error(mensajeBd(error, "No se pudo guardar el estilo."));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CLAVES_RRSS.ajustes }),
  });
}

// ── IA ───────────────────────────────────────────────────────────────────────

export interface VarianteIA {
  enfoque: "trabajo" | "problema" | "consejo";
  gancho: string;
  caption: string;
  hashtags: string[];
  altText: string;
  avisos: string[];
}

export interface IdeaIA {
  fecha: string;
  titulo: string;
  idea: string;
  formato: FormatoPieza;
  servicio: string;
  gancho: string;
  comoGrabarlo: string;
  motivo: string;
}

export interface PiezaCampanaIA {
  fecha: string;
  hora: string;
  formato: FormatoPieza;
  servicio: string;
  titulo: string;
  idea: string;
  caption: string;
  hashtags: string[];
  porQue: string;
  fase: string;
}

export interface CampanaIA {
  titulo: string;
  objetivo: string;
  publico: string;
  mensaje: string;
  razonamiento: string;
  fases: Array<{ nombre: string; desde: string; hasta: string; objetivo: string }>;
  piezas: PiezaCampanaIA[];
}

export interface PropuestaEstiloIA {
  resumen: string;
  cambios: string[];
  guia: string;
  hashtagsBase: string[];
  ctas: string[];
  palabrasEvitar: string[];
}

export function useIARrss<T>() {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => invocar<T>("rrss-ia", body, "La IA no ha podido responder"),
  });
}

// ── Campañas y fechas ────────────────────────────────────────────────────────

export interface CampanaRrss {
  id: string;
  titulo: string;
  objetivo: string | null;
  peticion: string | null;
  desde: string;
  hasta: string;
  estado: "propuesta" | "aceptada" | "descartada";
  propuesta: CampanaIA;
  created_at: string;
}

export function useCampanasRrss() {
  return useQuery({
    queryKey: CLAVES_RRSS.campanas,
    queryFn: async (): Promise<CampanaRrss[]> => {
      const { data, error } = await db.from("rrss_campanas").select("id, titulo, objetivo, peticion, desde, hasta, estado, propuesta, created_at")
        .neq("estado", "descartada").order("created_at", { ascending: false }).limit(30);
      if (error) throw new Error(mensajeBd(error));
      return (data ?? []) as CampanaRrss[];
    },
  });
}

export function useAccionCampana() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { accion: "aceptar"; id: string; indices: number[]; facebook: boolean } | { accion: "descartar"; id: string }) => {
      const { data, error } = p.accion === "aceptar"
        ? await db.rpc("rrss_aceptar_campana", { p_campana: p.id, p_indices: p.indices, p_facebook: p.facebook })
        : await db.rpc("rrss_descartar_campana", { p_campana: p.id });
      if (error) throw new Error(mensajeBd(error));
      return data as { ok: boolean; piezas?: string[] };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CLAVES_RRSS.campanas });
      qc.invalidateQueries({ queryKey: CLAVES_RRSS.piezas });
    },
  });
}

export interface FechaSenalada {
  clave: string;
  titulo: string;
  ambito: string;
  desde: string;
  hasta: string;
  idea: string | null;
  verificacion: string;
}

export function useFechasRrss(desde: string, hasta: string) {
  return useQuery({
    queryKey: ["rrss-fechas", desde, hasta],
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<FechaSenalada[]> => {
      const { data, error } = await db.rpc("rrss_fechas_entre", { p_desde: desde, p_hasta: hasta });
      if (error) throw new Error(mensajeBd(error));
      return ((data ?? []) as FechaSenalada[]).sort((a, b) => a.desde.localeCompare(b.desde));
    },
  });
}

// ── Métricas ─────────────────────────────────────────────────────────────────

export interface PublicacionMetricas {
  media_id: string;
  pieza_id: string | null;
  tipo_medio: string | null;
  producto: string | null;
  publicado_at: string | null;
  permalink: string | null;
  miniatura_url: string | null;
  caption: string | null;
  alcance: number | null;
  me_gusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

export interface CapturaMetricas {
  origen: string;
  inicio: string;
  fin: string | null;
  ok: boolean;
  error_tipo: string | null;
  error: string | null;
  avisos: string[];
}

export interface DatosMetricas {
  cuenta: Array<FilaMetricaCuenta & { red: string }>;
  publicaciones: PublicacionMetricas[];
  capturas: CapturaMetricas[];
  queFunciona: QueFunciona | null;
}

export interface QueFunciona {
  publicaciones: number;
  tasa_media: number | null;
  suficiente: boolean;
  aviso: string | null;
  por: Record<string, Array<{ clave: string; publicaciones: number; tasa: number | null; alcance_medio: number | null; suficiente: boolean }>>;
  conclusiones: Array<{ eje: string; estado: "mejor" | "parecido" | "faltan_datos"; texto: string }>;
}

/** Métricas guardadas (las lee el panel con su RLS; no llama a Meta). */
export function useMetricasRrss() {
  return useQuery({
    queryKey: CLAVES_RRSS.metricas,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DatosMetricas> => {
      const desde = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
      const [c, p, k, q] = await Promise.all([
        db.from("rrss_metricas_cuenta").select("fecha, red, seguidores, alcance, visualizaciones, visitas_perfil, cuentas_interaccion, interacciones, toques_enlaces")
          .gte("fecha", desde).order("fecha"),
        db.from("rrss_metricas_publicacion_ultima").select("media_id, pieza_id, tipo_medio, producto, publicado_at, permalink, miniatura_url, caption, alcance, me_gusta, comentarios, guardados, compartidos, visualizaciones, interacciones")
          .eq("red", "instagram").order("publicado_at", { ascending: false }).limit(120),
        db.from("rrss_metricas_capturas").select("origen, inicio, fin, ok, error_tipo, error, avisos").order("inicio", { ascending: false }).limit(10),
        db.rpc("rrss_que_funciona", { p_dias: 90, p_minimo: 3 }),
      ]);
      for (const r of [c, p, k]) if (r.error) throw new Error(mensajeBd(r.error));
      return { cuenta: c.data ?? [], publicaciones: p.data ?? [], capturas: k.data ?? [], queFunciona: q.error ? null : (q.data as QueFunciona) };
    },
  });
}

export function useActualizarMetricas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invocar<{ ok: boolean; publicaciones?: number; avisos?: string[] }>("rrss-metricas", { accion: "capturar" }, "No se pudieron actualizar las métricas"),
    onSettled: () => qc.invalidateQueries({ queryKey: CLAVES_RRSS.metricas }),
  });
}
