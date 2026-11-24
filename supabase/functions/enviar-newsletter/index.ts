// ============================================================================
// ENVIAR-NEWSLETTER — Edge Function del panel (Newsletter › Crear y enviar)
// ============================================================================
// Portada del panel de referencia. JWT de usuario + «Editar» en Newsletter
// (exigirPermiso, también para la prueba y las confirmaciones).
//   POST { accion: "enviar", newsletter, clave }   a todos los activos (canal de newsletter_config)
//   POST { accion: "prueba", newsletter }           solo a quien la pide y a la dirección de pruebas
//   POST { accion: "confirmaciones", ids? }         correo de confirmación a los pendientes (altas del panel)
// Sin RESEND_API_KEY o sin remitente no se envía nada: 503 con lo que falta.
// Lógica en envio.ts (uno a uno, prueba y confirmaciones) y broadcast.ts.
//
// Secretos: RESEND_API_KEY (con el canal Broadcast, «Full access»), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Opcionales: RESEND_NEWSLETTER_SEGMENT_ID y
// NEWSLETTER_LIMITE_CONTACTOS (canal Broadcast). Ver docs/NEWSLETTER.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirPermiso } from "../_shared/autorizacion.ts";
import { faltaParaEnviar, remitente } from "../_shared/newsletter/enlaces.ts";
import { enviarConfirmacion, leerAjustes } from "../_shared/newsletter/servidor.ts";
import { ClienteResendMarketing } from "../_shared/resend-marketing/cliente.ts";
import { limiteContactos, NOMBRE_SEGMENTO_NEWSLETTER } from "../_shared/resend-marketing/config.ts";
import { RepositorioNewsletterResend } from "../_shared/resend-marketing/repositorio.ts";
import { sincronizarConCerrojo } from "../_shared/resend-marketing/servicio.ts";
import { enviarBroadcast, puedeEnviarBroadcast } from "./broadcast.ts";
import { destinatariosPrueba, enviarConfirmacionesPendientes, enviarPrueba, enviarTransaccional } from "./envio.ts";
import { leerPeticion } from "./peticion.ts";
import { crearRepoEnvios, prepararConfirmaciones } from "./registro.ts";

const createClient = clienteConAuditoria(createClientBase, "enviar-newsletter");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Tiempo para la sincronización previa a un Broadcast (la función tiene ~150 s). */
const MS_SYNC_ANTES_DE_ENVIAR = 90_000;

Deno.serve(conAuditoriaDePeticion("enviar-newsletter", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const inicio = Date.now();

  const permiso = await exigirPermiso(req, "newsletter", "edit", { crearCliente: createClient, corsHeaders: cors });
  if (!permiso.ok) return permiso.response;

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ ok: false, error: "Cuerpo de la petición no válido" }, 400);
  }
  const lectura = leerPeticion(cuerpo);
  if (!lectura.ok) return json({ ok: false, error: lectura.error }, 400);
  const peticion = lectura.peticion;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const { config, negocio } = await leerAjustes(supabase);
  const faltan = faltaParaEnviar({ apiKey: Boolean(apiKey), config });
  if (faltan.length) {
    return json({ ok: false, error: `Falta configurar ${faltan.join(" y ")}. No se ha enviado nada.`, faltan, motivo: "no_configurado" }, 503);
  }
  const cliente = new ClienteResendMarketing({ apiKey });

  if (peticion.accion === "prueba") {
    const r = await enviarPrueba({ cliente, datos: peticion.datos, config, negocio, destinatarios: destinatariosPrueba(permiso.email, config) });
    if (!r.ok) return json({ ok: false, error: r.error }, r.status);
    return json({ ok: true, prueba: true, destinatarios: r.destinatarios, message: `Prueba enviada a ${r.destinatarios.join(" y ")}.` });
  }

  if (peticion.accion === "confirmaciones") {
    const r = await enviarConfirmacionesPendientes({
      ids: peticion.ids,
      preparar: (ids, limite) => prepararConfirmaciones(supabase, ids, limite),
      enviar: (p) => enviarConfirmacion(cliente, { ...p, config, negocio }),
    });
    return json(r);
  }

  // accion === "enviar"
  const repo = crearRepoEnvios(supabase);
  if (config.canal === "transaccional") {
    const r = await enviarTransaccional({
      repo, cliente, datos: peticion.datos, config, negocio, supabaseUrl, usuarioId: permiso.userId, clave: peticion.clave, hastaMs: inicio + 120_000,
    });
    if (!r.ok) return json({ ok: false, error: r.error }, r.status);
    return json({ ok: true, canal: "transaccional", envio_id: r.envioId, estado: r.estado, total: r.total, exitosos: r.exitosos, fallidos: r.fallidos, detalles: r.detalles });
  }

  // Canal Broadcast: sincroniza DENTRO del cerrojo y envía (ni un doble clic ni el cron se cuelan entre medias).
  const from = remitente(config.remitente_nombre, config.remitente_email)!;
  const limite = limiteContactos(Deno.env.get("NEWSLETTER_LIMITE_CONTACTOS"));
  const resultado = await sincronizarConCerrojo(
    {
      repo: new RepositorioNewsletterResend(supabase),
      cliente,
      origen: "envio",
      usuarioId: permiso.userId,
      segmentIdConfigurado: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID"),
      nombreSegmento: NOMBRE_SEGMENTO_NEWSLETTER,
      hastaMs: inicio + MS_SYNC_ANTES_DE_ENVIAR,
    },
    async (resumen) => {
      const veredicto = puedeEnviarBroadcast(resumen, limite);
      if (!veredicto.ok) return { veredicto, envio: null };
      const envio = await enviarBroadcast({
        cliente, repo, datos: peticion.datos, negocio, from, replyTo: config.responder_a, segmentId: resumen.segmentId!,
        destinatarios: resumen.destinatarios ?? 0, usuarioId: permiso.userId, clave: peticion.clave,
      });
      return { veredicto, envio };
    },
  );
  if (resultado.tipo === "ocupado") {
    return json({ ok: false, error: "Ahora mismo se está sincronizando con Resend (o enviando otra newsletter). Espera un minuto y vuelve a intentarlo." }, 409);
  }
  if (resultado.tipo === "error") return json({ ok: false, error: resultado.mensaje }, 500);
  const extra = resultado.extra;
  if (!extra || !extra.veredicto.ok) {
    const v = extra?.veredicto;
    return json({ ok: false, canal: "broadcast", error: v && !v.ok ? v.error : "No se pudo preparar el envío" }, v && !v.ok ? v.status : 500);
  }
  const envio = extra.envio!;
  if (!envio.ok) return json({ ok: false, canal: "broadcast", error: envio.error, broadcast_id: envio.broadcastId ?? null }, envio.status);
  const n = resultado.resumen.destinatarios ?? 0;
  return json({ ok: true, canal: "broadcast", envio_id: envio.envioId, broadcast_id: envio.broadcastId, estado: "completado", total: n, exitosos: n, fallidos: 0 });
}));
