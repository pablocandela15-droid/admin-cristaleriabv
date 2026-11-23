/**
 * Motor de precios de la web copiado tal cual de cristaleriabv (src/lib/web/pricing/{config,categories,tarifas}.ts):
 * lo que guarda el panel en `web_tarifas` lo aplica `resolverTarifas` igual que la web. Si alguien cambia los
 * ficheros en un repo y no en el otro, estas pruebas son las primeras en notarlo.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "@/lib/web/pricing/config";
import { categories, type Values } from "@/lib/web/pricing/categories";
import { mergePricing, resolverTarifas, type Catalogo } from "@/lib/web/pricing/tarifas";

const espejo: Values = { ancho: 100, alto: 100, espesor: "4", canto: "pulido", forma: "rectangular", cantidad: 1 };
const opcionesForma = (r: ReturnType<typeof resolverTarifas>) => {
  const f = r.categorias.espejos.sections.flatMap((s) => s.fields).find((x) => x.id === "forma");
  return f && "options" in f ? f.options.map((o) => o.value) : [];
};

describe("resolverTarifas", () => {
  it("sin fila: los precios y las categorías del código, todas activas", () => {
    const r = resolverTarifas(categories, null);
    expect(r.precios).toEqual(DEFAULT_PRICING);
    expect(Object.values(r.categorias).every((c) => c.activo)).toBe(true);
    // 1 m² × 65 €/m² × 1 (4 mm) × 1,15 (pulido) = 74,75 → 75
    expect(r.categorias.espejos.quote(espejo, r.precios).total).toBe(75);
  });

  it("una opción oculta desaparece del campo", () => {
    const catalogo: Catalogo = {
      categorias: {
        espejos: {
          campos: {
            forma: {
              opciones: [
                { value: "rectangular", label: "Rectangular" },
                { value: "redondo", label: "Redondo" },
                { value: "ovalado", label: "Ovalado" },
                { value: "irregular", label: "Irregular", activo: false },
              ],
            },
          },
        },
      },
    };
    expect(opcionesForma(resolverTarifas(categories, { catalogo }))).toEqual(["rectangular", "redondo", "ovalado"]);
  });

  it("una opción nueva con su multiplicador cambia el precio de un espejo", () => {
    const config = { espejos: { factors: { forma: { ...DEFAULT_PRICING.espejos.factors.forma, hexagonal: 1.5 } } } };
    const catalogo: Catalogo = {
      categorias: {
        espejos: {
          campos: {
            forma: {
              opciones: [
                { value: "rectangular", label: "Rectangular" },
                { value: "hexagonal", label: "Hexagonal" },
              ],
            },
          },
        },
      },
    };
    const r = resolverTarifas(categories, { config: config as never, catalogo });
    expect(opcionesForma(r)).toEqual(["rectangular", "hexagonal"]);
    const normal = r.categorias.espejos.quote(espejo, r.precios).total;
    const hexagonal = r.categorias.espejos.quote({ ...espejo, forma: "hexagonal" }, r.precios).total;
    expect(normal).toBe(75);
    expect(hexagonal).toBe(112); // 74,75 × 1,5 = 112,125
    // Lo demás de la categoría sigue con los valores por defecto (mezcla por niveles).
    expect(r.precios.espejos.factors.canto).toEqual(DEFAULT_PRICING.espejos.factors.canto);
    expect(r.precios.espejos.basePerM2).toBe(65);
  });

  it("una categoría oculta vuelve con activo = false (y se puede seguir calculando)", () => {
    const r = resolverTarifas(categories, { catalogo: { categorias: { domino: { activo: false, nombre: "Dominó" } } } });
    expect(r.categorias.domino.activo).toBe(false);
    expect(r.categorias.domino.name).toBe("Dominó");
    expect(r.categorias.mamparas.activo).toBe(true);
    expect(r.categorias.domino.quote({ ...r.categorias.domino.defaults, ancho: 100, alto: 100 }, r.precios).ready).toBe(true);
  });

  it("los campos obligatorios no se ocultan; los demás sí", () => {
    const r = resolverTarifas(categories, {
      catalogo: { categorias: { mamparas: { campos: { tipoMampara: { activo: false }, composicion: { activo: false } } } } },
    });
    const ids = r.categorias.mamparas.sections.flatMap((s) => s.fields).map((f) => f.id);
    expect(ids).toContain("tipoMampara");
    expect(ids).not.toContain("composicion");
  });

  it("si la opción por defecto se oculta, el valor de partida pasa a la primera que queda", () => {
    const r = resolverTarifas(categories, {
      catalogo: { categorias: { espejos: { campos: { forma: { opciones: [{ value: "rectangular", label: "R", activo: false }, { value: "redondo", label: "Redondo" }] } } } } },
    });
    expect(r.categorias.espejos.defaults.forma).toBe("redondo");
  });

  it("mergePricing: lo que falta sale del código; lo que viene, manda", () => {
    const p = mergePricing({ mamparas: { base: 250 } } as never);
    expect(p.mamparas.base).toBe(250);
    expect(p.mamparas.perCmWidth).toBe(DEFAULT_PRICING.mamparas.perCmWidth);
    expect(p.domino).toEqual(DEFAULT_PRICING.domino);
    expect(mergePricing(null)).toBe(DEFAULT_PRICING);
  });

  it("quote se llama como método (usa this) y la mampara suma sus suplementos", () => {
    const r = resolverTarifas(categories, null);
    const v: Values = { ...categories.mamparas.defaults, ancho: 100, alto: 195, cristal: "templado-10mm" };
    // 200 base + 100 cm × 3 €/cm + 100 € por el cristal de 10 mm
    expect(r.categorias.mamparas.quote(v, r.precios).total).toBe(600);
  });
});
