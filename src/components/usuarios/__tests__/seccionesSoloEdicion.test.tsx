/**
 * Secciones «solo edición» (`seccionesSoloEdicion.ts`, 06/11/2026): aquellas en las que «Ver» sin «Puede
 * editar» no da acceso. La única que había, «Reservas · Configuración», era del panel de restaurante y se ha
 * retirado: hoy la lista está vacía. Se comprueba que, sin ninguna, todas las secciones llevan su interruptor
 * de «Ver» (o el único de la sección) y los visores enseñan «Ver» tal como está guardado.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TablaPermisosSecciones } from "@/components/usuarios/TablaPermisosSecciones";
import { ListaPermisosUsuario } from "@/components/usuarios/VisorPermisosUsuario";
import { SECCIONES_SOLO_EDICION, esSeccionSoloEdicion } from "@/components/usuarios/seccionesSoloEdicion";
import { SECCIONES_CONFIGURABLES, permisosParaEditar } from "@/components/usuarios/permisosSecciones";

describe("SECCIONES_SOLO_EDICION", () => {
  it("hoy no hay ninguna", () => {
    expect([...SECCIONES_SOLO_EDICION]).toEqual([]);
  });

  it("ninguna sección configurable (ni una retirada) es «solo edición»", () => {
    for (const seccion of SECCIONES_CONFIGURABLES) expect(esSeccionSoloEdicion(seccion.key), seccion.key).toBe(false);
    expect(esSeccionSoloEdicion("reservas_configuracion")).toBe(false);
  });
});

describe("TablaPermisosSecciones sin secciones «solo edición»", () => {
  it("ninguna fila cambia «Ver» por «—»: todas tienen su interruptor de «Ver» (o el único de la sección)", () => {
    render(
      <TablaPermisosSecciones
        permisos={permisosParaEditar([])}
        onCambiarVer={vi.fn()}
        onCambiarEditar={vi.fn()}
        puedeConcederEdicion
      />,
    );
    expect(screen.queryByText(/«Ver» va con «Puede editar» en/)).toBeNull();
    expect(screen.getByRole("switch", { name: "Ver Dashboard" })).toBeEnabled();
    // Sin «Ver», «Puede editar» sigue bloqueado (no hay fila que lo active sola).
    expect(screen.getByRole("switch", { name: "Puede editar Dashboard" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Puede ver: Usuarios" })).toBeEnabled();
  });
});

describe("ListaPermisosUsuario sin secciones «solo edición»", () => {
  const fila = (nombre: string) => screen.getByText(nombre, { selector: "p" }).closest("li") as HTMLElement;

  it("un «Ver» suelto (sin «Editar») se enseña como «Sí»: basta para entrar", () => {
    render(
      <ListaPermisosUsuario
        user={{ is_super_admin: false, role: "staff", permissions: [{ section_key: "dashboard", can_view: true, can_edit: false }] }}
      />,
    );
    expect(within(fila("Dashboard")).getByLabelText("Ver Dashboard: Sí")).toBeInTheDocument();
    expect(within(fila("Dashboard")).getByLabelText("Editar Dashboard: No")).toBeInTheDocument();
    expect(within(fila("Usuarios")).getByLabelText("Puede ver Usuarios: No")).toBeInTheDocument();
  });
});
