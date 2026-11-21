// ============================================================================
//  Módulos del Admin Panel (14/11/2026)
// ----------------------------------------------------------------------------
//  Este catálogo es la ÚNICA lista de módulos que usa el equipo y manda en:
//    · el menú lateral del panel (AppSidebar), en este orden;
//    · Control del Panel (SuperAdminPanel): un interruptor por módulo, agrupados;
//    · la protección de las rutas (ProtectedRoute): un módulo desactivado no se
//      abre ni escribiendo su dirección (el super admin sí entra).
//
//  Una página nueva del panel → añadirla aquí (o a RUTAS_FUERA_DEL_CATALOGO
//  con el motivo). `modulosPanel.test.ts` falla si una ruta de App.tsx no está.
//
//  La clave (`clave`) es la `section_key` de `admin_feature_toggles`: no se
//  renombran una vez creadas. Sin fila en la tabla, el módulo está activado.
//  Los permisos por usuario (`secciones`, user_permissions) siguen igual: el
//  interruptor es una capa más por encima.
// ============================================================================
import type { ComponentType, SVGProps } from "react";
import { matchPath } from "react-router-dom";
import { Bell, HelpCircle, LayoutDashboard, MessageSquarePlus, Receipt, Shield, UserRound } from "lucide-react";
import type { SectionKey } from "@/hooks/useUserRole";

export type IconoModulo = ComponentType<SVGProps<SVGSVGElement>>;

/** Grupos de Control del Panel, en el orden del menú lateral. */
export const GRUPOS_MODULOS = [
  { id: "dia", titulo: "Día a día" },
  { id: "compras", titulo: "Compras" },
  { id: "gestion", titulo: "Equipo" },
  { id: "ayuda", titulo: "Ayuda y cuenta" },
] as const;
export type GrupoModulo = (typeof GRUPOS_MODULOS)[number]["id"];

export interface ModuloPanel {
  /** `section_key` de `admin_feature_toggles` (no renombrar las existentes). */
  clave: string;
  /** Nombre en el menú y en Control del Panel. */
  nombre: string;
  /** Una línea para que el dueño sepa qué es (Control del Panel). */
  descripcion: string;
  /**
   * Rutas de App.tsx que son de este módulo (patrones de react-router). La primera es la del menú.
   * Vacía: no es una página (p. ej. «Mi cuenta», un diálogo).
   */
  rutas: string[];
  icono: IconoModulo;
  grupo: GrupoModulo;
  /**
   * Permisos (user_permissions) con los que se ve en el menú: basta con UNO. Sin secciones lo ve todo el
   * mundo (Ayuda, Nueva petición). El permiso de cada ruta lo sigue comprobando ProtectedRoute como siempre.
   */
  secciones?: SectionKey[];
  /** ¿Se puede apagar desde Control del Panel? Dashboard, Ayuda, Avisos y Mi cuenta, no. */
  desactivable: boolean;
  /** Por qué no se puede apagar (lo enseña Control del Panel). */
  motivoSiempreActivo?: string;
  /** Sale como entrada del menú lateral. */
  enMenu: boolean;
  /** Solo con el permiso guardado: el super admin no lo ve por serlo. */
  soloConPermiso?: boolean;
  /** El enlace del menú pasa la página actual (`state.desde`): «Nueva petición» propone su módulo. */
  conOrigen?: boolean;
  /**
   * Mientras no tenga fila propia, vale lo mismo que este otro módulo: si en algún entorno estaba apagado,
   * sigue apagado. Sirve para separar un módulo de otro sin que cambie su estado (hoy ninguno lo usa).
   */
  heredaDe?: string;
}

export const MODULOS_PANEL: readonly ModuloPanel[] = [
  {
    clave: "dashboard",
    nombre: "Dashboard",
    descripcion: "Portada del panel: avisos y accesos rápidos.",
    rutas: ["/dashboard", "/"],
    icono: LayoutDashboard,
    grupo: "dia",
    secciones: ["dashboard"],
    desactivable: false,
    motivoSiempreActivo: "Es la portada del panel: ahí se lleva a quien entra en un módulo desactivado.",
    enMenu: true,
  },
  {
    clave: "facturas",
    nombre: "Facturas",
    descripcion: "Facturas de proveedores: se suben, se leen solas (OCR con IA) y se consultan compras, productos y precios.",
    rutas: ["/facturas"],
    icono: Receipt,
    grupo: "compras",
    // Con solo «Facturas · Subida» también sale (entra en la pestaña Cargar).
    secciones: ["facturas", "facturas_subida"],
    desactivable: true,
    enMenu: true,
  },
  {
    clave: "usuarios",
    nombre: "Usuarios",
    descripcion: "Consulta de usuarios y sus permisos.",
    rutas: ["/usuarios"],
    icono: Shield,
    grupo: "gestion",
    secciones: ["usuarios"],
    desactivable: true,
    enMenu: true,
  },
  {
    clave: "peticiones",
    nombre: "Nueva petición",
    descripcion: "Reportar errores, pedir mejoras o preguntar dudas, y ver cómo van (tú las ves en Tickets).",
    rutas: ["/peticiones"],
    icono: MessageSquarePlus,
    grupo: "ayuda",
    desactivable: true,
    enMenu: true,
    conOrigen: true,
  },
  {
    clave: "ayuda",
    nombre: "Ayuda",
    descripcion: "Centro de ayuda con guías y vídeos de cada sección.",
    rutas: ["/ayuda"],
    icono: HelpCircle,
    grupo: "ayuda",
    desactivable: false,
    motivoSiempreActivo: "Es la página de respaldo: ahí va quien no puede ver ninguna otra.",
    enMenu: true,
  },
  {
    clave: "avisos",
    nombre: "Avisos",
    descripcion: "Historial de los avisos de la campana: tickets urgentes, avisos del sistema y de los modelos de IA.",
    rutas: ["/avisos"],
    icono: Bell,
    grupo: "ayuda",
    desactivable: false,
    motivoSiempreActivo: "La campana del menú lleva aquí: sin esta página no se podría ver el historial.",
    enMenu: false,
  },
  {
    clave: "mi_cuenta",
    nombre: "Mi cuenta",
    descripcion: "Datos de cada usuario, sus permisos y el cambio de contraseña (pie del menú).",
    rutas: [],
    icono: UserRound,
    grupo: "ayuda",
    desactivable: false,
    motivoSiempreActivo: "Cada usuario necesita poder cambiar su contraseña.",
    enMenu: false,
  },
];

/**
 * Rutas de App.tsx que NO son un módulo del equipo, con el motivo. Las de `/super-admin` quedan fuera
 * todas (solo entra un super admin, SuperAdminRoute): ver `rutaFueraDelCatalogo`.
 */
export const RUTAS_FUERA_DEL_CATALOGO: Readonly<Record<string, string>> = {
  "/auth": "Inicio de sesión (antes de entrar al panel).",
  "*": "Página no encontrada.",
};

/** Prefijo de las páginas del Super Admin: no son del equipo (SuperAdminRoute). */
export const PREFIJO_SUPER_ADMIN = "/super-admin";

/** ¿Está esa ruta de App.tsx fuera del catálogo a propósito? Devuelve el motivo. */
export function rutaFueraDelCatalogo(ruta: string): string | undefined {
  if (ruta === PREFIJO_SUPER_ADMIN || ruta.startsWith(`${PREFIJO_SUPER_ADMIN}/`)) {
    return "Solo Super Admin (SuperAdminRoute): el equipo no entra.";
  }
  return RUTAS_FUERA_DEL_CATALOGO[ruta];
}

export const moduloPorClave = (clave: string): ModuloPanel | undefined => MODULOS_PANEL.find((m) => m.clave === clave);

/** Módulo al que pertenece una dirección (`/usuarios`, `/ayuda`…), o undefined. */
export function moduloDeRuta(pathname: string): ModuloPanel | undefined {
  const limpia = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return MODULOS_PANEL.find((m) => m.rutas.some((patron) => matchPath({ path: patron, end: true }, limpia)));
}

type FilaToggle = { section_key: string; enabled: boolean };

/**
 * Valor de un interruptor según las filas de `admin_feature_toggles`: su fila; sin fila, el del módulo del
 * que hereda (`heredaDe`); y si no, activado (como siempre).
 */
export function valorInterruptor(clave: string, filas: ReadonlyArray<FilaToggle>): boolean {
  const vistos = new Set<string>();
  let actual: string | undefined = clave;
  while (actual && !vistos.has(actual)) {
    vistos.add(actual);
    const fila = filas.find((t) => t.section_key === actual);
    if (fila) return fila.enabled;
    actual = moduloPorClave(actual)?.heredaDe;
  }
  return true;
}

/** ¿Está el módulo activado para el equipo? Los que no se pueden apagar, siempre. */
export const moduloActivo = (modulo: ModuloPanel, isEnabled: (clave: string) => boolean): boolean =>
  !modulo.desactivable || isEnabled(modulo.clave);

type Permiso = { section_key: string; can_view?: boolean | null };

/** ¿Tiene permiso para verlo? (sin mirar el interruptor) */
export function tienePermisoModulo(
  modulo: ModuloPanel,
  permisos: ReadonlyArray<Permiso>,
  esSuperAdmin: boolean,
): boolean {
  if (!modulo.secciones?.length) return true;
  if (esSuperAdmin && !modulo.soloConPermiso) return true;
  return modulo.secciones.some((s) => permisos.some((p) => p.section_key === s && p.can_view));
}

/** Entradas del menú lateral, en orden. */
export const MODULOS_MENU: readonly ModuloPanel[] = MODULOS_PANEL.filter((m) => m.enMenu);

/** Página que nunca rebota (no pide permisos ni se puede apagar). */
export const RUTA_SIEMPRE_DISPONIBLE = "/ayuda";

/**
 * A dónde llevar a quien no puede quedarse donde está: la primera sección del menú (en su orden) que puede
 * ver y está activada, sin contar el módulo de `rutaActual`. Si no hay ninguna, Ayuda.
 */
export function destinoPermitido(
  permisos: ReadonlyArray<Permiso>,
  isEnabled: (clave: string) => boolean,
  rutaActual: string,
): string {
  const actual = moduloDeRuta(rutaActual);
  const destino = MODULOS_MENU.find(
    (m) =>
      m !== actual
      && !!m.secciones?.length
      && moduloActivo(m, isEnabled)
      && m.secciones.some((s) => permisos.some((p) => p.section_key === s && p.can_view)),
  );
  return destino?.rutas[0] ?? RUTA_SIEMPRE_DISPONIBLE;
}
