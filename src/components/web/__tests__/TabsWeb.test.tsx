/**
 * Pestañas de Web con los datos simulados (sin Supabase): Tarifas (editar un precio cambia «Probar» y aparece
 * «Guardar»; añadir una opción; restaurar), Fotos (lista de books, vacía y en solo lectura) y Contenido (formularios
 * con los textos de la web y guardar lo cambiado).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { mergePricing } from "@/lib/web/pricing/tarifas";

const h = vi.hoisted(() => ({
  guardarTarifas: vi.fn(),
  guardarContenido: vi.fn(),
  albumes: [] as unknown[],
  contenido: {} as Record<string, unknown>,
}));

// Como React Query: los mismos datos en cada pintado (si no, el editor se reiniciaría sin parar).
const TARIFAS = { data: { config: mergePricing(null), catalogo: {}, actualizadoEn: null }, isLoading: false, error: null, refetch: () => undefined };
const SIN_FOTOS = { data: [], isLoading: false, error: null, refetch: () => undefined };
vi.mock("@/hooks/useWebTarifas", () => ({
  useTarifasWeb: () => TARIFAS,
  useGuardarTarifas: () => ({ mutate: h.guardarTarifas, isPending: false }),
}));
vi.mock("@/hooks/useWebContenido", () => ({
  useContenidoWeb: () => ({ data: h.contenido, isLoading: false, error: null, refetch: vi.fn() }),
  useGuardarContenido: () => ({ mutate: h.guardarContenido, isPending: false }),
}));
vi.mock("@/hooks/useWebFotos", () => {
  const mut = () => ({ mutate: vi.fn(), isPending: false });
  return {
    urlFoto: (r: string) => `https://x.supabase.co/storage/v1/object/public/web-fotos/${r}`,
    useAlbumesWeb: () => ({ data: h.albumes, isLoading: false, error: null, refetch: vi.fn() }),
    useFotosWeb: () => SIN_FOTOS,
    useCambiarAlbum: mut,
    useOrdenarWeb: mut,
    useBorrarAlbum: mut,
    useGuardarAlbum: mut,
    useCambiarFoto: mut,
    useBorrarFoto: mut,
    useRefrescarFotos: () => vi.fn(),
    subirFotoWeb: vi.fn(),
  };
});

import { TabTarifas } from "@/components/web/tarifas/TabTarifas";
import { TabFotos } from "@/components/web/fotos/TabFotos";
import { TabContenido } from "@/components/web/contenido/TabContenido";

afterEach(() => {
  h.guardarTarifas.mockReset();
  h.guardarContenido.mockReset();
  h.albumes = [];
  h.contenido = {};
});

// El editor de tarifas pinta muchos campos: con la suite completa en paralelo tarda más de los 5 s de serie.
describe("Web › Tarifas", { timeout: 20_000 }, () => {
  it("cambiar el precio base de la mampara se ve al momento en «Probar» y deja guardar", () => {
    render(<TabTarifas puedeEditar />);
    expect(screen.getByRole("tab", { name: /Mampara a medida/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/1 = sin recargo/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Ancho/), { target: { value: "100" } });
    expect(screen.getByTestId("total-calculo")).toHaveTextContent("500 €");
    fireEvent.change(screen.getByLabelText("Precio base de la mampara"), { target: { value: "250" } });
    expect(screen.getByTestId("total-calculo")).toHaveTextContent("550 €");
    fireEvent.click(screen.getByRole("button", { name: /Guardar tarifas/ }));
    expect(h.guardarTarifas).toHaveBeenCalledTimes(1);
    expect(h.guardarTarifas.mock.calls[0][0].config.mamparas.base).toBe(250);
  });

  it("añadir una forma al espejo con su multiplicador", () => {
    render(<TabTarifas puedeEditar />);
    fireEvent.click(screen.getByRole("tab", { name: /Espejo a medida/ }));
    // Cada campo va plegado: se abre el de «Forma».
    fireEvent.click(screen.getByRole("button", { name: /^Forma/ }));
    const forma = screen.getByLabelText("Nueva opción de Forma");
    fireEvent.change(forma, { target: { value: "Hexagonal" } });
    fireEvent.keyDown(forma, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Guardar tarifas/ }));
    const guardado = h.guardarTarifas.mock.calls[0][0];
    expect(guardado.config.espejos.factors.forma.hexagonal).toBe(1);
    expect(guardado.catalogo.categorias.espejos.campos.forma.opciones.at(-1)).toEqual({ value: "hexagonal", label: "Hexagonal" });
  });

  it("en solo lectura no hay barra de guardar y los precios no se tocan", () => {
    render(<TabTarifas puedeEditar={false} />);
    expect(screen.getByLabelText("Precio base de la mampara")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Restaurar valores por defecto/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Guardar tarifas/ })).toBeNull();
  });
});

describe("Web › Fotos", () => {
  it("sin books: lo dice y explica qué hace la web", () => {
    render(<TabFotos puedeEditar />);
    expect(screen.getByText("Aún no hay ningún book.")).toBeInTheDocument();
    expect(screen.getByText(/galería de siempre/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nuevo book/ })).toBeInTheDocument();
  });

  it("lista de books con portada, fotos, servicio y publicado", () => {
    h.albumes = [
      { id: "a1", slug: "mamparas-elche", titulo: "Mamparas en Elche", descripcion: null, servicio: "mamparas", portada_foto_id: null, orden: 0, publicado: true, creado_en: "", totalFotos: 3, portadaRuta: "albumes/a1/x.webp" },
      { id: "a2", slug: "obra", titulo: "Obra sin fotos", descripcion: null, servicio: null, portada_foto_id: null, orden: 1, publicado: false, creado_en: "", totalFotos: 0, portadaRuta: null },
    ];
    render(<TabFotos puedeEditar={false} />);
    const lista = screen.getByRole("list", { name: "Books de fotos" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("3 fotos")).toBeInTheDocument();
    expect(screen.getByText("Mamparas")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Publicar Mamparas en Elche" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Nuevo book/ })).toBeNull();
    expect(screen.getByText(/el book publicado/)).toBeInTheDocument();
  });
});

describe("Web › Contenido", () => {
  it("datos del negocio: cambia el lema y guarda solo lo que tiene valor", () => {
    h.contenido = { negocio: { tagline: "Especialistas", phones: [{ label: "Oficina", display: "650 06 63 23", tel: "+34650066323" }] }, servicios: {}, faq: [], imagenes: {} };
    render(<TabContenido puedeEditar />);
    fireEvent.change(screen.getByLabelText("Lema"), { target: { value: "Cristal con oficio" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar datos del negocio/ }));
    expect(h.guardarContenido).toHaveBeenCalledWith({
      clave: "negocio",
      valor: { tagline: "Cristal con oficio", phones: [{ label: "Oficina", display: "650 06 63 23", tel: "+34650066323" }] },
    });
  });

  it("imágenes: enseña la de la web mientras no se elija otra", () => {
    h.contenido = { negocio: {}, servicios: {}, faq: [], imagenes: { contact: { ruta: "sueltas/c.webp", alt: "Contacto" } } };
    render(<TabContenido puedeEditar />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Imágenes de la web/ }));
    expect(screen.getAllByText("La de la web")).toHaveLength(4);
    expect(screen.getByText("Elegida")).toBeInTheDocument();
    expect(screen.getByAltText("Contacto")).toHaveAttribute("src", expect.stringContaining("/web-fotos/sueltas/c.webp"));
  });
});
