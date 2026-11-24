/**
 * Newsletter › Suscriptores: cifras por estado, búsqueda y filtros, exportación, alta manual con el consentimiento
 * apuntado (sin marcarlo no se puede), baja y borrado RGPD con confirmación.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => {
  const fila = (id: string, extra: Record<string, unknown>) => ({
  id, email: `${id}@example.com`, nombre: null, estado: "activo", origen_alta: "web_formulario", consentimiento_at: "2026-11-01T10:00:00Z", consentimiento_detalle: null,
  fecha_verificacion_email: "2026-11-01T10:05:00Z", confirmaciones_enviadas: 1, confirmacion_enviada_at: "2026-11-01T10:00:00Z", fecha_baja: null, origen_baja: null,
  created_at: "2026-11-01T10:00:00Z", ...extra,
  });
  // Datos estables entre renders (como los de React Query).
  return {
    alta: vi.fn(), baja: vi.fn(), suprimir: vi.fn(), confirmaciones: vi.fn(), faltan: [] as string[],
    filas: [
      fila("ana", { nombre: "Ana Pérez" }),
      fila("beto", { estado: "pendiente", origen_alta: "panel_manual", fecha_verificacion_email: null, confirmacion_enviada_at: "2026-11-01T10:00:00Z" }),
      fila("carla", { estado: "baja", origen_alta: "importacion", fecha_baja: "2026-11-04T10:00:00Z", origen_baja: "rebote_permanente" }),
    ],
  };
});
vi.mock("@/hooks/useNewsletter", () => ({
  useNewsletterSuscriptores: () => ({
    data: h.filas,
    isLoading: false, isError: false, error: null, refetch: () => undefined,
  }),
  useEstadoNewsletter: () => ({ data: { canal: "transaccional", faltan: h.faltan, configurado: { api_key: !h.faltan.length } } }),
  useAltaSuscriptor: () => ({ mutate: h.alta, isPending: false }),
  useImportarSuscriptores: () => ({ mutate: vi.fn(), isPending: false }),
  useBajaSuscriptor: () => ({ mutate: h.baja, isPending: false }),
  useSuprimirSuscriptor: () => ({ mutate: h.suprimir, isPending: false }),
  useEnviarConfirmaciones: () => ({ mutate: h.confirmaciones, isPending: false }),
}));

import { GestionSuscriptores } from "../GestionSuscriptores";

beforeEach(() => {
  for (const f of [h.alta, h.baja, h.suprimir, h.confirmaciones]) f.mockReset();
  h.faltan = [];
});

const filas = () => screen.getAllByTestId("fila-suscriptor").map((f) => f.textContent ?? "");

describe("GestionSuscriptores", () => {
  it("cifras por estado y búsqueda sin tildes", () => {
    render(<GestionSuscriptores puedeEditar />);
    const cifras = screen.getByTestId("cifras-suscriptores");
    expect(cifras).toHaveTextContent(/Activos\s*1/);
    expect(cifras).toHaveTextContent(/Pendientes\s*1/);
    expect(cifras).toHaveTextContent(/De baja\s*1/);
    expect(filas()).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Buscar suscriptores"), { target: { value: "perez" } });
    expect(filas()).toEqual([expect.stringContaining("ana@example.com")]);
    fireEvent.change(screen.getByLabelText("Buscar suscriptores"), { target: { value: "nadie" } });
    expect(screen.getByText("Ningún suscriptor coincide con la búsqueda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exportar CSV/ })).toBeDisabled();
  });

  it("alta manual: exige el consentimiento apuntado y marcado; queda pendiente de confirmar", () => {
    render(<GestionSuscriptores puedeEditar />);
    fireEvent.click(screen.getByRole("button", { name: /Añadir/ }));
    const dialogo = screen.getByRole("dialog");
    const anadir = within(dialogo).getByRole("button", { name: /^Añadir$/ });
    fireEvent.change(within(dialogo).getByLabelText("Correo electrónico"), { target: { value: "nuevo@example.com" } });
    fireEvent.change(within(dialogo).getByLabelText("Cómo dio su consentimiento"), { target: { value: "Lo pidió en la tienda y firmó la hoja." } });
    expect(anadir).toBeDisabled();
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: /ha aceptado recibir/ }));
    expect(anadir).toBeEnabled();
    fireEvent.click(anadir);
    expect(h.alta).toHaveBeenCalledWith({ email: "nuevo@example.com", nombre: "", detalle: "Lo pidió en la tienda y firmó la hoja." }, expect.anything());
  });

  it("los pendientes: «Enviar confirmaciones» solo con el envío configurado", () => {
    h.faltan = ["Clave de Resend (RESEND_API_KEY)"];
    const { unmount } = render(<GestionSuscriptores puedeEditar />);
    expect(screen.getByRole("button", { name: /Enviar confirmaciones \(1\)/ })).toBeDisabled();
    unmount();
    h.faltan = [];
    render(<GestionSuscriptores puedeEditar />);
    fireEvent.click(screen.getByRole("button", { name: /Enviar confirmaciones \(1\)/ }));
    expect(h.confirmaciones).toHaveBeenCalledWith(null);
  });

  it("sin «Editar» no hay acciones de fila ni altas", () => {
    render(<GestionSuscriptores puedeEditar={false} />);
    expect(screen.queryByRole("button", { name: /Acciones de/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enviar confirmaciones/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Exportar CSV/ })).toBeEnabled();
  });
});
