// ============================================================================
// RESEND-WEBHOOK — eventos asíncronos de Resend (Edge Function pública)
// ============================================================================
// Resend avisa aquí de lo que pasa con cada correo (sent, delivered, opened,
// clicked, bounced, complained, suppressed…) y con los contactos (canal
// Broadcast). Portado del panel de referencia:
//   · FIRMA SVIX REAL (firma.ts): HMAC-SHA256 sobre «svix-id.svix-timestamp.cuerpo
//     crudo» con la clave de RESEND_WEBHOOK_SECRET (whsec_…), comparación en
//     tiempo constante y tolerancia de 5 min. FALLA CERRADO: sin el secreto,
//     500 y no se procesa nada; firma mala, 401.
//   · Archiva en email_eventos (estadísticas del panel) y actúa: supresión de
//     direcciones, bajas automáticas y contactos borrados (procesar.ts).
// verify_jwt = false (config.toml): Resend no manda JWT.
//
// Secretos: RESEND_WEBHOOK_SECRET (Resend › Webhooks › Signing secret),
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Ver docs/NEWSLETTER.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { autenticarWebhookResend, type CabecerasSvix } from "./firma.ts";
import { patronIlikeExacto } from "./newsletter.ts";
import { procesarEvento, type EventoResend, type RepoWebhook } from "./procesar.ts";

const createClient = clienteConAuditoria(createClientBase, "resend-webhook");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Tope del cuerpo (los eventos de Resend ocupan unos pocos KB). */
const MAX_CUERPO = 256 * 1024;

Deno.serve(conAuditoriaDePeticion("resend-webhook", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (Number(req.headers.get("content-length") || 0) > MAX_CUERPO) return json({ error: "payload_too_large" }, 413);

  // Cuerpo CRUDO: la firma se calcula sobre estos bytes exactos (nunca sobre un JSON.stringify).
  const cuerpo = await req.text();
  if (cuerpo.length > MAX_CUERPO) return json({ error: "payload_too_large" }, 413);
  const cabeceras: CabecerasSvix = {
    svixId: req.headers.get("svix-id"),
    svixTimestamp: req.headers.get("svix-timestamp"),
    svixSignature: req.headers.get("svix-signature"),
  };
  const auth = await autenticarWebhookResend(Deno.env.get("RESEND_WEBHOOK_SECRET"), cabeceras, cuerpo);
  if (!auth.ok) {
    if (auth.status === 500) {
      console.error("[resend-webhook] RESEND_WEBHOOK_SECRET no configurado — rechazando (falla cerrado)");
      return json({ error: "server_configuration_error" }, 500);
    }
    console.error("[resend-webhook] firma rechazada:", auth.motivo);
    return json({ error: auth.error }, 401);
  }

  let evento: EventoResend;
  try {
    evento = JSON.parse(cuerpo);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!evento || typeof evento.type !== "string") return json({ error: "Invalid event" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repo: RepoWebhook = {
    async archivar(fila) {
      const { data, error } = await supabase.from("email_eventos").upsert(fila, { onConflict: "svix_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
    async suprimir(s) {
      const { error } = await supabase
        .from("direcciones_email_suprimidas")
        .upsert({ ...s, actualizado_at: new Date().toISOString() }, { onConflict: "email" });
      if (error) throw new Error(error.message);
    },
    async darDeBaja(d) {
      const { data, error } = await supabase.rpc("newsletter_registrar_baja", { p_email: d.email, p_origen: d.origen, p_suscriptor_id: d.suscriptorId });
      if (!error) return typeof data === "number" ? data : 0;
      // Respaldo (no debería hacer falta): por id o por email exacto sin distinguir mayúsculas.
      console.error("[resend-webhook] newsletter_registrar_baja falló, se intenta directo:", error.message);
      let consulta = supabase.from("newsletter_suscriptores").update({ estado: "baja", fecha_baja: new Date().toISOString(), origen_baja: d.origen }).in("estado", ["activo", "pendiente"]);
      if (d.suscriptorId) consulta = consulta.eq("id", d.suscriptorId);
      else {
        const patron = patronIlikeExacto(d.email);
        if (patron === null) return 0;
        consulta = consulta.ilike("email", patron);
      }
      const { data: filas, error: e2 } = await consulta.select("id");
      if (e2) throw new Error(e2.message);
      return filas?.length ?? 0;
    },
    async desvincularContacto(contactId) {
      const { error } = await supabase.from("newsletter_suscriptores").update({ resend_contact_id: null }).eq("resend_contact_id", contactId);
      if (error) throw new Error(error.message);
    },
  };

  try {
    const r = await procesarEvento(evento, cabeceras.svixId, repo);
    return json({ success: true, ...r });
  } catch (e) {
    // Solo si no se pudo archivar: Resend reintentará. El detalle, al log.
    console.error("[resend-webhook] no se pudo archivar el evento:", e instanceof Error ? e.message : e);
    return json({ error: "Internal server error" }, 500);
  }
}));
