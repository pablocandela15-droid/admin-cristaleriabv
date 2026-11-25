// RRSS en el panel: hora de Madrid ↔ instante (con los cambios de hora), validación de la programación (las mismas
// reglas que rrss_programar), aviso de ±30 min en la misma red, eventos del calendario y recorte de las fotos (la
// misma cuenta en la vista previa y en el JPEG).
import { describe, expect, it } from "vitest";
import { conflictosCercanos, construirEventos, madridAUtc, utcAMadrid, validarProgramacion, valorInicial, type PiezaCalendario } from "../calendario";
import { estiloRecorteCss, fotoPequena, moverEncuadre, rectanguloRecorte, ENCUADRE_CENTRADO } from "../imagen";

describe("hora de Madrid", () => {
  it("convierte en invierno y en verano", () => {
    expect(madridAUtc("2026-12-01", "13:00")?.toISOString()).toBe("2026-12-01T12:00:00.000Z");
    expect(madridAUtc("2026-07-01", "13:00")?.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(utcAMadrid("2026-07-01T11:00:00Z")).toEqual({ fecha: "2026-07-01", hora: "13:00" });
  });
  it("la hora que no existe (marzo) no vale; la repetida (octubre) es la primera", () => {
    expect(madridAUtc("2027-03-28", "02:30")).toBeNull();
    expect(madridAUtc("2026-10-25", "02:30")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("valida como las RPC: 10 minutos a 75 días", () => {
    const ahora = new Date("2026-11-25T10:00:00Z");
    expect(validarProgramacion("2026-11-25", "11:05", ahora)).toEqual({ ok: false, error: "Hay que programarla con al menos 10 minutos de margen" });
    expect(validarProgramacion("2027-03-01", "12:00", ahora)).toEqual({ ok: false, error: "Como mucho se puede programar a 75 días vista" });
    expect(validarProgramacion("2026-11-26", "13:00", ahora)).toMatchObject({ ok: true });
    expect(valorInicial(null, ahora)).toEqual({ fecha: "2026-11-26", hora: "13:00" });
  });
  it("avisa de otras programadas en la misma red a ±30 min", () => {
    const lista = [
      { id: "a", pieza_id: "x", red: "instagram", programada_para: "2026-11-26T12:20:00Z", estado: "programada" },
      { id: "b", pieza_id: "y", red: "facebook", programada_para: "2026-11-26T12:10:00Z", estado: "programada" },
      { id: "c", pieza_id: "z", red: "instagram", programada_para: "2026-11-26T13:00:00Z", estado: "programada" },
    ];
    expect(conflictosCercanos(lista, "instagram", new Date("2026-11-26T12:00:00Z"), "p").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("eventos del calendario", () => {
  const p = (x: Partial<PiezaCalendario>): PiezaCalendario => ({ id: "p", grupo_id: "g", red: "instagram", formato: "foto", titulo: null, caption: "", estado: "lista",
    fecha_prevista: null, publicada_at: null, permalink: null, error: null, ...x });
  it("programadas en su hora, publicadas en publicada_at y borradores con fecha prevista sin programación; las canceladas no", () => {
    const eventos = construirEventos(
      [
        { id: "g1", pieza_id: "p1", red: "instagram", programada_para: "2026-11-26T12:00:00Z", estado: "programada", intentos: 0, ultimo_error: null },
        { id: "g2", pieza_id: "p2", red: "instagram", programada_para: "2026-11-27T12:00:00Z", estado: "cancelada", intentos: 0, ultimo_error: null },
      ],
      [p({ id: "p1", fecha_prevista: "2026-11-26" }), p({ id: "p3", estado: "publicada", publicada_at: "2026-11-24T09:00:00Z" }), p({ id: "p4", estado: "borrador", fecha_prevista: "2026-11-28" })],
    );
    expect(eventos.map((e) => [e.tipo, e.piezaId, e.dia, e.hora])).toEqual([
      ["publicada", "p3", "2026-11-24", "10:00"], ["programada", "p1", "2026-11-26", "13:00"], ["borrador", "p4", "2026-11-28", ""],
    ]);
  });
});

describe("recorte de las fotos", () => {
  it("el recorte más grande que cabe, centrado, y con zoom", () => {
    expect(rectanguloRecorte(4000, 3000, 1080, 1350, ENCUADRE_CENTRADO)).toEqual({ left: 800, top: 0, width: 2400, height: 3000 });
    expect(rectanguloRecorte(4000, 3000, 1080, 1080, { x: 0.5, y: 0.5, zoom: 2 })).toEqual({ left: 1250, top: 750, width: 1500, height: 1500 });
    expect(rectanguloRecorte(4000, 3000, 1080, 1350, { x: 0, y: 0.5, zoom: 1 }).left).toBe(0);
  });
  it("arrastrar mueve el centro sin salirse", () => {
    const rc = rectanguloRecorte(4000, 3000, 1080, 1350, ENCUADRE_CENTRADO);
    const e = moverEncuadre(ENCUADRE_CENTRADO, 100, 0, rc, 4000, 3000, 240);
    expect(e.x).toBeLessThan(0.5);
    expect(moverEncuadre(ENCUADRE_CENTRADO, -100000, 0, rc, 4000, 3000, 240).x).toBe(1);
  });
  it("la vista previa usa la misma cuenta y avisa si la foto es pequeña", () => {
    expect(estiloRecorteCss(4000, 3000, 240, 300, ENCUADRE_CENTRADO)).toEqual({ width: 400, height: 300, left: -80, top: -0 });
    expect(fotoPequena(600, 600, "4:5", ENCUADRE_CENTRADO)).toBe(true);
    expect(fotoPequena(3000, 4000, "4:5", ENCUADRE_CENTRADO)).toBe(false);
  });
});
