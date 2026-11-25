// Dobles de prueba de RRSS (sin red ni base de datos): repositorio en memoria con las mismas reglas de reserva que
// la migración, y una Graph API falsa que contesta por método y ruta y apunta cada llamada.
import type { AvanceMotor, FilaCuenta, FilaMedio, FilaPieza, FilaProgramacion, FilaTokens, RepositorioRrss, ResultadoReserva } from "../rrss/repositorio";

export const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function pieza(p: Partial<FilaPieza> = {}): FilaPieza {
  return {
    id: UUID(1), grupo_id: UUID(100), red: "instagram", formato: "foto", proporcion: "4:5", caption: "Mampara a medida en Elche #mamparas",
    servicio: "mamparas", estado: "lista", contenedor_id: null, hijos: [], media_id: null, permalink: null, publicada_at: null,
    publicacion_iniciada_at: null, procesando_desde: null, medios_borrados_at: null, reserva_id: null, ...p,
  };
}

export function medio(n: number, p: Partial<FilaMedio> = {}): FilaMedio {
  return { id: UUID(500 + n), pieza_id: UUID(1), orden: n, tipo: "imagen", ruta: `subidas/${UUID(9)}/${UUID(700 + n)}.jpg`, alt_text: "", portada_ms: null, duracion_s: null, bytes: 200_000, ...p };
}

export function cuentaVacia(p: Partial<FilaCuenta> = {}): FilaCuenta {
  return {
    estado: "sin_conectar", origen: null, ig_user_id: null, ig_usuario: null, ig_nombre: null, ig_foto_url: null, fb_pagina_id: null,
    fb_pagina_nombre: null, permisos: [], token_caduca_en: null, acceso_datos_caduca_en: null, paginas_candidatas: [], conectado_por: null,
    conectado_en: null, comprobado_en: null, error: null, aviso_clave: null, ...p,
  };
}

export interface RepoFalso extends RepositorioRrss {
  cuenta: FilaCuenta;
  tokens: FilaTokens;
  piezas: Map<string, FilaPieza>;
  medios: Map<string, FilaMedio[]>;
  estados: Map<string, { usuario_id: string; volver_a: string; usado: boolean }>;
  programaciones: Array<FilaProgramacion & { cierres: unknown[] }>;
  cierres: Array<{ piezaId: string; resultado: string; datos: Record<string, unknown> }>;
  avisos: Array<{ tipo: string; titulo: string; mensaje: string; clave: string; enlace: string }>;
  borrados: string[];
  firmadas: string[];
}

export function repoFalso(inicial: { piezas?: FilaPieza[]; medios?: Record<string, FilaMedio[]>; cuenta?: Partial<FilaCuenta> } = {}): RepoFalso {
  const r: RepoFalso = {
    cuenta: cuentaVacia(inicial.cuenta),
    tokens: { token_usuario: null, token_pagina: null, candidatos: null },
    piezas: new Map((inicial.piezas ?? []).map((p) => [p.id, { ...p }])),
    medios: new Map(Object.entries(inicial.medios ?? {})),
    estados: new Map(),
    programaciones: [],
    cierres: [],
    avisos: [],
    borrados: [],
    firmadas: [],
    async leerCuenta() { return { ...r.cuenta }; },
    async guardarCuenta(p) { r.cuenta = { ...r.cuenta, ...p }; },
    async leerTokens() { return { ...r.tokens }; },
    async guardarTokens(p) { r.tokens = { ...r.tokens, ...p }; },
    async crearEstado(hash, usuarioId, volverA) { r.estados.set(hash, { usuario_id: usuarioId, volver_a: volverA, usado: false }); },
    async usarEstado(hash) {
      const e = r.estados.get(hash);
      if (!e || e.usado) return null;
      e.usado = true;
      return { usuario_id: e.usuario_id, volver_a: e.volver_a };
    },
    async leerPieza(id) { const p = r.piezas.get(id); return p ? { ...p } : null; },
    async leerMedios(id) { return [...(r.medios.get(id) ?? [])]; },
    async reservar(id, _lease, programada): Promise<ResultadoReserva> {
      const p = r.piezas.get(id);
      if (!p) return { ok: false, motivo: "no_existe" };
      if (p.media_id || p.estado === "publicada") return { ok: false, motivo: "publicada", mediaId: p.media_id, permalink: p.permalink };
      if (p.reserva_id) return { ok: false, motivo: "en_curso" };
      if (!programada && r.programaciones.some((g) => g.pieza_id === id && g.estado === "programada")) return { ok: false, motivo: "programada" };
      if (!["lista", "error", "procesando", "publicando"].includes(p.estado)) return { ok: false, motivo: "no_lista" };
      p.estado = "publicando";
      p.reserva_id = `reserva-${id}`;
      p.publicacion_iniciada_at ??= new Date(1_000_000).toISOString();
      return { ok: true, reserva: p.reserva_id, pieza: { ...p } };
    },
    async progreso(id, reserva, a: AvanceMotor) {
      const p = r.piezas.get(id);
      if (!p || p.reserva_id !== reserva) return false;
      if (a.limpiar) { p.contenedor_id = null; p.hijos = []; }
      else {
        if (a.contenedor !== undefined && a.contenedor !== null) p.contenedor_id = a.contenedor;
        if (a.hijos) p.hijos = [...a.hijos];
      }
      if (a.mediaId) p.media_id ??= a.mediaId;
      if (a.permalink) p.permalink = a.permalink;
      return true;
    },
    async cerrar(id, reserva, resultado, datos = {}) {
      const p = r.piezas.get(id);
      if (!p || p.reserva_id !== reserva) throw new Error("La publicación ya no está reservada por esta petición");
      r.cierres.push({ piezaId: id, resultado, datos });
      p.reserva_id = null;
      if (resultado === "publicada") { p.estado = "publicada"; p.publicada_at = new Date().toISOString(); p.media_id ??= (datos.mediaId as string) ?? null; p.permalink = (datos.permalink as string) ?? p.permalink; }
      else if (resultado === "procesando") p.estado = "procesando";
      else if (resultado === "error") { p.estado = "error"; if (datos.limpiarContenedor) { p.contenedor_id = null; p.hijos = []; } }
      else p.estado = "lista";
    },
    async reclamarProgramacion() {
      const g = r.programaciones.find((x) => x.estado === "programada");
      if (!g) return null;
      g.estado = "publicando";
      g.bloqueo_id = `bloqueo-${g.id}`;
      return { ...g };
    },
    async cerrarProgramacion(id, bloqueo, resultado, d = {}) {
      const g = r.programaciones.find((x) => x.id === id && x.bloqueo_id === bloqueo);
      if (!g) throw new Error("La programación ya no está bloqueada por esta pasada");
      g.cierres.push({ resultado, ...d });
      g.estado = resultado === "publicada" ? "publicada" : resultado === "error" ? "error" : resultado === "reintentar" && g.intentos + 1 >= 3 ? "error" : "aplazada";
      if (resultado === "reintentar") g.intentos++;
    },
    async piezasProcesando() { return [...r.piezas.values()].filter((p) => p.estado === "procesando").map((p) => p.id); },
    async urlFirmada(ruta, seg) { r.firmadas.push(ruta); return `https://ejemplo.supabase.co/storage/v1/object/sign/rrss/${ruta}?token=eyJhbGciOiJIUzI1NiJ9.firma-de-prueba-larga.otra-parte-firma&s=${seg}`; },
    async ficherosParaBorrar() { return []; },
    async borrarFicheros(rutas) { r.borrados.push(...rutas); return rutas; },
    async marcarMediosBorrados(rutas) { return rutas.length; },
    async crearAviso(a) {
      if (r.avisos.some((x) => x.clave === a.clave)) return false;
      r.avisos.push(a);
      return true;
    },
  };
  return r;
}

export interface LlamadaGraph {
  metodo: string;
  ruta: string;
  consulta: Record<string, string>;
  cuerpo: Record<string, string>;
  auth: string | null;
}

type Respuesta = { status?: number; body: unknown } | ((l: LlamadaGraph) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>);

/** Graph API falsa: `rutas` = { "POST /17841/media": respuesta | [respuestas en orden] }. Lo no previsto → 404 de Meta. */
export function graphFalsa(rutas: Record<string, Respuesta | Respuesta[]>) {
  const llamadas: LlamadaGraph[] = [];
  const colas = new Map(Object.entries(rutas).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const ruta = u.pathname.replace(/^\/v\d+\.\d/, "");
    const metodo = init?.method ?? "GET";
    const cuerpo = Object.fromEntries(new URLSearchParams(typeof init?.body === "string" ? init.body : ""));
    const auth = new Headers(init?.headers).get("Authorization");
    const llamada = { metodo, ruta, consulta: Object.fromEntries(u.searchParams), cuerpo, auth };
    llamadas.push(llamada);
    const clave = `${metodo} ${ruta}`;
    let r = colas.get(clave);
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    if (!r) return new Response(JSON.stringify({ error: { message: `sin respuesta prevista para ${clave}`, code: 100 } }), { status: 400 });
    const res = typeof r === "function" ? await r(llamada) : r;
    if (res.body instanceof Error) throw res.body;
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetch, llamadas };
}
