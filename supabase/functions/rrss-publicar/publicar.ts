/**
 * Edge Function rrss-publicar — «Publicar ahora» desde RRSS.
 *
 *   POST ${SUPABASE_URL}/functions/v1/rrss-publicar   Authorization: Bearer <JWT> («Editar» en RRSS)
 *   { piezaIds: ["<uuid>", …] }   (las de un mismo envío: Instagram y Facebook; como mucho 4)
 *   → 200 { ok, resultados: [{ piezaId, red, estado: publicada|procesando|error|aplazada|omitida, permalink, mensaje, error }] }
 *     ok = ninguna terminó en error u omitida. «procesando»: Meta aún procesa el vídeo; el programador la termina sola.
 *   400 entrada · 401/403 sesión o permiso · 503 sin conexión ({ tipo: "sin_conexion", comoArreglarlo }).
 *
 * Cada pieza: reserva (cerrojo, nunca dos a la vez; 409 lógico «programada» si tiene una programación pendiente),
 * núcleo de publicación (_shared/rrss/motor.ts) con una URL firmada del cubo privado y cierre con el resultado. El
 * token de Meta no sale nunca de la función. Sin Deno ni imports remotos (vitest).
 */
import type { ClienteGraph } from "../_shared/rrss/cliente.ts";
import { resolverCredenciales } from "../_shared/rrss/credenciales.ts";
import type { ConfigMeta } from "../_shared/rrss/config.ts";
import { errorMetaAJson, estadoHttpDeError } from "../_shared/rrss/errores.ts";
import { json, leerCuerpo } from "../_shared/rrss/http.ts";
import { publicarConReserva, type ResultadoPublicacion } from "../_shared/rrss/publicacion.ts";
import type { RepositorioRrss } from "../_shared/rrss/repositorio.ts";

export interface DependenciasPublicar {
  config: ConfigMeta;
  repo: RepositorioRrss;
  autorizar(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }>;
  /** Cliente de la Graph API con ese token y el límite de la petición. */
  crearCliente(token: string, limite: number): ClienteGraph;
  ahora?: () => number;
  intervaloSondeoMs?: number;
}

/** La función tiene ~150 s de reloj: no se empieza nada nuevo pasado este tiempo. */
export const LIMITE_PETICION_MS = 110_000;
export const MAX_PIEZAS = 4;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function manejarPublicar(req: Request, d: DependenciasPublicar): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const auth = await d.autorizar(req);
  if (!auth.ok) return auth.response;
  const cuerpo = await leerCuerpo(req);
  if (cuerpo === null) return json({ ok: false, error: "Cuerpo de la petición no válido" }, 400);
  const ids = Array.isArray(cuerpo.piezaIds) ? [...new Set(cuerpo.piezaIds.filter((x): x is string => typeof x === "string" && RE_UUID.test(x)))] : [];
  if (ids.length === 0 || ids.length > MAX_PIEZAS) return json({ ok: false, error: `Indica de 1 a ${MAX_PIEZAS} publicaciones` }, 400);

  const ahora = d.ahora ?? Date.now;
  const limite = ahora() + LIMITE_PETICION_MS;
  // Las piezas de Facebook necesitan el token de la página.
  const piezas = await Promise.all(ids.map((id) => d.repo.leerPieza(id)));
  const conPagina = piezas.some((p) => p?.red === "facebook");
  const cred = await resolverCredenciales(d.config, d.repo, { conPagina });
  if (!cred.ok) return json({ ok: false, ...errorMetaAJson(cred.error) }, estadoHttpDeError(cred.error));

  const resultados: ResultadoPublicacion[] = [];
  // Instagram primero (es la red principal); Facebook después.
  const orden = ids.slice().sort((a, b) => Number(piezas[ids.indexOf(a)]?.red === "facebook") - Number(piezas[ids.indexOf(b)]?.red === "facebook"));
  for (const id of orden) {
    if (ahora() > limite - 25_000) {
      resultados.push({ piezaId: id, red: piezas[ids.indexOf(id)]?.red ?? null, estado: "omitida", motivo: "sin_tiempo", mensaje: "No ha dado tiempo: vuelve a pulsar «Publicar» para esta red." });
      continue;
    }
    resultados.push(await publicarConReserva(id, {
      repo: d.repo,
      cred: cred.cred,
      crearCliente: (t) => d.crearCliente(t, limite),
      ahora,
      limite,
      programada: false,
      intervaloSondeoMs: d.intervaloSondeoMs,
    }));
  }
  const ok = resultados.every((r) => r.estado === "publicada" || r.estado === "procesando");
  return json({ ok, resultados });
}
