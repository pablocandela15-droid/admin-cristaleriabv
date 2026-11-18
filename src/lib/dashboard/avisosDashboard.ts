// Dashboard › «Avisos» (10/11/2026). Los avisos que ya hay en el panel —los de la campana y la página Avisos
// (tabla notificaciones_dashboard): tickets urgentes, modelos de IA, avisos del sistema…— con su enlace
// (`rutaDeAviso`). Cada uno se enseña solo a quien puede ver su sección: la tabla la lee cualquiera con
// «Dashboard», así que el filtro por sección se hace aquí. Sin React: se prueba suelto.
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { avisoCaducado } from "@/lib/avisos";

export type SeccionAviso = "super_admin" | "general";

export interface PermisosAvisos {
  superAdmin: boolean;
}

export const ETIQUETA_SECCION_AVISO: Record<SeccionAviso, string> = {
  super_admin: "Super Admin",
  general: "Panel",
};

/** De qué sección es un aviso (decide quién lo ve). */
export function seccionDeAviso(n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo">): SeccionAviso {
  if (n.tipo.startsWith("ia_modelo") || n.referencia_tipo === "ia_modelos") return "super_admin";
  if (n.tipo === "peticion_urgente" || n.referencia_tipo === "peticion") return "super_admin";
  return "general";
}

export function puedeVerAviso(n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo">, p: PermisosAvisos): boolean {
  const s = seccionDeAviso(n);
  if (s === "general") return true;
  return p.superAdmin;
}

/**
 * Lo que enseña el módulo: los avisos que puede ver, sin los caducados ni los que no van a la campana
 * (`datos.campana = false`), sin leer primero y, dentro, del más nuevo al más viejo.
 */
export function avisosParaDashboard(
  lista: NotificacionDashboard[],
  permisos: PermisosAvisos,
  ahora: number = Date.now(),
): NotificacionDashboard[] {
  return lista
    .filter((n) => n.datos?.campana !== false && !avisoCaducado(n, ahora) && puedeVerAviso(n, permisos))
    .sort((a, b) => Number(a.leida) - Number(b.leida) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Sin leer por sección (las fichas de arriba), en el orden del menú. */
export function sinLeerPorSeccion(lista: NotificacionDashboard[]): { seccion: SeccionAviso; n: number }[] {
  const orden: SeccionAviso[] = ["super_admin", "general"];
  const cuenta = new Map<SeccionAviso, number>();
  for (const a of lista) if (!a.leida) cuenta.set(seccionDeAviso(a), (cuenta.get(seccionDeAviso(a)) ?? 0) + 1);
  return orden.flatMap((seccion) => (cuenta.get(seccion) ? [{ seccion, n: cuenta.get(seccion) as number }] : []));
}
