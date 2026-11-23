/**
 * Utilidades de Web › Fotos y Web › Contenido (sin React): rutas del bucket web-fotos, slug de los books, orden de
 * listas, imágenes de la web (la elegida o la de siempre) y limpieza de lo que se guarda en web_contenido.
 */
import { describe, expect, it } from "vitest";
import { mover, ordenesNuevos, rutaFotoWeb, siguienteOrden, slugMientrasEscribe, slugValido, slugificar, urlFotoWeb, mensajeErrorWeb } from "@/lib/web/fotos";
import {
  HUECOS_IMAGEN,
  IMAGENES_POR_DEFECTO,
  imagenElegida,
  imagenEnLaWeb,
  limpiarFaq,
  limpiarNegocio,
  limpiarServicio,
  telefonoEnlace,
  urlImagenPorDefecto,
} from "@/lib/web/contenido";

describe("fotos", () => {
  it("slug del book: sin tildes, minúsculas y guiones (y válido para la base)", () => {
    expect(slugificar("Mamparas en Crevillente · Baño pequeño")).toBe("mamparas-en-crevillente-bano-pequeno");
    expect(slugificar("  ¡España!  ")).toBe("espana");
    expect(slugValido(slugificar("Obra nº 3"))).toBe(true);
    expect(slugValido("Con Mayúsculas")).toBe(false);
    expect(slugValido("doble--guion")).toBe(false);
    expect(slugMientrasEscribe("mamparas-")).toBe("mamparas-");
  });

  it("rutas: albumes/<album>/<uuid>.webp o sueltas/<uuid>.webp, y su URL pública", () => {
    expect(rutaFotoWeb("2b7f0c1e-0000-4000-8000-000000000001", "abc")).toBe("albumes/2b7f0c1e-0000-4000-8000-000000000001/abc.webp");
    expect(rutaFotoWeb(null, "abc")).toBe("sueltas/abc.webp");
    expect(rutaFotoWeb(null)).toMatch(/^sueltas\/[0-9a-f-]{36}\.webp$/);
    expect(urlFotoWeb("https://x.supabase.co/", "sueltas/a b.webp")).toBe("https://x.supabase.co/storage/v1/object/public/web-fotos/sueltas/a%20b.webp");
  });

  it("orden: mover, solo los cambios y el siguiente libre", () => {
    expect(mover(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(mover(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(ordenesNuevos(["b", "a", "c"], new Map([["a", 0], ["b", 1], ["c", 2]]))).toEqual([{ id: "b", orden: 0 }, { id: "a", orden: 1 }]);
    expect(siguienteOrden([])).toBe(0);
    expect(siguienteOrden([0, 4, 2])).toBe(5);
  });

  it("errores claros: permisos, repetidos y migración sin aplicar", () => {
    expect(mensajeErrorWeb({ code: "42501", message: "new row violates row-level security policy" }, "Web · Fotos")).toBe("No tienes permiso de edición en Web · Fotos.");
    expect(mensajeErrorWeb({ code: "23505", message: "duplicate key" }, "Web · Fotos")).toMatch(/Ya existe/);
    expect(mensajeErrorWeb({ code: "PGRST205", message: "Could not find the table 'public.web_albumes' in the schema cache" }, "x")).toMatch(/migración/);
  });
});

describe("imágenes de la web", () => {
  it("cinco huecos, cada uno con la imagen que trae la web", () => {
    expect(HUECOS_IMAGEN.map((h) => h.clave)).toEqual(["hero", "heroHouse", "about", "aboutHands", "contact"]);
    expect(urlImagenPorDefecto("hero")).toBe(`https://cristaleriabv.vercel.app${IMAGENES_POR_DEFECTO.hero.src}`);
  });

  it("acepta {ruta, alt} o la ruta sola; vacío = la de la web", () => {
    expect(imagenElegida({ hero: { ruta: "sueltas/a.webp", alt: " Baño " } }, "hero")).toEqual({ ruta: "sueltas/a.webp", alt: "Baño" });
    expect(imagenElegida({ hero: "sueltas/b.webp" }, "hero")).toEqual({ ruta: "sueltas/b.webp" });
    expect(imagenElegida({ hero: "" }, "hero")).toBeNull();
    expect(imagenElegida({}, "about")).toBeNull();
    const enWeb = imagenEnLaWeb({ about: "sueltas/c.webp" }, "about", "https://x.supabase.co");
    expect(enWeb).toEqual({ url: "https://x.supabase.co/storage/v1/object/public/web-fotos/sueltas/c.webp", alt: IMAGENES_POR_DEFECTO.about.alt, porDefecto: false });
    expect(imagenEnLaWeb(null, "contact", "https://x").porDefecto).toBe(true);
  });
});

describe("contenido que se guarda", () => {
  it("teléfono para enlazar", () => {
    expect(telefonoEnlace("650 06 63 23")).toBe("+34650066323");
    expect(telefonoEnlace("+34 649 99 40 07")).toBe("+34649994007");
    expect(telefonoEnlace("0034 965 00 00 00")).toBe("+34965000000");
    expect(telefonoEnlace("")).toBe("");
  });

  it("negocio sin vacíos (la web pone lo suyo), conservando las coordenadas", () => {
    expect(
      limpiarNegocio({
        tagline: " Cristal con oficio ",
        description: "",
        yearsExperience: 30,
        phones: [{ label: "Oficina", display: "650 06 63 23", tel: "" }, { label: "", display: " ", tel: "" }],
        hours: [{ days: "", time: "" }],
        address: { street: "C/ Pío XII, 5", city: "", lat: 38.2, lon: -0.8 },
      }),
    ).toEqual({
      tagline: "Cristal con oficio",
      yearsExperience: 30,
      phones: [{ label: "Oficina", display: "650 06 63 23", tel: "+34650066323" }],
      address: { street: "C/ Pío XII, 5", lat: 38.2, lon: -0.8 },
    });
  });

  it("servicio y preguntas sin vacíos", () => {
    expect(limpiarServicio({ name: "Mamparas", intro: " ", features: ["Templado", " ", "Antical"] })).toEqual({ name: "Mamparas", features: ["Templado", "Antical"] });
    expect(limpiarFaq([{ q: " ¿Plazo? ", a: "Una semana", tags: ["plazo", ""] }, { q: "Sin respuesta", a: "" }, "basura"])).toEqual([
      { q: "¿Plazo?", a: "Una semana", tags: ["plazo"] },
    ]);
    expect(limpiarFaq(null)).toEqual([]);
  });
});
