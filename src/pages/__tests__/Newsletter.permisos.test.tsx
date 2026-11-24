/**
 * Marketing › Newsletter (/newsletter) según los permisos de la sección «newsletter»: con solo «Ver» desaparece
 * «Crear y enviar», sale «Solo lectura» y se abren los suscriptores (sin añadir, importar ni dar de baja; exportar
 * sí); los ajustes se ven pero no se cambian. Con «Editar» (o siendo super admin), todo.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => 640 }));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
// Datos estables entre renders (como los de React Query).
const h = vi.hoisted(() => ({
  permisos: {} as Permisos,
  superAdmin: false,
  suscriptores: [{ id: "s1", email: "ana@example.com", nombre: "Ana", estado: "activo", origen_alta: "web_formulario", consentimiento_at: "2026-11-01T10:00:00Z",
    fecha_verificacion_email: "2026-11-01T10:05:00Z", confirmaciones_enviadas: 1, confirmacion_enviada_at: null, fecha_baja: null, origen_baja: null, created_at: "2026-11-01T10:00:00Z" }],
  estado: { canal: "transaccional", faltan: [], configurado: { api_key: true, webhook_secret: true, remitente: true, ia: true, cron_secret: true, segment_id: null }, url_webhook: "" },
  config: { remitente_email: "novedades@example.com", remitente_nombre: "Cristalería BV", responder_a: null, canal: "transaccional", email_prueba: null, limite_transaccional: 100, web_url: "https://cristaleriabv.vercel.app" },
}));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "staff", isAdmin: false, permissions: [], loading: false }),
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({ canAccess: h.superAdmin || !!h.permisos[seccion]?.[tipo], loading: false }),
}));
vi.mock("@/components/newsletter/CreadorNewsletter", () => ({ CreadorNewsletter: () => <p>Creador de prueba</p> }));
vi.mock("@/components/newsletter/EstadisticasNewsletter", () => ({ EstadisticasNewsletter: ({ historial }: { historial: ReactNode }) => <section>Estadísticas de prueba{historial}</section> }));
vi.mock("@/components/newsletter/HistorialEnvios", () => ({ HistorialEnvios: () => <p>Historial de prueba</p> }));
vi.mock("@/components/newsletter/DialogosSuscriptores", () => ({ DialogoAltaSuscriptor: () => null, DialogoImportarCsv: () => null }));
const mutacion = { mutate: vi.fn(), isPending: false };
vi.mock("@/hooks/useNewsletter", () => ({
  useNewsletterSuscriptores: () => ({
    data: h.suscriptores,
    isLoading: false, isError: false, error: null, refetch: () => undefined,
  }),
  useEstadoNewsletter: () => ({ data: h.estado, isLoading: false, isError: false }),
  useNewsletterConfig: () => ({ data: h.config, isLoading: false }),
  useGuardarConfigNewsletter: () => mutacion,
  useBajaSuscriptor: () => mutacion,
  useSuprimirSuscriptor: () => mutacion,
  useEnviarConfirmaciones: () => mutacion,
}));

import Newsletter from "@/pages/Newsletter";

function montar(permisos: Permisos | "superAdmin") {
  h.superAdmin = permisos === "superAdmin";
  h.permisos = permisos === "superAdmin" ? {} : permisos;
  return render(<Newsletter />);
}
afterEach(() => {
  h.permisos = {};
  h.superAdmin = false;
  window.history.replaceState(null, "", "/");
});

describe("Newsletter según los permisos", () => {
  it("solo «Ver»: sin «Crear y enviar», con «Solo lectura»; suscriptores en lectura y exportables", () => {
    montar({ newsletter: { view: true } });
    expect(screen.getByRole("heading", { level: 1, name: "Newsletter" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Crear/ })).toBeNull();
    expect(screen.queryByText("Creador de prueba")).toBeNull();
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Suscriptores/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Añadir/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Importar CSV/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Acciones de ana@example.com" })).toBeNull();
    expect(screen.getByRole("button", { name: /Exportar CSV/ })).toBeEnabled();
  });

  it("solo «Ver»: los ajustes se consultan pero no se guardan", () => {
    window.history.replaceState(null, "", "/newsletter?tab=configuracion");
    montar({ newsletter: { view: true } });
    expect(screen.getByLabelText("Remitente (email)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Guardar ajustes/ })).toBeNull();
  });

  it("con «Editar»: «Crear y enviar» abierta por defecto y sin «Solo lectura»", () => {
    montar({ newsletter: { view: true, edit: true } });
    expect(screen.getByRole("tab", { name: /Crear/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Creador de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Suscriptores/ }));
    expect(screen.getByRole("button", { name: /Añadir/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acciones de ana@example.com" })).toBeInTheDocument();
  });

  it("super admin: todo, aunque no tenga la sección marcada", () => {
    montar("superAdmin");
    expect(screen.getByText("Creador de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura")).toBeNull();
  });
});
