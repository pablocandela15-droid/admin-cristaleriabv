// ============================================================================
// NEWSLETTER-SYNC-RESEND — estado de la configuración y lista de envío
// ============================================================================
// Portada del panel de referencia. Copia newsletter_suscriptores (la fuente de
// verdad) a Resend Marketing y trae de vuelta las bajas hechas en la página de
// Resend; solo hace falta con el canal «broadcast». La lógica está en
// ../_shared/resend-marketing/sync.ts; aquí solo hay I/O.
//
//   POST {"accion":"estado"} / GET   panel («Ver» en Newsletter): qué está configurado y qué falta (sin valores
//                                    de secretos), canal, contactos usados y última pasada.
//   POST {"accion":"sincronizar"}    panel («Editar») o pg_cron (x-ocr-secret, newsletter_disparar_sync).
//
// Secretos: RESEND_API_KEY («Full access» para Contacts y Broadcasts), OCR_TRABAJOS_SECRET (cron).
// Opcionales: RESEND_NEWSLETTER_SEGMENT_ID (sin él se busca/crea el Segment «Newsletter Cristalería BV»),
// NEWSLETTER_LIMITE_CONTACTOS (1.000 por defecto, plan gratuito).
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirPermiso } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { faltaParaEnviar, remitente } from "../_shared/newsletter/enlaces.ts";
import { leerAjustes } from "../_shared/newsletter/servidor.ts";
import { ClienteResendMarketing } from "../_shared/resend-marketing/cliente.ts";
import { limiteContactos, NOMBRE_SEGMENTO_NEWSLETTER } from "../_shared/resend-marketing/config.ts";
import { RepositorioNewsletterResend } from "../_shared/resend-marketing/repositorio.ts";
import { sincronizarConCerrojo } from "../_shared/resend-marketing/servicio.ts";
import { autenticarCron, construirEstado, leerAccion, respuestaSincronizacion } from "./peticion.ts";

const createClient = clienteConAuditoria(createClientBase, "newsletter-sync-resend");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** La función tiene ~150 s de reloj: a los 100 s deja de empezar acciones nuevas y lo que falte queda para la siguiente pasada. */
const MS_PRESUPUESTO = 100_000;

Deno.serve(conAuditoriaDePeticion("newsletter-sync-resend", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  const inicio = Date.now();

  let cuerpo: unknown = null;
  if (req.method === "POST") {
    const texto = await req.text();
    if (texto.trim()) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        return json({ success: false, error: "Cuerpo de la petición no válido" }, 400);
      }
    }
  }
  const accion = leerAccion(req.method, cuerpo);
  if (!accion) return json({ success: false, error: "accion no válida (estado | sincronizar)" }, 400);

  // pg_cron (x-ocr-secret, solo sincronizar) o un usuario del panel con la sección.
  const cron = autenticarCron(req.headers, Deno.env.get("OCR_TRABAJOS_SECRET") ?? "");
  let usuarioId: string | null = null;
  if (cron.es) {
    if (!cron.ok) {
      if (cron.status === 500) console.error("[newsletter-sync] OCR_TRABAJOS_SECRET no configurado — llamada de cron rechazada (falla cerrado)");
      return json({ success: false, error: cron.error }, cron.status);
    }
    if (accion !== "sincronizar") return json({ success: false, error: "accion no válida para el cron" }, 400);
  } else {
    const permiso = await exigirPermiso(req, "newsletter", accion === "sincronizar" ? "edit" : "view", { crearCliente: createClient, corsHeaders: cors });
    if (!permiso.ok) return permiso.response;
    usuarioId = permiso.userId;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  const repo = new RepositorioNewsletterResend(supabase);
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const limite = limiteContactos(Deno.env.get("NEWSLETTER_LIMITE_CONTACTOS"));
  const { config } = await leerAjustes(supabase);

  if (accion === "estado") {
    // Sin la tabla de pasadas (o sin datos) el estado se enseña igual: lo importante es qué falta configurar.
    const [ultima, ultimaTerminada] = await Promise.all([
      repo.ultimaPasada(false).catch(() => null),
      repo.ultimaPasada(true).catch(() => null),
    ]);
    return json({
      success: true,
      ...construirEstado({
        canal: config.canal,
        apiKey: Boolean(apiKey),
        webhookSecret: Boolean(Deno.env.get("RESEND_WEBHOOK_SECRET")),
        remitente: Boolean(remitente(config.remitente_nombre, config.remitente_email)),
        ia: Boolean(claveOpenAI("otros")),
        cronSecret: Boolean(Deno.env.get("OCR_TRABAJOS_SECRET")),
        segmentIdEnv: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID") ?? null,
        faltan: faltaParaEnviar({ apiKey: Boolean(apiKey), config }),
        limite,
        ultima,
        ultimaTerminada,
        supabaseUrl,
      }),
    });
  }

  // accion === "sincronizar": solo con el canal Broadcast (con el transaccional no hay lista en Resend).
  if (config.canal !== "broadcast") {
    return json({ success: true, omitida: true, motivo: "canal_transaccional", mensaje: "Con el envío uno a uno no hace falta lista de envío en Resend." });
  }
  if (!apiKey) return json({ success: false, error: "Falta configurar RESEND_API_KEY (clave de Resend con Full access)" }, 503);

  const resultado = await sincronizarConCerrojo({
    repo,
    cliente: new ClienteResendMarketing({ apiKey }),
    origen: cron.es ? "cron" : "panel",
    usuarioId,
    segmentIdConfigurado: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID"),
    nombreSegmento: NOMBRE_SEGMENTO_NEWSLETTER,
    hastaMs: inicio + MS_PRESUPUESTO,
  });
  if (resultado.tipo === "ocupado") return json({ success: false, error: "Ya hay una sincronización (o un envío) en curso. Espera un minuto." }, 409);
  if (resultado.tipo === "error") return json({ success: false, error: resultado.mensaje }, 500);
  const r = resultado.resumen;
  console.log(`[newsletter-sync] origen=${cron.es ? "cron" : "panel"} estado=${r.estado} altas=${r.altas} borrados=${r.borrados} bajas_resend=${r.bajasResend} errores=${r.errores.length} pendientes=${r.pendientes}`);
  return json(respuestaSincronizacion(r, resultado.pasadaId, limite), r.estado === "error" ? 502 : 200);
}));
