// Marcar avisos como revisados (11/11/2026).
import { supabase } from "@/integrations/supabase/client";

/** Tipos de aviso que ya no se crean ni se enseñan (vacío: si alguno se retira, se añade aquí). */
export const TIPOS_AVISO_RETIRADOS: readonly string[] = [];
export const avisoRetirado = (tipo: string | null | undefined): boolean => !!tipo && TIPOS_AVISO_RETIRADOS.includes(tipo);

/**
 * Marca avisos como revisados con la RPC `marcar_avisos_revisados`. Un UPDATE directo lo deja la RLS solo a
 * quien EDITA el panel; la RPC exige VER la sección de cada aviso y solo cambia `leida`.
 *
 * - `ids`: esos avisos. - `tipos`: todos los sin revisar de esos tipos. - Nada: todos los que se ven.
 * Devuelve cuántos ha marcado (0 si ya estaban revisados).
 */
export async function marcarAvisosRevisados(filtro: { ids?: string[]; tipos?: readonly string[] } = {}) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  const { data, error } = await llamar.call(supabase, "marcar_avisos_revisados", {
    p_ids: filtro.ids ?? null,
    p_tipos: filtro.tipos ? [...filtro.tipos] : null,
  });
  return { marcados: typeof data === "number" ? data : 0, error };
}
