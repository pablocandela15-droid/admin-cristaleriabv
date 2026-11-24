// ============================================================================
// NEWSLETTER-ALTA — Edge Function pública (web de la cristalería)
// ============================================================================
// Alta en el newsletter desde la web (doble opt-in) y confirmación desde el
// enlace del correo. verify_jwt = false (config.toml): la web la llama con la
// clave publicable, que no es un JWT. La protección real (origen de la web,
// campo trampa, consentimiento, límite por huella de IP) está en alta.ts.
//
// Secretos: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (los pone la plataforma),
// RESEND_API_KEY. Remitente: Newsletter › Configuración (newsletter_config).
// Opcional: LOGS_WEB_ORIGENES_EXTRA (otro dominio de la web). Ver docs/NEWSLETTER.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { ipCliente } from "../_shared/ip-cliente.ts";
import { ClienteResendMarketing } from "../_shared/resend-marketing/cliente.ts";
import { enviarConfirmacion, leerAjustes } from "../_shared/newsletter/servidor.ts";
import { manejarAlta, type ResultadoRegistro } from "./alta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const createClient = clienteConAuditoria(createClientBase, "newsletter-alta");
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Envoltorio común (ADMITE_INTEGRACION): sin usuario; la protección está en alta.ts.
Deno.serve(conAuditoriaDePeticion("newsletter-alta", createClientBase, (req) => {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  return manejarAlta(req, {
    ip: ipCliente(req),
    sal: SERVICE_ROLE_KEY,
    origenesExtra: Deno.env.get("LOGS_WEB_ORIGENES_EXTRA") ?? "",
    apiKey: Boolean(apiKey),
    leerConfig: () => leerAjustes(supabase),
    async registrar(ipHash, datos, texto, maxHora): Promise<ResultadoRegistro> {
      const { data, error } = await supabase.rpc("newsletter_alta_web", {
        p_ip_hash: ipHash,
        p_email: datos.email,
        p_nombre: datos.nombre,
        p_origen: datos.origen,
        p_texto_consentimiento: texto,
        p_max_hora: maxHora,
      });
      if (error) throw new Error(error.message);
      return data as ResultadoRegistro;
    },
    enviarConfirmacion: (o) => enviarConfirmacion(new ClienteResendMarketing({ apiKey, maxReintentos: 2, timeoutMs: 10_000 }), o),
    async confirmar(token) {
      const { data, error } = await supabase.rpc("newsletter_confirmar", { p_token: token });
      if (error) throw new Error(error.message);
      return data as { estado: "confirmada" | "ya_confirmada" | "caducado" | "invalido"; email?: string };
    },
  }).catch((e) => {
    console.error("[newsletter-alta] error no controlado:", (e as Error)?.message ?? e);
    return new Response(JSON.stringify({ ok: false, error: "interno" }), { status: 500, headers: { "Content-Type": "application/json" } });
  });
}));
