/**
 * Sección que se abre al iniciar sesión (11/11/2026, petición del dueño: «Que en Usuarios se pueda
 * poner qué pestaña se le va a abrir por defecto cuando inician sesión»): a dónde se va al entrar.
 */
import { describe, expect, it } from "vitest";
import {
  esEntradaAlPanel,
  ESTADO_TRAS_LOGIN,
  OPCIONES_INICIO,
  opcionInicio,
  opcionesInicio,
  rutaDeInicio,
} from "@/lib/seccionInicio";

const ver = (...secciones: string[]) => secciones.map((section_key) => ({ section_key, can_view: true, can_edit: false }));

describe("OPCIONES_INICIO", () => {
  it("son las entradas del menú, en su orden: Dashboard, Usuarios y Ayuda", () => {
    expect(OPCIONES_INICIO.map((o) => [o.clave, o.ruta])).toEqual([
      ["dashboard", "/dashboard"],
      ["usuarios", "/usuarios"],
      ["ayuda", "/ayuda"],
    ]);
  });

  it("opcionInicio busca por clave; NULL o una clave que ya no existe, undefined", () => {
    expect(opcionInicio("usuarios")?.titulo).toBe("Usuarios");
    expect(opcionInicio(null)).toBeUndefined();
    expect(opcionInicio("reservas")).toBeUndefined();
  });
});

describe("rutaDeInicio", () => {
  it("abre la sección elegida si puede verla", () => {
    expect(rutaDeInicio("usuarios", ver("dashboard", "usuarios"))).toBe("/usuarios");
    expect(rutaDeInicio("dashboard", ver("dashboard"))).toBe("/dashboard");
  });

  it("sin permiso para verla, lo de siempre (null)", () => {
    expect(rutaDeInicio("usuarios", ver("dashboard"))).toBeNull();
    expect(rutaDeInicio("usuarios", [{ section_key: "usuarios", can_view: false }])).toBeNull();
  });

  it("sin elegir o con una clave que ya no existe, lo de siempre", () => {
    expect(rutaDeInicio(null, ver("usuarios"))).toBeNull();
    expect(rutaDeInicio(undefined, ver("usuarios"))).toBeNull();
    // Una clave guardada de una sección retirada no lleva a ningún sitio.
    expect(rutaDeInicio("reservas", ver("dashboard", "usuarios"))).toBeNull();
    expect(rutaDeInicio("trabajadores", ver("usuarios"))).toBeNull();
  });

  it("el super admin ve todo; Ayuda, todo el mundo", () => {
    expect(rutaDeInicio("usuarios", [], true)).toBe("/usuarios");
    expect(rutaDeInicio("dashboard", [], true)).toBe("/dashboard");
    expect(rutaDeInicio("ayuda", [])).toBe("/ayuda");
  });
});

describe("opcionesInicio", () => {
  it("son las entradas del menú que ve, en su orden", () => {
    expect(opcionesInicio(ver("usuarios", "dashboard")).map((o) => o.clave)).toEqual(["dashboard", "usuarios", "ayuda"]);
    expect(opcionesInicio(ver("usuarios")).map((o) => o.clave)).toEqual(["usuarios", "ayuda"]);
    expect(opcionesInicio([]).map((o) => o.clave)).toEqual(["ayuda"]);
  });

  it("el super admin las ve todas", () => {
    expect(opcionesInicio([], true).map((o) => o.clave)).toEqual(["dashboard", "usuarios", "ayuda"]);
  });
});

describe("esEntradaAlPanel", () => {
  it("«/» y /dashboard tras iniciar sesión; el Dashboard del menú, no", () => {
    expect(esEntradaAlPanel("/", null)).toBe(true);
    expect(esEntradaAlPanel("/dashboard", ESTADO_TRAS_LOGIN)).toBe(true);
    expect(esEntradaAlPanel("/dashboard", null)).toBe(false);
    expect(esEntradaAlPanel("/usuarios", ESTADO_TRAS_LOGIN)).toBe(false);
  });
});
