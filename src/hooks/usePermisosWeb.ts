import { useCanAccessSection } from "@/hooks/useUserRole";
import type { PermisosWeb } from "@/lib/web/permisos";

/** Qué puede hacer el usuario en cada pestaña de Web (ver lib/web/permisos.ts). El super admin, todo. */
export function usePermisosWeb(): PermisosWeb & { cargando: boolean } {
  const fotosVer = useCanAccessSection("web_fotos", "view");
  const fotosEditar = useCanAccessSection("web_fotos", "edit");
  const tarifasVer = useCanAccessSection("web_tarifas", "view");
  const tarifasEditar = useCanAccessSection("web_tarifas", "edit");
  const contenidoVer = useCanAccessSection("web_contenido", "view");
  const contenidoEditar = useCanAccessSection("web_contenido", "edit");
  const todos = [fotosVer, fotosEditar, tarifasVer, tarifasEditar, contenidoVer, contenidoEditar];
  return {
    fotos: { ver: fotosVer.canAccess || fotosEditar.canAccess, editar: fotosEditar.canAccess },
    tarifas: { ver: tarifasVer.canAccess || tarifasEditar.canAccess, editar: tarifasEditar.canAccess },
    contenido: { ver: contenidoVer.canAccess || contenidoEditar.canAccess, editar: contenidoEditar.canAccess },
    cargando: todos.some((x) => x.loading),
  };
}
