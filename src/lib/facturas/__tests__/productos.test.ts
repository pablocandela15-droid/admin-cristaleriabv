import { describe, expect, it } from "vitest";
import {
  aResumen,
  categoriaRaiz,
  claveProveedor,
  destinoFusionSugerido,
  filtrarProductos,
  formatCantidades,
  indexarCategorias,
  opcionesCategoria,
  proveedoresDe,
  rangoPeriodo,
  rutaCategoria,
  serieDesdeLineas,
  totalesPorRaiz,
  type CategoriaProducto,
  type ResumenProducto,
} from "../productos";

const cat = (id: number, nombre: string, padre_id: number | null = null, orden = id, activa = true): CategoriaProducto => ({
  id, clave: null, nombre, descripcion: null, padre_id, orden, activa,
});
const CATS = [
  cat(1, "Vidrio", null, 10),
  cat(2, "Templado", 1, 10),
  cat(3, "Laminado", 1, 30),
  cat(4, "Herrajes", null, 20),
  cat(5, "Mamparas", 4, 20),
  cat(6, "Servicios", null, 110),
  cat(7, "Vieja", null, 5, false),
];
const MAPA = indexarCategorias(CATS);

const prod = (id: number, nombre: string, categoria_id: number | null, extra: Partial<ResumenProducto> = {}): ResumenProducto => ({
  producto_id: id, nombre, categoria_id, origen: "ia", unidad_habitual: "ud", compras: 1, documentos: 1,
  cantidades: { ud: 1 }, gasto: 10, lineas_sin_importe: 0, ultimo_precio: 10, ultima_fecha: "2026-01-01",
  proveedores: ["VIDRIOS DEL VINALOPO, S.L."], ...extra,
});

describe("categorías", () => {
  it("ruta y raíz", () => {
    expect(rutaCategoria(MAPA, 2)).toBe("Vidrio › Templado");
    expect(rutaCategoria(MAPA, 6)).toBe("Servicios");
    expect(rutaCategoria(MAPA, null)).toBeNull();
    expect(rutaCategoria(MAPA, 99)).toBeNull();
    expect(categoriaRaiz(MAPA, 5)).toBe(4);
    expect(categoriaRaiz(MAPA, 4)).toBe(4);
  });

  it("opciones en árbol, sin las desactivadas salvo la actual", () => {
    expect(opcionesCategoria(CATS).map((o) => o.etiqueta)).toEqual([
      "Vidrio", "Vidrio › Templado", "Vidrio › Laminado", "Herrajes", "Herrajes › Mamparas", "Servicios",
    ]);
    expect(opcionesCategoria(CATS, 7)[0]).toMatchObject({ id: 7, etiqueta: "Vieja", activa: false });
  });
});

describe("formatCantidades", () => {
  it("de mayor a menor, sin ceros, con «sin unidad»", () => {
    expect(formatCantidades({ m2: 75.48, ud: 12, ml: 0 })).toBe("75,48 m2 · 12 ud");
    expect(formatCantidades({ "": 3 })).toBe("3 (sin unidad)");
    expect(formatCantidades({})).toBe("—");
  });
});

describe("proveedores", () => {
  it("la misma empresa con distinta forma jurídica o mayúsculas es una", () => {
    expect(claveProveedor("VIDRIOS DEL VINALOPO, S.L.")).toBe(claveProveedor("Vidrios del Vinalopo, S.L."));
    expect(claveProveedor("TECNOVIDRIO LEVANTE S.L.")).toBe("tecnovidrio levante");
    const lista = proveedoresDe([prod(1, "a", null), prod(2, "b", null, { proveedores: ["Vidrios del Vinalopo, S.L.", "Siliconas Levante"] })]);
    expect(lista.map((p) => p.nombre)).toEqual(["Siliconas Levante", "VIDRIOS DEL VINALOPO, S.L."]);
  });
});

describe("filtrarProductos", () => {
  const lista = [
    prod(1, "Vidrio termico bajo emisivo", 2, { proveedores: ["GRUPO CRISTALVIDRIO S.L."] }),
    prod(2, "Laminado 3+3 incoloro", 3),
    prod(3, "Bisagra vidrio-pared", 5, { compras: 0, gasto: 0 }),
    prod(4, "Portes", 6),
    prod(5, "Sin nada", null),
  ];
  const base = { busqueda: "", categoria: "todas" as const, proveedor: "", soloConCompras: false };

  it("por categoría madre incluye las hijas; por hija solo esa", () => {
    expect(filtrarProductos(lista, { ...base, categoria: 1 }, MAPA).map((p) => p.producto_id)).toEqual([1, 2]);
    expect(filtrarProductos(lista, { ...base, categoria: 3 }, MAPA).map((p) => p.producto_id)).toEqual([2]);
    expect(filtrarProductos(lista, { ...base, categoria: "sin" }, MAPA).map((p) => p.producto_id)).toEqual([5]);
  });

  it("búsqueda sin tildes por nombre o categoría, proveedor y solo con compras", () => {
    expect(filtrarProductos(lista, { ...base, busqueda: "TÉRMICO" }, MAPA).map((p) => p.producto_id)).toEqual([1]);
    expect(filtrarProductos(lista, { ...base, busqueda: "mamparas" }, MAPA).map((p) => p.producto_id)).toEqual([3]);
    expect(filtrarProductos(lista, { ...base, proveedor: claveProveedor("Grupo Cristalvidrio SL") }, MAPA).map((p) => p.producto_id)).toEqual([1]);
    expect(filtrarProductos(lista, { ...base, soloConCompras: true }, MAPA)).toHaveLength(4);
  });

  it("palabra a palabra, no la frase entera", () => {
    const siliconas = [prod(10, "Silicona neutra transparente", null), prod(11, "Silicona acetica blanca", null), prod(12, "Siliconadora", null)];
    expect(filtrarProductos(siliconas, { ...base, busqueda: "silicona transparente" }, MAPA).map((p) => p.producto_id)).toEqual([10]);
    expect(filtrarProductos(siliconas, { ...base, busqueda: "transparente   SILICONA" }, MAPA).map((p) => p.producto_id)).toEqual([10]);
    // Una palabra en el nombre y otra en la categoría también vale.
    expect(filtrarProductos(lista, { ...base, busqueda: "bisagra mamparas" }, MAPA).map((p) => p.producto_id)).toEqual([3]);
  });
});

describe("serieDesdeLineas (gráfica de la ficha de producto)", () => {
  const l = (fecha: string, proveedor: string, precio: number | null, extra: Record<string, unknown> = {}) => ({
    fecha, proveedor, cantidad: 2, unidad: "m2", precio_unitario: precio, total: precio === null ? null : precio * 2, ...extra,
  });

  it("un punto por fecha y proveedor, media ponderada, sin precios a 0", () => {
    const s = serieDesdeLineas("Templado 8 mm", [
      l("2026-09-01", "Vinalopó", 10, { cantidad: 1 }),
      l("2026-09-01", "Vinalopó", 13, { cantidad: 3 }),
      l("2026-09-10", "Vinalopó", 0),
      l("2026-10-01", "Vinalopó", 14),
    ]);
    expect(s).toMatchObject({ producto: "Templado 8 mm", unidad: "m2", proveedores: ["Vinalopó"], n: 2, min: 12.25, max: 14, ultimo: 14 });
    if ("puntos" in s) expect(s.puntos).toEqual([["2026-09-01", 12.25, 0], ["2026-10-01", 14, 0]]);
    if ("variacion_pct" in s) expect(s.variacion_pct).toBe(14.3);
  });

  it("una sola unidad (la más comprada) y sin variación entre proveedores", () => {
    const s = serieDesdeLineas("Silicona neutra", [
      l("2026-09-01", "A", 2),
      l("2026-09-02", "B", 3),
      l("2026-09-03", "A", 20, { unidad: "caja" }),
    ]);
    expect(s).toMatchObject({ unidad: "m2", proveedores: ["A", "B"], n: 2, variacion_pct: null });
  });

  it("varias unidades: las devuelve todas (con sus compras) y se puede elegir otra", () => {
    const lineas = [
      l("2026-09-01", "A", 2),
      l("2026-09-02", "B", 3),
      l("2026-09-02", "B", 3.2),
      l("2026-09-03", "A", 20, { unidad: "Caja" }),
    ];
    const s = serieDesdeLineas("Silicona neutra", lineas);
    expect(s).toMatchObject({ unidad: "m2", unidades: [{ unidad: "m2", n: 2 }, { unidad: "caja", n: 1 }] });
    const caja = serieDesdeLineas("Silicona neutra", lineas, undefined, "caja");
    expect(caja).toMatchObject({ unidad: "caja", n: 1, proveedores: ["A"], unidades: [{ unidad: "m2", n: 2 }, { unidad: "caja", n: 1 }] });
    // Una unidad que ya no existe vuelve a la más comprada.
    expect(serieDesdeLineas("Silicona neutra", lineas, undefined, "saco")).toMatchObject({ unidad: "m2" });
  });

  it("sin líneas válidas: sin datos", () => {
    expect(serieDesdeLineas("Nada", [l("2026-09-01", "A", null)])).toEqual({ sin_datos: true, buscado: "Nada" });
  });
});

describe("totalesPorRaiz", () => {
  it("suma subcategorías en su madre; «Sin categoría» y «Sin clasificar» al final", () => {
    const t = totalesPorRaiz(
      [
        { categoria_id: 2, categoria: "Templado", padre_id: 1, padre: "Vidrio", sin_clasificar: false, gasto: 12513.5, lineas: 23, productos: 23, lineas_sin_importe: 0 },
        { categoria_id: 3, categoria: "Laminado", padre_id: 1, padre: "Vidrio", sin_clasificar: false, gasto: 100.1, lineas: 2, productos: 2, lineas_sin_importe: 0 },
        { categoria_id: 6, categoria: "Servicios", padre_id: null, padre: null, sin_clasificar: false, gasto: 500, lineas: 5, productos: 3, lineas_sin_importe: 0 },
        { categoria_id: null, categoria: "Sin clasificar", padre_id: null, padre: null, sin_clasificar: true, gasto: 20, lineas: 2, productos: 0, lineas_sin_importe: 0 },
        { categoria_id: null, categoria: "Sin categoría", padre_id: null, padre: null, sin_clasificar: false, gasto: 900, lineas: 1, productos: 1, lineas_sin_importe: 0 },
      ],
      MAPA,
    );
    expect(t).toEqual([
      { clave: 1, nombre: "Vidrio", gasto: 12613.6, lineas: 25 },
      { clave: 6, nombre: "Servicios", gasto: 500, lineas: 5 },
      { clave: "sin", nombre: "Sin categoría", gasto: 900, lineas: 1 },
      { clave: "pendiente", nombre: "Sin clasificar", gasto: 20, lineas: 2 },
    ]);
  });
});

describe("rangoPeriodo", () => {
  const hoy = new Date(2026, 9, 7); // 7-oct-2026
  it("calcula los límites inclusivos", () => {
    expect(rangoPeriodo("todo", hoy)).toEqual({ desde: null, hasta: null });
    expect(rangoPeriodo("mes", hoy)).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoPeriodo("mes_anterior", hoy)).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" });
    expect(rangoPeriodo("trimestre", hoy)).toEqual({ desde: "2026-08-01", hasta: "2026-10-31" });
    expect(rangoPeriodo("anio_anterior", hoy)).toEqual({ desde: "2025-01-01", hasta: "2025-12-31" });
    expect(rangoPeriodo("mes_anterior", new Date(2026, 0, 15))).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" });
  });
});

describe("destinoFusionSugerido", () => {
  it("prefiere el corregido a mano, luego el de más compras", () => {
    expect(destinoFusionSugerido([])).toBeNull();
    expect(destinoFusionSugerido([prod(1, "a", null, { compras: 1 }), prod(2, "b", null, { compras: 5 })])).toBe(2);
    expect(destinoFusionSugerido([prod(1, "a", null, { compras: 1, origen: "manual" }), prod(2, "b", null, { compras: 5 })])).toBe(1);
  });
});

describe("aResumen", () => {
  it("convierte numeric en número", () => {
    const r = aResumen({ producto_id: "7", nombre: "X", categoria_id: null, origen: "ia", compras: 2, documentos: 1, cantidades: { m2: "1.500" }, gasto: "12.30", lineas_sin_importe: 0, ultimo_precio: "8.20", ultima_fecha: "2026-01-01", proveedores: ["A"] });
    expect(r).toMatchObject({ producto_id: 7, cantidades: { m2: 1.5 }, gasto: 12.3, ultimo_precio: 8.2 });
  });
});
