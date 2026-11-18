// ============================================================================
//  Super Admin › Informes — REGISTRO de todos los informes del panel
// ----------------------------------------------------------------------------
//  (10/11/2026) Un módulo del superadmin donde se generan de forma centralizada
//  todos los informes del panel. La página (/super-admin/informes) lista lo que
//  hay aquí, filtrado por permisos, y deja elegir el periodo y generar/descargar
//  en PDF (diapositivas) o CSV.
//
//  CÓMO SE AÑADE UN INFORME
//    1. Si es una tabla (o varias): escribe `obtener(periodo, ctx)` que
//       devuelva un `InformeTabla` (./tabla.ts) o `{ vacio: true, motivo }`.
//       Si tiene diapositivas propias: un componente que reciba
//       `PropsGeneradorInforme` y pinte dentro de `<Marco>`.
//    2. Añade su `DefinicionInforme` a `INFORMES` (abajo): id único, título,
//       sección, permiso, tipo de periodo y el generador.
//    3. Si su sección no está en `SECCIONES_INFORME`, añádela.
//    4. Test: src/lib/informes/__tests__/registro.test.ts comprueba que los
//       ids son únicos y que cada sección y permiso existen.
// ============================================================================
import type { ComponentType, ReactNode } from "react";
import type { SectionKey } from "@/hooks/useUserRole";
import type { OpcionMes, Periodo, TipoPeriodo } from "./periodo";
import type { ResultadoInformeTabla } from "./tabla";
import { obtenerInformeServicios } from "./fuentes/servicios";
import { obtenerInformeAuditoria } from "./fuentes/auditoria";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type IdSeccionInforme = "servicios" | "auditoria";

export interface SeccionInforme {
  id: IdSeccionInforme;
  titulo: string;
}

/** Orden en que salen los grupos en la página. */
export const SECCIONES_INFORME: SeccionInforme[] = [
  { id: "servicios", titulo: "Servicios" },
  { id: "auditoria", titulo: "Seguridad" },
];

/**
 * Quién puede generar el informe:
 *   · «superadmin»: solo super admins (módulos que solo existen en el Super Admin: Servicios, Auditoría…).
 *   · «seccion»: quien tenga ese permiso en Usuarios (como `useCanAccessSection`): «view» o «edit».
 * Un super admin lo puede todo (igual que `has_section_permission()` en la base de datos).
 */
export type PermisoInforme = { tipo: "superadmin" } | { tipo: "seccion"; seccion: SectionKey; nivel: "view" | "edit" };

export type FormatoInforme = "pdf" | "csv";

export interface ContextoInforme {
  /** Hoy, `YYYY-MM-DD` (día local). */
  hoy: string;
}

/** Lo que recibe el componente de un informe con diapositivas propias. */
export interface PropsGeneradorInforme {
  periodo: Periodo;
  hoy: string;
  /** Cabecera (título, selector de periodo) y zona de vista previa comunes: el informe pone sus botones y su contenido. */
  Marco: ComponentType<{ acciones: ReactNode; children: ReactNode }>;
}

export type GeneradorInforme =
  /** Una o varias tablas: la página hace la vista previa, el PDF (diapositivas) y el CSV. */
  | { tipo: "tabla"; obtener: (periodo: Periodo, ctx: ContextoInforme) => Promise<ResultadoInformeTabla> }
  /** Diapositivas propias: componente que se carga al elegir el informe. */
  | { tipo: "componente"; cargar: () => Promise<{ default: ComponentType<PropsGeneradorInforme> }> };

export interface DefinicionInforme {
  /** Único y estable: va en la URL (?informe=servicios-mensual). */
  id: string;
  titulo: string;
  /** Una o dos frases: qué sale en el informe. */
  descripcion: string;
  seccion: IdSeccionInforme;
  permiso: PermisoInforme;
  periodo: TipoPeriodo;
  formatos: FormatoInforme[];
  /** Pantalla donde también se puede generar (enlace «También en …»). */
  origen?: { etiqueta: string; ruta: string };
  /** Solo con periodo «mes»: meses que se pueden elegir y el de por defecto (si no, los 12 últimos y el anterior). */
  meses?: (hoy: string) => OpcionMes[];
  mesPorDefecto?: (hoy: string) => string;
  generador: GeneradorInforme;
}

// ─── Los informes ───────────────────────────────────────────────────────────

export const INFORMES: DefinicionInforme[] = [
  {
    id: "servicios-mensual",
    // 13/11/2026: también la IA función por función, lo que cuesta cada cosa y los precios por confirmar.
    titulo: "Informe mensual de costes",
    descripcion:
      "Gasto de cada servicio en el mes, el total y la comparación con el anterior; la IA función por función y lo que cuesta cada cosa; lo que falta por meter y los precios por confirmar.",
    seccion: "servicios",
    permiso: { tipo: "superadmin" },
    periodo: "mes",
    formatos: ["pdf", "csv"],
    origen: { etiqueta: "Servicios › Costes", ruta: "/super-admin/servicios" },
    generador: { tipo: "tabla", obtener: (periodo) => obtenerInformeServicios(periodo) },
  },
  {
    id: "auditoria-mensual",
    // 14/11/2026, petición del dueño: quién usa el panel, qué toca y qué hace el sistema solo.
    titulo: "Informe mensual de auditoría",
    descripcion:
      "Quién ha usado el panel en el mes: acciones, días que entró y dónde trabaja más; gráfico por días y horas; lo delicado (borrados, precios, permisos) y, aparte, lo que hace el sistema solo.",
    seccion: "auditoria",
    permiso: { tipo: "superadmin" },
    periodo: "mes",
    formatos: ["pdf", "csv"],
    origen: { etiqueta: "Super Admin › Auditoría", ruta: "/super-admin/auditoria" },
    generador: { tipo: "tabla", obtener: (periodo) => obtenerInformeAuditoria(periodo) },
  },
];

// ─── Permisos ───────────────────────────────────────────────────────────────

export interface PermisosUsuario {
  esSuperAdmin: boolean;
  permisos: ReadonlyArray<{ section_key: string; can_view: boolean; can_edit: boolean }>;
}

/** ¿Puede este usuario generar el informe? Misma regla que `useCanAccessSection`. */
export function puedeVerInforme(def: Pick<DefinicionInforme, "permiso">, u: PermisosUsuario): boolean {
  if (u.esSuperAdmin) return true;
  if (def.permiso.tipo === "superadmin") return false;
  const { seccion, nivel } = def.permiso;
  const p = u.permisos.find((x) => x.section_key === seccion);
  if (!p) return false;
  return nivel === "view" ? p.can_view || p.can_edit : p.can_edit;
}

/** Los informes que puede ver, agrupados por sección en el orden de `SECCIONES_INFORME` (sin grupos vacíos). */
export function informesPorSeccion(
  u: PermisosUsuario,
  informes: DefinicionInforme[] = INFORMES,
): { seccion: SeccionInforme; informes: DefinicionInforme[] }[] {
  const visibles = informes.filter((i) => puedeVerInforme(i, u));
  return SECCIONES_INFORME.map((seccion) => ({ seccion, informes: visibles.filter((i) => i.seccion === seccion.id) })).filter((g) => g.informes.length > 0);
}

export const buscarInforme = (id: string | null, informes: DefinicionInforme[] = INFORMES): DefinicionInforme | null =>
  (id && informes.find((i) => i.id === id)) || null;
