import { describe, it, expect, beforeEach } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import {
  detalleError,
  errorDefinitivo,
  reintentarConsulta,
  avisosCabecera,
  avisosFicha,
  crearResolverDeLista,
  decodificarLista,
  SIN_REGALADO,
} from "../listaCompras";
import { borrarCopiasLista, CADUCIDAD_COPIA_MS, guardarCopiaLista, leerCopiaLista } from "../copiaListaCompras";
import { agregarPorProveedor } from "../resumenCompras";
import { contarFiltrosDocumentos, filtrarDocumentos } from "../compras";

// Una fila tal cual la devuelve documentos_lista() (orden de la migración 20261121100000_facturas).
const FILA = [
  7, "F-7", "VIDRIOS DEL VINALOPO, S.L.", 3, "B123", "2026-10-02", "90.00", "99.00", "leido",
  "originales/2026/10/7-f7.pdf", false, "auto", 4, [["iva_incoherente", "alta"]], [12.5, true, 1], true, null,
];
const CRUDO = {
  v: 1,
  proveedores: { 3: "Vidrios del Vinalopó S.L." },
  docs: [FILA, [8, "F-8", null, null, null, "2026-10-01", null, null, null, null, true, null, 0, null, null, false, "15.00"]],
};

describe("decodificarLista", () => {
  it("convierte cada array en una cabecera con sus tipos", () => {
    const [f, b] = decodificarLista(CRUDO);
    expect(f).toEqual({
      id: 7, numero_documento: "F-7", proveedor: "VIDRIOS DEL VINALOPO, S.L.", proveedor_id: 3,
      proveedor_canonico: "Vidrios del Vinalopó S.L.", cif: "B123", fecha: "2026-10-02",
      subtotal: 90, total: 99, total_origen: "leido", archivo_path: "originales/2026/10/7-f7.pdf", verificada: false,
      verificacion_origen: "auto", n_lineas: 4, alertas: [{ codigo: "iva_incoherente", severidad: "alta" }],
      regalado: { importe: 12.5, estimado: true, regalos: 1 }, precio_atipico: true, retencion_irpf: null,
    });
    expect(b).toMatchObject({ id: 8, proveedor: null, total: null, alertas: [], regalado: SIN_REGALADO, precio_atipico: false, retencion_irpf: 15 });
  });

  it("rechaza lo que no es la respuesta v1", () => {
    expect(() => decodificarLista(null)).toThrow();
    expect(() => decodificarLista({ v: 2, docs: [] })).toThrow();
  });
});

describe("avisos, filtros y proveedores con cabeceras", () => {
  const cabeceras = decodificarLista(CRUDO);

  it("avisos de la fila: los guardados más el de precio atípico", () => {
    expect(avisosCabecera(cabeceras[0]).map((a) => a.codigo)).toEqual(["iva_incoherente", "precio_atipico_pagina"]);
    expect(avisosCabecera(cabeceras[1])).toEqual([]);
  });

  it("un documento verificado no tiene avisos pendientes en la lista", () => {
    const conAvisos = { ...cabeceras[0], precio_atipico: true };
    expect(avisosCabecera({ ...conAvisos, verificada: false }).length).toBeGreaterThan(0);
    expect(avisosCabecera({ ...conAvisos, verificada: true })).toEqual([]);
  });

  it("el resolver da el proveedor unificado por el id del documento; lo demás, con el de base", () => {
    const resolver = crearResolverDeLista(cabeceras, (t) => ({ clave: `texto:${t}`, nombre: t }));
    expect(resolver("VIDRIOS DEL VINALOPO, S.L.")).toEqual({ clave: "#3", nombre: "Vidrios del Vinalopó S.L." });
    expect(resolver("Otro")).toEqual({ clave: "texto:Otro", nombre: "Otro" });
  });

  it("buscar: la cabecera casa sola; lo que dice el servidor (líneas) se suma", () => {
    const avisos = new Map(cabeceras.map((d) => [d.id, avisosCabecera(d)]));
    expect(filtrarDocumentos(cabeceras, "f-7", "todo", avisos).map((d) => d.id)).toEqual([7]);
    expect(filtrarDocumentos(cabeceras, "templado", "todo", avisos)).toEqual([]);
    expect(filtrarDocumentos(cabeceras, "templado", "todo", avisos, new Set([8])).map((d) => d.id)).toEqual([8]);
    const c = contarFiltrosDocumentos(cabeceras, "", avisos);
    expect(c).toEqual({ todo: 2, abonos: 0, con_avisos: 1, sin_revisar: 1 });
  });

  it("por proveedor suma el regalado que ya trae la cabecera", () => {
    const resolver = crearResolverDeLista(cabeceras, (t) => ({ clave: t, nombre: t }));
    const a = agregarPorProveedor(cabeceras, resolver).get("#3");
    expect(a).toMatchObject({ gasto: 99, regalado: 12.5, regaladoEstimado: true, documentos: [cabeceras[0]] });
  });
});

// ─── La ficha: avisos con la media de referencia de cada línea ──────────────
const linea = (id: number, nombre: string, precio: number, extra: Partial<ProductoFactura> = {}): ProductoFactura => ({
  id, producto_nombre: nombre, precio, precio_unitario: precio, cantidad: 1, proveedor: null, ...extra,
});
const doc = (id: number, productos: ProductoFactura[], extra: Partial<Factura> = {}): Factura => ({
  id, numero_documento: `D-${id}`, proveedor: "Vinalopó", proveedor_normalizado: "vinalopo", cif: null, fecha: `2026-10-${String(id).padStart(2, "0")}`,
  subtotal: null, iva: null, total: 10, total_origen: null, observaciones: null, productos, archivo_path: null,
  alertas: [], procesado_en: null, created_at: null, verificada: true, ...extra,
});

describe("avisosFicha", () => {
  it("una línea que pasa del doble de su media avisa; revisada, ya no", () => {
    const ficha = doc(3, [linea(31, "Templado 8 mm", 30, { media_referencia: 11 }), linea(32, "Portes", 50, { media_referencia: null })]);
    expect(avisosFicha({ ...ficha, verificada: false }).map((a) => a.codigo)).toEqual(["precio_atipico_pagina"]);
    expect(avisosFicha(ficha)).toEqual([]);
    const normal = doc(4, [linea(41, "Templado 8 mm", 12, { media_referencia: 11 })], { verificada: false });
    expect(avisosFicha(normal)).toEqual([]);
  });
});

describe("copia de la lista en el dispositivo", () => {
  beforeEach(() => window.localStorage.clear());

  it("se guarda por usuario y se lee tal cual", () => {
    guardarCopiaLista("u1", CRUDO, 1000);
    expect(leerCopiaLista("u1", 2000)).toEqual({ crudo: CRUDO, guardado: 1000 });
    expect(leerCopiaLista("u2", 2000)).toBeNull();
    expect(leerCopiaLista(null, 2000)).toBeNull();
  });

  it("caducada, de otra versión o rota: no se usa", () => {
    guardarCopiaLista("u1", CRUDO, 1000);
    expect(leerCopiaLista("u1", 1000 + CADUCIDAD_COPIA_MS + 1)).toBeNull();
    window.localStorage.setItem("compras-lista:u1", JSON.stringify({ v: 99, guardado: 1000, crudo: CRUDO }));
    expect(leerCopiaLista("u1", 2000)).toBeNull();
    window.localStorage.setItem("compras-lista:u1", "{roto");
    expect(leerCopiaLista("u1", 2000)).toBeNull();
  });

  it("al cerrar sesión se borran las de todos (y nada más)", () => {
    guardarCopiaLista("u1", CRUDO);
    guardarCopiaLista("u2", CRUDO);
    window.localStorage.setItem("otra-cosa", "1");
    borrarCopiasLista();
    expect(leerCopiaLista("u1")).toBeNull();
    expect(leerCopiaLista("u2")).toBeNull();
    expect(window.localStorage.getItem("otra-cosa")).toBe("1");
  });
});

describe("reintentos de Compras (no reintentar lo que no se va a arreglar)", () => {
  it("sin permiso, 4xx o PostgREST: definitivo; red o 5xx: se reintenta (hasta 2 veces)", () => {
    expect(errorDefinitivo({ code: "42501", message: "permission denied" })).toBe(true);
    expect(errorDefinitivo({ code: "PGRST116" })).toBe(true);
    expect(errorDefinitivo({ status: 403 })).toBe(true);
    expect(errorDefinitivo({ code: "XX000", status: 500 })).toBe(false);
    expect(errorDefinitivo(new Error("Failed to fetch"))).toBe(false);
    expect(reintentarConsulta(0, new Error("Failed to fetch"))).toBe(true);
    expect(reintentarConsulta(2, new Error("Failed to fetch"))).toBe(false);
    expect(reintentarConsulta(0, { code: "42501" })).toBe(false);
  });
  it("el detalle técnico lleva el mensaje y el código", () => {
    expect(detalleError({ message: "fallo", code: "XX000" })).toBe("fallo (XX000)");
    expect(detalleError(null)).toBe("error desconocido");
  });
});
