import { describe, expect, it } from "vitest";
import {
  aProveedor,
  cifsDistintos,
  claveProveedorCanonico,
  crearResolverProveedor,
  destinoFusionProveedorSugerido,
    filtrarProveedores,
  normalizarCif,
  type Proveedor,
} from "../proveedores";
import { filtrarProductos, indexarCategorias, nombresProveedores, proveedoresDe, type ResumenProducto } from "../productos";

const prov = (id: number, nombre: string, extra: Partial<Proveedor> = {}): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: "carga_inicial",
  documentos: 1,
  total: 100,
  ultima_fecha: "2025-12-10",
  variantes: [],
  alias: [],
  cifs_extra: [],
  ...extra,
});

// Proveedores de ejemplo de una cristalería.
const VINALOPO = prov(19, "Vidrios del Vinalopó S.A.", {
  nombre_comercial: "Vinalopó",
  cif: "A12345674",
  documentos: 2,
  variantes: ["Vidrios del Vinalopó S.A.", "VINALOPO (Vidrios del Vinalopó)"],
  alias: ["vidrios del vinalopo", "vinalopo"],
});
const CRISTALPE = prov(26, "Herederos Juan Peña Cristal C.B.", {
  nombre_comercial: "Cristalpe",
  cif: "E13781760",
  variantes: ["HEREDEROS JUAN PEÑA CRISTAL C.B. (CRISTALPE)"],
  alias: ["cristalpe", "herederos juan pena cristal", "herederos juan pena cristal c.b"],
});
const FLOPE = prov(23, "Flopeinversiones, S.L.", {
  cif: "B32455032",
  documentos: 2,
  variantes: ["FLOPEINVERSIONES, S.L."],
  alias: ["flopeinversiones"],
  cifs_extra: ["A22222222"],
});
const SILICONAS = prov(29, "Siliconas Levante", { documentos: 2, variantes: ["Siliconas Levante"], alias: ["siliconas levante"] });
const TODOS = [VINALOPO, CRISTALPE, FLOPE, SILICONAS];

describe("aProveedor", () => {
  it("convierte la fila de la RPC (numeric como texto, arrays nulos)", () => {
    const p = aProveedor({
      id: "19", nombre: "Vidrios del Vinalopó S.A.", nombre_comercial: null, cif: "A12345674", activo: null, origen: "manual",
      documentos: 2, total: "3126.57", ultima_fecha: "2025-12-15",
      variantes: ["a", null, "b"], alias: null, cifs_extra: undefined,
    });
    expect(p).toMatchObject({ id: 19, activo: true, documentos: 2, total: 3126.57 });
    expect(p.variantes).toEqual(["a", "b"]);
    expect(p.alias).toEqual([]);
    expect(p.cifs_extra).toEqual([]);
  });
});

describe("crearResolverProveedor", () => {
  const r = crearResolverProveedor(TODOS);

  it("las dos formas de Vinalopó son el mismo proveedor, con su nombre canónico", () => {
    expect(r("VINALOPO (Vidrios del Vinalopó)")).toEqual({ clave: claveProveedorCanonico(19), nombre: "Vidrios del Vinalopó S.A." });
    expect(r("Vidrios del Vinalopó S.A.")).toEqual(r("VINALOPO (Vidrios del Vinalopó)"));
  });

  it("reconoce el nombre comercial y textos sin documento todavía", () => {
    expect(r("CRISTALPE").nombre).toBe("Herederos Juan Peña Cristal C.B.");
    expect(r("  Siliconas Levante ").clave).toBe(claveProveedorCanonico(29));
    expect(r("Flopeinversiones SL").clave).toBe(claveProveedorCanonico(23));
  });

  it("un texto desconocido (o sin proveedores) se queda con la clave de texto", () => {
    expect(r("Proveedor Nuevo S.L.")).toEqual({ clave: "proveedor nuevo", nombre: "Proveedor Nuevo S.L." });
    expect(crearResolverProveedor(undefined)("VINALOPO (Vidrios del Vinalopó)").clave).toBe("vinalopo (vidrios del vinalopo)");
  });
});

describe("Productos con proveedores unificados", () => {
  const prod = (id: number, proveedores: string[]): ResumenProducto => ({
    producto_id: id, nombre: `P${id}`, categoria_id: null, origen: "manual", unidad_habitual: null, compras: 1, documentos: 1,
    cantidades: {}, gasto: 10, lineas_sin_importe: 0, ultimo_precio: null, ultima_fecha: null, proveedores,
  });
  const lista = [
    prod(1, ["VINALOPO (Vidrios del Vinalopó)"]),
    prod(2, ["Vidrios del Vinalopó S.A.", "Siliconas Levante"]),
    prod(3, ["CRISTALPE"]),
  ];
  const r = crearResolverProveedor(TODOS);

  it("el filtro enseña cada proveedor una vez, con el nombre canónico", () => {
    expect(proveedoresDe(lista, r)).toEqual([
      { clave: "#26", nombre: "Herederos Juan Peña Cristal C.B." },
      { clave: "#29", nombre: "Siliconas Levante" },
      { clave: "#19", nombre: "Vidrios del Vinalopó S.A." },
    ]);
    // Sin resolver: como antes, partido.
    expect(proveedoresDe(lista)).toHaveLength(4);
  });

  it("filtrar por Vinalopó trae los productos de sus dos formas de escribirse", () => {
    const f = { busqueda: "", categoria: "todas" as const, proveedor: "#19", soloConCompras: false };
    expect(filtrarProductos(lista, f, indexarCategorias([]), r).map((p) => p.producto_id)).toEqual([1, 2]);
  });

  it("los nombres de un producto salen canónicos y sin repetir", () => {
    expect(nombresProveedores(prod(9, ["Vidrios del Vinalopó S.A.", "VINALOPO (Vidrios del Vinalopó)"]), r)).toEqual(["Vidrios del Vinalopó S.A."]);
  });
});

describe("filtrarProveedores", () => {
  it("por nombre, comercial, variante o CIF con o sin guion", () => {
    expect(filtrarProveedores(TODOS, "vinalopo").map((p) => p.id)).toEqual([19]);
    expect(filtrarProveedores(TODOS, "cristalpe").map((p) => p.id)).toEqual([26]);
    expect(filtrarProveedores(TODOS, "B-32455032").map((p) => p.id)).toEqual([23]);
    expect(filtrarProveedores(TODOS, "a-2222").map((p) => p.id)).toEqual([23]);
    expect(filtrarProveedores(TODOS, "")).toHaveLength(4);
  });
});

describe("CIF y fusión", () => {
  it("normalizarCif como en SQL", () => {
    expect(normalizarCif("b-32455032")).toBe("B32455032");
    expect(normalizarCif("ESB32455032")).toBe("B32455032");
    expect(normalizarCif(" E 13.781.760 ")).toBe("E13781760");
    expect(normalizarCif("")).toBeNull();
    expect(normalizarCif(null)).toBeNull();
  });

  it("queda el que tiene CIF; luego el de más documentos", () => {
    expect(destinoFusionProveedorSugerido([prov(5, "sin cif", { documentos: 9 }), prov(7, "con cif", { cif: "B1", documentos: 1 })])).toBe(7);
    expect(destinoFusionProveedorSugerido([prov(5, "a", { documentos: 1 }), prov(7, "b", { documentos: 3 })])).toBe(7);
    expect(destinoFusionProveedorSugerido([])).toBeNull();
  });

  it("avisa de CIF distintos", () => {
    expect(cifsDistintos([VINALOPO, SILICONAS])).toEqual(["A12345674"]);
    expect(cifsDistintos([VINALOPO, FLOPE])).toEqual(["A12345674", "B32455032"]);
  });

});
