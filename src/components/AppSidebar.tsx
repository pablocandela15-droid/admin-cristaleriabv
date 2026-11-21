import { LogOut, Settings } from "lucide-react";
import { useEffect } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { VersionPanel } from "@/components/panel/VersionPanel";
import { cn } from "@/lib/utils";
import { precargarSeccion } from "@/lib/precargaSecciones";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { BotonUsuarioMenu } from "@/components/cuenta/BotonUsuarioMenu";
import { MODULOS_MENU, moduloActivo, tienePermisoModulo } from "@/lib/modulosPanel";
import { NEGOCIO } from "@/config/negocio";
import { Logotipo } from "@/components/marca/Logotipo";
import { IndicadorSubidasFacturas } from "@/components/facturas/IndicadorSubidasFacturas";

// Las entradas del menú salen del catálogo de módulos (`lib/modulosPanel.ts`, 14/11/2026), en su orden:
// el mismo que manda en Control del Panel y en las rutas. Cada una se ve si el usuario tiene alguno de
// sus permisos (`secciones`; sin secciones, todo el mundo) y su módulo está activado en Control del Panel.
// El super admin las ve todas, también las desactivadas, marcadas «Desactivado para el equipo».
// Lo del Super Admin (Control del Panel, Auditoría, Servicios, Gestor Gasto…) vive en /super-admin.
// «Avisos» va por la campana del pie del menú y su página /avisos.
const AVISO_DESACTIVADO = "Desactivado para el equipo";

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const { role, permissions, loading } = useUserRole();
  const { isSuperAdmin, loading: superAdminLoading } = useSuperAdmin();
  const { isEnabled, loading: togglesLoading } = useAdminFeatureToggles();

  // También en sus subrutas: /seccion/algo sigue marcando «Seccion».
  const isActive = (path: string) => currentPath === path || (path !== "/" && currentPath.startsWith(`${path}/`));
  // En el panel deslizante (tablet vertical) `state` sigue siendo el del menú de escritorio,
  // pero dentro del Sheet siempre se ve expandido: no confundir con el carril de iconos.
  const isCollapsed = state === "collapsed" && !isMobile;

  // Al navegar, el panel deslizante se cierra solo (si no, tapaba la página nueva).
  useEffect(() => {
    setOpenMobile(false);
  }, [currentPath, setOpenMobile]);

  // Filtrar según permisos y módulos activados en Control del Panel.
  const visibleItems = MODULOS_MENU.filter((modulo) => {
    if (loading || togglesLoading || superAdminLoading) return false;
    // Un módulo desactivado no lo ve el equipo; el super admin sí (marcado).
    if (!moduloActivo(modulo, isEnabled) && !isSuperAdmin) return false;
    // Usuarios se configura por permisos como las demás desde el 06/11/2026 (antes, rol admin).
    // Ser "admin" ya no da acceso a todo lo demás: solo un super admin lo ve
    // todo pase lo que pase en la tabla de permisos.
    return tienePermisoModulo(modulo, permissions, isSuperAdmin);
  }).map((modulo) => ({
    title: modulo.nombre,
    url: modulo.rutas[0],
    icon: modulo.icono,
    conOrigen: modulo.conOrigen,
    desactivado: !moduloActivo(modulo, isEnabled),
  }));

  return (
    <Sidebar collapsible="icon">
      {/* El plegador vivía en la cabecera de página, que se eliminó para
          recuperar alto (ver DashboardLayout.tsx); aquí no gasta ni un píxel
          del área de contenido y sigue presente en TODAS las secciones.
          La campana va en el Dashboard (tarjeta «Avisos») y, en tablet/móvil,
          en la cabecera del marco. */}
      <SidebarHeader
        className={cn(
          "h-[5.5rem] shrink-0 justify-center border-b border-sidebar-border py-2 pl-[calc((var(--sidebar-width-icon)-theme(spacing.11))/2)] pr-3",
          isCollapsed && "px-0",
        )}
      >
        <div className={cn("flex w-full min-w-0 items-center gap-2", isCollapsed && "flex-col gap-1")}>
          <SidebarTrigger className="text-sidebar-foreground hover:bg-sidebar-accent active:bg-sidebar-accent" />
          {/* Versión y entorno arriba, bien a la vista (2026-11-03); con el menú plegado, solo el número. */}
          {isCollapsed && <VersionPanel colapsado />}
          {!isCollapsed && (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* La cúpula de la marca (manual, página 05: «Símbolo» sobre marino). A 28 px de alto, por encima
                  del mínimo de 24 px; el nombre va escrito al lado, así que es decorativa. */}
              <Logotipo variante="simbolo" decorativo className="h-7 shrink-0" />
              <div className="min-w-0 flex-1">
                {/* Versión a la derecha del título, en pequeño (dueño, 04/11/2026): solo el
                    número, en el color del entorno (ámbar demo, verde producción); el entorno va
                    en el tooltip y para el lector de pantalla. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">Admin Panel</h2>
                  <VersionPanel colapsado className="font-medium" />
                </div>
                <p
                  className="truncate text-xs text-sidebar-foreground/75"
                  title={NEGOCIO.subtitulo}
                >
                  {NEGOCIO.subtitulo}
                </p>
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestión</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.desactivado ? `${item.title} · ${AVISO_DESACTIVADO}` : item.title}
                    className="rounded-lg"
                  >
                    <NavLink
                      to={item.url}
                      state={item.conOrigen && !isActive(item.url) ? { desde: `${currentPath}${location.search}` } : undefined}
                      aria-label={item.desactivado ? `${item.title} (${AVISO_DESACTIVADO.toLocaleLowerCase("es")})` : item.title}
                      data-desactivado={item.desactivado || undefined}
                      // Al acercar el ratón o el dedo, empieza a bajar el fichero de la sección (07/11/2026).
                      onMouseEnter={() => precargarSeccion(item.url)}
                      onTouchStart={() => precargarSeccion(item.url)}
                      onFocus={() => precargarSeccion(item.url)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg hover:bg-sidebar-accent",
                        // Solo lo ve el super admin: atenuado y con su marca (el equipo no lo ve).
                        item.desactivado && "text-sidebar-foreground/60",
                      )}
                    >
                      <item.icon
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.title}</span>
                      {item.desactivado && (
                        <span
                          aria-hidden="true"
                          title={AVISO_DESACTIVADO}
                          className="ml-auto shrink-0 rounded-full border border-dashed group-data-[collapsible=icon]:hidden border-sidebar-foreground/40 px-1.5 py-px text-[10px] font-medium leading-4"
                        >
                          Desactivado
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-sidebar-border p-2">
        {/* Facturas subiéndose o leyéndose en segundo plano (no se pinta si no hay ninguna). */}
        {!isMobile && (
          <IndicadorSubidasFacturas
            variante="menu"
            colapsado={isCollapsed}
            className={isCollapsed ? "flex justify-center" : ""}
          />
        )}
        <SidebarMenu>
          {/* Quién ha iniciado sesión; abre «Mi cuenta» (datos, permisos y contraseña). */}
          <BotonUsuarioMenu
            tono="panel"
            esSuperAdmin={!superAdminLoading && isSuperAdmin}
            rol={role ?? null}
            permisos={permissions ?? []}
          />
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="rounded-lg gap-3"
              onClick={() => void signOut()}
            >
              <LogOut aria-hidden="true" />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Super Admin"
              aria-label="Super Admin"
              className="rounded-lg gap-3"
              onClick={() => navigate("/super-admin/login")}
            >
              <Settings aria-hidden="true" />
              <span>Super Admin</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
