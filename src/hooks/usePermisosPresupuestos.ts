import { useCanAccessSection } from "@/hooks/useUserRole";

/**
 * Qué puede hacer el usuario en Presupuestos (sección `presupuestos`): «Ver» consulta (y descarga el PDF); «Editar»
 * crea, cambia, envía y borra. El super admin, todo. La base lo hace cumplir (RLS).
 */
export function usePermisosPresupuestos(): { ver: boolean; editar: boolean; cargando: boolean } {
  const ver = useCanAccessSection("presupuestos", "view");
  const editar = useCanAccessSection("presupuestos", "edit");
  return { ver: ver.canAccess || editar.canAccess, editar: editar.canAccess, cargando: ver.loading || editar.loading };
}
