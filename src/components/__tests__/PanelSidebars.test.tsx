import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  role: "admin" as string | null,
  isSuperAdmin: true,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: h.user }),
}));
vi.mock("@/hooks/useUserRole", async (original) => ({
  // SECTIONS y los tipos reales: «Mi cuenta» enseña los permisos por sección.
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({
    isAdmin: true,
    role: h.role,
    loading: false,
    permissions: [{ section_key: "usuarios", can_view: true, can_edit: true }],
  }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.isSuperAdmin, loading: false }),
}));
vi.mock("@/hooks/useAdminFeatureToggles", () => ({
  useAdminFeatureToggles: () => ({ isEnabled: () => true, loading: false }),
}));

import { AppSidebar } from "@/components/AppSidebar";
import { SuperAdminSidebar } from "@/components/SuperAdminSidebar";
import { NEGOCIO } from "@/config/negocio";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1440,
  });
  h.user = {
    id: "u-1",
    email: "laura@cristaleria.test",
    user_metadata: { display_name: "Laura Gómez" },
    created_at: "2026-01-15T09:30:00Z",
    last_sign_in_at: "2026-11-03T08:00:00Z",
  };
  h.role = "admin";
  h.isSuperAdmin = true;
  localStorage.clear();
});

describe.each([
  ["admin", AppSidebar, "Usuarios"],
  ["superadmin", SuperAdminSidebar, "Auditoría"],
] as const)("navegación %s", (_name, Panel, section) => {
  it("permite recoger y expandir sin perder el nombre accesible de los iconos", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <Panel />
        </SidebarProvider>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Recoger menú lateral" }),
    );
    expect(
      screen.getByRole("button", { name: "Expandir menú lateral" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: section })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Expandir menú lateral" }),
    );
    expect(
      screen.getByRole("button", { name: "Recoger menú lateral" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it.each([390, 820])(
    "abre el menú completo a %s px aunque escritorio esté recogido, y lo cierra al navegar",
    async (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      render(
        <MemoryRouter>
          <SidebarProvider defaultOpen={false}>
            <Panel />
            <SidebarTrigger />
          </SidebarProvider>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
      const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
      expect(
        within(drawer).getByRole("link", { name: section }),
      ).toBeInTheDocument();
      expect(
        within(drawer).getByRole("button", { name: "Cerrar menú" }),
      ).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(within(drawer).getByRole("link", { name: section }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole("button", { name: "Abrir menú" }),
      ).toHaveAttribute("aria-expanded", "false");
    },
  );
});

// ───────── Super Admin: orden del menú, agrupado por tema ─────────

function renderSuperAdmin(ruta = "/super-admin", { defaultOpen = true } = {}) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <SuperAdminSidebar />
        <SidebarTrigger />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("menú del Super Admin", () => {
  it("los módulos agrupados: «Administración», «Costes» y «Web», sin «Más módulos»", () => {
    renderSuperAdmin();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Control del Panel", "Usuarios", "Auditoría",
      "Informes",
      // Tickets (13/11/2026): las peticiones de los usuarios, analizadas por la IA.
      "Tickets",
      // «Costes» es una pestaña de Servicios desde el 2026-11-04: ya no tiene entrada propia.
      "Gestor Gasto", "Servicios",
      // Logs (24/11/2026): actividad de la web, errores e incidencias.
      "Logs",
    ]);
    expect(
      within(screen.getByRole("list", { name: "Administración" })).getAllByRole("link").map((l) => l.getAttribute("aria-label")),
    ).toEqual(["Control del Panel", "Usuarios", "Auditoría", "Informes", "Tickets"]);
    expect(
      within(screen.getByRole("list", { name: "Costes" })).getAllByRole("link").map((l) => l.getAttribute("aria-label")),
    ).toEqual(["Gestor Gasto", "Servicios"]);
    const logs = within(screen.getByRole("list", { name: "Web" })).getByRole("link", { name: "Logs" });
    expect(logs).toHaveAttribute("href", "/super-admin/logs");
    expect(screen.queryByTestId("mas-modulos")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Web y clientes" })).not.toBeInTheDocument();
  });

  it("Servicios queda marcado también en sus pestañas (Costes incluida)", () => {
    renderSuperAdmin("/super-admin/servicios?tab=costes");
    expect(screen.getByRole("link", { name: "Servicios" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Costes" })).not.toBeInTheDocument();
  });

  it("Gestor Gasto, en el grupo Costes, marcado al estar en él", () => {
    renderSuperAdmin("/super-admin/gestor-gasto");
    const enlace = within(screen.getByRole("list", { name: "Costes" })).getByRole("link", { name: "Gestor Gasto" });
    expect(enlace).toHaveAttribute("href", "/super-admin/gestor-gasto");
    expect(enlace).toHaveAttribute("aria-current", "page");
  });
});

// ───────── Pie del menú: usuario conectado y «Mi cuenta» ─────────

describe.each([
  ["admin", AppSidebar, "Admin"],
  ["superadmin", SuperAdminSidebar, "Super Admin"],
] as const)("pie del menú %s", (_nombre, Panel, rolEsperado) => {
  // Usuario «admin» que no es super admin: en el Admin Panel se ve «Admin»; dentro
  // del Super Admin siempre «Super Admin» (solo entra un super admin).
  beforeEach(() => {
    h.isSuperAdmin = false;
  });
  const renderPanel = (defaultOpen = true) =>
    render(
      <MemoryRouter>
        <SidebarProvider defaultOpen={defaultOpen}>
          <Panel />
        </SidebarProvider>
      </MemoryRouter>,
    );

  it("enseña al usuario con sus iniciales, su nombre y su rol, y mantiene el resto del pie", () => {
    renderPanel();
    const boton = screen.getByTestId("boton-mi-cuenta");
    expect(boton).toHaveAccessibleName(`Mi cuenta: Laura Gómez, ${rolEsperado}`);
    expect(within(boton).getByTestId("avatar-usuario")).toHaveTextContent("LG");
    expect(within(boton).getByText("Laura Gómez")).toBeInTheDocument();
    expect(within(boton).getByText(rolEsperado)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    // La versión ya no va en el pie (2026-11-03): está arriba.
    const pie = boton.closest('[data-sidebar="footer"]')!;
    expect(within(pie as HTMLElement).queryByTestId("version-panel")).toBeNull();
  });

  it("sin nombre guardado usa el email (o el usuario de @staff.local)", () => {
    h.user = { ...h.user, user_metadata: {}, email: "pepe@staff.local" };
    const { unmount } = renderPanel();
    expect(screen.getByTestId("boton-mi-cuenta")).toHaveAccessibleName(expect.stringContaining("Mi cuenta: pepe,"));
    expect(screen.getByTestId("avatar-usuario")).toHaveTextContent("PE");
    unmount();
    h.user = { ...h.user, email: "marta.lopez@cristaleria.test" };
    renderPanel();
    expect(screen.getByTestId("boton-mi-cuenta")).toHaveAccessibleName(expect.stringContaining("marta.lopez@cristaleria.test"));
    expect(screen.getByTestId("avatar-usuario")).toHaveTextContent("ML");
  });

  it("en modo iconos queda el avatar, con el nombre en el tooltip", async () => {
    renderPanel(false);
    const boton = screen.getByTestId("boton-mi-cuenta");
    expect(within(boton).getByTestId("avatar-usuario")).toBeInTheDocument();
    expect(boton).toHaveAccessibleName(expect.stringContaining("Laura Gómez"));
    fireEvent.focus(boton);
    expect((await screen.findAllByText(`Mi cuenta · Laura Gómez (${rolEsperado})`)).length).toBeGreaterThan(0);
  });

  it("abre «Mi cuenta» con sus datos, sus secciones y el cambio de contraseña", async () => {
    h.isSuperAdmin = _nombre === "superadmin";
    renderPanel();
    fireEvent.click(screen.getByTestId("boton-mi-cuenta"));
    const dialogo = await screen.findByRole("dialog", { name: "Laura Gómez" });
    expect(within(dialogo).getByText("Email").nextSibling).toHaveTextContent("laura@cristaleria.test");
    expect(within(dialogo).getByText("Rol").nextSibling).toHaveTextContent(rolEsperado);
    expect(within(dialogo).getByText("Alta en el panel").nextSibling).toHaveTextContent("2026");
    expect(within(dialogo).getByText("Último inicio de sesión")).toBeInTheDocument();
    expect(within(dialogo).getByRole("heading", { name: "Secciones a las que tienes acceso" })).toBeInTheDocument();
    if (_nombre === "admin") {
      // Admin sin super admin: «Usuarios» (un solo interruptor, «Puede ver») sí; Dashboard, no.
      expect(within(dialogo).getByLabelText("Puede ver Usuarios: Sí")).toBeInTheDocument();
      expect(within(dialogo).getByLabelText("Ver Dashboard: No")).toBeInTheDocument();
    } else {
      // Super admin: todas las secciones, sin la tabla de Sí/No.
      expect(within(dialogo).getByLabelText("Dashboard: ver y editar")).toBeInTheDocument();
      expect(within(dialogo).getByLabelText("Usuarios: ver y editar")).toBeInTheDocument();
      expect(within(dialogo).queryByLabelText("Puede ver Usuarios: Sí")).toBeNull();
    }
    fireEvent.mouseDown(within(dialogo).getByRole("tab", { name: "Contraseña" }));
    expect(await within(dialogo).findByLabelText("Contraseña actual", { selector: "input" })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nueva contraseña", { selector: "input" })).toBeInTheDocument();
  });
});

// ───────── Versión y entorno en la cabecera del menú (2026-11-03) ─────────

describe.each([
  ["admin", AppSidebar, "Admin Panel"],
  ["superadmin", SuperAdminSidebar, "Super Admin"],
] as const)("versión arriba en el menú %s", (_nombre, Panel, titulo) => {
  const renderPanel = (defaultOpen = true) =>
    render(
      <MemoryRouter>
        <SidebarProvider defaultOpen={defaultOpen}>
          <Panel />
          <SidebarTrigger />
        </SidebarProvider>
      </MemoryRouter>,
    );
  const cabecera = () => screen.getByRole("heading", { name: titulo }).closest('[data-sidebar="header"]') as HTMLElement;

  it("expandido: en la cabecera, junto al título, con el entorno; no en el pie", () => {
    renderPanel();
    const version = within(cabecera()).getByTestId("version-panel");
    expect(version).toHaveTextContent("Local");
    expect(version).toHaveAttribute("title", "Local");
    expect(screen.getAllByTestId("version-panel")).toHaveLength(1);
  });

  it("en modo iconos queda un indicador compacto en la cabecera", () => {
    renderPanel(false);
    const version = screen.getByTestId("version-panel");
    expect(version.closest('[data-sidebar="header"]')).not.toBeNull();
    expect(version.closest('[data-sidebar="footer"]')).toBeNull();
    expect(version).toHaveAttribute("data-entorno", "local");
  });

  it("en el panel deslizante (390 px) también está arriba", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderPanel(false);
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const drawer = screen.getByRole("dialog", { name: "Menú de navegación" });
    expect(within(drawer).getByTestId("version-panel").closest('[data-sidebar="header"]')).not.toBeNull();
  });
});

describe("menú del panel normal · cabecera con el negocio", () => {
  it("bajo «Admin Panel» sale el subtítulo del negocio (config/negocio.ts)", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    const cabecera = screen.getByRole("heading", { name: "Admin Panel" }).closest('[data-sidebar="header"]') as HTMLElement;
    expect(within(cabecera).getByText(NEGOCIO.subtitulo)).toHaveAttribute("title", NEGOCIO.subtitulo);
    expect(NEGOCIO.subtitulo).toBe("Cristalería Baix Vinalopó");
  });

  it("las entradas del menú, en el orden del catálogo (super admin: las ve todas)", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Dashboard", "Facturas", "Web", "Presupuestos", "Tráfico web", "Newsletter", "RRSS", "Usuarios", "Nueva petición", "Ayuda",
    ]);
  });
});

describe("menú del panel normal · «Nueva petición» (13/11/2026)", () => {
  it("la ve cualquier usuario, también sin ser super admin, justo antes de Ayuda; y lleva la página de origen", () => {
    h.isSuperAdmin = false;
    render(
      <MemoryRouter initialEntries={["/usuarios?tab=lista"]}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    const enlace = screen.getByRole("link", { name: "Nueva petición" });
    expect(enlace).toHaveAttribute("href", "/peticiones");
    const nombres = screen.getAllByRole("link").map((l) => l.getAttribute("aria-label"));
    expect(nombres.indexOf("Ayuda")).toBe(nombres.indexOf("Nueva petición") + 1);
    // Con permiso de Usuarios (y sin el de Dashboard), Usuarios sí y Dashboard no.
    expect(nombres).toContain("Usuarios");
    expect(nombres).not.toContain("Dashboard");
  });
});
