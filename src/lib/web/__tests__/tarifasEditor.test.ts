/**
 * Editor de Web › Tarifas (src/lib/web/tarifasEditor.ts): cada precio de DEFAULT_PRICING tiene su sitio en el editor,
 * cada campo con opciones apunta a la tabla donde quote() lee su precio, y lo que escribe el editor (opciones nuevas,
 * ocultas, textos, restaurar) lo entiende resolverTarifas igual que la web.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "@/lib/web/pricing/config";
import { categories } from "@/lib/web/pricing/categories";
import { mergePricing, resolverTarifas } from "@/lib/web/pricing/tarifas";
import {
  IDS_CATEGORIAS,
  PRECIOS_ENTREGA,
  anadirOpcion,
  cambiarActivoCampo,
  cambiarActivoCategoria,
  cambiarOpcion,
  cambiarTextoCampo,
  cambiarTextoCategoria,
  camposCategoria,
  categoriaPorDefecto,
  escribirRuta,
  leerPrecio,
  limpiarCatalogo,
  mismoEstado,
  moverOpcion,
  opcionConPrecio,
  opcionesEditables,
  precioDeCampo,
  preciosNoValidos,
  preciosSueltos,
  quitarOpcion,
  restaurarCategoria,
  tieneOpciones,
  valorOpcion,
  type CampoConOpciones,
  type EstadoTarifas,
} from "@/lib/web/tarifasEditor";

const inicial = (): EstadoTarifas => ({ config: mergePricing(null), catalogo: {} });
const campo = (cat: (typeof IDS_CATEGORIAS)[number], id: string) => camposCategoria(cat).find((f) => f.id === id) as CampoConOpciones;

/** Todas las rutas a números de un objeto (sin `version`). */
function hojas(obj: unknown, ruta: string[] = []): string[] {
  if (typeof obj === "number") return [ruta.join(".")];
  if (obj && typeof obj === "object") return Object.entries(obj).flatMap(([k, v]) => (k === "version" ? [] : hojas(v, [...ruta, k])));
  return [];
}

describe("cada precio tiene su sitio en el editor", () => {
  it("las 8 categorías de la calculadora", () => {
    expect(IDS_CATEGORIAS).toEqual(["mamparas", "domino", "espejos", "cerramientos", "aluminio", "barandillas", "armarios", "otros"]);
  });

  it("todos los números de DEFAULT_PRICING salen en algún sitio (sueltos, tablas de opciones o entrega)", () => {
    const config = mergePricing(null);
    const editables = new Set<string>(PRECIOS_ENTREGA.map((p) => p.ruta.join(".")));
    for (const cat of IDS_CATEGORIAS) {
      for (const p of preciosSueltos(cat, config)) editables.add(p.ruta.join("."));
      for (const f of camposCategoria(cat).filter(tieneOpciones)) {
        const donde = precioDeCampo(cat, f, config);
        if (!donde) continue;
        for (const o of f.options) if (opcionConPrecio(donde, o.value)) editables.add([...donde.ruta, o.value].join("."));
      }
    }
    const faltan = hojas(DEFAULT_PRICING).filter((r) => !editables.has(r));
    expect(faltan).toEqual([]);
    // Y ninguno de los sueltos apunta a algo que no existe.
    for (const r of editables) expect(leerPrecio(config, r.split(".")), r).toEqual(expect.any(Number));
  });

  it("cada tabla de multiplicadores es de un campo que existe", () => {
    for (const cat of IDS_CATEGORIAS) {
      const factores = (DEFAULT_PRICING as unknown as Record<string, { factors?: Record<string, unknown> }>)[cat].factors ?? {};
      const ids = camposCategoria(cat).map((f) => f.id);
      for (const f of Object.keys(factores)) expect(ids, `${cat}.${f}`).toContain(f);
    }
  });

  it("dónde lee quote() cada precio", () => {
    const c = mergePricing(null);
    expect(precioDeCampo("espejos", campo("espejos", "forma"), c)).toEqual({ tipo: "factor", ruta: ["espejos", "factors", "forma"] });
    expect(precioDeCampo("mamparas", campo("mamparas", "cristal"), c)).toMatchObject({ tipo: "euros", ruta: ["mamparas", "cristal"] });
    expect(precioDeCampo("mamparas", campo("mamparas", "acabadoCristal"), c)).toMatchObject({ tipo: "euros", ceroSeValora: true });
    expect(precioDeCampo("armarios", campo("armarios", "tipoMadera"), c)).toMatchObject({ tipo: "eurosM2", ruta: ["armarios", "maderaM2"] });
    expect(precioDeCampo("otros", campo("otros", "herrajes"), c)).toMatchObject({ tipo: "euros", ruta: ["otros", "hardware"] });
    expect(precioDeCampo("espejos", campo("espejos", "extras"), c)).toMatchObject({ ruta: ["espejos", "extras"], soloValores: ["iluminacion", "antivaho"] });
    // Sin tabla: sus opciones no cambian el precio.
    expect(precioDeCampo("mamparas", campo("mamparas", "tipoMampara"), c)).toBeNull();
    expect(precioDeCampo("domino", campo("domino", "color"), c)).toBeNull();
  });

  it("extras de las categorías por m² en «precios de la categoría» (0 € = se valora en la visita)", () => {
    const domino = preciosSueltos("domino", mergePricing(null));
    expect(domino.map((p) => p.ruta.join("."))).toEqual([
      "domino.basePerM2", "domino.extras.extraclaro", "domino.extras.antical", "domino.extras.tirador",
      "domino.extras.freno", "domino.extras.caset", "domino.extras.varillaMl",
    ]);
    expect(domino.find((p) => p.ruta[2] === "tirador")).toMatchObject({ etiqueta: "Tirador", ceroSeValora: true });
    // Los del espejo van en la tabla de su campo «Extras», no aquí.
    expect(preciosSueltos("espejos", mergePricing(null)).map((p) => p.ruta.join("."))).toEqual(["espejos.basePerM2"]);
  });
});

describe("opciones", () => {
  it("sin tocar: las del código; al tocarlas se guarda la lista completa y ordenada", () => {
    const forma = campo("espejos", "forma");
    expect(opcionesEditables({}, "espejos", forma).map((o) => o.value)).toEqual(["rectangular", "redondo", "ovalado", "irregular"]);
    const catalogo = cambiarOpcion({}, "espejos", forma, "irregular", { activo: false, label: "A medida" });
    expect(catalogo.categorias?.espejos?.campos?.forma?.opciones).toEqual([
      { value: "rectangular", label: "Rectangular" },
      { value: "redondo", label: "Redondo" },
      { value: "ovalado", label: "Ovalado" },
      { value: "irregular", label: "A medida", activo: false },
    ]);
  });

  it("añadir una forma nueva con multiplicador: el espejo cambia de precio en la calculadora", () => {
    const { estado, valor } = anadirOpcion(inicial(), "espejos", campo("espejos", "forma"), "Hexagonal", 1.5);
    expect(valor).toBe("hexagonal");
    expect(estado.config.espejos.factors.forma.hexagonal).toBe(1.5);
    const r = resolverTarifas(categories, estado);
    const v = { ancho: 100, alto: 100, espesor: "4", canto: "pulido", cantidad: 1 };
    expect(r.categorias.espejos.quote({ ...v, forma: "hexagonal" }, r.precios).total).toBe(112);
    expect(r.categorias.espejos.quote({ ...v, forma: "rectangular" }, r.precios).total).toBe(75);
  });

  it("sin precio indicado: multiplicador 1 o 0 €; en un campo sin tabla, sin precio", () => {
    expect(anadirOpcion(inicial(), "cerramientos", campo("cerramientos", "material"), "Acero").estado.config.cerramientos.factors.material.acero).toBe(1);
    expect(anadirOpcion(inicial(), "mamparas", campo("mamparas", "acabadoPerfil"), "Bronce").estado.config.mamparas.acabadoPerfil.bronce).toBe(0);
    const { estado } = anadirOpcion(inicial(), "mamparas", campo("mamparas", "tipoMampara"), "Doble");
    expect(estado.config).toEqual(inicial().config);
    expect(estado.catalogo.categorias?.mamparas?.campos?.tipoMampara?.opciones?.at(-1)).toEqual({ value: "doble", label: "Doble" });
  });

  it("un extra nuevo del espejo no tiene precio automático (el cálculo de la web solo cobra iluminación y antivaho)", () => {
    const { estado, valor } = anadirOpcion(inicial(), "espejos", campo("espejos", "extras"), "Marco de madera");
    expect(valor).toBe("marco-de-madera");
    expect(estado.config.espejos.extras).toEqual(DEFAULT_PRICING.espejos.extras);
  });

  it("valor sin repetir y sin tildes", () => {
    expect(valorOpcion("Ónix  pulido!", [])).toBe("onix-pulido");
    expect(valorOpcion("Redondo", ["redondo"])).toBe("redondo-2");
    expect(valorOpcion("Redondo", ["redondo", "redondo-2"])).toBe("redondo-3");
    expect(valorOpcion("¿?", [])).toBe("opcion");
  });

  it("quitar solo las nuevas (con su precio); las del código se ocultan", () => {
    const forma = campo("espejos", "forma");
    const { estado } = anadirOpcion(inicial(), "espejos", forma, "Hexagonal", 1.5);
    const sin = quitarOpcion(estado, "espejos", forma, "hexagonal");
    expect(sin.config.espejos.factors.forma).toEqual(DEFAULT_PRICING.espejos.factors.forma);
    expect(opcionesEditables(sin.catalogo, "espejos", forma).map((o) => o.value)).not.toContain("hexagonal");
    expect(quitarOpcion(sin, "espejos", forma, "redondo")).toBe(sin);
  });

  it("ordenar", () => {
    const forma = campo("espejos", "forma");
    const catalogo = moverOpcion({}, "espejos", forma, 3, 0);
    expect(opcionesEditables(catalogo, "espejos", forma).map((o) => o.value)).toEqual(["irregular", "rectangular", "redondo", "ovalado"]);
    expect(moverOpcion({}, "espejos", forma, 0, 9)).toEqual({});
  });
});

describe("categorías y campos", () => {
  it("ocultar una categoría y cambiar sus textos (solo se guarda lo distinto del código)", () => {
    let c = cambiarActivoCategoria({}, "domino", false);
    c = cambiarTextoCategoria(c, "domino", "nombre", "  Dominó a medida ");
    c = cambiarTextoCategoria(c, "domino", "short", categories.domino.short);
    expect(c).toEqual({ categorias: { domino: { activo: false, nombre: "Dominó a medida" } } });
    expect(cambiarActivoCategoria(c, "domino", true)).toEqual({ categorias: { domino: { nombre: "Dominó a medida" } } });
    expect(cambiarTextoCategoria(cambiarActivoCategoria(c, "domino", true), "domino", "nombre", "")).toEqual({});
  });

  it("etiqueta y ayuda de un campo; los obligatorios no se ocultan", () => {
    let c = cambiarTextoCampo({}, "mamparas", "ancho", "label", "Ancho del hueco");
    c = cambiarTextoCampo(c, "mamparas", "ancho", "hint", "");
    expect(c.categorias?.mamparas?.campos?.ancho).toEqual({ label: "Ancho del hueco", hint: "" });
    expect(resolverTarifas(categories, { catalogo: c }).categorias.mamparas.sections[1].fields[0]).toMatchObject({ label: "Ancho del hueco", hint: undefined });
    expect(cambiarActivoCampo({}, "mamparas", "ancho", false)).toEqual({});
    expect(cambiarActivoCampo({}, "mamparas", "composicion", false)).toEqual({ categorias: { mamparas: { campos: { composicion: { activo: false } } } } });
  });

  it("restaurar una categoría deja sus precios y su catálogo como en el código (y no toca las demás)", () => {
    let estado = anadirOpcion(inicial(), "espejos", campo("espejos", "forma"), "Hexagonal", 1.5).estado;
    estado = { ...estado, config: escribirRuta(estado.config, ["espejos", "basePerM2"], 80) };
    estado = { ...estado, config: escribirRuta(estado.config, ["mamparas", "base"], 250), catalogo: cambiarActivoCategoria(estado.catalogo, "otros", false) };
    expect(categoriaPorDefecto(estado, "espejos")).toBe(false);
    const r = restaurarCategoria(estado, "espejos");
    expect(categoriaPorDefecto(r, "espejos")).toBe(true);
    expect(r.config.mamparas.base).toBe(250);
    expect(r.catalogo).toEqual({ categorias: { otros: { activo: false } } });
  });

  it("precios no válidos: vacíos, negativos o un multiplicador 0", () => {
    const e = inicial();
    expect(preciosNoValidos(e)).toEqual([]);
    expect(preciosNoValidos({ ...e, config: escribirRuta(e.config, ["espejos", "factors", "forma", "redondo"], 0) })).toEqual(["espejos.factors.forma.redondo"]);
    expect(preciosNoValidos({ ...e, config: escribirRuta(e.config, ["mamparas", "base"], -1) })).toEqual(["mamparas.base"]);
    expect(preciosNoValidos({ ...e, config: escribirRuta(e.config, ["mamparas", "base"], Number.NaN) })).toEqual(["mamparas.base"]);
    // 0 € en un suplemento sí vale (sin recargo / se valora en la visita).
    expect(preciosNoValidos({ ...e, config: escribirRuta(e.config, ["mamparas", "extraclaro"], 0) })).toEqual([]);
  });

  it("limpiarCatalogo y mismoEstado", () => {
    expect(limpiarCatalogo({ categorias: { espejos: { campos: { forma: {} } }, domino: {} } })).toEqual({});
    expect(mismoEstado(inicial(), { ...inicial(), catalogo: { categorias: {} } })).toBe(true);
    expect(mismoEstado(inicial(), { ...inicial(), catalogo: cambiarActivoCategoria({}, "otros", false) })).toBe(false);
  });
});
