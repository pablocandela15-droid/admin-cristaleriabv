// Páginas «Peticiones» (usuarios) y Super Admin › Tickets: la página de origen propone el módulo, pestañas
// «Nueva petición» / «Mis peticiones», y el enlace del aviso (?ticket=<id>) abre la ficha.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Peticion } from "@/lib/peticiones";

const h = vi.hoisted(() => ({ mias: vi.fn(), tickets: vi.fn(), analizar: vi.fn(), enAnalisis: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/SuperAdminLayout", () => ({ SuperAdminLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
// El tour guiado se prueba aparte (useTourSeccion.test.tsx): aquí, solo que está su botón «?».
const lanzarTour = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTourSeccion", () => ({ useTourSeccion: () => ({ lanzar: lanzarTour }) }));
vi.mock("@/lib/peticiones", () => ({
  leerMisPeticiones: h.mias,
  leerTickets: h.tickets,
  pedirAnalisis: h.analizar,
  marcarEnAnalisis: h.enAnalisis,
  crearPeticion: vi.fn(),
  cambiarEstadoPeticion: vi.fn(),
  urlCaptura: vi.fn(),
}));

import Peticiones from "../Peticiones";
import SuperAdminTickets from "../SuperAdminTickets";

const TICKET: Peticion = {
  id: "t-1", creado_por: "u-2", creado_por_nombre: "Ana Sala", creado_por_email: "ana@t", titulo: "No se guarda el usuario",
  prioridad: "urgente", modulo: "usuarios", descripcion: "Al pulsar Guardar no pasa nada.", captura_path: null, ruta: "/usuarios",
  dispositivo: null, estado: "en_analisis", motivo_descarte: null, estado_cambiado_en: null, analisis: null, analisis_estado: "error",
  analisis_error: "OpenAI respondió 500", analisis_modelo: null, analizado_en: null, linear_id: null, linear_url: null,
  created_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z",
};

function pintar(ui: ReactNode, entrada: Parameters<typeof MemoryRouter>[0]["initialEntries"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entrada}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.mias.mockResolvedValue([]);
  h.tickets.mockResolvedValue([TICKET]);
  h.analizar.mockResolvedValue({ ok: true });
  h.enAnalisis.mockResolvedValue(false);
});

describe("Peticiones", () => {
  it("abierta desde Usuarios propone «Usuarios y permisos»; «Mis peticiones» en su pestaña", async () => {
    pintar(<Peticiones />, [{ pathname: "/peticiones", state: { desde: "/usuarios?tab=lista" } }]);
    expect((screen.getByLabelText("Módulo afectado") as HTMLSelectElement).value).toBe("usuarios");
    expect(screen.getByText("/usuarios")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Mis peticiones/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Mis peticiones/ }));
    expect(await screen.findByTestId("sin-peticiones")).toBeInTheDocument();
    expect(h.mias).toHaveBeenCalledWith("u-1");
  });

  it("sin página de origen (entrada directa) no propone módulo", () => {
    pintar(<Peticiones />, ["/peticiones"]);
    expect((screen.getByLabelText("Módulo afectado") as HTMLSelectElement).value).toBe("");
  });

  it("abierta desde una página que no es de ningún módulo (Super Admin › Servicios) tampoco propone ninguno", () => {
    pintar(<Peticiones />, [{ pathname: "/peticiones", state: { desde: "/super-admin/servicios" } }]);
    expect((screen.getByLabelText("Módulo afectado") as HTMLSelectElement).value).toBe("");
  });

  it("lleva el botón «?» de su tour y las marcas de las pestañas que recorre", () => {
    pintar(<Peticiones />, ["/peticiones"]);
    const boton = screen.getByRole("button", { name: "Ayuda: ver cómo funciona esta pantalla" });
    expect(boton).toHaveAttribute("data-tour", "boton-ayuda");
    fireEvent.click(boton);
    expect(lanzarTour).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: /Nueva petición|Nueva/ })).toHaveAttribute("data-tour", "peticiones-pestana-nueva");
    expect(screen.getByRole("tab", { name: /Mis peticiones/ })).toHaveAttribute("data-tour", "peticiones-pestana-mias");
  });
});

describe("SuperAdminTickets", () => {
  it("lista los tickets y el enlace del aviso (?ticket=) abre su ficha", async () => {
    pintar(<SuperAdminTickets />, ["/super-admin/tickets?ticket=t-1"]);
    expect(await screen.findByTestId("detalle-ticket")).toBeInTheDocument();
    expect(screen.getAllByText("No se guarda el usuario").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("analisis-error")).toHaveTextContent("OpenAI respondió 500");
    // Ya tiene análisis (fallido): al abrirla no se vuelve a lanzar sola.
    await waitFor(() => expect(h.tickets).toHaveBeenCalled());
    expect(h.analizar).not.toHaveBeenCalled();
  });
});
