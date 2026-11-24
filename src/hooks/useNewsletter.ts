// ============================================================================
//  Newsletter (Marketing › Newsletter): datos y acciones del panel
// ----------------------------------------------------------------------------
//  Portado del panel de referencia (useNewsletterSuscriptores, useResendMarketing,
//  useEmailEventos, useEnviarNewsletter) y adaptado:
//    · suscriptores con su estado (pendiente / activo / baja); las altas, la
//      importación, la baja y la supresión RGPD van por las funciones SQL del
//      panel, que exigen «Editar» (el panel no escribe directo en la tabla);
//    · ajustes (newsletter_config: remitente, canal…), con «Editar»;
//    · estado de la configuración (qué falta) y lista de envío de Resend:
//      Edge Function newsletter-sync-resend;
//    · envío, prueba y confirmaciones: Edge Function enviar-newsletter;
//    · historial (newsletter_envios) y estadísticas (email_eventos).
//  Sin tipos generados para estas tablas (migración 20261124173700): se accede
//  con el cliente sin tipar, como en la referencia.
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { COLUMNAS_SUSCRIPTOR, type FilaImportada, type SuscriptorNewsletter } from "@/lib/newsletter/suscriptores";
import { textoErrorCliente, textoSuscriptores } from "@/lib/newsletter/textos";
import { agruparEstadisticas, mensajeSincronizacion, type EstadisticasEnvio, type EstadoResend, type FilaEstadistica, type ResultadoSincronizacion } from "@/lib/newsletter/resend";
import { resumirEventosCorreo, TIPOS_EVENTO_CORREO, type EventoCorreo, type ResumenCorreos } from "@/lib/newsletter/estadisticasCorreos";
import type { PayloadNewsletter } from "@/lib/newsletter/diseno";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tablas sin tipos generados (migración 20261124173700)
const db = supabase as any;

export const CLAVES_NEWSLETTER = {
  suscriptores: ["newsletter-suscriptores"],
  config: ["newsletter-config"],
  estado: ["newsletter-estado"],
  historial: ["newsletter-envios-historial"],
  estadisticas: ["newsletter-estadisticas"],
} as const;

/**
 * Ante un 4xx/5xx supabase-js solo da «Edge Function returned a non-2xx status code»; el motivo real (falta
 * configurar, sin permiso, límite…) viene en el cuerpo, en `error.context`.
 */
export async function mensajeErrorFuncion(error: unknown, porDefecto: string): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const cuerpo = (await (ctx as Response).clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      // cuerpo no JSON: se usa el mensaje genérico
    }
  }
  const msg = (error as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg ? msg : porDefecto;
}

/** Error de una función SQL del panel en llano. */
function mensajeRpc(error: { message?: string; code?: string } | null): string {
  const m = error?.message ?? "";
  if (error?.code === "42501" || /Editar/.test(m)) return "No tienes permiso para cambiar el newsletter (hace falta «Editar» en Newsletter).";
  if (/does not exist|PGRST202|42883/.test(m)) return "El newsletter todavía no está instalado en la base de datos. Avisa al equipo técnico.";
  return m || "No se pudo completar la acción.";
}

// ── Suscriptores ────────────────────────────────────────────────────────────

const PAGINA = 1000;

/** Todos los suscriptores (activos, pendientes y bajas). Se refresca solo cada minuto: las bajas y confirmaciones llegan solas. */
export function useNewsletterSuscriptores() {
  return useQuery({
    queryKey: CLAVES_NEWSLETTER.suscriptores,
    queryFn: async (): Promise<SuscriptorNewsletter[]> => {
      const filas: SuscriptorNewsletter[] = [];
      for (let desde = 0; desde < 20_000; desde += PAGINA) {
        const { data, error } = await db
          .from("newsletter_suscriptores")
          .select(COLUMNAS_SUSCRIPTOR)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(desde, desde + PAGINA - 1);
        if (error) throw error;
        filas.push(...((data ?? []) as SuscriptorNewsletter[]));
        if ((data ?? []).length < PAGINA) break;
      }
      return filas;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.suscriptores });
    qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.estado });
  };
}

export interface ResultadoAlta {
  ok: boolean;
  accion: "creado" | "ya_pendiente" | "ya_activo" | "baja_previa" | "invalido";
  id?: string;
}

/** Alta manual con el consentimiento apuntado (queda pendiente; luego se le manda la confirmación). */
export function useAltaSuscriptor() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (a: { email: string; nombre: string; detalle: string }): Promise<ResultadoAlta> => {
      const { data, error } = await db.rpc("newsletter_alta_panel", { p_email: a.email, p_nombre: a.nombre || null, p_detalle: a.detalle });
      if (error) throw new Error(mensajeRpc(error));
      return data as ResultadoAlta;
    },
    onSettled: invalidar,
  });
}

export interface ResultadoImportacion {
  creados: number;
  ya_pendientes: number;
  ya_activos: number;
  bajas_previas: number;
  invalidos: number;
  total: number;
}

export function useImportarSuscriptores() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (a: { filas: FilaImportada[]; detalle: string }): Promise<ResultadoImportacion> => {
      const { data, error } = await db.rpc("newsletter_importar", { p_filas: a.filas, p_detalle: a.detalle });
      if (error) throw new Error(mensajeRpc(error));
      return data as ResultadoImportacion;
    },
    onSettled: invalidar,
  });
}

export function useBajaSuscriptor() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("newsletter_baja_panel", { p_id: id });
      if (error) throw new Error(mensajeRpc(error));
    },
    onSuccess: () => toast.success("Dado de baja. No recibirá más newsletters."),
    onError: (e: Error) => toast.error(`No se pudo dar de baja. ${e.message}`),
    onSettled: invalidar,
  });
}

/** Supresión RGPD: borra al suscriptor, sus eventos y su email del rastro de auditoría. */
export function useSuprimirSuscriptor() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("newsletter_suprimir", { p_id: id });
      if (error) throw new Error(mensajeRpc(error));
    },
    onSuccess: () => toast.success("Datos borrados (supresión RGPD)."),
    onError: (e: Error) => toast.error(`No se pudieron borrar los datos. ${e.message}`),
    onSettled: invalidar,
  });
}

/** Correos de confirmación a los pendientes (todos los que toquen o los de `ids`). */
export function useEnviarConfirmaciones() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (ids: string[] | null): Promise<{ enviadas: number; fallidas: number }> => {
      const { data, error } = await supabase.functions.invoke("enviar-newsletter", { body: { accion: "confirmaciones", ...(ids ? { ids } : {}) } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "No se pudieron enviar las confirmaciones"));
      return data as { enviadas: number; fallidas: number };
    },
    onSuccess: (r) => {
      if (!r.enviadas && !r.fallidas) toast.info("No hay nadie a quien mandar la confirmación ahora (como mucho una al día y cinco por persona).");
      else if (r.fallidas) toast.warning(`Confirmaciones enviadas: ${r.enviadas}; no se pudieron enviar ${r.fallidas}.`);
      else toast.success(`Confirmaciones enviadas: ${r.enviadas}. Se activarán cuando pulsen el enlace del correo.`);
    },
    onError: (e: Error) => toast.error(`No se enviaron las confirmaciones. ${textoErrorCliente(e.message)}`),
    onSettled: invalidar,
  });
}

// ── Ajustes y estado de la configuración ────────────────────────────────────

export interface ConfigNewsletterPanel {
  remitente_email: string | null;
  remitente_nombre: string;
  responder_a: string | null;
  canal: "transaccional" | "broadcast";
  email_prueba: string | null;
  limite_transaccional: number;
  web_url: string;
  actualizado_en: string | null;
}

export function useNewsletterConfig() {
  return useQuery({
    queryKey: CLAVES_NEWSLETTER.config,
    queryFn: async (): Promise<ConfigNewsletterPanel | null> => {
      const { data, error } = await db
        .from("newsletter_config")
        .select("remitente_email, remitente_nombre, responder_a, canal, email_prueba, limite_transaccional, web_url, actualizado_en")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data as ConfigNewsletterPanel | null) ?? null;
    },
    staleTime: 60_000,
  });
}

export function useGuardarConfigNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Omit<ConfigNewsletterPanel, "actualizado_en">) => {
      const { data, error } = await db
        .from("newsletter_config")
        .update({
          remitente_email: c.remitente_email?.trim() || null,
          remitente_nombre: c.remitente_nombre.trim(),
          responder_a: c.responder_a?.trim() || null,
          canal: c.canal,
          email_prueba: c.email_prueba?.trim() || null,
          limite_transaccional: c.limite_transaccional,
          web_url: c.web_url.trim(),
        })
        .eq("id", 1)
        .select("id");
      if (error) {
        if (/check/i.test(error.message ?? "")) throw new Error("Algún dato no es válido: revisa los correos y que la web empiece por https://.");
        throw new Error(error.message);
      }
      if (!data?.length) throw new Error("No tienes permiso para cambiar los ajustes (hace falta «Editar» en Newsletter).");
    },
    onSuccess: () => toast.success("Ajustes del newsletter guardados."),
    onError: (e: Error) => toast.error(`No se guardaron los ajustes. ${e.message}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.config });
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.estado });
    },
  });
}

/** Qué está configurado y qué falta (newsletter-sync-resend). Sin sondeo: al montar y al volver a la pestaña. */
export function useEstadoNewsletter() {
  return useQuery({
    queryKey: CLAVES_NEWSLETTER.estado,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("newsletter-sync-resend", { body: { accion: "estado" } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "No se pudo consultar la configuración del envío"));
      return data as EstadoResend;
    },
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useSincronizarResend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_opciones: { automatica?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("newsletter-sync-resend", { body: { accion: "sincronizar" } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "No se pudo actualizar la lista de envío"));
      return data as ResultadoSincronizacion;
    },
    onSuccess: (data, opciones) => {
      if (opciones?.automatica) return;
      const m = mensajeSincronizacion(data);
      if (m.tipo === "ok") toast.success(m.texto);
      else if (m.tipo === "aviso") toast.warning(m.texto);
      else toast.error(m.texto);
    },
    onError: (error: Error, opciones) => {
      if (opciones?.automatica) return;
      toast.error(textoErrorCliente(error.message, "No se pudo actualizar la lista de envío. Inténtalo de nuevo y, si sigue igual, avisa al equipo técnico."));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.estado });
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.suscriptores });
    },
  });
}

// ── Envío y prueba ──────────────────────────────────────────────────────────

interface RespuestaEnvio {
  ok?: boolean;
  exitosos?: number;
  fallidos?: number;
  destinatarios?: string[];
}

export function useEnviarPruebaNewsletter() {
  return useMutation({
    mutationFn: async (newsletter: PayloadNewsletter) => {
      const { data, error } = await supabase.functions.invoke("enviar-newsletter", { body: { accion: "prueba", newsletter } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "Error al enviar la prueba"));
      return data as RespuestaEnvio;
    },
    onSuccess: (d) => toast.success(`Prueba enviada a ${(d?.destinatarios ?? []).join(" y ") || "tu correo"}. No llega a ningún suscriptor.`),
    onError: (e: Error) => toast.error(`No se pudo enviar la prueba. ${textoErrorCliente(e.message)}`),
  });
}

/** Envío real. `clave` la genera el formulario al abrir la confirmación: repetir la misma petición no reenvía. */
export function useEnviarNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ newsletter, clave }: { newsletter: PayloadNewsletter; clave: string }) => {
      const { data, error } = await supabase.functions.invoke("enviar-newsletter", { body: { accion: "enviar", newsletter, clave } });
      if (error) throw new Error(await mensajeErrorFuncion(error, "Error al enviar la newsletter"));
      return data as RespuestaEnvio;
    },
    onSuccess: (d) => {
      if (d?.fallidos) toast.warning(`Newsletter enviada a ${textoSuscriptores(d.exitosos ?? 0)}; a ${d.fallidos} no se pudo enviar.`);
      else toast.success(`Newsletter enviada a ${textoSuscriptores(d?.exitosos ?? 0)}.`);
    },
    onError: (e: Error) => toast.error(`No se ha enviado la newsletter. ${textoErrorCliente(e.message)}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.historial });
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.suscriptores });
      qc.invalidateQueries({ queryKey: CLAVES_NEWSLETTER.estado });
    },
  });
}

// ── Historial y estadísticas ────────────────────────────────────────────────

export interface EnvioNewsletter {
  id: string;
  asunto: string;
  created_at: string;
  total_destinatarios: number;
  exitosos: number;
  fallidos: number;
  estado: string;
  tipo_newsletter: string;
  canal: "transaccional" | "broadcast";
  error: string | null;
  estadisticas: EstadisticasEnvio | null;
}

export function useHistorialEnvios(limite = 20) {
  return useQuery({
    queryKey: [...CLAVES_NEWSLETTER.historial, limite],
    queryFn: async (): Promise<EnvioNewsletter[]> => {
      const { data, error } = await db
        .from("newsletter_envios")
        .select("id, asunto, created_at, total_destinatarios, exitosos, fallidos, estado, tipo_newsletter, canal, error")
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) throw error;
      const filas = (data ?? []) as Omit<EnvioNewsletter, "estadisticas">[];
      let stats = new Map<string, EstadisticasEnvio>();
      if (filas.length) {
        const r = await db.rpc("newsletter_estadisticas_envios", { p_envio_ids: filas.map((f) => f.id) });
        if (!r.error) stats = agruparEstadisticas((r.data ?? []) as FilaEstadistica[]);
      }
      return filas.map((f) => ({ ...f, estadisticas: stats.get(f.id) ?? null }));
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Eventos archivados como mucho (tope de seguridad de la lectura por lotes). */
const LIMITE_EVENTOS = 50_000;

export interface EstadisticasCorreos extends ResumenCorreos {
  truncado: boolean;
}

/** Estadísticas de los correos de la newsletter (categoria = newsletter), con una sola cuenta (resumirEventosCorreo). */
export function useEstadisticasCorreos() {
  return useQuery({
    queryKey: CLAVES_NEWSLETTER.estadisticas,
    queryFn: async (): Promise<EstadisticasCorreos> => {
      const filas: EventoCorreo[] = [];
      let truncado = false;
      for (let desde = 0; ; desde += PAGINA) {
        if (desde >= LIMITE_EVENTOS) {
          truncado = true;
          break;
        }
        const { data, error } = await db
          .from("email_eventos")
          .select("id, tipo_evento, email_id, timestamp_evento, created_at")
          .eq("metadata->>categoria", "newsletter")
          .in("tipo_evento", [...TIPOS_EVENTO_CORREO])
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(desde, desde + PAGINA - 1);
        if (error) throw error;
        filas.push(...((data ?? []) as EventoCorreo[]));
        if ((data ?? []).length < PAGINA) break;
      }
      return { ...resumirEventosCorreo(filas, { ahora: Date.now(), dias: 7 }), truncado };
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
