// ============================================================================
//  Autenticación de procesar-factura y clasificar-productos (usuario)
// ----------------------------------------------------------------------------
//  Sin Deno.env al cargarse: recibe la configuración y la fábrica de clientes
//  por parámetro (los tests la simulan). Las llamadas de servidor a servidor
//  (pg_cron → ocr-trabajo y clasificar-productos) se autentican con el secreto
//  compartido de _shared/secreto-servidor.ts.
//
//  ⚠️ `verify_jwt` NO sirve como autenticación en este proyecto: la anon key es
//  un JWT válido y viaja en el bundle público del panel. Hay que comprobar que
//  detrás del token hay un USUARIO real y que tiene la sección `facturas`.
// ============================================================================
import { corsHeaders, jsonResponse, verificarSecreto } from "../_shared/secreto-servidor.ts";

export { corsHeaders, jsonResponse, verificarSecreto };

export interface ConfigAuth {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  crearCliente: (url: string, key: string, opciones?: any) => any;
}

/**
 * Qué se comprueba en cada modo (basta con UNA, `has_section_permission`, que
 * ya da true al super admin):
 *   · "subir"  (procesar-factura: subir y decidir sobre lo propio): «Editar» en
 *     Facturas o el permiso «Facturas · Subida» (facturas_subida, can_view o
 *     can_edit). Con solo «Ver» en Facturas NO se sube.
 *   · "edit"   (sustituir una factura ajena, clasificar): «Editar».
 *   · "view"   (consultar): «Ver» en Facturas.
 */
export type PermisoFacturas = "view" | "edit" | "subir";

export const COMPROBACIONES_PERMISO: Record<PermisoFacturas, ReadonlyArray<readonly [string, "view" | "edit"]>> = {
  view: [["facturas", "view"]],
  edit: [["facturas", "edit"]],
  subir: [["facturas", "edit"], ["facturas_subida", "view"], ["facturas_subida", "edit"]],
};

const MENSAJE_SIN_PERMISO: Record<PermisoFacturas, string> = {
  view: "Sin permisos sobre la sección de facturas",
  edit: "Esta acción exige permiso de edición en Facturas",
  subir: "Subir documentos exige el permiso «Facturas · Subida» o «Editar» en Facturas",
};

/**
 * Comprueba que detrás del token hay un usuario y que tiene `permiso` sobre
 * facturas (ver COMPROBACIONES_PERMISO). `editar`: además tiene «Editar» en
 * Facturas (puede decidir sobre documentos de otros).
 */
export async function autenticar(
  req: Request,
  cfg: ConfigAuth,
  permiso: PermisoFacturas = "view",
): Promise<{ ok: true; userId: string; editar: boolean } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[procesar-factura] Sin cabecera Authorization");
    return { ok: false, response: jsonResponse({ success: false, error: "No autorizado" }, 401) };
  }

  const supabaseUser = cfg.crearCliente(cfg.supabaseUrl, cfg.anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    console.error("[procesar-factura] Token sin usuario:", userError?.message);
    return { ok: false, response: jsonResponse({ success: false, error: "Usuario no autenticado" }, 401) };
  }

  const supabaseAdmin = cfg.crearCliente(cfg.supabaseUrl, cfg.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const comprobaciones = COMPROBACIONES_PERMISO[permiso];
  if (!comprobaciones) {
    // Un llamador mal escrito nunca abre la función.
    return { ok: false, response: jsonResponse({ success: false, error: MENSAJE_SIN_PERMISO.edit }, 403) };
  }
  let editar = false;
  let permitido = false;
  for (const [seccion, modo] of comprobaciones) {
    const { data, error: permError } = await supabaseAdmin.rpc("has_section_permission", {
      _user_id: user.id,
      _section: seccion,
      _permission: modo,
    });
    if (permError) {
      console.error("[procesar-factura] Error comprobando permisos:", permError.message);
      return { ok: false, response: jsonResponse({ success: false, error: "Error verificando permisos" }, 500) };
    }
    if (data === true) {
      permitido = true;
      editar = seccion === "facturas" && modo === "edit";
      break;
    }
  }
  if (!permitido) {
    console.error(`[procesar-factura] Usuario sin permiso '${permiso}' en facturas:`, user.id);
    return { ok: false, response: jsonResponse({ success: false, error: MENSAJE_SIN_PERMISO[permiso] }, 403) };
  }
  return { ok: true, userId: user.id, editar };
}

export const MENSAJE_SOLO_LO_PROPIO =
  "Solo puedes sustituir o completar documentos que hayas subido tú. Para los de otros hace falta «Editar» en Facturas.";

/**
 * Quien sube sin «Editar» solo decide sobre lo suyo: sustituir esa factura o
 * añadirle una página solo si la subió él (facturas.subido_por) y el trabajo
 * de OCR con el documento nuevo también es suyo. Falla cerrado: sin la fila o
 * con cualquier error, false.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function esDocumentoPropio(supabase: any, facturaId: number, trabajoId: string, userId: string): Promise<boolean> {
  try {
    const { data: f, error: eF } = await supabase.from("facturas").select("subido_por").eq("id", facturaId).maybeSingle();
    if (eF || !f || f.subido_por !== userId) return false;
    const { data: t, error: eT } = await supabase.from("ocr_trabajos").select("creado_por").eq("id", trabajoId).maybeSingle();
    if (eT || !t || t.creado_por !== userId) return false;
    return true;
  } catch (e) {
    console.error("[procesar-factura] No se pudo comprobar de quién es el documento:", e instanceof Error ? e.message : e);
    return false;
  }
}
