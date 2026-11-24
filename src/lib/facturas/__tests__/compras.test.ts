import { describe, expect, it } from "vitest";
import type { Factura, ProductoFactura } from "@/hooks/useFacturas";
import {
  busquedaConFicha,
  esNavegacionDeFicha,
  estadoConFichas,
  pilaDeFichas,
  contarFiltrosDocumentos,
  contarPorModo,
  documentosDeProveedor,
  filtrarDocumentos,
  filtrarProveedoresCompras,
  nombresConSubida,
  normalizarFichaProveedor,
  proveedoresDelTexto,
  textoFrecuencia,
} from "../compras";
import { crearResolverProveedor, type Proveedor } from "../proveedores";
import type { ResumenProducto } from "../productos";

const linea = (id: number, nombre: string, canonico: string | null = null): ProductoFactura => ({
  id,
  producto_nombre: nombre,
  precio: 10,
  proveedor: null,
  producto_canonico: canonico,
});

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  numero_documento: `D-${id}`,
  proveedor: null,
  cif: null,
  fecha: "2026-09-01",
  subtotal: null,
  iva: null,
  total: 100,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: false,
  ...extra,
});

const prov = (id: number, nombre: string, extra: Partial<Proveedor> = {}): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 1,
  total: 100,
  ultima_fecha: "2026-09-01",
  variantes: [nombre],
  alias: [],
  cifs_extra: [],
  ...extra,
});

const PROVEEDORES = [
  prov(1, "Vidrios del Vinalopó S.L.", { variantes: ["VIDRIOS DEL VINALOPO, S.L.", "Vidrios del Vinalopó"], documentos: 3 }),
  prov(2, "Aluminios Elda", { variantes: ["ALUMINIOS ELDA, S.L."], documentos: 1 }),
  prov(3, "Sin documentos", { documentos: 0, variantes: ["Sin documentos"] }),
];
const resolver = crearResolverProveedor(PROVEEDORES);

const DOCS: Factura[] = [
  doc(1, { numero_documento: "F-100", proveedor: "VIDRIOS DEL VINALOPO, S.L.", productos: [linea(1, "TEMPL 8MM INC", "Vidrio templado 8 mm incoloro")] }),
  doc(2, { numero_documento: "F-101", proveedor: "ALUMINIOS ELDA, S.L.", verificada: true, productos: [linea(2, "Perfil aluminio anodizado plata")] }),
  doc(3, { numero_documento: "F-102", proveedor: "Vidrios del Vinalopó", fecha: "2026-10-01", productos: [linea(3, "Templado extraclaro")] }),
  doc(4, { numero_documento: "F-103", proveedor: "VIDRIOS DEL VINALOPO, S.L.", fecha: "2026-09-15", verificada: true, productos: [linea(5, "Templado 10 mm")] }),
];
const AVISOS = new Map<number, unknown[]>([[2, [{ codigo: "iva_incoherente" }]]]);

describe("documentos", () => {
  it("el texto busca en cabecera y en el nombre de cada línea, sin tildes ni mayúsculas", () => {
    const ids = (t: string) => filtrarDocumentos(DOCS, t, "todo", AVISOS).map((d) => d.id);
    expect(ids("TEMPLADO")).toEqual([3, 4, 1]);
    expect(ids("extraclaro")).toEqual([3]);
    expect(ids("elda anodizado")).toEqual([2]); // todas las palabras
    expect(ids("F-101")).toEqual([2]);
    expect(ids("vinalopo")).toEqual([3, 4, 1]);
    expect(ids("zzz")).toEqual([]);
    expect(ids("")).toHaveLength(4);
  });

  it("cada chip filtra lo suyo y se combina con el texto", () => {
    const ids = (t: string, f: Parameters<typeof filtrarDocumentos>[2]) => filtrarDocumentos(DOCS, t, f, AVISOS).map((d) => d.id);
    expect(ids("", "con_avisos")).toEqual([2]);
    expect(ids("", "sin_revisar").sort()).toEqual([1, 3]);
    expect(ids("templado", "sin_revisar")).toEqual([3, 1]);
  });

  it("los contadores de los chips son los del texto buscado", () => {
    expect(contarFiltrosDocumentos(DOCS, "templado", AVISOS)).toEqual({ todo: 3, abonos: 0, con_avisos: 0, sin_revisar: 2 });
  });

  it("chip «Abonos»: los documentos con total negativo", () => {
    const conAbono = [...DOCS, { ...DOCS[0], id: 99, numero_documento: "AB-1", total: -40 }];
    expect(filtrarDocumentos(conAbono, "", "abonos", AVISOS).map((d) => d.id)).toEqual([99]);
    expect(contarFiltrosDocumentos(conAbono, "", AVISOS).abonos).toBe(1);
  });

  it("del más reciente al más antiguo", () => {
    expect(filtrarDocumentos(DOCS, "", "todo", AVISOS).map((d) => d.id)).toEqual([3, 4, 2, 1]);
  });
});

describe("proveedores", () => {
  it("un texto trae a quien se llama así y a quien lo vende", () => {
    expect(proveedoresDelTexto(PROVEEDORES, DOCS, "templado", resolver).map((p) => p.id)).toEqual([1]);
    expect(proveedoresDelTexto(PROVEEDORES, DOCS, "elda", resolver).map((p) => p.id)).toEqual([2]);
    expect(proveedoresDelTexto(PROVEEDORES, DOCS, "", resolver)).toHaveLength(3);
  });

  it("la lista del modo Proveedores va de más a menos documentos", () => {
    expect(filtrarProveedoresCompras(PROVEEDORES, DOCS, "", resolver).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(filtrarProveedoresCompras(PROVEEDORES, DOCS, "anodizado", resolver).map((p) => p.id)).toEqual([2]);
  });

  it("documentos de un proveedor", () => {
    expect(documentosDeProveedor(DOCS, PROVEEDORES[0], resolver).map((d) => d.id)).toEqual([3, 4, 1]);
  });
});

describe("contador por modo", () => {
  const producto = (id: number, nombre: string): ResumenProducto => ({
    producto_id: id,
    nombre,
    categoria_id: null,
    origen: "ia",
    unidad_habitual: null,
    compras: 1,
    documentos: 1,
    cantidades: {},
    gasto: 10,
    lineas_sin_importe: 0,
    ultimo_precio: 1,
    ultima_fecha: null,
    proveedores: [],
  });
  const productos = [producto(1, "Vidrio templado 8 mm incoloro"), producto(2, "Templado extraclaro"), producto(3, "Silicona neutra")];

  it("«templado»: 3 documentos · 2 productos · 1 proveedor", () => {
    expect(
      contarPorModo({ texto: "templado", documentos: DOCS, productos, proveedores: PROVEEDORES, mapaCategorias: new Map(), resolver }),
    ).toEqual({ documentos: 3, productos: 2, proveedores: 1 });
  });

  it("sin texto, el total de cada modo", () => {
    expect(
      contarPorModo({ texto: "  ", documentos: DOCS, productos, proveedores: PROVEEDORES, mapaCategorias: new Map(), resolver }),
    ).toEqual({ documentos: 4, productos: 3, proveedores: 3 });
  });
});

describe("subidas de precio y ficha de proveedor", () => {
  it("nombres con subida (filas de productos_con_subida), normalizados; basura = vacío", () => {
    const s = nombresConSubida([{ nombre: "Vidrio Templado 8 mm" }, { nombre: "" }, {}, null]);
    expect([...s]).toEqual(["vidrio templado 8 mm"]);
    expect(nombresConSubida({ error: "x" }).size).toBe(0);
    expect(nombresConSubida(null).size).toBe(0);
  });

  it("normaliza la ficha de la RPC", () => {
    const f = normalizarFichaProveedor({
      proveedor: "Vidrios del Vinalopó S.L.",
      docs: "5",
      ultima: "2026-10-01",
      intervalo_medio_dias: 9,
      gasto: 1234.5,
      top_productos: [{ producto: "Vidrio templado 8 mm", unidad: "m2", ultimo_precio: 42.9, ultima_fecha: "2026-10-01" }, { sin: "nombre" }],
    });
    expect(f).toMatchObject({ proveedor: "Vidrios del Vinalopó S.L.", docs: 5, intervalo_medio_dias: 9, gasto: 1234.5 });
    expect(f && "top_productos" in f && f.top_productos).toHaveLength(1);
  });

  it("sin datos, con error y basura", () => {
    expect(normalizarFichaProveedor({ sin_datos: true, buscado: "x", nota: "Ninguno" })).toEqual({ sinDatos: true, nota: "Ninguno" });
    expect(normalizarFichaProveedor({ error: "Falta el nombre." })).toEqual({ sinDatos: true, nota: "Falta el nombre." });
    expect(normalizarFichaProveedor(7)).toBeNull();
  });

  it("frecuencia en palabras", () => {
    expect(textoFrecuencia(null)).toBeNull();
    expect(textoFrecuencia(3)).toBe("cada 3 días");
    expect(textoFrecuencia(7)).toBe("cada semana");
    expect(textoFrecuencia(14)).toBe("cada dos semanas");
    expect(textoFrecuencia(30)).toBe("cada mes");
    expect(textoFrecuencia(90)).toBe("cada 3 meses");
  });
});

describe("fichas en el historial", () => {
  it("lee la pila del state y descarta lo que no es una ficha", () => {
    expect(pilaDeFichas(null)).toEqual([]);
    expect(pilaDeFichas({ otra: 1 })).toEqual([]);
    expect(pilaDeFichas(estadoConFichas([{ tipo: "documento", id: 3 }, { tipo: "producto", id: 9 }]))).toEqual([
      { tipo: "documento", id: 3 },
      { tipo: "producto", id: 9 },
    ]);
    expect(pilaDeFichas({ fichaCompras: { pila: [{ tipo: "x", id: 1 }, { tipo: "producto", id: 1.5 }, { tipo: "producto", id: 2 }] } })).toEqual([
      { tipo: "producto", id: 2 },
    ]);
    expect(esNavegacionDeFicha(estadoConFichas([{ tipo: "documento", id: 1 }]))).toBe(true);
    expect(esNavegacionDeFicha(estadoConFichas([]))).toBe(false);
  });

  it("la URL lleva ?doc= o ?producto= y pierde los otros enlaces de Compras", () => {
    expect(busquedaConFicha("?tab=compras&modo=documentos&doc=7&mes=2026-08", { tipo: "producto", id: 4 })).toBe("?tab=compras&producto=4");
    expect(busquedaConFicha("?tab=productos&x=1", { tipo: "documento", id: 2 })).toBe("?tab=compras&x=1&doc=2");
    expect(busquedaConFicha("?tab=compras&doc=7", null)).toBe("?tab=compras");
  });
});
