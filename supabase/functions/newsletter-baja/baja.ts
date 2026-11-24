// ============================================================================
// newsletter-baja · lógica (sin Deno ni red: se prueba con vitest)
// ----------------------------------------------------------------------------
// Baja REAL del newsletter (RGPD), portada del panel de referencia y con el
// token aleatorio por suscriptor (newsletter_claves) en vez de la firma HMAC:
//   · GET  ?t=<token>                → 302 a la página de la web (enlaces abiertos en el navegador). No cambia nada.
//   · GET  ?t=<token>&formato=json   → estado para la página: confirmar | ya_estaba | invalido (no cambia nada).
//   · POST ?t=<token>&formato=json   → baja de verdad (botón «Darme de baja» de la página).
//   · POST ?t=<token>&via=header     → botón nativo «Cancelar suscripción» de Gmail/Outlook (RFC 8058, cuerpo
//                                      `List-Unsubscribe=One-Click`): baja inmediata, sin página.
// Un GET nunca da de baja: los programas de correo y los antivirus siguen los
// enlaces solos. Sin el token (64 hex aleatorios, uno por suscriptor) no se
// puede dar de baja a nadie: no vale con adivinar ids ni emails.
// ============================================================================

import { entornoDeOrigen } from "../_shared/logs-web/clasificacion.ts";
import { TOKEN_RE, enmascararEmail, urlBajaWeb } from "../_shared/newsletter/enlaces.ts";

export type EstadoBaja = "confirmar" | "baja_hecha" | "ya_estaba" | "invalido" | "prueba" | "error";

export interface RespuestaBaja {
  ok: boolean;
  estado: EstadoBaja;
  /** A medias («an***@example.com»): lo enseña la página. */
  email: string | null;
  fecha_baja: string | null;
}

export function respuestaBaja(estado: EstadoBaja, email: string | null = null, fechaBaja: string | null = null): RespuestaBaja {
  const ok = estado === "confirmar" || estado === "baja_hecha" || estado === "ya_estaba";
  return { ok, estado, email: ok ? enmascararEmail(email) : null, fecha_baja: ok ? fechaBaja : null };
}

/** El enlace de las pruebas y de la vista previa del panel (no es de nadie). */
export const TOKEN_PRUEBA = "prueba";

export interface ResultadoRpcBaja {
  estado: "confirmar" | "baja_hecha" | "ya_estaba" | "invalido";
  email?: string | null;
  fecha_baja?: string | null;
  resend_contact_id?: string | null;
}

export interface DependenciasBaja {
  origenesExtra?: string;
  /** web_url de newsletter_config (para la redirección de los GET). */
  web(): Promise<string>;
  /** RPC newsletter_estado_baja. */
  estado(token: string): Promise<ResultadoRpcBaja>;
  /** RPC newsletter_baja_por_token. */
  baja(token: string, origen: "enlace_email" | "cabecera_one_click"): Promise<ResultadoRpcBaja>;
  /** Tras una baja: quitar el contacto de Resend (canal Broadcast). Best-effort, nunca cambia la respuesta. */
  trasBaja?(r: ResultadoRpcBaja): Promise<unknown>;
  /** EdgeRuntime.waitUntil si existe (para no retrasar la respuesta). */
  enSegundoPlano?(p: Promise<unknown>): void;
  log?: (m: string) => void;
}

function cors(origen: string | null, extra: string): Record<string, string> {
  const permitido = origen !== null && entornoDeOrigen(origen, extra) !== null;
  return {
    ...(permitido ? { "Access-Control-Allow-Origin": origen!, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function manejarBaja(req: Request, deps: DependenciasBaja): Promise<Response> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const c = cors(req.headers.get("origin"), deps.origenesExtra ?? "");
  const url = new URL(req.url);
  const token = (url.searchParams.get("t") ?? "").trim();
  const json = url.searchParams.get("formato") === "json";
  const oneClick = url.searchParams.get("via") === "header";
  const responder = (estado: EstadoBaja, email?: string | null, fecha?: string | null, status = 200) =>
    new Response(JSON.stringify(respuestaBaja(estado, email ?? null, fecha ?? null)), {
      status,
      headers: { ...c, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: c });

  // Navegador abriendo el enlace (o la URL de la cabecera): a la página de la web, que pregunta antes.
  if (req.method === "GET" && !json) {
    const web = await deps.web().catch(() => "");
    return new Response(null, {
      status: 302,
      headers: { Location: urlBajaWeb(web, token), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }

  if (token === TOKEN_PRUEBA) return responder("prueba");
  if (!TOKEN_RE.test(token)) {
    return oneClick ? new Response("Enlace no válido", { status: 400, headers: c }) : responder("invalido");
  }

  try {
    if (req.method === "GET") {
      const r = await deps.estado(token);
      return responder(r.estado, r.email, r.fecha_baja);
    }
    const r = await deps.baja(token, oneClick ? "cabecera_one_click" : "enlace_email");
    if (r.estado === "baja_hecha" && deps.trasBaja) {
      const tarea = deps.trasBaja(r).catch((e) => log(`[newsletter-baja] tras la baja: ${e instanceof Error ? e.message : e}`));
      if (deps.enSegundoPlano) deps.enSegundoPlano(tarea);
      else await tarea;
    }
    if (r.estado === "baja_hecha") log("[newsletter-baja] baja registrada" + (oneClick ? " (one-click)" : ""));
    if (oneClick) {
      return new Response(r.estado === "invalido" ? "Enlace no válido" : "Baja registrada", {
        status: r.estado === "invalido" ? 400 : 200,
        headers: { ...c, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return responder(r.estado, r.email, r.fecha_baja);
  } catch (e) {
    log(`[newsletter-baja] error: ${e instanceof Error ? e.message : e}`);
    if (oneClick) return new Response("Error", { status: 500, headers: c });
    return responder("error", null, null, 500);
  }
}
