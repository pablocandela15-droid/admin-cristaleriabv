/**
 * Tipos de usuario fijos de la pantalla Usuarios (10/11/2026).
 *
 * Se eligen en el mismo desplegable que los roles preconfigurados, al crear un usuario y en su diálogo
 * «Permisos», y rellenan los permisos. A diferencia de los preconfigurados (tabla user_role_presets,
 * editables y borrables), van en el código: siempre están y siempre significan lo mismo.
 *
 * Hoy no hay ninguno (el panel solo tiene Dashboard y Usuarios). Para añadir uno: su entrada en
 * `TIPOS_USUARIO` con los permisos que deja y la pantalla con la que empieza al entrar. Mientras la
 * lista esté vacía, el desplegable no enseña el grupo «Tipos de usuario».
 */
import { mismosPermisos, permisosParaEditar, type PermisoSeccion } from "@/components/usuarios/permisosSecciones";

export interface TipoUsuario {
  id: string;
  nombre: string;
  /** Una línea para el desplegable y la ayuda. */
  descripcion: string;
  /** Permisos que deja (el resto de secciones, sin nada). */
  permisos: PermisoSeccion[];
  /** Pantalla con la que empieza al entrar. */
  inicio: string;
}

export const TIPOS_USUARIO: readonly TipoUsuario[] = [];

/** Prefijo del valor en el desplegable («tipo:<id>»), para no chocar con los ids de los preconfigurados. */
export const PREFIJO_TIPO = "tipo:";

export const valorTipo = (tipo: Pick<TipoUsuario, "id">) => `${PREFIJO_TIPO}${tipo.id}`;

/** El tipo de un valor del desplegable, o null si no es un tipo. */
export function tipoDeValor(valor: string | null | undefined): TipoUsuario | null {
  if (!valor?.startsWith(PREFIJO_TIPO)) return null;
  return TIPOS_USUARIO.find((t) => t.id === valor.slice(PREFIJO_TIPO.length)) ?? null;
}

/** El tipo cuyos permisos son EXACTAMENTE estos (para preseleccionarlo y para la etiqueta de la lista). */
export function tipoQueCoincide(
  permisos: ReadonlyArray<{ section_key: string; can_view?: boolean | null; can_edit?: boolean | null }>,
): TipoUsuario | null {
  return TIPOS_USUARIO.find((t) => mismosPermisos(permisos, t.permisos)) ?? null;
}
