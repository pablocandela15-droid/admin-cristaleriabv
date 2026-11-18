// ============================================================================
//  analizar-peticion / cliente-linear.ts — cliente de la API de Linear
// ----------------------------------------------------------------------------
//  API GraphQL de Linear (https://api.linear.app/graphql), cabecera
//  `Authorization: <LINEAR_API_KEY>` (clave personal). Lo usa «Enviar a
//  Linear» desde Super Admin › Tickets (./linear.ts).
//
//  SIN DUPLICADOS aunque se reintente o haya dos procesos: el ticket se crea
//  con un `id` propio (IssueCreateInput.id admite un UUID v4). Si el primer
//  intento llegó a crearlo pero la respuesta se perdió (timeout), el
//  reintento choca con ese id y aquí se recupera el ticket existente con
//  `issue(id)` en vez de crear otro.
//
//  Errores LEGIBLES: Linear responde a una clave mala con 400/401 y un error
//  AUTHENTICATION_ERROR, a la falta de permiso con FORBIDDEN, a un id que no
//  existe con «Entity not found»… Todo se traduce a una frase en español que
//  dice qué hacer (ErrorLinear.codigo para decidir; .message para mostrar).
//  La clave nunca sale del servidor.
//  Sin Deno ni imports remotos: se prueba con vitest y un fetch simulado.
// ============================================================================

export interface TicketLinear {
  id: string;
  identificador: string | null;
  url: string | null;
  estadoTipo: string | null; // triage | backlog | unstarted | started | completed | canceled | duplicate
  estadoNombre: string | null;
}

export interface DatosCrear {
  id: string; // linear_uuid
  equipoId: string | null;
  proyectoId: string | null;
  titulo: string;
  descripcion: string;
  prioridad: number; // 1 urgente, 2 alta, 3 normal, 4 baja
  etiquetas: string[];
  /** Id interno del origen (0 si no aplica): solo lo usan los destinos de prueba. */
  incidenciaId: number;
}

export interface DestinoTickets {
  tipo: "prueba" | "real";
  crear(d: DatosCrear): Promise<TicketLinear>;
  comentar(issueId: string, cuerpo: string, incidenciaId: number): Promise<void>;
  /** null = el ticket ya no existe (borrado) o la clave no lo ve. */
  consultar(issueId: string): Promise<TicketLinear | null>;
  /**
   * Vuelve a abrir el ticket SI está cerrado (hecho, cancelado o duplicado). Con
   * `estadoId` va a ese estado; sin él, al primer estado «por hacer» de su
   * equipo. Si sigue abierto en Linear no lo mueve (no lo devuelve de «En curso»
   * a «Por hacer»). Devuelve el nombre del estado al que lo pasa, o null.
   */
  reabrir(issueId: string, estadoId: string | null, incidenciaId: number): Promise<string | null>;
}

/** Qué ha fallado, para decidir qué hacer (el texto para la persona va en `message`). */
export type CodigoErrorLinear = "clave" | "permiso" | "no_encontrado" | "limite" | "caido" | "datos" | "otro";

export class ErrorLinear extends Error {
  constructor(
    message: string,
    readonly reintentable: boolean,
    readonly status: number | null = null,
    readonly codigo: CodigoErrorLinear = "otro",
  ) {
    super(message);
    this.name = "ErrorLinear";
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const LINEAR_API = "https://api.linear.app/graphql";

/** Dónde se crea la clave (lo enseña el panel y lo repiten los mensajes de error). */
export const PASOS_CLAVE =
  "En Linear: Settings › Security & access › Personal API keys › New API key. Después, en Supabase › Edge Functions › Secrets, guárdala como LINEAR_API_KEY.";

export const MENSAJES_LINEAR = {
  sinClave: `Falta la clave de Linear (LINEAR_API_KEY) en el servidor. ${PASOS_CLAVE}`,
  clave: `Linear no acepta la clave guardada: puede estar mal copiada, caducada o revocada. Crea otra (${PASOS_CLAVE.replace(/^En Linear: /, "")})`,
  permiso: "La clave de Linear no tiene permiso para esto: créala con acceso completo (o, como mínimo, leer y crear incidencias y comentarios) y con acceso al equipo elegido.",
  limite: "Linear pide esperar (demasiadas peticiones seguidas). Se reintenta solo.",
  caido: "Linear no responde ahora mismo. Se reintenta solo.",
} as const;

const CAMPOS_TICKET = "id identifier url state { name type }";

function aTicket(issue: Record<string, unknown> | null | undefined): TicketLinear | null {
  if (!issue || typeof issue.id !== "string") return null;
  const estado = (issue.state ?? null) as { name?: string; type?: string } | null;
  return {
    id: issue.id,
    identificador: typeof issue.identifier === "string" ? issue.identifier : null,
    url: typeof issue.url === "string" ? issue.url : null,
    estadoTipo: estado?.type ?? null,
    estadoNombre: estado?.name ?? null,
  };
}

type ErrorGql = { message?: string; extensions?: { code?: string; type?: string; userPresentableMessage?: string } };

const esDuplicado = (mensaje: string) => /already exists|duplicate|unique constraint|conflict|entity.*exist/i.test(mensaje);
const RE_CLAVE = /authenticat|not authenticated|unauthori[sz]ed|invalid api key|api key (is )?(invalid|revoked|expired)/i;
const RE_PERMISO = /forbidden|not allowed|permission|access denied|insufficient/i;
const RE_NO_ENCONTRADO = /entity not found|not found|could not find|does not exist/i;
const RE_LIMITE = /ratelimit|rate limit|too many requests/i;

/** Traduce una respuesta de error de Linear a un ErrorLinear con una frase que dice qué hacer. */
export function clasificarErrorLinear(status: number, errores: ErrorGql[], texto = ""): ErrorLinear {
  const partes = errores.map((e) => [e.extensions?.code, e.extensions?.type, e.message, e.extensions?.userPresentableMessage].filter(Boolean).join(" "));
  const todo = `${partes.join(" · ")} ${errores.length ? "" : texto.slice(0, 200)}`.trim();
  const detalle = (errores[0]?.extensions?.userPresentableMessage ?? errores[0]?.message ?? texto.slice(0, 160)).slice(0, 200);
  if (status === 429 || RE_LIMITE.test(todo)) return new ErrorLinear(MENSAJES_LINEAR.limite, true, status, "limite");
  if (status === 401 || RE_CLAVE.test(todo)) return new ErrorLinear(MENSAJES_LINEAR.clave, false, status, "clave");
  if (status === 403 || RE_PERMISO.test(todo)) return new ErrorLinear(MENSAJES_LINEAR.permiso, false, status, "permiso");
  if (status >= 500 && !errores.length) return new ErrorLinear(`${MENSAJES_LINEAR.caido} (código ${status})`, true, status, "caido");
  if (RE_NO_ENCONTRADO.test(todo)) return new ErrorLinear(`Linear no encuentra lo pedido (${detalle}): puede que se haya borrado o que la clave no tenga acceso.`, false, status, "no_encontrado");
  if (status >= 500) return new ErrorLinear(`${MENSAJES_LINEAR.caido} (código ${status})`, true, status, "caido");
  return new ErrorLinear(`Linear rechaza la petición: ${detalle || `código ${status}`}`, false, status, "datos");
}

interface OpcionesCliente {
  apiKey: string;
  fetchFn?: FetchLike;
  url?: string;
  intentos?: number;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Cliente GraphQL con reintentos (429/5xx/red) y errores legibles. */
export function crearClienteLinear(opts: OpcionesCliente) {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const url = opts.url ?? LINEAR_API;
  const intentos = Math.max(1, opts.intentos ?? 3);
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let ultimo: ErrorLinear | null = null;
    for (let n = 1; n <= intentos; n++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: opts.apiKey },
          body: JSON.stringify({ query, variables }),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(t);
        const motivo = (e as Error)?.name === "AbortError" ? `sin respuesta en ${Math.round(timeoutMs / 1000)} s` : "no se pudo conectar";
        ultimo = new ErrorLinear(`${MENSAJES_LINEAR.caido} (${motivo})`, true, null, "caido");
        if (n < intentos) await esperar(Math.min(1000 * 2 ** (n - 1), 8000));
        continue;
      }
      clearTimeout(t);
      const texto = await res.text().catch(() => "");
      let cuerpo: { data?: T; errors?: ErrorGql[] } = {};
      try {
        cuerpo = texto ? JSON.parse(texto) : {};
      } catch {
        // cuerpo no JSON: se trata por el código HTTP
      }
      const errores = Array.isArray(cuerpo.errors) ? cuerpo.errors : [];
      if (res.ok && !errores.length) return cuerpo.data as T;
      const error = clasificarErrorLinear(res.status, errores, texto);
      if (!error.reintentable) throw error;
      ultimo = error;
      if (n < intentos) await esperar(Math.min(1000 * 2 ** (n - 1), 8000));
    }
    throw ultimo ?? new ErrorLinear(MENSAJES_LINEAR.caido, true, null, "caido");
  };
}

/** Estado al que se reabre un ticket cerrado: el primero «por hacer» del equipo (o pendiente/triaje). */
export function estadoParaReabrir(estados: Array<{ id: string; name: string; type: string; position?: number }>): { id: string; name: string } | null {
  for (const tipo of ["unstarted", "backlog", "triage", "started"]) {
    const candidato = estados.filter((e) => e.type === tipo).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
    if (candidato) return { id: candidato.id, name: candidato.name };
  }
  return null;
}

const CERRADO = new Set(["completed", "canceled", "duplicate"]);

export function crearDestinoLinear(opts: OpcionesCliente): DestinoTickets {
  const gql = crearClienteLinear(opts);

  async function consultar(issueId: string): Promise<TicketLinear | null> {
    try {
      const d = await gql<{ issue?: Record<string, unknown> | null }>(`query($id: String!) { issue(id: $id) { ${CAMPOS_TICKET} } }`, { id: issueId });
      return aTicket(d?.issue ?? null);
    } catch (e) {
      if (e instanceof ErrorLinear && e.codigo === "no_encontrado") return null;
      throw e;
    }
  }

  return {
    tipo: "real",
    async crear(d) {
      if (!d.equipoId) throw new ErrorLinear("Falta el equipo de Linear (web_logs_config.linear_equipo_id; ver docs/DESPLIEGUE.md).", false, null, "datos");
      const input: Record<string, unknown> = {
        id: d.id,
        teamId: d.equipoId,
        title: d.titulo,
        description: d.descripcion,
        priority: d.prioridad,
      };
      if (d.proyectoId) input.projectId = d.proyectoId;
      if (d.etiquetas.length) input.labelIds = d.etiquetas;
      try {
        const r = await gql<{ issueCreate?: { success?: boolean; issue?: Record<string, unknown> } }>(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${CAMPOS_TICKET} } } }`,
          { input },
        );
        const ticket = aTicket(r?.issueCreate?.issue);
        if (!r?.issueCreate?.success || !ticket) throw new ErrorLinear("Linear no confirmó la creación del ticket. Se reintenta solo.", true, null, "caido");
        return ticket;
      } catch (e) {
        // Un intento anterior ya lo creó (respuesta perdida o id repetido): se recupera, no se duplica.
        if (e instanceof ErrorLinear && (e.reintentable || esDuplicado(e.message) || e.codigo === "datos")) {
          const existente = await consultar(d.id).catch(() => null);
          if (existente) return existente;
        }
        throw e;
      }
    },
    async comentar(issueId, cuerpo) {
      const r = await gql<{ commentCreate?: { success?: boolean } }>(
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId, body: cuerpo } },
      );
      if (!r?.commentCreate?.success) throw new ErrorLinear("Linear no confirmó el comentario. Se reintenta solo.", true, null, "caido");
    },
    consultar,
    async reabrir(issueId, estadoId) {
      const d = await gql<{ issue?: { state?: { type?: string } | null; team?: { states?: { nodes?: Array<{ id: string; name: string; type: string; position?: number }> } } | null } | null }>(
        `query($id: String!) { issue(id: $id) { state { type } team { states(first: 50) { nodes { id name type position } } } } }`,
        { id: issueId },
      );
      const issue = d?.issue;
      if (!issue) throw new ErrorLinear("El ticket ya no existe en Linear (borrado o sin acceso): no se puede reabrir.", false, null, "no_encontrado");
      if (!CERRADO.has(String(issue.state?.type ?? ""))) return null; // sigue abierto: solo se comenta
      const estados = issue.team?.states?.nodes ?? [];
      const destino = estadoId ? estados.find((e) => e.id === estadoId) ?? { id: estadoId, name: "el estado configurado" } : estadoParaReabrir(estados);
      if (!destino) return null;
      const r = await gql<{ issueUpdate?: { success?: boolean } }>(
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
        { id: issueId, input: { stateId: destino.id } },
      );
      if (!r?.issueUpdate?.success) throw new ErrorLinear("Linear no confirmó la reapertura. Se reintenta solo.", true, null, "caido");
      return destino.name;
    },
  };
}
