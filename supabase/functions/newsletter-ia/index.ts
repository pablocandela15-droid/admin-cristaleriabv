// ============================================================================
// NEWSLETTER-IA — «Crear con IA» de Newsletter › Crear y enviar
// ============================================================================
// La IA redacta el correo y propone su presentación por bloques. Nunca envía ni
// guarda nada (ver ia.ts). JWT de usuario + «Editar» en Newsletter.
// Secreto: OPENAI_API_KEY (el general). Opcional: NEWSLETTER_IA_MODEL.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirPermiso, tokenBearer } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { configModeloFuncion } from "../_shared/modelo-funcion.ts";
import { registrarUso } from "../_shared/registrar-uso-ia.ts";
import { leerAjustes } from "../_shared/newsletter/servidor.ts";
import { errorReserva, manejarNewsletterIA, FUNCION, MODELO_POR_DEFECTO } from "./ia.ts";

const createClient = clienteConAuditoria(createClientBase, "newsletter-ia");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const servicio = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(conAuditoriaDePeticion("newsletter-ia", createClientBase, (req) => {
  // Las peticiones del tope diario van con el JWT del usuario (RLS «Editar» y autor = él).
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${tokenBearer(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return manejarNewsletterIA(req, {
    clave: claveOpenAI("otros"),
    cors,
    autorizar: (r) => exigirPermiso(r, "newsletter", "edit", { crearCliente: createClient, corsHeaders: cors }),
    modelo: async () => (await configModeloFuncion(FUNCION, (Deno.env.get("NEWSLETTER_IA_MODEL") ?? "").trim() || MODELO_POR_DEFECTO, { cliente: servicio })).modelo,
    async reservar(modelo) {
      const { data, error, status } = await comoUsuario.from("newsletter_ia_peticiones").insert({ modelo }).select("id").single();
      if (error) throw errorReserva(status ?? 0, `${error.code ?? ""} ${error.message ?? ""}`);
      return (data?.id as number) ?? null;
    },
    async marcar(id, ok) {
      if (id !== null) await comoUsuario.from("newsletter_ia_peticiones").update({ ok }).eq("id", id);
    },
    negocio: async () => (await leerAjustes(servicio)).negocio,
    registrar: registrarUso,
  });
}));
