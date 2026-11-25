// ============================================================================
// RRSS-OAUTH — vuelta del «Conectar con Facebook» (URL de redirección de la app de Meta)
// ============================================================================
// Pública (verify_jwt = false): la abre el navegador al volver de Facebook. La
// protege el state aleatorio de un solo uso (rrss_oauth_estados, solo su
// sha256), creado por rrss-conexion para un usuario con «Editar» en RRSS. La
// lógica está en oauth.ts. Secretos: META_APP_ID, META_APP_SECRET (y
// RRSS_CLAVE_TOKENS, opcional). Ver docs/RRSS.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { configMeta } from "../_shared/rrss/config.ts";
import { crearRepositorio } from "../_shared/rrss/repositorio.ts";
import { manejarOauth } from "./oauth.ts";

const createClient = clienteConAuditoria(createClientBase, "rrss-oauth");

Deno.serve(conAuditoriaDePeticion("rrss-oauth", createClientBase, (req) => {
  const env = (n: string) => Deno.env.get(n);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return manejarOauth(req, { config: configMeta(env), env, repo: crearRepositorio(supabase) });
}));
