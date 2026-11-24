/**
 * Web › Fotos por tipo de trabajo (sin React): book de cada tipo (`trabajos-<servicio>`), reparto de books y fotos
 * por tipo, orden de las fotos (el mismo que usa la web), fotos ★ que ve la web y título a partir del fichero.
 */
import { describe, expect, it } from "vitest";
import {
  agruparPorTipo,
  destacadasEnWeb,
  esAlbumTipo,
  fotoVisibleEnWeb,
  ordenarFotosTipo,
  resumenTipo,
  slugAlbumTipo,
  textoDestacadas,
  tituloDesdeArchivo,
} from "@/lib/web/fotosPorTipo";
import { SERVICIOS_WEB, slugValido } from "@/lib/web/fotos";

const album = (id: string, slug: string, servicio: string | null, extra: Partial<{ orden: number; publicado: boolean }> = {}) => ({
  id,
  slug,
  servicio,
  orden: 0,
  publicado: true,
  ...extra,
});
const foto = (id: string, album_id: string | null, orden: number, extra: Partial<{ creado_en: string; publicado: boolean; destacada: boolean }> = {}) => ({
  id,
  album_id,
  orden,
  creado_en: "2026-11-24T10:00:00Z",
  publicado: true,
  destacada: false,
  ...extra,
});

describe("book de cada tipo de trabajo", () => {
  it("slug trabajos-<servicio>, válido para la base", () => {
    expect(slugAlbumTipo("mamparas")).toBe("trabajos-mamparas");
    for (const s of SERVICIOS_WEB) expect(slugValido(slugAlbumTipo(s.slug))).toBe(true);
  });

  it("solo es de tipo si el slug y el servicio cuadran", () => {
    expect(esAlbumTipo({ slug: "trabajos-espejos", servicio: "espejos" })).toBe(true);
    expect(esAlbumTipo({ slug: "trabajos-espejos", servicio: "mamparas" })).toBe(false);
    expect(esAlbumTipo({ slug: "trabajos-espejos", servicio: null })).toBe(false);
    expect(esAlbumTipo({ slug: "espejos-elche", servicio: "espejos" })).toBe(false);
  });
});

describe("agruparPorTipo", () => {
  const albumes = [
    album("viejo", "mamparas-elche", "mamparas", { orden: 0, publicado: false }),
    album("obra", "obra-casa", null, { orden: 1 }),
    album("tipo-m", "trabajos-mamparas", "mamparas", { orden: 2 }),
    album("tipo-e", "trabajos-espejos", "espejos", { orden: 3 }),
  ];
  const fotos = [
    foto("m2", "tipo-m", 2),
    foto("m0", "tipo-m", 0),
    foto("v1", "viejo", 1),
    foto("o0", "obra", 0),
    foto("e0", "tipo-e", 0, { publicado: false }),
    foto("suelta", null, 0),
  ];
  const { tipos, otros } = agruparPorTipo(albumes, fotos);

  it("los 8 tipos en el orden de la web, con su nombre", () => {
    expect(tipos.map((t) => t.servicio)).toEqual(SERVICIOS_WEB.map((s) => s.slug));
    expect(tipos.map((t) => t.nombre)).toEqual(SERVICIOS_WEB.map((s) => s.nombre));
  });

  it("un tipo junta las fotos de todos sus books (también los antiguos), por su orden", () => {
    const mamparas = tipos[0];
    expect(mamparas.album?.id).toBe("tipo-m");
    expect(mamparas.albumes.map((a) => a.id)).toEqual(["viejo", "tipo-m"]);
    expect(mamparas.fotos.map((f) => f.id)).toEqual(["m0", "v1", "m2"]);
    // La del book antiguo sin publicar no la ve la web.
    expect(mamparas.visibles).toBe(2);
  });

  it("tipos sin book todavía, y fotos ocultas que no cuentan como visibles", () => {
    const espejos = tipos[1];
    expect(espejos.fotos.map((f) => f.id)).toEqual(["e0"]);
    expect(espejos.visibles).toBe(0);
    const cerramientos = tipos[2];
    expect(cerramientos.album).toBeNull();
    expect(cerramientos.fotos).toEqual([]);
  });

  it("«Otros books»: los que no son de tipo (con servicio o sin él); las sueltas no entran en ningún tipo", () => {
    expect(otros.map((a) => a.id)).toEqual(["viejo", "obra"]);
    expect(tipos.flatMap((t) => t.fotos).some((f) => f.id === "suelta" || f.id === "o0")).toBe(false);
  });
});

describe("orden de las fotos de un tipo", () => {
  it("por orden; a igualdad, por el orden del book y por fecha de subida", () => {
    const posicion = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const lista = [
      foto("b0", "b", 0),
      foto("a0-tarde", "a", 0, { creado_en: "2026-11-24T12:00:00Z" }),
      foto("a0-pronto", "a", 0, { creado_en: "2026-11-24T09:00:00Z" }),
      foto("a-1", "a", -1),
    ];
    expect(ordenarFotosTipo(lista, posicion).map((f) => f.id)).toEqual(["a-1", "a0-pronto", "a0-tarde", "b0"]);
  });
});

describe("lo que ve la web", () => {
  const albumes = [album("pub", "trabajos-mamparas", "mamparas"), album("oculto", "viejo", "espejos", { publicado: false })];
  it("foto visible: publicada y de un book publicado (o suelta)", () => {
    const porId = new Map(albumes.map((a) => [a.id, a]));
    expect(fotoVisibleEnWeb(foto("x", "pub", 0), porId)).toBe(true);
    expect(fotoVisibleEnWeb(foto("x", "pub", 0, { publicado: false }), porId)).toBe(false);
    expect(fotoVisibleEnWeb(foto("x", "oculto", 0), porId)).toBe(false);
    expect(fotoVisibleEnWeb(foto("x", null, 0), porId)).toBe(true);
    expect(fotoVisibleEnWeb(foto("x", "no-existe", 0), porId)).toBe(false);
  });

  it("cuenta solo las ★ que ve la web", () => {
    const fotos = [
      foto("1", "pub", 0, { destacada: true }),
      foto("2", "pub", 1, { destacada: true, publicado: false }),
      foto("3", "oculto", 0, { destacada: true }),
      foto("4", "pub", 2),
    ];
    expect(destacadasEnWeb(fotos, albumes)).toBe(1);
  });
});

describe("textos de la pantalla", () => {
  it("resumen de un tipo: fotos, ocultas, ★ y fotos de ejemplo", () => {
    expect(resumenTipo({ fotos: [], visibles: 0 })).toBe("Sin fotos: la web enseña las de ejemplo");
    expect(resumenTipo({ fotos: [{ destacada: false }], visibles: 1 })).toBe("1 foto");
    expect(resumenTipo({ fotos: [{ destacada: true }, { destacada: false }, { destacada: false }], visibles: 2 })).toBe("3 fotos · 1 oculta · ★ 1 en el inicio");
    expect(resumenTipo({ fotos: [{ destacada: false }, { destacada: false }], visibles: 0 })).toBe("2 fotos · ninguna visible: la web enseña las de ejemplo");
  });

  it("cómo va el inicio con las ★", () => {
    expect(textoDestacadas(0)).toMatch(/primera foto de cada tipo/);
    expect(textoDestacadas(1)).toBe("Ahora hay 1 foto con estrella en el inicio.");
    expect(textoDestacadas(10)).toBe("Hay 10 fotos con estrella: el inicio enseña las 8 primeras.");
  });
});

describe("título a partir del nombre del fichero", () => {
  it("deja los nombres que dicen algo", () => {
    expect(tituloDesdeArchivo("mampara-baño-elche.jpg")).toBe("mampara baño elche");
    expect(tituloDesdeArchivo("Cerramiento_terraza (2).webp")).toBe("Cerramiento terraza 2");
    expect(tituloDesdeArchivo("espejo LED 120x80.png")).toBe("espejo LED 120x80");
  });

  it("descarta los que pone el móvil o la cámara", () => {
    expect(tituloDesdeArchivo("IMG_2034.jpg")).toBeNull();
    expect(tituloDesdeArchivo("IMG-20261124-WA0003.jpg")).toBeNull();
    expect(tituloDesdeArchivo("WhatsApp Image 2026-11-24 at 10.32.15.jpeg")).toBeNull();
    expect(tituloDesdeArchivo("PXL_20261124_093215123.jpg")).toBeNull();
    expect(tituloDesdeArchivo("DSC01234.JPG")).toBeNull();
    expect(tituloDesdeArchivo("Captura de pantalla 2026-11-24 a las 10.32.15.png")).toBeNull();
    expect(tituloDesdeArchivo("20261124_103215.jpg")).toBeNull();
    expect(tituloDesdeArchivo(".jpg")).toBeNull();
  });
});
