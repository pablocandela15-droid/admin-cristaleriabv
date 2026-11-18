/**
 * Tipos de usuario fijos (`tiposUsuario.ts`, 10/11/2026). Los de entonces, «Reservas» y «Albaranes», eran
 * del panel de restaurante y se han retirado: hoy la lista está vacía (el panel solo tiene Dashboard y
 * Usuarios). Se comprueba que los ayudantes se portan bien sin ningún tipo: nada se reconoce como tipo y
 * el valor del desplegable sigue sin chocar con los ids de los roles preconfigurados.
 */
import { describe, expect, it } from "vitest";
import { SECCIONES_CONFIGURABLES } from "@/components/usuarios/permisosSecciones";
import { PREFIJO_TIPO, TIPOS_USUARIO, tipoDeValor, tipoQueCoincide, valorTipo } from "@/components/usuarios/tiposUsuario";

describe("tipos de usuario", () => {
  it("hoy no hay ninguno", () => {
    expect(TIPOS_USUARIO).toEqual([]);
  });

  it("el valor del desplegable lleva el prefijo «tipo:», para no chocar con los ids de los preconfigurados", () => {
    expect(PREFIJO_TIPO).toBe("tipo:");
    expect(valorTipo({ id: "nuevo" })).toBe("tipo:nuevo");
  });

  it("ningún valor del desplegable es un tipo (tampoco los de los tipos retirados)", () => {
    expect(tipoDeValor("tipo:reservas")).toBeNull();
    expect(tipoDeValor("tipo:albaranes")).toBeNull();
    expect(tipoDeValor("manual")).toBeNull();
    expect(tipoDeValor("5f0c8a3e-0000-4000-8000-000000000000")).toBeNull();
    expect(tipoDeValor("")).toBeNull();
    expect(tipoDeValor(null)).toBeNull();
    expect(tipoDeValor(undefined)).toBeNull();
  });

  it("ningún usuario guardado se reconoce como tipo, tenga lo que tenga", () => {
    expect(tipoQueCoincide([])).toBeNull();
    expect(tipoQueCoincide([{ section_key: "dashboard", can_view: true, can_edit: false }])).toBeNull();
    expect(tipoQueCoincide(SECCIONES_CONFIGURABLES.map((s) => ({ section_key: s.key, can_view: true, can_edit: true })))).toBeNull();
    // Un usuario de antes con los permisos del tipo «Albaranes» (sección retirada) tampoco.
    expect(tipoQueCoincide([{ section_key: "facturas_albaranes", can_view: true, can_edit: false }])).toBeNull();
  });
});
