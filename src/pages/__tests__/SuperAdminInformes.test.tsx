import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoInformeTabla } from "@/lib/informes/tabla";

vi.setConfig({ testTimeout: 15_000 });

const estado = vi.hoisted(() => ({
  superAdmin: true,
  cargando: false,
  permisos: [] as { section_key: string; can_view: boolean; can_edit: boolean }[],
  servicios: vi.fn(),
  auditoria: vi.fn(),
  descargas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/SuperAdminLayout", () => ({ SuperAdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: estado.superAdmin, loading: estado.cargando }) }));
vi.mock("@/hooks/useUserRole", async (original) => ({
  ...(await original<typeof import("@/hooks/useUserRole")>()),
  useUserRole: () => ({ permissions: estado.permisos, loading: estado.cargando, role: null, isAdmin: false }),
}));
vi.mock("@/components/informes/diapositivas/fuente", () => ({ prepararFuenteInforme: () => Promise.resolve(), cssFuenteEmbebida: () => Promise.resolve(null) }));
vi.mock("@/components/informes/diapositivas/pdf", () => ({
  descargarBlob: (_b: Blob, nombre: string) => estado.descargas.push(nombre),
  descargarPdfInforme: vi.fn(),
}));
// Las dos fuentes del registro (costes de Servicios y auditoría): se prueban aparte con sus datos.
vi.mock("@/lib/informes/fuentes/servicios", () => ({ obtenerInformeServicios: (...a: unknown[]) => estado.servicios(...a) }));
vi.mock("@/lib/informes/fuentes/auditoria", () => ({ obtenerInformeAuditoria: (...a: unknown[]) => estado.auditoria(...a) }));

import SuperAdminInformes from "../SuperAdminInformes";

let ubicacion = "";
function Ubicacion() {
  const l = useLocation();
  ubicacion = `${l.pathname}${l.search}`;
  return null;
}

function pintar(ruta = "/super-admin/informes") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ruta]}>
        <SuperAdminInformes />
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const informeCostes: ResultadoInformeTabla = {
  vacio: false,
  titulo: "Gasto por servicio",
  descripcion: "Lo que ha costado cada servicio en el mes.",
  textoPeriodo: "Octubre de 2026",
  tablas: [
    {
      titulo: "Gasto por servicio",
      columnas: [
        { id: "nombre", etiqueta: "Servicio", tipo: "texto" },
        { id: "valor", etiqueta: "Coste", tipo: "eur" },
      ],
      filas: [{ nombre: "OpenAI", valor: 12 }],
      total: { nombre: "Total", valor: 12 },
    },
  ],
  nombreArchivo: "informe-mensual-de-costes-2026-10",
};

// Solo se finge la fecha (no los temporizadores): «hoy» es el 18/11/2026 y el mes por defecto, octubre.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T12:00:00"));
  // Radix Select en jsdom.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  estado.superAdmin = true;
  estado.cargando = false;
  estado.permisos = [];
  estado.descargas = [];
  estado.servicios = vi.fn(async () => informeCostes);
  estado.auditoria = vi.fn(async () => informeCostes);
});

describe("Super Admin › Informes", () => {
  it("lista todos los informes por sección y pide elegir uno", () => {
    pintar();
    const lista = screen.getByRole("navigation", { name: "Informes disponibles" });
    expect(within(lista).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Servicios", "Seguridad"]);
    expect(within(lista).getByRole("button", { name: /Informe mensual de costes/ })).toBeInTheDocument();
    expect(within(lista).getByRole("button", { name: /Informe mensual de auditoría/ })).toBeInTheDocument();
    expect(screen.getByText("Elige un informe")).toBeInTheDocument();
  });

  it("mientras se leen los permisos, esqueletos", () => {
    estado.cargando = true;
    pintar();
    expect(screen.getByLabelText("Cargando informes")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Informes disponibles" })).not.toBeInTheDocument();
  });

  it("sin permiso en ninguna sección: estado vacío", () => {
    estado.superAdmin = false;
    pintar();
    expect(screen.getByText("No tienes informes disponibles")).toBeInTheDocument();
    expect(screen.queryByText("Elige un informe")).not.toBeInTheDocument();
  });

  it("los informes del Super Admin no salen con permisos de sección (y la URL no se lo salta)", () => {
    estado.superAdmin = false;
    estado.permisos = [
      { section_key: "dashboard", can_view: true, can_edit: true },
      { section_key: "usuarios", can_view: true, can_edit: true },
    ];
    pintar("/super-admin/informes?informe=servicios-mensual");
    expect(screen.getByText("No tienes informes disponibles")).toBeInTheDocument();
    expect(screen.queryByTestId("vista-informe")).not.toBeInTheDocument();
    expect(estado.servicios).not.toHaveBeenCalled();
  });

  it("un informe de tabla: mes en la URL, vista previa en diapositivas y descarga en CSV", async () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: /Informe mensual de costes/ }));
    expect(ubicacion).toMatch(/informe=servicios-mensual/);
    const vista = await screen.findByTestId("vista-informe");
    // Portada y una diapositiva con la tabla.
    await waitFor(() => expect(within(vista).getAllByTestId(/^diapositiva-/)).toHaveLength(2));
    expect(within(vista).getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Informe mensual de costes", level: 2 }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Servicios › Costes" })).toHaveAttribute("href", "/super-admin/servicios");
    // Por defecto, el último mes cerrado.
    expect(estado.servicios.mock.calls[0][0]).toEqual({ tipo: "mes", mes: "2026-10" });
    expect(screen.getByRole("combobox", { name: "Mes del informe" })).toHaveTextContent("Octubre de 2026");
    fireEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(estado.descargas).toEqual(["informe-mensual-de-costes-2026-10.csv"]);
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
  });

  it("toma el mes de la URL y lo vuelve a pedir al cambiarlo", async () => {
    pintar("/super-admin/informes?informe=auditoria-mensual&mes=2026-09");
    await screen.findByTestId("vista-informe");
    await waitFor(() => expect(estado.auditoria).toHaveBeenCalled());
    expect(estado.auditoria.mock.calls[0][0]).toEqual({ tipo: "mes", mes: "2026-09" });
    expect(estado.servicios).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Super Admin › Auditoría" })).toHaveAttribute("href", "/super-admin/auditoria");
    const selector = screen.getByRole("combobox", { name: "Mes del informe" });
    expect(selector).toHaveTextContent("Septiembre de 2026");
    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole("option", { name: "Agosto de 2026" }));
    await waitFor(() => expect(ubicacion).toMatch(/mes=2026-08/));
    await waitFor(() => expect(estado.auditoria.mock.calls.at(-1)![0]).toEqual({ tipo: "mes", mes: "2026-08" }));
  });

  it("un mes de la URL fuera de la lista se cambia por el de por defecto", async () => {
    pintar("/super-admin/informes?informe=auditoria-mensual&mes=2020-01");
    await waitFor(() => expect(estado.auditoria).toHaveBeenCalled());
    expect(estado.auditoria.mock.calls[0][0]).toEqual({ tipo: "mes", mes: "2026-10" });
  });

  it("si falla la lectura: error con «Reintentar»", async () => {
    estado.servicios = vi.fn(async () => {
      throw new Error("sin conexión");
    });
    pintar("/super-admin/informes?informe=servicios-mensual");
    expect(await screen.findByText(/No se han podido cargar los datos del informe/)).toBeInTheDocument();
    estado.servicios = vi.fn(async () => informeCostes);
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
  });

  it("sin datos: lo dice y por qué", async () => {
    estado.auditoria = vi.fn(async () => ({ vacio: true as const, motivo: "Nadie ha usado el panel este mes." }));
    pintar("/super-admin/informes?informe=auditoria-mensual");
    expect(await screen.findByText("No hay datos para este informe")).toBeInTheDocument();
    expect(screen.getByText(/Nadie ha usado el panel este mes\./)).toHaveTextContent("Prueba con otro periodo.");
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
  });

  it("«Todos los informes» vuelve a la lista (móvil)", async () => {
    pintar("/super-admin/informes?informe=servicios-mensual");
    await screen.findByTestId("vista-informe");
    fireEvent.click(screen.getByRole("button", { name: "Todos los informes" }));
    expect(ubicacion).toBe("/super-admin/informes");
  });
});
