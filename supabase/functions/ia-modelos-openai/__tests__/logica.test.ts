import { describe, expect, it } from "vitest";
import {
  compatibilidadHerramientas, cuerpoPrueba, esDeInteres, esModeloDeChat, modelosDeRespuesta, procesoDeFuncion, textoRespuesta,
} from "../logica";

describe("ia-modelos-openai · lógica", () => {
  it("limpia la lista de /v1/models (sin duplicados ni ids raros, ordenada)", () => {
    const r = modelosDeRespuesta({
      data: [
        { id: "gpt-6-luna", owned_by: "system", created: 1757808000 },
        { id: "gpt-4.1-mini", owned_by: "system", created: 1744000000 },
        { id: "gpt-6-luna", owned_by: "otro" },
        { id: "mal id; drop" },
        { id: 42 },
      ],
    });
    expect(r.map((m) => m.id)).toEqual(["gpt-4.1-mini", "gpt-6-luna"]);
    expect(r[1]).toEqual({ id: "gpt-6-luna", owned_by: "system", created: 1757808000 });
    expect(() => modelosDeRespuesta({ error: "x" })).toThrow();
  });

  it("familias de interés y modelos de chat", () => {
    expect(esDeInteres("gpt-6-sol")).toBe(true);
    expect(esDeInteres("o4-mini")).toBe(true);
    expect(esDeInteres("text-embedding-3-small")).toBe(true);
    expect(esDeInteres("dall-e-3")).toBe(false);
    expect(esModeloDeChat("gpt-6-luna")).toBe(true);
    expect(esModeloDeChat("gpt-4o-mini-tts")).toBe(false);
    expect(esModeloDeChat("text-embedding-3-small")).toBe(false);
    expect(esModeloDeChat("gpt-image-2")).toBe(false);
  });

  it("cada función se prueba con la clave de su proyecto", () => {
    expect(procesoDeFuncion("chat-facturas")).toBe("chat");
    expect(procesoDeFuncion("chat-web")).toBe("chatweb");
    expect(procesoDeFuncion("ocr-trabajo")).toBe("ocr");
    expect(procesoDeFuncion(null)).toBe("otros");
  });

  it("la prueba usa los parámetros de la familia y una herramienta", () => {
    const g6 = cuerpoPrueba("gpt-6-luna");
    expect(g6).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "none", tool_choice: "auto" });
    expect(g6).not.toHaveProperty("temperature");
    expect(Array.isArray(g6.tools)).toBe(true);
    expect(cuerpoPrueba("gpt-4.1-mini")).toMatchObject({ max_tokens: 16, temperature: 0 });
    expect(() => cuerpoPrueba("x; y")).toThrow();
  });

  it("texto de la respuesta", () => {
    expect(textoRespuesta({ choices: [{ message: { content: " funciona " } }] })).toBe("funciona");
    expect(textoRespuesta({ choices: [{ message: { content: null }, finish_reason: "tool_calls" }] })).toContain("tool_calls");
    expect(textoRespuesta(null)).toBe("(sin texto)");
  });
});

describe("compatibilidadHerramientas (20261107620000)", () => {
  it("2xx = compatible", () => {
    expect(compatibilidadHerramientas(200, null)).toEqual({ compatible: true, motivo: null });
  });
  it("los 400 de gpt-6.1-sol = incompatible con el motivo de OpenAI", () => {
    const a = compatibilidadHerramientas(400, "Unsupported value: 'reasoning_effort' does not support 'none' with this model.");
    expect(a?.compatible).toBe(false);
    expect(a?.motivo).toMatch(/^OpenAI 400: .*does not support 'none'/);
    const b = compatibilidadHerramientas(400, "Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses.");
    expect(b?.compatible).toBe(false);
    expect(compatibilidadHerramientas(400, "x".repeat(900))).toBeNull();
    expect(compatibilidadHerramientas(400, "tools " + "x".repeat(900))!.motivo!.length).toBe(400);
  });
  it("otros errores no dicen nada (no se guarda)", () => {
    expect(compatibilidadHerramientas(429, "Rate limit reached for tools")).toBeNull();
    expect(compatibilidadHerramientas(500, null)).toBeNull();
    expect(compatibilidadHerramientas(401, "Incorrect API key")).toBeNull();
    expect(compatibilidadHerramientas(400, "Invalid 'messages[0].content'")).toBeNull();
  });
  it("la prueba lleva una herramienta (si no, no detectaría nada)", () => {
    expect((cuerpoPrueba("gpt-6.1-terra").tools as unknown[]).length).toBe(1);
  });
});
