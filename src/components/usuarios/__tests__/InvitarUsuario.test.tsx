/**
 * Pantalla Usuarios → «Añadir Usuario» (InvitarUsuario): «Puede editar» al crear.
 *
 * El alta va por la Edge Function `admin-create-user`, que escribe los permisos con
 * la service role y respeta el `can_edit` que le llega. La puede llamar cualquier
 * admin (no solo un super admin), así que la regla se mantiene en el panel: un
 * usuario nuevo empieza SIN edición, y solo un super admin puede dársela al crearlo
 * (igual que solo un super admin puede cambiarla luego en «Permisos», por RLS).
 *
 * Supabase va mockeado (`__mocks__/client.ts`): se mira el `body` que se enviaría.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";

const h = vi.hoisted(() => ({
  esSuperAdmin: true as boolean,
  presets: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: () => ({ isSuperAdmin: h.esSuperAdmin, loading: false }),
}));
vi.mock("@/hooks/useUserRolePresets", () => ({
  useUserRolePresets: () => ({
    presets: h.presets,
    loading: false,
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
  }),
}));

import { supabase } from "@/integrations/supabase/client";
import { InvitarUsuario } from "@/components/usuarios/InvitarUsuario";
import { toast } from "sonner";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

/** Rol preconfigurado con edición en Dashboard y «Puede ver» en Usuarios. */
const ENCARGADO: UserRolePreset = {
  id: "p-encargado",
  name: "Encargado",
  base_role: "manager",
  permissions: [
    { section_key: "dashboard", can_view: true, can_edit: true },
    { section_key: "usuarios", can_view: true, can_edit: false },
  ],
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.esSuperAdmin = true;
  h.presets = [];
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: "x" } }, error: null } as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true, userId: "u-nuevo" }, error: null } as never);
});

const interruptor = (nombre: string) => screen.getByRole("switch", { name: nombre });

function rellenarYCrear() {
  fireEvent.change(screen.getByLabelText("Nombre de Usuario"), { target: { value: "camarero2" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "prueba-123" } });
  fireEvent.click(screen.getByRole("button", { name: /Crear Usuario/ }));
}

async function permisosEnviados() {
  await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith("admin-create-user", expect.anything()));
  const [, opciones] = vi.mocked(supabase.functions.invoke).mock.calls.find(([nombre]) => nombre === "admin-create-user")!;
  return (opciones as { body: { permissions: Fila[] } }).body.permissions;
}

function rolEnviado() {
  const [, opciones] = vi.mocked(supabase.functions.invoke).mock.calls.find(([nombre]) => nombre === "admin-create-user")!;
  return (opciones as { body: { role: string } }).body.role;
}

const de = (filas: Fila[], clave: string) => filas.find((f) => f.section_key === clave);

async function elegirRol(nombre: string) {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: nombre }));
}

describe("InvitarUsuario · «Puede editar» al crear", () => {
  it("un usuario nuevo empieza viendo solo el Dashboard, sin edición en ninguna sección, y es Staff", async () => {
    render(<InvitarUsuario />);

    expect(screen.getAllByRole("switch", { name: /^Puede editar / }).every((s) => s.getAttribute("aria-checked") === "false")).toBe(true);
    expect(interruptor("Ver Dashboard")).toBeChecked();
    expect(interruptor("Puede ver: Usuarios")).not.toBeChecked();
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(filas).toEqual([
      { section_key: "dashboard", can_view: true, can_edit: false },
      { section_key: "facturas", can_view: false, can_edit: false },
      { section_key: "facturas_subida", can_view: false, can_edit: false },
      { section_key: "web_fotos", can_view: false, can_edit: false },
      { section_key: "web_tarifas", can_view: false, can_edit: false },
      { section_key: "web_contenido", can_view: false, can_edit: false },
      { section_key: "presupuestos", can_view: false, can_edit: false },
      { section_key: "trafico_web", can_view: false, can_edit: false },
      { section_key: "newsletter", can_view: false, can_edit: false },
      { section_key: "rrss", can_view: false, can_edit: false },
      { section_key: "usuarios", can_view: false, can_edit: false },
    ]);
    expect(rolEnviado()).toBe("staff");
  });

  it("un super admin puede darle edición al crearlo y viaja en el payload (rol Manager)", async () => {
    render(<InvitarUsuario />);

    fireEvent.click(interruptor("Puede editar Dashboard"));
    rellenarYCrear();

    expect(de(await permisosEnviados(), "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: true });
    expect(rolEnviado()).toBe("manager");
  });

  it("«Puede editar» no se activa sin «Ver», y quitar «Ver» lo apaga", () => {
    render(<InvitarUsuario />);

    expect(interruptor("Puede editar Dashboard")).toBeEnabled();
    fireEvent.click(interruptor("Puede editar Dashboard"));
    fireEvent.click(interruptor("Ver Dashboard"));
    expect(interruptor("Puede editar Dashboard")).toBeDisabled();
    expect(interruptor("Puede editar Dashboard")).not.toBeChecked();
    fireEvent.click(interruptor("Ver Dashboard"));
    expect(interruptor("Puede editar Dashboard")).toBeEnabled();
    expect(interruptor("Puede editar Dashboard")).not.toBeChecked();
  });

  it("quien no es super admin no puede dar edición al crear", async () => {
    h.esSuperAdmin = false;
    render(<InvitarUsuario />);

    expect(interruptor("Puede editar Dashboard")).toBeDisabled();
    expect(screen.getByText(/solo un super admin puede conceder o retirar/i)).toBeInTheDocument();
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(de(filas, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: false });
  });

  it("un rol preconfigurado con edición la aplica si crea un super admin (y manda su rol base)", async () => {
    h.presets = [ENCARGADO];
    render(<InvitarUsuario />);

    await elegirRol("Encargado");
    expect(interruptor("Puede editar Dashboard")).toBeChecked();
    expect(interruptor("Puede ver: Usuarios")).toBeChecked();
    rellenarYCrear();

    const filas = await permisosEnviados();
    expect(de(filas, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: true });
    expect(de(filas, "usuarios")).toEqual({ section_key: "usuarios", can_view: true, can_edit: false });
    expect(rolEnviado()).toBe("manager");
  });

  it("…pero no si crea quien no es super admin: se queda en «Ver»", async () => {
    h.esSuperAdmin = false;
    h.presets = [ENCARGADO];
    render(<InvitarUsuario />);

    await elegirRol("Encargado");
    expect(interruptor("Puede editar Dashboard")).not.toBeChecked();
    rellenarYCrear();

    expect(de(await permisosEnviados(), "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: false });
  });
});

describe("InvitarUsuario · «Usuarios» (un solo interruptor, «Puede ver»)", () => {
  it("se guarda en can_view sin edición; con todas las secciones a la vista el rol sale Admin", async () => {
    render(<InvitarUsuario />);

    expect(screen.queryByRole("switch", { name: "Puede editar Usuarios" })).toBeNull();
    fireEvent.click(interruptor("Puede ver: Usuarios"));
    rellenarYCrear();

    expect(de(await permisosEnviados(), "usuarios")).toEqual({ section_key: "usuarios", can_view: true, can_edit: false });
    // Dashboard y Usuarios no cuentan para el rol: quien ve todas las secciones es Admin (rolSegunPermisos).
    expect(rolEnviado()).toBe("admin");
  });

  it("también lo da quien no es super admin (es un permiso de «Ver»)", async () => {
    h.esSuperAdmin = false;
    render(<InvitarUsuario />);

    fireEvent.click(interruptor("Puede ver: Usuarios"));
    rellenarYCrear();

    expect(de(await permisosEnviados(), "usuarios")).toEqual({ section_key: "usuarios", can_view: true, can_edit: false });
  });
});

it("explica el alta duplicada y conserva el formulario para corregirlo", async () => {
  vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify({ error: "Este nombre de usuario ya está registrado" }), { status: 409 }) } } as never);
  render(<InvitarUsuario />);
  rellenarYCrear();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este nombre de usuario ya está registrado"));
  expect(screen.getByLabelText("Nombre de Usuario")).toHaveValue("camarero2");
  expect(toast.success).not.toHaveBeenCalled();
});

it("un alta normal creada cuyo acceso de superadmin falla muestra solo el aviso real", async () => {
  vi.mocked(supabase.functions.invoke).mockImplementation(async name => name === "admin-create-user"
    ? { data: { success: true, userId: "u-nuevo" }, error: null } as never
    : { data: null, error: { context: new Response(JSON.stringify({ error: "No se pudo conceder el acceso" }), { status: 500 }) } } as never);
  render(<InvitarUsuario allowSuperAdmin />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Crear como Super Admin/ }));
  rellenarYCrear();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Usuario creado, pero.*No se pudo conceder el acceso/)));
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nombre de Usuario")).toHaveValue("");
});

describe("InvitarUsuario · desplegable «Configuración de acceso»", () => {
  const opciones = async () => {
    fireEvent.click(screen.getByRole("combobox"));
    return (await screen.findAllByRole("option")).map((o) => o.textContent);
  };

  it("sin tipos de usuario fijos (hoy no hay) ni preconfigurados, solo «Configuración manual»", async () => {
    render(<InvitarUsuario />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Configuración manual");
    expect(screen.getByTestId("ayuda-configuracion-acceso")).toHaveTextContent(/opción manual o una preconfiguración/);
    expect(await opciones()).toEqual(["Configuración manual"]);
    expect(screen.queryByText("Tipos de usuario")).toBeNull();
  });

  it("con preconfigurados, salen en su grupo; el de «Tipos de usuario» sigue sin salir", async () => {
    h.presets = [ENCARGADO];
    render(<InvitarUsuario />);

    expect(await opciones()).toEqual(["Configuración manual", "Encargado"]);
    expect(screen.getByText("Roles preconfigurados")).toBeInTheDocument();
    expect(screen.queryByText("Tipos de usuario")).toBeNull();
  });

  it("tocar un permiso a mano deja de ser el rol preconfigurado elegido", async () => {
    h.presets = [ENCARGADO];
    render(<InvitarUsuario />);

    await elegirRol("Encargado");
    expect(screen.getByRole("combobox")).toHaveTextContent("Encargado");
    fireEvent.click(interruptor("Puede ver: Usuarios"));
    expect(screen.getByRole("combobox")).toHaveTextContent("Configuración manual");
    rellenarYCrear();

    // Ya no es el preconfigurado: el rol sale de lo marcado (edita en Dashboard → Manager).
    expect(de(await permisosEnviados(), "usuarios")).toEqual({ section_key: "usuarios", can_view: false, can_edit: false });
    expect(rolEnviado()).toBe("manager");
  });
});
