/**
 * Pantalla Usuarios → «Configurar roles» (ConfigurarRolesModal): los roles
 * preconfigurados llevan también «Puede editar» (2026-10-01).
 *
 * Antes el editor de plantillas forzaba `can_edit: false` al copiar los permisos
 * actuales y en cada cambio. Se comprueba lo que el modal pasa a onCreatePreset /
 * onUpdatePreset (los hooks que escriben en la BD tienen su propio test).
 *
 * Secciones de hoy: «Dashboard» («Ver» y «Puede editar») y «Usuarios» (un solo
 * interruptor, «Puede ver»).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ConfigurarRolesModal } from "@/components/usuarios/ConfigurarRolesModal";
import type { UserRolePreset } from "@/hooks/useUserRolePresets";

type Fila = { section_key: string; can_view: boolean; can_edit: boolean };

/** Permisos actuales del formulario: Dashboard con edición, sin Usuarios. */
const ACTUALES: Fila[] = [{ section_key: "dashboard", can_view: true, can_edit: true }];

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

const onCreatePreset = vi.fn();
const onUpdatePreset = vi.fn();
const onDeletePreset = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onCreatePreset.mockImplementation(async (name: string) => ({ ...ENCARGADO, id: "p-nuevo", name }));
  onUpdatePreset.mockImplementation(async () => ENCARGADO);
});

function abrir({
  puedeConcederEdicion = true,
  presets = [] as UserRolePreset[],
  actuales = ACTUALES,
} = {}) {
  render(
    <ConfigurarRolesModal
      currentPermissions={actuales}
      presets={presets}
      presetsLoading={false}
      onCreatePreset={onCreatePreset}
      onUpdatePreset={onUpdatePreset}
      onDeletePreset={onDeletePreset}
      puedeConcederEdicion={puedeConcederEdicion}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Configurar roles/ }));
  return screen.getByRole("dialog");
}

const de = (filas: Fila[], clave: string) => filas.find((f) => f.section_key === clave);

async function guardarNuevo(dialogo: HTMLElement, nombre: string) {
  fireEvent.change(within(dialogo).getByLabelText("Nombre del rol"), { target: { value: nombre } });
  fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar rol" }));
  await waitFor(() => expect(onCreatePreset).toHaveBeenCalledTimes(1));
  const [nombreGuardado, , permisos] = onCreatePreset.mock.calls[0] as [string, string, Fila[]];
  expect(nombreGuardado).toBe(nombre);
  return permisos;
}

describe("ConfigurarRolesModal · «Puede editar» en los roles preconfigurados", () => {
  it("el nuevo rol parte de los permisos actuales, edición incluida, y la guarda", async () => {
    const dialogo = abrir();

    expect(within(dialogo).getByRole("switch", { name: "Ver Dashboard" })).toBeChecked();
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).toBeChecked();
    expect(within(dialogo).getByText("1 secciones con acceso")).toBeInTheDocument();

    const permisos = await guardarNuevo(dialogo, "Encargado");
    // Todas las secciones configurables, las que no se tocan sin nada.
    expect(permisos).toEqual([
      { section_key: "dashboard", can_view: true, can_edit: true },
      { section_key: "facturas", can_view: false, can_edit: false },
      { section_key: "facturas_subida", can_view: false, can_edit: false },
      { section_key: "web_fotos", can_view: false, can_edit: false },
      { section_key: "web_tarifas", can_view: false, can_edit: false },
      { section_key: "web_contenido", can_view: false, can_edit: false },
      { section_key: "presupuestos", can_view: false, can_edit: false },
      { section_key: "trafico_web", can_view: false, can_edit: false },
      { section_key: "usuarios", can_view: false, can_edit: false },
    ]);
  });

  it("se puede retirar la edición en la plantilla y se conserva «Ver»", async () => {
    const dialogo = abrir();

    fireEvent.click(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" }));
    const permisos = await guardarNuevo(dialogo, "Consulta");

    expect(de(permisos, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: false });
  });

  it("se puede conceder la edición en la plantilla (primero «Ver», después «Puede editar»)", async () => {
    const dialogo = abrir({ actuales: [] });

    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).toBeDisabled();
    fireEvent.click(within(dialogo).getByRole("switch", { name: "Ver Dashboard" }));
    fireEvent.click(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" }));
    const permisos = await guardarNuevo(dialogo, "Caja");

    expect(de(permisos, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: true });
  });

  it("quitar «Ver» quita también «Puede editar»", async () => {
    const dialogo = abrir();

    fireEvent.click(within(dialogo).getByRole("switch", { name: "Ver Dashboard" }));
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).not.toBeChecked();
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).toBeDisabled();
    const permisos = await guardarNuevo(dialogo, "Sin acceso");

    expect(de(permisos, "dashboard")).toEqual({ section_key: "dashboard", can_view: false, can_edit: false });
  });

  it("al editar un rol guardado muestra sus permisos (no los actuales) y los conserva al guardar", async () => {
    const dialogo = abrir({ presets: [ENCARGADO], actuales: [{ section_key: "dashboard", can_view: true, can_edit: false }] });

    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).not.toBeChecked();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Editar/ }));
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).toBeChecked();
    expect(within(dialogo).getByRole("switch", { name: "Puede ver: Usuarios" })).toBeChecked();
    expect(within(dialogo).getByLabelText("Nombre del rol")).toHaveValue("Encargado");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onUpdatePreset).toHaveBeenCalledTimes(1));
    const [id, nombre, rolBase, permisos] = onUpdatePreset.mock.calls[0] as [string, string, string, Fila[]];
    expect([id, nombre, rolBase]).toEqual(["p-encargado", "Encargado", "manager"]);
    expect(de(permisos, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: true });
    expect(de(permisos, "usuarios")).toEqual({ section_key: "usuarios", can_view: true, can_edit: false });
  });

  it("quien no es super admin no puede conceder edición en las plantillas", () => {
    const dialogo = abrir({ puedeConcederEdicion: false, actuales: [] });

    fireEvent.click(within(dialogo).getByRole("switch", { name: "Ver Dashboard" }));
    expect(within(dialogo).getByRole("switch", { name: "Ver Dashboard" })).toBeChecked();
    expect(within(dialogo).getByRole("switch", { name: "Puede editar Dashboard" })).toBeDisabled();
    expect(within(dialogo).getByText(/Solo un super admin puede conceder o retirar/)).toBeInTheDocument();
  });
});

describe("ConfigurarRolesModal · «Usuarios» (06/11/2026): un solo interruptor", () => {
  it("sale con «Puede ver» (sin «Ver» ni «Puede editar» propios) y se guarda en can_view", async () => {
    const dialogo = abrir();

    const puedeVer = within(dialogo).getByRole("switch", { name: "Puede ver: Usuarios" });
    expect(puedeVer).not.toBeChecked();
    expect(within(dialogo).queryByRole("switch", { name: "Ver Usuarios" })).toBeNull();
    expect(within(dialogo).queryByRole("switch", { name: "Puede editar Usuarios" })).toBeNull();
    expect(within(dialogo).getByText(/^Puede ver: consultar en el admin panel/)).toBeInTheDocument();
    fireEvent.click(puedeVer);
    expect(within(dialogo).getByText("2 secciones con acceso")).toBeInTheDocument();
    const permisos = await guardarNuevo(dialogo, "Supervisor");

    expect(de(permisos, "usuarios")).toEqual({ section_key: "usuarios", can_view: true, can_edit: false });
    // Va por libre: el Dashboard sigue como estaba.
    expect(de(permisos, "dashboard")).toEqual({ section_key: "dashboard", can_view: true, can_edit: true });
  });

  it("también lo cambia quien no puede conceder edición (es un permiso de «Ver»)", () => {
    const dialogo = abrir({ puedeConcederEdicion: false });
    expect(within(dialogo).getByRole("switch", { name: "Puede ver: Usuarios" })).toBeEnabled();
  });
});
