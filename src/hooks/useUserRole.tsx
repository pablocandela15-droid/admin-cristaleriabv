import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useSuperAdmin } from "./useSuperAdmin";
import { precargarFeatureToggles } from "@/lib/precargaToggles";
import { alRevalidarSesion } from "@/lib/revalidacion-sesion";
import { SUPER_ADMIN_EMAILS, isSuperAdmin as checkIsSuperAdmin } from "@/config/permissions";
import { guardarPermisosRecordados, leerPermisosRecordados } from "@/lib/cachePermisos";

export type AppRole = "admin" | "manager" | "staff";

export interface UserPermissions {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface UserRoleData {
  role: AppRole | null;
  isAdmin: boolean;
  permissions: UserPermissions[];
  loading: boolean;
  /**
   * Ya se han leído del servidor (o se intentó) para este usuario. Con `false` lo que hay puede ser lo
   * recordado en el dispositivo (`lib/cachePermisos.ts`): vale para dejar pasar, no para echar a nadie.
   */
  verificado?: boolean;
  /**
   * Sección que se abre al iniciar sesión (11/11/2026, `lib/seccionInicio.ts`): la clave guardada en
   * `user_roles.seccion_inicio`, null = lo de siempre y `undefined` = aún no se sabe.
   */
  seccionInicio?: string | null;
}

export const SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  // Facturas de proveedores con lectura automática (migración 20261121100000_facturas): «Ver» consulta
  // Compras; «Editar» además modifica, verifica, clasifica y sube.
  { key: "facturas", label: "Facturas" },
  // Subir facturas (pestaña Cargar) y corregir lo que sube uno mismo. Va por libre: no necesita «Ver»
  // en Facturas. Un solo interruptor («Puede subir», guardado en can_view). En la BD:
  // facturas_puede_subir().
  { key: "facturas_subida", label: "Facturas · Subida" },
  // Web editable (migración 20261123100000_web_y_presupuestos, página /web): una sección por pestaña. «Ver»
  // consulta; «Editar» cambia lo que lee la web (books de fotos, tarifas de la calculadora, textos e imágenes).
  { key: "web_fotos", label: "Web · Fotos" },
  { key: "web_tarifas", label: "Web · Tarifas" },
  { key: "web_contenido", label: "Web · Contenido" },
  // Gestor de presupuestos y solicitudes que llegan de la web (misma migración). «Ver» consulta; «Editar» crea,
  // cambia y envía.
  { key: "presupuestos", label: "Presupuestos" },
  { key: "usuarios", label: "Usuarios" },
] as const;
// Nota: lo del Super Admin (Control del Panel, Auditoría, Servicios, Gestor Gasto…) no forma parte del
// Admin Panel normal: solo lo ve un super admin.

export type SectionKey = typeof SECTIONS[number]["key"];

const UserRoleContext = createContext<UserRoleData | null>(null);

/** Guarda rol y permisos en el dispositivo solo si las DOS lecturas fueron bien (PGRST116 = sin rol, vale). */
function recordarSiCompleto(
  userId: string,
  roleData: { role: string } | null,
  roleError: { code?: string } | null,
  permData: UserPermissions[] | null,
  permError: unknown,
) {
  if (permError || !permData) return;
  if (roleError && roleError.code !== "PGRST116") return;
  guardarPermisosRecordados(userId, { role: (roleData?.role as AppRole | undefined) ?? null, permissions: permData });
}

/**
 * Sección de inicio del usuario (11/11/2026, petición del dueño: «qué pestaña se le va a abrir por
 * defecto cuando inician sesión»). Lectura aparte del rol y sin tumbar nada si falla: una BD sin la
 * columna (migración 20261124134500 aún no aplicada) o un corte devuelven `undefined` (no se sabe).
 */
async function leerSeccionInicio(userId: string): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase
      .from("user_roles")
      .select("seccion_inicio")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return undefined;
    return typeof data?.seccion_inicio === "string" && data.seccion_inicio ? data.seccion_inicio : null;
  } catch {
    return undefined;
  }
}

/**
 * Única consulta de rol/permisos para toda la app (2026-09-25).
 *
 * Mismo problema que useAuth: ProtectedRoute y AppSidebar llamaban cada uno
 * a su propio useUserRole(), así que cada carga de página disparaba DOS
 * consultas independientes a user_roles y user_permissions, con dos
 * `loading` que resolvían en momentos distintos — parte del lag y el
 * parpadeo al entrar. Ahora la consulta vive una sola vez aquí, en
 * UserRoleProvider, y useUserRole()/useCanAccessSection() solo leen ese
 * contexto.
 */
export function UserRoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [verificado, setVerificado] = useState(false);
  const [seccionInicio, setSeccionInicio] = useState<string | null | undefined>(undefined);

  // Se depende de valores primitivos (id, email), NO del objeto `user`:
  // supabase-js re-emite SIGNED_IN / TOKEN_REFRESHED al volver a la app y eso
  // no debe relanzar la consulta ni poner loading=true (desmontaría la página
  // protegida, con sus formularios y diálogos). Un usuario distinto sí cambia
  // el id y recarga rol y permisos.
  const userId = user?.id ?? null;
  const isSuperAdminUser = checkIsSuperAdmin(user?.email);

  useEffect(() => {
    // Espera a que useAuth resuelva del todo antes de decidir nada. Sin este
    // guard, en el instante en que `user` todavía es null (useAuth sigue
    // validando la sesión) este efecto ya resolvía loading=false; cuando
    // `user` llegaba un instante después, había un render en el que TANTO
    // authLoading como este loading leían false a la vez → se veía el
    // contenido de la página → y acto seguido este efecto volvía a poner
    // loading=true para pedir el rol → aparecía el spinner encima. Ese
    // "página y luego spinner" era exactamente esta carrera.
    if (authLoading) return;

    if (!userId) {
      setRole(null);
      setPermissions([]);
      setSeccionInicio(null);
      setLoading(false);
      setVerificado(true);
      return;
    }

    let isMounted = true;
    setVerificado(false);

    // Este efecto solo corre al cargar o al cambiar de usuario (nunca en un
    // refresco de token), así que es seguro descartar lo del usuario anterior.
    setRole(null);
    setPermissions([]);
    setSeccionInicio(undefined);

    // Si es super admin, acceso inmediato
    if (isSuperAdminUser) {
      setRole("admin");
      setLoading(false);
    }

    // Lo último que se leyó para ESTE usuario en este dispositivo (09/11/2026, mala cobertura): se pinta
    // ya y se vuelve a leer abajo igualmente; si ha cambiado, se corrige al llegar (`lib/cachePermisos.ts`).
    const recordado = leerPermisosRecordados(userId);
    if (recordado?.permissions) {
      setRole(recordado.role ?? (isSuperAdminUser ? "admin" : null));
      setPermissions(recordado.permissions);
      // Una copia de antes del 11/11/2026 no la tiene: se entra como siempre sin esperar a la red.
      setSeccionInicio(recordado.seccionInicio ?? null);
      setLoading(false);
    }

    // El menú lateral los necesita en cuanto pase ProtectedRoute: se piden ya, en paralelo.
    precargarFeatureToggles();

    const fetchRoleAndPermissions = async () => {
      // Si no es super admin (ni hay nada recordado), mostramos loading
      if (!isSuperAdminUser && !recordado?.permissions) setLoading(true);

      try {
        // Rol y permisos A LA VEZ (07/11/2026): no dependen uno del otro y en serie eran dos
        // viajes seguidos al entrar (con cobertura de móvil se notaba). Se aplican igual que antes.
        // La sección de inicio va en el mismo viaje (11/11/2026): ProtectedRoute la necesita al entrar.
        const [{ data: roleData, error: roleError }, { data: permData, error: permError }, seccion] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", userId).single(),
          supabase.from("user_permissions").select("section_key, can_view, can_edit").eq("user_id", userId),
          leerSeccionInicio(userId),
        ]);
        if (!isMounted) return;
        recordarSiCompleto(userId, roleData, roleError, permData, permError);
        if (seccion !== undefined) {
          setSeccionInicio(seccion);
          guardarPermisosRecordados(userId, { seccionInicio: seccion });
        }

        if (roleData) {
          setRole(roleData.role as AppRole);
        } else if (isSuperAdminUser) {
          setRole("admin");
        }

        if (permData) {
          setPermissions(permData);
        }
      } catch (error) {
        console.error("Error fetching role/permissions:", error);
      } finally {
        if (isMounted && !isSuperAdminUser) setLoading(false);
        if (isMounted) {
          // Sin poder leerla (ni copia): lo de siempre.
          setSeccionInicio((previa) => (previa === undefined ? null : previa));
          setVerificado(true);
        }
      }
    };

    fetchRoleAndPermissions();

    return () => {
      isMounted = false;
    };
  }, [userId, authLoading, isSuperAdminUser]);

  // CT-REM-FE-02: relectura silenciosa de rol y permisos cuando AuthProvider
  // revalida la sesión (TOKEN_REFRESHED, foco y sondeo de 15 s). No toca
  // `loading`, así que no desmonta la página; si falla la lectura se conserva
  // lo último conocido (un corte de red no debe quitar permisos).
  useEffect(() => {
    if (authLoading || !userId) return;
    let vivo = true;
    let enCurso = false;
    const releer = async () => {
      if (enCurso) return;
      enCurso = true;
      try {
        const [{ data: roleData, error: roleError }, { data: permData, error: permError }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", userId).single(),
          supabase.from("user_permissions").select("section_key, can_view, can_edit").eq("user_id", userId),
        ]);
        if (!vivo) return;
        recordarSiCompleto(userId, roleData, roleError, permData, permError);
        // PGRST116 = sin fila: el rol se ha retirado de verdad.
        const roleOk = !roleError || roleError.code === "PGRST116";
        if (roleOk) {
          const nuevo = (roleData?.role as AppRole | undefined) ?? (isSuperAdminUser ? "admin" : null);
          setRole((previo) => (previo === nuevo ? previo : nuevo));
        }
        if (!permError && permData) {
          setPermissions((previo) =>
            JSON.stringify(previo) === JSON.stringify(permData) ? previo : permData,
          );
        }
      } catch (error) {
        console.error("Error revalidando rol/permisos:", error);
      } finally {
        enCurso = false;
      }
    };
    const baja = alRevalidarSesion(() => void releer());
    return () => {
      vivo = false;
      baja();
    };
  }, [userId, authLoading, isSuperAdminUser]);

  const isAdmin = role === "admin" || isSuperAdminUser;

  const value: UserRoleData = {
    role: isSuperAdminUser ? "admin" : role,
    isAdmin,
    permissions,
    loading,
    verificado,
    seccionInicio,
  };

  return <UserRoleContext.Provider value={value}>{children}</UserRoleContext.Provider>;
}

export function useUserRole(): UserRoleData {
  const context = useContext(UserRoleContext);
  if (!context) {
    throw new Error("useUserRole debe usarse dentro de <UserRoleProvider>");
  }
  return context;
}

export function useCanAccessSection(sectionKey: SectionKey, permissionType: "view" | "edit" = "view") {
  const { permissions, loading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();

  if (loading || superAdminLoading) return { canAccess: false, loading: true };

  // Ser "admin" ya no da acceso automático a todo (2026-09-26): un admin solo
  // ve lo que le marquen sus permisos, igual que un manager o un staff. El
  // único acceso incondicional es el de super admin (tabla super_admins),
  // igual que en has_section_permission() del lado de la base de datos.
  if (isSuperAdmin) return { canAccess: true, loading: false };

  const permission = permissions.find(p => p.section_key === sectionKey);

  if (!permission) return { canAccess: false, loading: false };

  const canAccess = permissionType === "view" ? permission.can_view : permission.can_edit;

  return { canAccess, loading: false };
}

