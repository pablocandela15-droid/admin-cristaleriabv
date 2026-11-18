import { describe, expect, it } from "vitest";
import { type Fallo, horaLegible, mensajeFallo } from "../fallos";

const base = { id: 1, usuario: "ana@cristaleria.test", created_at: "2026-11-12T10:30:00Z" };

describe("mensajeFallo · formatos propios", () => {
  it("OpenAI sin créditos: cuántas llamadas, desde cuándo, el error y qué hacer", () => {
    const t = mensajeFallo({
      ...base, usuario: null, tipo: "openai_sin_creditos",
      datos: { trabajos: 6, desde: "2026-11-12T09:00:00Z", ejemplo: "  OpenAI 429:\n You have no credits  " },
    });
    expect(t.split("\n")).toEqual([
      "OpenAI sin créditos o con error de facturación",
      "Llamadas a la IA fallidas por esto: 6 (desde 12/11/2026, 10:00)",
      "Error: OpenAI 429: You have no credits",
      "Qué hacer: revisa el saldo y la facturación de OpenAI; hasta entonces lo que usa IA (análisis de tickets) no funciona.",
    ]);
  });

  it("OpenAI sin créditos sin datos: «?» y sin líneas vacías", () => {
    const t = mensajeFallo({ ...base, tipo: "openai_sin_creditos", datos: {} });
    expect(t).toContain("Llamadas a la IA fallidas por esto: ?");
    expect(t).not.toContain("(desde");
    expect(t).not.toContain("Error:");
  });

  it("cron caído: una línea por tarea (como mucho 8)", () => {
    const t = mensajeFallo({
      ...base, tipo: "cron_caido",
      datos: { crons: [
        { job: "sincronizar-costes-openai", minutos: 185.4, maximo: 90, error: "job startup timeout" },
        { job: "avisos-telegram", maximo: 15 },
      ] },
    });
    expect(t.split("\n")).toEqual([
      "Tarea programada sin éxito",
      "- sincronizar-costes-openai: 185 min sin éxito (máx. 90) · job startup timeout",
      "- avisos-telegram: mucho tiempo sin éxito (máx. 15)",
    ]);
    expect(mensajeFallo({ ...base, tipo: "cron_caido", datos: {} })).toBe("Tarea programada sin éxito\n- (sin detalle)");
    const muchos = mensajeFallo({ ...base, tipo: "cron_caido", datos: { crons: Array.from({ length: 12 }, (_, i) => ({ job: `tarea-${i}`, minutos: 60, maximo: 30 })) } });
    expect(muchos.match(/^- tarea-/gm)).toHaveLength(8);
  });
});

describe("mensajeFallo · genérico", () => {
  it("tipo sin formato propio: tipo, usuario, hora y los datos", () => {
    const t = mensajeFallo({ ...base, tipo: "copia_seguridad_fallida", datos: { tabla: "peticiones", motivo: "sin espacio" } });
    expect(t.split("\n")).toEqual([
      "Fallo interno: copia seguridad fallida",
      "Usuario: ana@cristaleria.test",
      "Hora: 12/11/2026, 11:30",
      '{"tabla":"peticiones","motivo":"sin espacio"}',
    ]);
    expect(mensajeFallo({ ...base, usuario: null, tipo: "x", datos: {} })).not.toContain("Usuario:");
  });

  it("los fallos agrupados desde el aviso anterior: cuántos, desde cuándo y sus ids", () => {
    const d = { acumulados_desde: "2026-11-12T10:00:00Z" };
    const t = mensajeFallo({ ...base, tipo: "copia_seguridad_fallida", datos: { ...d, acumulados_antes: 7, acumulados_ids: [41, 42] } });
    expect(t).toContain("Además: 7 fallos más desde 12/11/2026, 11:00 (se agrupan: un aviso cada 15 min como mucho).");
    expect(t).toContain("Ids: 41, 42");
    expect(mensajeFallo({ ...base, tipo: "x", datos: { ...d, acumulados_antes: 1 } })).toContain("Además: 1 fallo más desde");
    expect(mensajeFallo({ ...base, tipo: "x", datos: { ...d, acumulados_antes: 1 } })).not.toContain("Ids:");
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(mensajeFallo({ ...base, tipo: "x", datos: { ...d, acumulados_antes: 12, acumulados_ids: ids } })).toContain("Ids: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10…");
    // Sin acumulados (o con un número raro), sin «Además».
    expect(mensajeFallo({ ...base, tipo: "x", datos: { motivo: "error" } })).not.toContain("Además");
    expect(mensajeFallo({ ...base, tipo: "x", datos: { acumulados_antes: "muchos" } })).not.toContain("Además");
  });

  it("los tipos del restaurante (albaranes, chat de Facturas) ya no tienen formato propio: salen con el genérico", () => {
    const albaran = mensajeFallo({ ...base, tipo: "albaran_aviso", datos: { factura_id: 5, avisos: [] } });
    expect(albaran).toMatch(/^Fallo interno: albaran aviso\n/);
    expect(albaran).not.toContain("Albarán id");
    expect(mensajeFallo({ ...base, tipo: "chat_error", datos: { motivo: "tiempo_agotado" } })).toMatch(/^Fallo interno: chat error\n/);
  });

  it("nunca pasa de 4096", () => {
    const t = mensajeFallo({ ...base, tipo: "otro_fallo", datos: { x: "y".repeat(9000) } });
    expect(t).toContain("Fallo interno: otro fallo");
    expect(t.length).toBeLessThanOrEqual(4096);
    const f: Fallo = { ...base, tipo: "openai_sin_creditos", datos: { ejemplo: "z".repeat(9000) } };
    expect(mensajeFallo(f).length).toBeLessThanOrEqual(4096);
  });

  it("horaLegible: hora de Madrid; «?» si no es una fecha", () => {
    expect(horaLegible("2026-07-01T21:30:00Z")).toBe("01/07/2026, 23:30");
    expect(horaLegible("no es fecha")).toBe("?");
    expect(horaLegible(null)).toBe("?");
  });
});
