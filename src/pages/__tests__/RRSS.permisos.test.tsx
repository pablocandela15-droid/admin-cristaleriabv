/**
 * Marketing › RRSS (/rrss) según los permisos de la sección «rrss»: con solo «Ver» desaparece «Crear», sale «Solo
 * lectura» y se abren las publicaciones (sin publicar, reintentar ni borrar); la conexión se ve pero no se cambia.
 * Con «Editar» (o siendo super admin), todo. Sin nada configurado, la conexión explica los pasos y no deja conectar.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => 640 }));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));
vi.mock("@/components/rrss/CrearPublicacion", () => ({ CrearPublicacion: () => <p>Crear de prueba</p> }));
vi.mock("@/components/rrss/MetricasRrss", () => ({ MetricasRrss: () => <p>Métricas de prueba</p> }));
vi.mock("@/components/rrss/IdeasCampanasRrss", () => ({ IdeasCampanasRrss: () => <p>Ideas de prueba</p> }));

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
const pieza = (p: Record<string, unknown>) => ({
  id: "p1", grupo_id: "g1", red: "instagram", formato: "foto", proporcion: "4:5", titulo: "Mampara baño", caption: "Mampara a medida en Elche", servicio: "mamparas",
  estado: "error", origen: "panel", campana_id: null, fecha_prevista: null, idea: null, media_id: null, permalink: null, publicada_at: null, procesando_desde: null,
  error: "Al token le faltan permisos", error_tipo: "permisos", como_arreglarlo: "Pulsa «Renovar conexión».", medios_borrados_at: null,
  created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z", rrss_medios: [], ...p,
});
const SIN_CONECTAR = {
  ok: true, modo: null, estado: "sin_conectar", conectada: false,
  configuracion: { appId: false, appSecret: false, configId: false, tokenSistema: false, igUserIdSistema: false, paginaSistema: false, ia: false, cron: false },
  faltan: ["META_APP_ID", "META_APP_SECRET"], puedeConectar: false, redirectUri: "https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth",
  versionApi: "v26.0", permisosNecesarios: [], cuenta: null, permisos: [], faltanPermisos: [],
  caducidad: { nivel: "ok", dias: null, fecha: null, texto: "La conexión no caduca.", tokenCaducaEn: null, accesoDatosCaducaEn: null },
  comprobadoEn: null, conectadoEn: null, error: null, candidatas: [], facebook: false,
};
// Datos estables entre renders (como los de React Query).
const h = vi.hoisted(() => ({
  permisos: {} as Permisos, superAdmin: false, conexion: null as unknown, piezas: [] as unknown[], programaciones: [] as unknown[], urls: {},
  ajustes: { zona: "Elche y el Baix Vinalopó", tono: "cercano", guia: "Cristalería de barrio.", hashtags_base: ["#elche"], ctas: ["Pide presupuesto"], palabras_evitar: [],
    facebook_por_defecto: false, emojis: true, aprendido_en: null, aprendido_resumen: null, version: 1, actualizado_en: "" },
}));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ role: "staff", isAdmin: false, permissions: [], loading: false }),
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({ canAccess: h.superAdmin || !!h.permisos[seccion]?.[tipo], loading: false }),
}));
const mutacion = { mutate: vi.fn(), isPending: false };
vi.mock("@/hooks/useRrss", () => ({
  useConexionRrss: () => ({ data: h.conexion, isLoading: false, isError: false, refetch: () => undefined }),
  useAccionConexion: () => mutacion,
  useIniciarConexion: () => mutacion,
  usePiezasRrss: () => ({ data: h.piezas, isLoading: false }),
  useProgramacionesRrss: () => ({ data: h.programaciones, isLoading: false }),
  usePublicarAhora: () => mutacion,
  useBorrarPieza: () => mutacion,
  useMarcarLista: () => mutacion,
  useCancelarProgramacion: () => mutacion,
  useProgramar: () => mutacion,
  useReprogramar: () => mutacion,
  useUrlsFirmadas: () => ({ data: h.urls }),
  useAjustesRrss: () => ({ data: h.ajustes, isLoading: false }),
  useGuardarAjustes: () => mutacion,
  useIARrss: () => mutacion,
}));

import RRSS from "@/pages/RRSS";

function montar(permisos: Permisos | "superAdmin") {
  h.superAdmin = permisos === "superAdmin";
  h.permisos = permisos === "superAdmin" ? {} : permisos;
  return render(<RRSS />);
}
afterEach(() => {
  h.permisos = {};
  h.superAdmin = false;
  h.conexion = SIN_CONECTAR;
  h.piezas = [];
  window.history.replaceState(null, "", "/");
});
h.conexion = SIN_CONECTAR;

describe("RRSS según los permisos", () => {
  it("solo «Ver»: sin «Crear», con «Solo lectura»; publicaciones sin acciones", () => {
    h.piezas = [pieza({})];
    montar({ rrss: { view: true } });
    expect(screen.getByRole("heading", { level: 1, name: "RRSS" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Crear/ })).toBeNull();
    expect(screen.queryByText("Crear de prueba")).toBeNull();
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Publicaciones/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Mampara baño")).toBeInTheDocument();
    expect(screen.getByText(/Al token le faltan permisos/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reintentar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Borrar" })).toBeNull();
  });

  it("con «Editar»: «Crear» abierta por defecto; en Publicaciones se puede reintentar un error", () => {
    h.piezas = [pieza({})];
    montar({ rrss: { view: true, edit: true } });
    expect(screen.getByRole("tab", { name: /^Crear/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Crear de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Publicaciones/ }));
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Borrar" })).toBeInTheDocument();
  });

  it("sin configurar: la conexión explica los pasos, enseña la URL de vuelta y no deja conectar", () => {
    window.history.replaceState(null, "", "/rrss?tab=conexion");
    montar({ rrss: { view: true, edit: true } });
    const caja = screen.getByTestId("rrss-sin-conectar");
    expect(within(caja).getByText(/no se puede publicar ni medir nada/)).toBeInTheDocument();
    expect(within(caja).getByText("https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth")).toBeInTheDocument();
    expect(within(caja).getByText("META_APP_ID, META_APP_SECRET")).toBeInTheDocument();
    expect(within(caja).getByRole("button", { name: /Conectar con Facebook/ })).toBeDisabled();
    expect(screen.getByText(/IA para los textos sin configurar/)).toBeInTheDocument();
  });

  it("conectada y a punto de caducar: lo avisa y no enseña ningún token", () => {
    h.conexion = {
      ...SIN_CONECTAR, modo: "conexion", estado: "conectada", conectada: true, puedeConectar: true, faltan: [], facebook: true,
      configuracion: { ...SIN_CONECTAR.configuracion, appId: true, appSecret: true, ia: true, cron: true },
      cuenta: { igUserId: "17841400000000001", usuario: "cristaleria_demo", nombre: null, foto: null, paginaId: "100000000000001", paginaNombre: "Cristalería demo" },
      caducidad: { nivel: "aviso", dias: 6, fecha: "2026-12-01T00:00:00Z", texto: "El acceso de la app a la cuenta caduca en 6 días (1 de diciembre de 2026). Pulsa «Renovar conexión» antes.", tokenCaducaEn: null, accesoDatosCaducaEn: "2026-12-01T00:00:00Z" },
    };
    window.history.replaceState(null, "", "/rrss?tab=conexion");
    const { container } = montar({ rrss: { view: true, edit: true } });
    expect(screen.getByText("@cristaleria_demo")).toBeInTheDocument();
    expect(screen.getByText(/Página de Facebook: Cristalería demo/)).toBeInTheDocument();
    expect(screen.getByTestId("rrss-aviso-caducidad")).toHaveTextContent(/caduca en 6 días/);
    expect(screen.getByRole("button", { name: /Renovar conexión/ })).toBeEnabled();
    expect(container.textContent).not.toMatch(/EAA|token_pagina|v1\./);
  });

  it("super admin: todo, aunque no tenga la sección marcada", () => {
    montar("superAdmin");
    expect(screen.getByText("Crear de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura")).toBeNull();
  });
});
