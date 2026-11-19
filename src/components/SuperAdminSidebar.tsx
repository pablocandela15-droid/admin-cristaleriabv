import {
  LayoutDashboard,
  Wallet,
  Users,
  LogOut,
  ArrowLeft,
  ScrollText,
  Server,
  FileBarChart2,
  Ticket,
} from "lucide-react";
import { useEffect, type ComponentType, type SVGProps } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { VersionPanel } from "@/components/panel/VersionPanel";
import { Logotipo } from "@/components/marca/Logotipo";
import { cn } from "@/lib/utils";
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
import { BotonUsuarioMenu } from "@/components/cuenta/BotonUsuarioMenu";

interface ItemMenu {
  title: string;
  url: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * Menú del Super Admin: arriba lo de uso diario agrupado por tema (Costes dentro de Servicios desde el
 * 2026-11-04).
 */
const gruposMenuSuperAdmin: { etiqueta: string; items: ItemMenu[] }[] = [
  {
    etiqueta: "Administración",
    items: [
      { title: "Control del Panel", url: "/super-admin", icon: LayoutDashboard },
      { title: "Usuarios", url: "/super-admin/usuarios", icon: Users },
      { title: "Auditoría", url: "/super-admin/auditoria", icon: ScrollText },
      // Informes: todos los informes del panel en un sitio (src/lib/informes/registro.ts).
      { title: "Informes", url: "/super-admin/informes", icon: FileBarChart2 },
      // Tickets: las peticiones de los usuarios del panel, analizadas por la IA.
      { title: "Tickets", url: "/super-admin/tickets", icon: Ticket },
    ],
  },
  {
    etiqueta: "Costes",
    items: [
      { title: "Gestor Gasto", url: "/super-admin/gestor-gasto", icon: Wallet },
      // «Costes» es una pestaña de Servicios desde el 04/11/2026.
      { title: "Servicios", url: "/super-admin/servicios", icon: Server },
    ],
  },
];

export function SuperAdminSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  // Dentro del panel deslizante (tablet vertical) el menú siempre se ve expandido.
  const isCollapsed = state === "collapsed" && !isMobile;

  // Al navegar, el panel deslizante se cierra solo.
  useEffect(() => {
    setOpenMobile(false);
  }, [currentPath, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      {/* El plegador vive aquí desde que SuperAdminLayout quitó su cabecera
          de escritorio (2026-10-09); mismo patrón que AppSidebar. */}
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
              <Logotipo variante="simbolo" decorativo className="h-7 shrink-0" />
              <div className="min-w-0 flex-1">
                {/* Versión a la derecha del título, en pequeño (dueño, 04/11/2026): solo el
                    número, en el color del entorno (ámbar demo, verde producción); el entorno va
                    en el tooltip y para el lector de pantalla. Sin el escudo rojo de antes: sobre el
                    marino del menú no se leía (2,8:1) y no cabía junto a la cúpula. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">Super Admin</h2>
                  <VersionPanel colapsado className="font-medium" />
                </div>
                <p
                  className="truncate text-xs text-sidebar-foreground/75"
                  title="Control total del sistema"
                >
                  Control total del sistema
                </p>
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {gruposMenuSuperAdmin.map((grupo) => (
          <SidebarGroup key={grupo.etiqueta} className="py-1 first:pt-2">
            {/* En pantallas bajas (iPad apaisado, 768 px) sin etiquetas: así caben todos los
                módulos y «Más módulos» sin hacer scroll en el menú. */}
            <SidebarGroupLabel className="[@media(max-height:819px)]:hidden">{grupo.etiqueta}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu aria-label={grupo.etiqueta}>
                {grupo.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                      className="rounded-lg"
                    >
                      <NavLink
                        to={item.url}
                        end={item.url === "/super-admin"}
                        aria-label={item.title}
                        className="flex items-center gap-3 rounded-lg hover:bg-sidebar-accent"
                      >
                        <item.icon
                          className="h-5 w-5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-sidebar-border p-2">
        <SidebarMenu>
          {/* Dentro del Super Admin solo entra un super admin (SuperAdminRoute). */}
          <BotonUsuarioMenu tono="superadmin" esSuperAdmin rol="admin" permisos={[]} />
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Volver al Admin Panel"
              aria-label="Volver al Admin Panel"
              className="rounded-lg gap-3"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft aria-hidden="true" />
              <span>Volver al Admin Panel</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
