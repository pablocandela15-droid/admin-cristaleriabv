// Enlaces externos seguros (FE-06) y mensajes de error para la persona (FE-08). El Markdown del chat de
// facturas (IA-02) y el visor del original de una factura se fueron con el panel del restaurante.
import { describe, it, expect, vi } from "vitest";
import { urlSegura, esUrlHttp } from "@/lib/url-segura";
import { ErrorNegocio, mensajeUsuario } from "@/lib/mensaje-usuario";

describe("urlSegura (FE-06)", () => {
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.tld", "/ruta", "", "  ", null, undefined])(
    "rechaza %s",
    (u) => expect(urlSegura(u as string | null | undefined)).toBeNull(),
  );
  it("acepta http y https", () => {
    expect(urlSegura("https://drive.google.com/file/d/1/view")).toBe("https://drive.google.com/file/d/1/view");
    expect(esUrlHttp("http://a.tld/x")).toBe(true);
  });
  it("mailto/tel solo si se piden", () => {
    expect(urlSegura("mailto:a@b.es")).toBeNull();
    expect(urlSegura("mailto:a@b.es", ["mailto:"])).toBe("mailto:a@b.es");
    expect(urlSegura("tel:+34600000000")).toBeNull();
    expect(urlSegura("tel:+34600000000", ["tel:"])).toBe("tel:+34600000000");
    // Pedir mailto no abre la puerta a javascript:.
    expect(urlSegura("javascript:alert(1)", ["mailto:", "tel:"])).toBeNull();
  });
  it("quita los espacios de alrededor y devuelve la URL normalizada", () => {
    expect(urlSegura("  https://a.tld/x  ")).toBe("https://a.tld/x");
    expect(urlSegura("https://A.TLD")).toBe("https://a.tld/");
    expect(esUrlHttp("javascript:alert(1)")).toBe(false);
    expect(esUrlHttp(null)).toBe(false);
  });
});

describe("mensajeUsuario (FE-08)", () => {
  it("error técnico -> genérico y detalle a console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pg = { code: "23505", message: 'duplicate key value violates unique constraint "x"', details: "d" };
    expect(mensajeUsuario(pg, "No se pudo guardar")).toBe("No se pudo guardar");
    expect(mensajeUsuario(new TypeError("Failed to fetch"), "g")).toBe("g");
    expect(mensajeUsuario(new Error("JWT expired"), "g")).toBe("g");
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
  it("error de negocio en español se muestra tal cual", () => {
    expect(mensajeUsuario(new Error("Ese usuario ya está bloqueado"), "g")).toBe("Ese usuario ya está bloqueado");
    expect(mensajeUsuario(new ErrorNegocio("Falta el NIF"), "g")).toBe("Falta el NIF");
  });
  it("RAISE EXCEPTION de negocio (P0001) se muestra tal cual", () => {
    // P. ej. el tope diario de peticiones (disparador de la migración de peticiones).
    const e = { code: "P0001", message: "Has enviado 20 peticiones en las últimas 24 horas.", details: null, hint: null };
    expect(mensajeUsuario(e, "g")).toBe("Has enviado 20 peticiones en las últimas 24 horas.");
  });
  it("códigos técnicos siguen genéricos (42501, 23505, PGRST)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["42501", "23505", "PGRST301", "28000"]) {
      expect(mensajeUsuario({ code, message: "Acceso no permitido" }, "g")).toBe("g");
    }
    spy.mockRestore();
  });
});
