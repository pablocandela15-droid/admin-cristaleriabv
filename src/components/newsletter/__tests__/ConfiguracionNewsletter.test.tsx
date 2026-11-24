/**
 * Newsletter › Configuración: la lista de lo que falta (sin enseñar nunca el valor de un secreto) y los ajustes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Datos estables entre renders (como los de React Query): el formulario se rellena con un efecto sobre ellos.
const h = vi.hoisted(() => ({
  guardar: vi.fn(),
  estado: null as unknown,
  config: { remitente_email: null, remitente_nombre: "Cristalería BV", responder_a: null, canal: "transaccional", email_prueba: null, limite_transaccional: 100, web_url: "https://cristaleriabv.vercel.app", actualizado_en: null },
}));
vi.mock("@/hooks/useNewsletter", () => ({
  useNewsletterConfig: () => ({ data: h.config, isLoading: false }),
  useEstadoNewsletter: () => ({ data: h.estado, isLoading: false, isError: !h.estado }),
  useGuardarConfigNewsletter: () => ({ mutate: h.guardar, isPending: false }),
}));

import { ConfiguracionNewsletter } from "../ConfiguracionNewsletter";

beforeEach(() => {
  h.guardar.mockReset();
  h.estado = {
    canal: "transaccional", faltan: ["Clave de Resend (RESEND_API_KEY)", "Remitente"],
    configurado: { api_key: false, webhook_secret: false, remitente: false, ia: true, cron_secret: true, segment_id: null },
    url_webhook: "https://demo.supabase.co/functions/v1/resend-webhook",
  };
});

describe("ConfiguracionNewsletter", () => {
  it("marca qué falta y da la dirección del webhook", () => {
    render(<ConfiguracionNewsletter puedeEditar />);
    expect(screen.getByText(/Todavía falta algo/)).toBeInTheDocument();
    expect(screen.getByTestId("config-api_key")).toHaveAttribute("data-ok", "no");
    expect(screen.getByTestId("config-remitente")).toHaveAttribute("data-ok", "no");
    expect(screen.getByTestId("config-webhook_secret")).toHaveTextContent("https://demo.supabase.co/functions/v1/resend-webhook");
    expect(screen.getByTestId("config-ia")).toHaveAttribute("data-ok", "si");
    expect(screen.queryByTestId("config-segment")).toBeNull();
  });

  it("si no se puede comprobar (funciones sin desplegar), lo dice", () => {
    h.estado = null;
    render(<ConfiguracionNewsletter puedeEditar />);
    expect(screen.getByText(/falta desplegar las funciones/)).toBeInTheDocument();
  });

  it("guarda el remitente y los ajustes con «Editar»", () => {
    render(<ConfiguracionNewsletter puedeEditar />);
    fireEvent.change(screen.getByLabelText("Remitente (email)"), { target: { value: "novedades@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar ajustes/ }));
    expect(h.guardar).toHaveBeenCalledWith(expect.objectContaining({ remitente_email: "novedades@example.com", canal: "transaccional", limite_transaccional: 100 }));
  });
});
