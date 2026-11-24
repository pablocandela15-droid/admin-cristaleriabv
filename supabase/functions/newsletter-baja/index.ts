// ============================================================================
// NEWSLETTER-BAJA — Edge Function pública (enlace del pie y botón one-click)
// ============================================================================
// Baja real del newsletter con el token aleatorio de cada suscriptor. La
// lógica (GET nunca da de baja; POST de la página o del botón nativo del
// programa de correo) está en baja.ts. verify_jwt = false (config.toml): la
// llaman los programas de correo sin cabeceras.
//
// Secretos: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (los pone la plataforma).
// Opcional: RESEND_API_KEY (con el canal Broadcast, para quitar el contacto de
// Resend al momento; si no, lo hace la siguiente sincronización).
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { baseWeb } from "../_shared/newsletter/enlaces.ts";
import { manejarBaja, type ResultadoRpcBaja } from "./baja.ts";
import { quitarDeResendTrasBaja } from "./resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const createClient = clienteConAuditoria(createClientBase, "newsletter-baja");
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
const esperarFuera = runtime?.waitUntil ? (p: Promise<unknown>) => runtime.waitUntil!(p) : null;

const rpc = async (fn: string, args: Record<string, unknown>): Promise<ResultadoRpcBaja> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as ResultadoRpcBaja;
};

// Envoltorio común (ADMITE_INTEGRACION): sin usuario; el token es la autenticación (baja.ts).
Deno.serve(conAuditoriaDePeticion("newsletter-baja", createClientBase, (req) =>
  manejarBaja(req, {
    origenesExtra: Deno.env.get("LOGS_WEB_ORIGENES_EXTRA") ?? "",
    async web() {
      const { data } = await supabase.from("newsletter_config").select("web_url").eq("id", 1).maybeSingle();
      return baseWeb(data?.web_url);
    },
    estado: (token) => rpc("newsletter_estado_baja", { p_token: token }),
    baja: (token, origen) => rpc("newsletter_baja_por_token", { p_token: token, p_origen: origen }),
    // Canal Broadcast: fuera de Resend también (libera cuota y no recibe el siguiente Broadcast).
    trasBaja: (r) =>
      r.resend_contact_id
        ? quitarDeResendTrasBaja({ apiKey: Deno.env.get("RESEND_API_KEY"), email: r.resend_contact_id, suscriptorId: "suscriptor" })
        : Promise.resolve("no_estaba"),
    // Sin EdgeRuntime.waitUntil se espera a que termine (baja.ts).
    enSegundoPlano: esperarFuera ? (p) => esperarFuera(p) : undefined,
  })
));
