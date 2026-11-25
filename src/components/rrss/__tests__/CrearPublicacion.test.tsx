/**
 * RRSS › Crear: sin conexión deja preparar pero no publicar ni programar; lo que falta sale en llano; las historias
 * solo van a Instagram; la IA desactivada se explica; las fotos de Web › Fotos se añaden y llevan su texto
 * alternativo; con todo listo se guarda el grupo (una pieza por red) y se publica.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  conexion: null as unknown,
  guardadas: [] as unknown[],
  publicadas: [] as unknown[],
  fotos: [{ id: "f1", ruta: "albumes/a/1.webp", titulo: null, alt: "Mampara de ducha fija", ancho: 1600, alto: 1200, servicio: "mamparas", album: "Mamparas", visible_en_web: true, creado_en: "" }],
  urls: {},
  ajustes: { facebook_por_defecto: false },
  piezas: [] as unknown[],
}));
const CONECTADA = {
  conectada: true, facebook: true, cuenta: { usuario: "cristaleria_demo", paginaNombre: "Cristalería demo" }, configuracion: { ia: false },
};
vi.mock("@/hooks/useRrss", () => ({
  useConexionRrss: () => ({ data: h.conexion }),
  useAjustesRrss: () => ({ data: h.ajustes }),
  usePiezasRrss: () => ({ data: h.piezas }),
  useUrlsFirmadas: () => ({ data: h.urls }),
  useFotosWeb: () => ({ data: h.fotos, isLoading: false, isError: false }),
  urlFotoWeb: (r: string) => `https://ejemplo.supabase.co/storage/v1/object/public/web-fotos/${r}`,
  subirFichero: vi.fn(async () => "subidas/00000000-0000-4000-8000-000000000009/00000000-0000-4000-8000-000000000001.jpg"),
  useGuardarGrupo: () => ({
    isPending: false,
    mutateAsync: async (d: { redes: string[] }) => {
      h.guardadas.push(d);
      return d.redes.map((red, i) => ({ id: `p${i}`, grupo_id: "g1", red }));
    },
  }),
  usePublicarAhora: () => ({
    isPending: false,
    mutateAsync: async (ids: string[]) => {
      h.publicadas.push(ids);
      return { ok: true, resultados: ids.map((id) => ({ piezaId: id, red: "instagram", estado: "publicada", permalink: "https://www.instagram.com/p/a/" })) };
    },
  }),
  useIARrss: () => ({ mutate: vi.fn(), isPending: false }),
  useProgramar: () => ({ mutate: vi.fn(), isPending: false }),
  useReprogramar: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/rrss/imagen", async (original) => ({
  ...(await original<typeof import("@/lib/rrss/imagen")>()),
  recortarAJpeg: vi.fn(async () => ({ blob: new Blob(["x"], { type: "image/jpeg" }), ancho: 1080, alto: 1350 })),
}));

import { CrearPublicacion } from "../CrearPublicacion";

afterEach(() => {
  h.conexion = null;
  h.guardadas = [];
  h.publicadas = [];
});

describe("RRSS › Crear", () => {
  it("sin conexión: se puede preparar, pero no publicar ni programar, y dice qué falta", () => {
    h.conexion = { conectada: false, facebook: false, cuenta: null, configuracion: { ia: false } };
    render(<CrearPublicacion puedeEditar />);
    expect(screen.getByText(/aún no está conectado con Instagram/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publicar ahora/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Programar/ })).toBeDisabled();
    expect(within(screen.getByTestId("rrss-problemas")).getByText(/Una foto necesita exactamente una imagen/)).toBeInTheDocument();
  });

  it("las historias solo van a Instagram y no llevan texto", () => {
    h.conexion = CONECTADA;
    render(<CrearPublicacion puedeEditar />);
    fireEvent.click(screen.getByRole("radio", { name: "Historia" }));
    expect(screen.getByRole("checkbox", { name: /Facebook/ })).toBeDisabled();
    expect(screen.getByText("Las historias solo se publican en Instagram.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Texto")).toBeNull();
  });

  it("sin la clave de OpenAI, la ayuda de la IA lo explica", () => {
    h.conexion = CONECTADA;
    render(<CrearPublicacion puedeEditar />);
    fireEvent.click(screen.getByRole("button", { name: /Ayuda de la IA/ }));
    expect(screen.getByTestId("rrss-ia-no-disponible")).toHaveTextContent(/OPENAI_API_KEY/);
  });

  it("con una foto de Web › Fotos y texto: guarda una pieza por red y publica", async () => {
    h.conexion = CONECTADA;
    render(<CrearPublicacion puedeEditar />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Facebook/ }));
    fireEvent.click(screen.getByRole("button", { name: /Elegir de Web › Fotos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mampara de ducha fija" }));
    fireEvent.click(screen.getByRole("button", { name: /Añadir/ }));
    expect(screen.getByDisplayValue("Mampara de ducha fija")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Mampara fija en un baño de Elche. #mamparas" } });
    expect(screen.queryByTestId("rrss-problemas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Publicar ahora/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(h.publicadas).toEqual([["p0", "p1"]]));
    expect(h.guardadas[0]).toMatchObject({ redes: ["instagram", "facebook"], formato: "foto", proporcion: "4:5", servicio: "mamparas", estado: "lista" });
    expect((h.guardadas[0] as { medios: unknown[] }).medios[0]).toMatchObject({ tipo: "imagen", origen: "web_fotos", web_foto_id: "f1", alt_text: "Mampara de ducha fija", ancho: 1080, alto: 1350 });
    expect(await screen.findByTestId("rrss-resultados")).toHaveTextContent("Publicada");
  });
});
