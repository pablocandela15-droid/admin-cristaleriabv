// ============================================================================
// RRSS-CONEXION — estado, comprobación, «Conectar con Facebook» y desconexión
// ============================================================================
// JWT de usuario: «Ver» en RRSS para el estado y la comprobación; «Editar» para
// conectar, elegir la página y desconectar. La lógica está en conexion.ts.
// Secretos: META_APP_ID y META_APP_SECRET (conectar), o IG_ACCESS_TOKEN +
// IG_USER_ID (+ FB_PAGE_ID) si se usa un token de usuario del sistema.
// Opcionales: META_LOGIN_CONFIG_ID, META_API_VERSION, RRSS_CLAVE_TOKENS,
// PANEL_URL / PANEL_URL_DEMO. Ver docs/RRSS.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirPermiso } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { configMeta } from "../_shared/rrss/config.ts";
import { CORS } from "../_shared/rrss/http.ts";
import { crearRepositorio } from "../_shared/rrss/repositorio.ts";
import { manejarConexion } from "./conexion.ts";

const createClient = clienteConAuditoria(createClientBase, "rrss-conexion");

Deno.serve(conAuditoriaDePeticion("rrss-conexion", createClientBase, (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const env = (n: string) => Deno.env.get(n);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return manejarConexion(req, {
    config: configMeta(env),
    env,
    repo: crearRepositorio(supabase),
    autorizar: (r, modo) => exigirPermiso(r, "rrss", modo, { crearCliente: createClient, corsHeaders: CORS }),
    iaDisponible: Boolean(claveOpenAI("otros")),
    cronConfigurado: Boolean(Deno.env.get("OCR_TRABAJOS_SECRET")),
  });
}));
