// ============================================================================
//  _shared/entorno.ts — en qué entorno corre una Edge Function
// ----------------------------------------------------------------------------
//  Producción, demo o local, según la SUPABASE_URL de la función. Los refs de
//  los proyectos salen de los secretos SUPABASE_REF_PRODUCCION y
//  SUPABASE_REF_DEMO (ver docs/DESPLIEGUE.md); sin ellos, todo es «local».
//  Sirve, por ejemplo, para que los enlaces al panel apunten al panel del
//  mismo entorno (PANEL_URL o PANEL_URL_DEMO).
// ============================================================================

export type Entorno = "produccion" | "demo" | "local";

function refEntorno(nombre: string): string | null {
  const deno = (globalThis as { Deno?: { env?: { get?: (n: string) => string | undefined } } }).Deno;
  try {
    const v = deno?.env?.get?.(nombre);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Entorno de una Edge Function según su SUPABASE_URL (`refs` permite fijarlos en las pruebas). */
export function entornoDeSupabase(
  url: string | null | undefined,
  refs: { produccion?: string | null; demo?: string | null } = {},
): Entorno {
  const produccion = refs.produccion ?? refEntorno("SUPABASE_REF_PRODUCCION");
  const demo = refs.demo ?? refEntorno("SUPABASE_REF_DEMO");
  if (produccion && url?.includes(produccion)) return "produccion";
  if (demo && url?.includes(demo)) return "demo";
  return "local";
}
