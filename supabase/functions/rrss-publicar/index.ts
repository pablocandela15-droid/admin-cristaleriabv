// ============================================================================
// RRSS-PUBLICAR — «Publicar ahora» en Instagram y en la página de Facebook
// ============================================================================
// JWT de usuario con «Editar» en RRSS. La lógica está en publicar.ts y en
// _shared/rrss (motor.ts, publicacion.ts). Usa la conexión guardada (tokens
// cifrados) o el token de usuario del sistema de los secretos. Ver docs/RRSS.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirPermiso } from "../_shared/autorizacion.ts";
import { ClienteGraph } from "../_shared/rrss/cliente.ts";
import { configMeta } from "../_shared/rrss/config.ts";
import { CORS } from "../_shared/rrss/http.ts";
import { crearRepositorio } from "../_shared/rrss/repositorio.ts";
import { registro } from "../_shared/rrss/secretos.ts";
import { manejarPublicar } from "./publicar.ts";

const createClient = clienteConAuditoria(createClientBase, "rrss-publicar");

Deno.serve(conAuditoriaDePeticion("rrss-publicar", createClientBase, (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const env = (n: string) => Deno.env.get(n);
  const config = configMeta(env);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return manejarPublicar(req, {
    config,
    repo: crearRepositorio(supabase),
    autorizar: (r) => exigirPermiso(r, "rrss", "edit", { crearCliente: createClient, corsHeaders: CORS }),
    crearCliente: (token, limite) => new ClienteGraph({ token, versionApi: config.versionApi, limite, registro: (l) => registro("info", "rrss-publicar", l) }),
  });
}));
