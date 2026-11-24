// ============================================================================
// enviar-newsletter · acceso a la base de datos (sin imports https://, testeable)
// ----------------------------------------------------------------------------
// newsletter_envios (historial y cerrojo), los activos con su token de baja y
// las direcciones suprimidas, con el cliente de la SERVICE ROLE (lo crea
// index.ts). Migración 20261124173700_newsletter.sql.
// ============================================================================

import type { CreacionEnvio, Destinatario, EstadoEnvio, FilaEnvioNueva, PendienteConfirmar, RepoEnvios } from "./envio.ts";

// deno-lint-ignore no-explicit-any
type ClienteSupabase = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- supabase-js sin importar https:// (testeable)

/** PostgREST devuelve como mucho 1.000 filas por petición: se pagina. */
const TAM_PAGINA = 1000;

export function crearRepoEnvios(db: ClienteSupabase, ahora: () => Date = () => new Date()): RepoEnvios {
  return {
    async cerrarColgados(minutos) {
      const limite = new Date(ahora().getTime() - minutos * 60_000).toISOString();
      const { error } = await db
        .from("newsletter_envios")
        .update({ estado: "fallido", terminado_at: ahora().toISOString(), error: "Envío abandonado (la función terminó sin cerrarlo)" })
        .eq("estado", "enviando")
        .lt("created_at", limite);
      if (error) console.error("[enviar-newsletter] no se pudieron cerrar los envíos colgados:", error.message);
    },

    async destinatarios() {
      const filas: Destinatario[] = [];
      for (let desde = 0; ; desde += TAM_PAGINA) {
        const { data, error } = await db
          .from("newsletter_suscriptores")
          .select("id, email, nombre, newsletter_claves(baja_token)")
          .eq("estado", "activo")
          .order("id", { ascending: true })
          .range(desde, desde + TAM_PAGINA - 1);
        if (error) throw new Error(`newsletter_suscriptores: ${error.message}`);
        const pagina = (data ?? []) as Array<{ id: string; email: string; nombre: string | null; newsletter_claves: { baja_token: string } | { baja_token: string }[] | null }>;
        for (const f of pagina) {
          const claves = Array.isArray(f.newsletter_claves) ? f.newsletter_claves[0] : f.newsletter_claves;
          filas.push({ id: f.id, email: f.email, nombre: f.nombre, baja_token: claves?.baja_token ?? null });
        }
        if (pagina.length < TAM_PAGINA) return filas;
      }
    },

    async suprimidas() {
      const { data, error } = await db.from("direcciones_email_suprimidas").select("email");
      if (error) {
        console.warn("[enviar-newsletter] no se pudo leer direcciones_email_suprimidas:", error.message);
        return new Set<string>();
      }
      return new Set(((data ?? []) as { email: string }[]).map((f) => (f.email ?? "").trim().toLowerCase()).filter(Boolean));
    },

    async crearEnvio(fila: FilaEnvioNueva): Promise<CreacionEnvio> {
      const { data, error } = await db.from("newsletter_envios").insert({ ...fila, estado: "enviando" }).select("id").single();
      if (!error) return { ok: true, id: data.id as string };
      if (error.code === "23505") {
        return /clave_idempotencia/.test(`${error.message ?? ""} ${error.details ?? ""}`) ? { ok: false, motivo: "duplicado" } : { ok: false, motivo: "ocupado" };
      }
      throw new Error(`newsletter_envios: ${error.message}`);
    },

    async terminarEnvio(id: string, d: { estado: EstadoEnvio; exitosos?: number; fallidos?: number; error?: string | null }) {
      const { error } = await db
        .from("newsletter_envios")
        .update({
          estado: d.estado,
          ...(d.exitosos !== undefined ? { exitosos: d.exitosos } : {}),
          ...(d.fallidos !== undefined ? { fallidos: d.fallidos } : {}),
          error: d.error ? d.error.slice(0, 2000) : null,
          terminado_at: d.estado === "enviando" ? null : ahora().toISOString(),
        })
        .eq("id", id);
      if (error) console.error(`[enviar-newsletter] no se pudo cerrar el envío ${id}:`, error.message);
    },
  };
}

/** RPC newsletter_preparar_confirmaciones (service role): pendientes con su token nuevo. */
export async function prepararConfirmaciones(db: ClienteSupabase, ids: string[] | null, limite: number): Promise<PendienteConfirmar[]> {
  const { data, error } = await db.rpc("newsletter_preparar_confirmaciones", { p_ids: ids, p_limite: limite });
  if (error) throw new Error(`newsletter_preparar_confirmaciones: ${error.message}`);
  return Array.isArray(data) ? (data as PendienteConfirmar[]) : [];
}
