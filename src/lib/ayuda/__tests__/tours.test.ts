import { describe, expect, it, vi } from "vitest";
import { TOURS, TOUR_BOTON_AYUDA, claveTourVisto, esEstadoLanzarTour, esperarA, pestanasDelTour, cadenaPestanas } from "../tours";
import { FICHAS_AYUDA, esArchivoVideo, pasosDeFicha } from "../centroAyuda";

describe("tours de ayuda", () => {
  it("cada sección tiene pasos con título y texto, y acaba en el botón «?»", () => {
    for (const [seccion, pasos] of Object.entries(TOURS)) {
      expect(pasos.length, seccion).toBeGreaterThan(3);
      for (const p of pasos) {
        expect(p.titulo.trim(), seccion).not.toBe("");
        expect(p.texto.trim(), seccion).not.toBe("");
      }
      expect(pasos.at(-1)?.elemento).toBe(TOUR_BOTON_AYUDA);
    }
  });

  it("no repite el mismo elemento en la misma pestaña", () => {
    for (const pasos of Object.values(TOURS)) {
      const ids = pasos.filter((p) => p.elemento).map((p) => `${p.pestana ?? ""}|${p.elemento}`);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("solo hay tours de Peticiones y Usuarios (los del restaurante ya no están)", () => {
    expect(Object.keys(TOURS).sort()).toEqual(["peticiones", "usuarios"]);
  });

  it("el tour de Peticiones avisa de que «Urgente» es solo si no puedes trabajar", () => {
    expect(TOURS.peticiones.find((p) => p.elemento === "peticiones-prioridad")?.texto).toMatch(/Urgente.*no puedes trabajar/);
  });

  it("el tour de Usuarios enseña el resumen y la lista, con lo que se ve en «Permisos»", () => {
    expect(TOURS.usuarios.map((p) => p.elemento).filter(Boolean)).toEqual(["usuarios-resumen", "usuarios-lista", TOUR_BOTON_AYUDA]);
    expect(TOURS.usuarios.find((p) => p.elemento === "usuarios-lista")?.texto).toMatch(/Permisos/);
  });

  it("los textos de ayuda hablan de tú y en español: nada de «usted»", () => {
    const textos = [
      ...Object.values(TOURS).flat().map((p) => p.texto),
      ...FICHAS_AYUDA.flatMap((f) => [f.queEs, ...pasosDeFicha(f), ...f.preguntas.map((q) => q.respuesta)]),
    ];
    for (const t of textos) expect(t).not.toMatch(/\busted\b/i);
  });

  it("recorre las pestañas en orden: Peticiones Nueva → Mis peticiones; Usuarios no tiene pestañas", () => {
    expect(pestanasDelTour(TOURS.peticiones)).toEqual(["peticiones-pestana-nueva", "peticiones-pestana-mias"]);
    expect(pestanasDelTour(TOURS.usuarios)).toEqual([]);
  });

  it("cadenaPestanas: sin pestaña, ninguna; una subpestaña, primero su pestaña de fuera", () => {
    expect(cadenaPestanas({ titulo: "t", texto: "x" })).toEqual([]);
    expect(cadenaPestanas({ titulo: "t", texto: "x", pestana: "fuera" })).toEqual(["fuera"]);
    expect(cadenaPestanas({ titulo: "t", texto: "x", pestana: ["fuera", "dentro"] })).toEqual(["fuera", "dentro"]);
    // pestanasDelTour cuenta solo las de fuera, sin repetir.
    expect(
      pestanasDelTour([
        { titulo: "a", texto: "x", pestana: ["fuera", "dentro"] },
        { titulo: "b", texto: "x", pestana: "fuera" },
        { titulo: "c", texto: "x", pestana: "otra" },
      ]),
    ).toEqual(["fuera", "otra"]);
  });

  it("los pasos de una pestaña van juntos (no se salta de una a otra y vuelve)", () => {
    for (const pasos of Object.values(TOURS)) {
      const secuencia = pasos.map((p) => cadenaPestanas(p).join(" > ")).filter(Boolean);
      const bloques = secuencia.filter((p, i) => p !== secuencia[i - 1]);
      expect(new Set(bloques).size).toBe(bloques.length);
    }
  });

  it("«Nueva petición» se explica por partes: la pestaña, título, prioridad y enviar, en ese orden", () => {
    const nueva = TOURS.peticiones.filter((p) => p.pestana === "peticiones-pestana-nueva").map((p) => p.elemento);
    expect(nueva).toEqual(["peticiones-pestana-nueva", "peticiones-titulo", "peticiones-prioridad", "peticiones-enviar"]);
    const mias = TOURS.peticiones.filter((p) => p.pestana === "peticiones-pestana-mias").map((p) => p.elemento);
    expect(mias).toEqual(["peticiones-pestana-mias"]);
  });

  it("esperarA: devuelve el elemento en cuanto aparece y null si no llega a tiempo", async () => {
    vi.useFakeTimers();
    try {
      let el: string | null = null;
      const encontrado = esperarA(() => el, 2000);
      await vi.advanceTimersByTimeAsync(300);
      el = "EL";
      await vi.advanceTimersByTimeAsync(100);
      await expect(encontrado).resolves.toBe("EL");

      const nunca = esperarA(() => null, 2000);
      await vi.advanceTimersByTimeAsync(2100);
      await expect(nunca).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("la clave de «ya visto» distingue sección y usuario", () => {
    expect(claveTourVisto("peticiones", "u1")).not.toBe(claveTourVisto("peticiones", "u2"));
    expect(claveTourVisto("peticiones", "u1")).not.toBe(claveTourVisto("usuarios", "u1"));
  });

  it("reconoce el estado de navegación que pide lanzar un tour", () => {
    expect(esEstadoLanzarTour({ lanzarTour: "peticiones" })).toBe(true);
    expect(esEstadoLanzarTour({ lanzarTour: "usuarios" })).toBe(true);
    expect(esEstadoLanzarTour({ lanzarTour: "nada" })).toBe(false);
    // Un tour que ya no existe (del panel del restaurante) no se lanza.
    expect(esEstadoLanzarTour({ lanzarTour: "facturas" })).toBe(false);
    expect(esEstadoLanzarTour(null)).toBe(false);
  });

  it("hay una ficha del Centro de Ayuda por cada tour, con pasos y preguntas", () => {
    expect(FICHAS_AYUDA.map((f) => f.seccion).sort()).toEqual(Object.keys(TOURS).sort());
    for (const f of FICHAS_AYUDA) {
      expect(pasosDeFicha(f).length).toBeGreaterThan(0);
      for (const g of f.grupos) {
        expect(g.titulo.trim()).not.toBe("");
        expect(g.pasos.length).toBeGreaterThan(0);
      }
      expect(f.preguntas.length).toBeGreaterThan(0);
      expect(f.ruta.startsWith("/")).toBe(true);
    }
  });
});

describe("esArchivoVideo", () => {
  it("distingue archivos de vídeo propios de enlaces de inserción", () => {
    expect(esArchivoVideo("/ayuda/videos/peticiones.webm")).toBe(true);
    expect(esArchivoVideo("/ayuda/videos/usuarios.mp4?v=2")).toBe(true);
    expect(esArchivoVideo("https://www.youtube.com/embed/abc123")).toBe(false);
    expect(esArchivoVideo("https://player.vimeo.com/video/123")).toBe(false);
  });
});
