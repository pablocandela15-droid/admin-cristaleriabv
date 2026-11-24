/**
 * Newsletter › Crear y enviar. Lo importante: sin la configuración del envío (clave de Resend, remitente) no se puede
 * enviar ni probar y se dice qué falta; sin la clave de OpenAI «Crear con IA» sale desactivado y se explica; la IA
 * solo propone; enviar pide confirmación avisando de los huecos; la vista previa se ve como en el móvil.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  prueba: vi.fn(),
  guardar: vi.fn(),
  borrar: vi.fn(),
  ia: vi.fn(),
  estado: null as unknown,
  suscriptores: [] as unknown[],
}));

const ESTADO_LISTO = {
  success: true, canal: "transaccional", faltan: [],
  configurado: { api_key: true, webhook_secret: true, remitente: true, ia: true, cron_secret: true, segment_id: null },
  limite_contactos: 1000, contactos_resend: null, nivel_cuota: "ok", ultima_pasada: null, ultima_terminada: null, url_webhook: "https://x.supabase.co/functions/v1/resend-webhook",
};

vi.mock("@/hooks/useNewsletter", () => ({
  useNewsletterSuscriptores: () => ({ data: h.suscriptores }),
  useEstadoNewsletter: () => ({ data: h.estado, isLoading: false, isError: false }),
  useNewsletterConfig: () => ({ data: { canal: "transaccional", email_prueba: "pruebas@example.com", web_url: "https://cristaleriabv.vercel.app" } }),
  useEnviarNewsletter: () => ({ mutate: h.enviar, isPending: false }),
  useEnviarPruebaNewsletter: () => ({ mutate: h.prueba, isPending: false }),
}));
vi.mock("@/hooks/useNewsletterPlantillas", () => ({
  useNewsletterPlantillas: () => ({ plantillas: [], disponible: true, cargando: false }),
  useGuardarPlantillaNewsletter: () => ({ mutate: h.guardar, isPending: false }),
  useBorrarPlantillaNewsletter: () => ({ mutate: h.borrar, isPending: false }),
  useCrearNewsletterIA: () => ({ mutate: h.ia, isPending: false }),
  useGaleriaImagenes: () => ({ data: [], isLoading: false }),
  useNegocioNewsletter: () => ({ data: undefined }),
}));
vi.mock("../SelectorImagenGaleria", () => ({ SelectorImagenGaleria: ({ etiqueta }: { etiqueta?: string }): ReactNode => <p>{etiqueta}</p> }));

import { CreadorNewsletter } from "../CreadorNewsletter";

const vistaPrevia = () => document.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
const activo = (id: string) => ({ id, email: `s${id}@example.com`, nombre: null, estado: "activo", origen_alta: "web_formulario" });
const pintar = (props: { onIrAConfiguracion?: () => void } = {}) => render(<TooltipProvider><CreadorNewsletter {...props} /></TooltipProvider>);

beforeEach(() => {
  for (const f of [h.enviar, h.prueba, h.guardar, h.borrar, h.ia]) f.mockReset();
  h.estado = ESTADO_LISTO;
  h.suscriptores = [activo("1"), activo("2"), { ...activo("3"), estado: "pendiente" }];
});

describe("CreadorNewsletter", () => {
  it("plantillas de cristalería (nada de restaurante); sin elegir no se envía; envía solo a los confirmados", () => {
    pintar();
    const nombres = within(screen.getByRole("radiogroup", { name: "Plantilla" })).getAllByRole("radio").map((r) => r.textContent);
    expect(nombres).toEqual(["Novedades", "Oferta", "Temporada", "Trabajos", "Consejos", "Aviso", "En blanco"]);
    expect(document.body.textContent).not.toMatch(/men[uú]|reserva|mesa|plato/i);
    expect(screen.getByRole("button", { name: /Enviar a 2 suscriptores/ })).toBeDisabled();
    expect(screen.queryByTestId("newsletter-falta-configurar")).toBeNull();
  });

  it("al elegir una plantilla se carga en el editor y en la vista previa, con el pie de baja; se ve como en el móvil", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /^Temporada/ }));
    expect(screen.getByLabelText("Asunto")).toHaveValue("Prepara tu casa para la nueva temporada");
    expect(vistaPrevia()).toContain("Prepara tu casa para la nueva temporada");
    expect(vistaPrevia()).toContain('data-pie-baja="obligatorio"');
    expect(vistaPrevia()).toContain("/newsletter/baja?t=prueba");
    const primerTexto = screen.getAllByLabelText(/Texto/)[0];
    fireEvent.change(primerTexto, { target: { value: "Cerramos la terraza antes del frío." } });
    expect(vistaPrevia()).toContain("Cerramos la terraza antes del frío.");
    expect(screen.getByTitle("Vista previa del email")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Móvil" }));
    expect(screen.getByTitle("Vista previa del email en el móvil").className).toContain("w-[375px]");
  });

  it("enviar pide confirmación, avisa de huecos y manda bloques, versión de texto y una clave de envío", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /^Temporada/ }));
    fireEvent.click(screen.getByRole("button", { name: /Enviar a 2 suscriptores/ }));
    expect(h.enviar).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText(/Quedan huecos sin completar/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Sí, enviar/ }));
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const { newsletter, clave } = h.enviar.mock.calls[0][0];
    expect(newsletter.tipo).toBe("temporada");
    expect(newsletter.bloques.length).toBeGreaterThan(2);
    expect(newsletter.mensaje).toContain("Con el cambio de estación");
    expect(clave).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("la prueba va solo a quien la pide (y a la dirección de pruebas), sin confirmación", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /^Aviso/ }));
    expect(screen.getByText(/y a pruebas@example.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviar prueba a mi correo/ }));
    expect(h.prueba).toHaveBeenCalledTimes(1);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("sin la clave de Resend o el remitente: dice qué falta y no deja enviar ni probar (sí preparar)", () => {
    const irAConfig = vi.fn();
    h.estado = { ...ESTADO_LISTO, faltan: ["Clave de Resend (RESEND_API_KEY)", "Remitente"], configurado: { ...ESTADO_LISTO.configurado, api_key: false, remitente: false } };
    pintar({ onIrAConfiguracion: irAConfig });
    const aviso = screen.getByTestId("newsletter-falta-configurar");
    expect(within(aviso).getByText("Clave de Resend (RESEND_API_KEY)")).toBeInTheDocument();
    fireEvent.click(within(aviso).getByRole("button", { name: "Ver la configuración" }));
    expect(irAConfig).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /^Oferta/ }));
    expect(screen.getByRole("button", { name: /Enviar a 2 suscriptores/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enviar prueba/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Guardar como plantilla/ })).toBeEnabled();
  });

  it("sin la clave de OpenAI «Crear con IA» sale desactivado y lo explica", () => {
    h.estado = { ...ESTADO_LISTO, configurado: { ...ESTADO_LISTO.configurado, ia: false } };
    pintar();
    expect(screen.getByRole("button", { name: /Crear con IA/ })).toBeDisabled();
    expect(screen.getByTestId("newsletter-ia-desactivada")).toHaveTextContent(/OPENAI_API_KEY/);
    expect(screen.queryByTestId("newsletter-falta-configurar")).toBeNull();
  });

  it("«Crear con IA» carga la propuesta para revisarla y NO envía nada", async () => {
    h.ia.mockImplementation((_p, opts) =>
      opts.onSuccess({
        propuesta: { tipo: "oferta", titulo: "Mamparas con descuento", insignia: "Oferta", preheader: "Solo este mes", bloques: [{ tipo: "texto", texto: "Un [porcentaje] menos en mamparas." }] },
        avisos: ["Falta completar: porcentaje."],
        modelo: "m",
      }),
    );
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Crear con IA/ }));
    const redactar = screen.getByRole("button", { name: /Redactar con IA/ });
    expect(redactar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("¿Qué quieres contar?"), { target: { value: "Descuento en mamparas de baño este mes" } });
    fireEvent.click(redactar);
    expect(h.ia).toHaveBeenCalledTimes(1);
    expect(h.ia.mock.calls[0][0]).toMatchObject({ descripcion: "Descuento en mamparas de baño este mes", tono: "cercano" });
    await waitFor(() => expect(screen.getByText("Propuesta de la IA cargada")).toBeInTheDocument());
    expect(screen.getByText("Falta completar: porcentaje.")).toBeInTheDocument();
    expect(screen.getByLabelText("Asunto")).toHaveValue("Mamparas con descuento");
    expect(vistaPrevia()).toContain("Un [porcentaje] menos en mamparas.");
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.prueba).not.toHaveBeenCalled();
  });

  it("un bloque vacío bloquea el envío y dice por qué", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /^En blanco/ }));
    fireEvent.change(screen.getByLabelText("Asunto"), { target: { value: "Hola" } });
    expect(screen.getByText(/está vacío/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar a 2 suscriptores/ })).toBeDisabled();
  });
});
