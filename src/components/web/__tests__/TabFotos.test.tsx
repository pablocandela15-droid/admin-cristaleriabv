/**
 * Web › Fotos por tipo de trabajo, con los datos simulados (sin Supabase): un apartado por tipo en el orden de la
 * web, abrir uno y ver sus fotos (también las de books antiguos de ese tipo), ★ inicio, ocultar y ordenar, subir
 * directamente a un tipo (creando su book si aún no existe), «Otros books» con los books hechos a mano, y solo
 * lectura.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  albumes: [] as unknown[],
  fotos: [] as unknown[],
  cambiarFoto: vi.fn(),
  ordenar: vi.fn(),
  subir: vi.fn(),
  asegurar: vi.fn(),
}));

vi.mock("@/hooks/useWebFotos", () => {
  const mut = () => ({ mutate: vi.fn(), isPending: false });
  return {
    urlFoto: (r: string) => `https://x.supabase.co/storage/v1/object/public/web-fotos/${r}`,
    useAlbumesWeb: () => ({ data: h.albumes, isLoading: false, error: null, refetch: vi.fn() }),
    useFotosWeb: () => ({ data: h.fotos, isLoading: false, error: null, refetch: vi.fn() }),
    useCambiarAlbum: mut,
    useOrdenarWeb: () => ({ mutate: h.ordenar, isPending: false }),
    useBorrarAlbum: mut,
    useGuardarAlbum: mut,
    useCambiarFoto: () => ({ mutate: h.cambiarFoto, isPending: false }),
    useBorrarFoto: mut,
    useRefrescarFotos: () => vi.fn(),
    subirFotoWeb: h.subir,
    asegurarAlbumTipo: h.asegurar,
  };
});

import { TabFotos } from "@/components/web/fotos/TabFotos";

const album = (id: string, slug: string, titulo: string, servicio: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  slug,
  titulo,
  descripcion: null,
  servicio,
  portada_foto_id: null,
  orden: 0,
  publicado: true,
  creado_en: "2026-11-24T09:00:00Z",
  totalFotos: 0,
  portadaRuta: null,
  ...extra,
});
const foto = (id: string, album_id: string | null, orden: number, extra: Record<string, unknown> = {}) => ({
  id,
  album_id,
  ruta: album_id ? `albumes/${album_id}/${id}.webp` : `sueltas/${id}.webp`,
  titulo: null,
  alt: id,
  ancho: 1600,
  alto: 1200,
  orden,
  publicado: true,
  destacada: false,
  creado_en: "2026-11-24T10:00:00Z",
  ...extra,
});

function conDatos() {
  h.albumes = [
    album("viejo", "mamparas-elche", "Mamparas en Elche", "mamparas", { orden: 0, publicado: false, totalFotos: 1 }),
    album("obra", "obra-casa", "Obra en Crevillente", null, { orden: 1, totalFotos: 1 }),
    album("tipo-m", "trabajos-mamparas", "Mamparas", "mamparas", { orden: 2, totalFotos: 2 }),
  ];
  h.fotos = [foto("m2", "tipo-m", 2, { destacada: true }), foto("m0", "tipo-m", 0), foto("v1", "viejo", 1), foto("o0", "obra", 0), foto("s0", null, 0)];
}

afterEach(() => {
  h.albumes = [];
  h.fotos = [];
  h.cambiarFoto.mockReset();
  h.ordenar.mockReset();
  h.subir.mockReset();
  h.asegurar.mockReset();
});

const abrirTipo = (nombre: string) => {
  const tarjeta = screen.getByTestId(`tipo-${nombre}`);
  fireEvent.click(within(tarjeta).getAllByRole("button")[0]);
  return tarjeta;
};

describe("Web › Fotos por tipo de trabajo", () => {
  it("un apartado por tipo, en el orden de la web, y la ayuda de cómo salen en la web", () => {
    render(<TabFotos puedeEditar />);
    const tipos = within(screen.getByRole("region", { name: "Tipos de trabajo" })).getAllByTestId(/^tipo-/);
    expect(tipos.map((t) => t.dataset.testid)).toEqual(
      ["mamparas", "espejos", "cerramientos", "aluminio", "barandillas", "armarios", "domino", "otros"].map((s) => `tipo-${s}`),
    );
    expect(within(tipos[6]).getByText("Dominó")).toBeInTheDocument();
    expect(within(tipos[7]).getByText("Otros trabajos")).toBeInTheDocument();
    expect(screen.getAllByText("Sin fotos: la web enseña las de ejemplo")).toHaveLength(8);
    expect(screen.getByText(/Espacios que se llenan de luz/)).toBeInTheDocument();
    expect(screen.getByText(/sigue con las fotos de ejemplo/)).toBeInTheDocument();
    expect(screen.getByText(/ninguna foto con estrella: el inicio enseña la primera foto de cada tipo/)).toBeInTheDocument();
    // Plegado: no se ve la zona de subida hasta abrirlo.
    expect(screen.queryByRole("button", { name: /Subir fotos a Mamparas/ })).toBeNull();
    abrirTipo("mamparas");
    expect(screen.getByRole("button", { name: /Subir fotos a Mamparas/ })).toBeInTheDocument();
    expect(screen.getByText(/Aún no hay fotos de Mamparas/)).toBeInTheDocument();
  });

  it("abrir un tipo: sus fotos y las de books antiguos de ese tipo, en el orden de la web; ★, ocultar y mover", () => {
    conDatos();
    render(<TabFotos puedeEditar />);
    const tarjeta = screen.getByTestId("tipo-mamparas");
    expect(within(tarjeta).getByText("3 fotos · 1 oculta · ★ 1 en el inicio")).toBeInTheDocument();
    expect(screen.getByText("Ahora hay 1 foto con estrella en el inicio.")).toBeInTheDocument();
    abrirTipo("mamparas");

    const lista = within(tarjeta).getByRole("list", { name: "Fotos de Mamparas" });
    const items = within(lista).getAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("img").getAttribute("alt"))).toEqual(["m0", "v1", "m2"]);
    // La del book antiguo dice de cuál viene; la ★ lleva su marca.
    expect(within(items[1]).getByText("Mamparas en Elche")).toBeInTheDocument();
    expect(within(items[2]).getByText("Inicio")).toBeInTheDocument();
    expect(within(tarjeta).getByText(/Incluye las fotos del book «Mamparas en Elche»/)).toBeInTheDocument();

    const estrella = within(items[0]).getByRole("button", { name: "Sale en el inicio de la web" });
    expect(estrella).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(estrella);
    expect(h.cambiarFoto).toHaveBeenLastCalledWith({ id: "m0", cambios: { destacada: true } });
    expect(within(items[2]).getByRole("button", { name: "Sale en el inicio de la web" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(items[0]).getByRole("button", { name: "Ocultar en la web" }));
    expect(h.cambiarFoto).toHaveBeenLastCalledWith({ id: "m0", cambios: { publicado: false } });

    fireEvent.click(within(items[0]).getByRole("button", { name: "Mover después" }));
    expect(h.ordenar).toHaveBeenCalledWith({
      tabla: "web_fotos",
      cambios: [
        { id: "v1", orden: 0 },
        { id: "m0", orden: 1 },
      ],
    });
  });

  it("subir a un tipo con su book ya creado: van directas a él, detrás de las que hay", async () => {
    conDatos();
    h.subir.mockResolvedValue({});
    render(<TabFotos puedeEditar />);
    const tarjeta = abrirTipo("mamparas");
    const archivo = new File(["x"], "mampara.jpg", { type: "image/jpeg" });
    fireEvent.change(tarjeta.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [archivo] } });
    await waitFor(() => expect(h.subir).toHaveBeenCalledTimes(1));
    expect(h.asegurar).not.toHaveBeenCalled();
    expect(h.subir).toHaveBeenCalledWith(archivo, expect.objectContaining({ albumId: "tipo-m", orden: 3 }));
  });

  it("subir a un tipo sin book: lo crea (trabajos-<tipo>) y sube ahí", async () => {
    conDatos();
    h.asegurar.mockResolvedValue("nuevo-espejos");
    h.subir.mockResolvedValue({});
    render(<TabFotos puedeEditar />);
    const tarjeta = abrirTipo("espejos");
    const archivos = [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.png", { type: "image/png" })];
    fireEvent.change(tarjeta.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: archivos } });
    await waitFor(() => expect(h.subir).toHaveBeenCalledTimes(2));
    expect(h.asegurar).toHaveBeenCalledTimes(1);
    expect(h.asegurar).toHaveBeenCalledWith("espejos", { ordenes: [0, 1, 2] });
    expect(h.subir).toHaveBeenNthCalledWith(1, archivos[0], expect.objectContaining({ albumId: "nuevo-espejos", orden: 0 }));
    expect(h.subir).toHaveBeenNthCalledWith(2, archivos[1], expect.objectContaining({ albumId: "nuevo-espejos", orden: 1 }));
  });

  it("si no se puede crear el book del tipo, lo dice en cada foto y no sube nada", async () => {
    h.asegurar.mockRejectedValue({ code: "42501", message: "new row violates row-level security policy" });
    render(<TabFotos puedeEditar />);
    const tarjeta = abrirTipo("aluminio");
    fireEvent.change(tarjeta.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" })] } });
    expect(await within(tarjeta).findByText("No tienes permiso de edición en Web · Fotos.")).toBeInTheDocument();
    expect(h.subir).not.toHaveBeenCalled();
  });

  it("«Otros books»: plegado, con los books hechos a mano (no los de tipo) y las fotos sueltas", () => {
    conDatos();
    render(<TabFotos puedeEditar />);
    const otros = screen.getByTestId("otros-books");
    expect(within(otros).getByText("2 books · 1 foto suelta")).toBeInTheDocument();
    expect(within(otros).queryByRole("list")).toBeNull();
    fireEvent.click(within(otros).getByRole("button", { name: /Otros books/ }));
    const lista = within(otros).getByRole("list", { name: "Otros books" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    expect(within(lista).getByText("Mamparas en Elche")).toBeInTheDocument();
    expect(within(lista).getByText("Obra en Crevillente")).toBeInTheDocument();
    expect(within(lista).queryByText("Mamparas", { exact: true })).not.toBeNull(); // la etiqueta del tipo del book antiguo
    expect(within(otros).getByRole("button", { name: /Nuevo book/ })).toBeInTheDocument();
    expect(within(otros).getByRole("button", { name: /Fotos sueltas/ })).toBeInTheDocument();
  });

  it("solo lectura: se ven las fotos, pero sin subir, sin acciones y sin «Nuevo book»", () => {
    conDatos();
    render(<TabFotos puedeEditar={false} />);
    const tarjeta = abrirTipo("mamparas");
    expect(within(within(tarjeta).getByRole("list", { name: "Fotos de Mamparas" })).getAllByRole("listitem")).toHaveLength(3);
    expect(within(tarjeta).queryByRole("button", { name: /Subir fotos/ })).toBeNull();
    expect(within(tarjeta).queryByRole("button", { name: "Sale en el inicio de la web" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nuevo book/ })).toBeNull();
  });
});
