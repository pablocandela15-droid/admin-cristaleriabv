import { describe, expect, it, vi } from "vitest";
import {
  agruparPendientes,
  type Categoria,
  clasificarPendientes,
  construirMensajes,
  type LineaPendiente,
  type ProductoCatalogo,
  validarAsignaciones,
} from "./clasificacion.ts";

const categorias: Categoria[] = [
  { id: 1, nombre: "Vidrio", padre_id: null, descripcion: null, activa: true },
  { id: 2, nombre: "Templado", padre_id: 1, descripcion: "Vidrio templado de seguridad", activa: true },
  { id: 3, nombre: "Consumibles", padre_id: null, descripcion: null, activa: true },
  { id: 4, nombre: "Vieja", padre_id: null, descripcion: null, activa: false },
];
const catalogo: ProductoCatalogo[] = [{ id: 10, nombre: "Silicona neutra transparente 300 ml", categoria_id: 3 }];

const linea = (id: number, nombre: string, norm: string | null, extra: Partial<LineaPendiente> = {}): LineaPendiente => ({
  id, nombre, nombre_normalizado: norm, unidad: "ud", precio_unitario: "4.14", proveedor: "VIDRIOS DEL VINALOPO", ...extra,
});

describe("agruparPendientes", () => {
  it("junta las líneas con el mismo texto normalizado y descarta los vacíos", () => {
    const r = agruparPendientes([
      linea(1, "SIL. NEUTRA TRANSP.", "sil. neutra transp."),
      linea(2, "Sil. neutra transp.", "sil. neutra transp."),
      linea(3, "", null),
      linea(4, "Templado 8 mm", "templado 8 mm", { precio_unitario: null }),
    ]);
    expect(r).toEqual([
      { texto: "sil. neutra transp.", ejemplo: "SIL. NEUTRA TRANSP.", proveedor: "VIDRIOS DEL VINALOPO", unidad: "ud", precio: 4.14, lineas: 2 },
      { texto: "templado 8 mm", ejemplo: "Templado 8 mm", proveedor: "VIDRIOS DEL VINALOPO", unidad: "ud", precio: null, lineas: 1 },
    ]);
  });

  it("no pasa del máximo de textos distintos", () => {
    const muchas = Array.from({ length: 10 }, (_, i) => linea(i, `P${i}`, `p${i}`));
    expect(agruparPendientes(muchas, 3)).toHaveLength(3);
  });
});

describe("construirMensajes", () => {
  it("lista categorías activas con su ruta, el catálogo y los textos exactos", () => {
    const [sistema, usuario] = construirMensajes(agruparPendientes([linea(1, "SIL NEUTRA", "sil neutra")]), catalogo, categorias);
    expect(sistema.content).toContain("2: Vidrio › Templado — Vidrio templado de seguridad");
    expect(sistema.content).not.toContain("Vieja");
    expect(usuario.content).toContain("10|Silicona neutra transparente 300 ml|3");
    expect(usuario.content).toContain('"t":"sil neutra"');
  });

  it("pide el nombre de cristalería (espesor, composición y acabado) y deja fuera las medidas de la pieza", () => {
    const [sistema] = construirMensajes(agruparPendientes([linea(1, "TEMPL 8 INC", "templ 8 inc")]), catalogo, categorias);
    expect(sistema.content).toContain("cristalería");
    expect(sistema.content).toContain("Vidrio templado 8 mm incoloro");
    expect(sistema.content).toContain("NO van en el nombre");
    expect(sistema.content).toContain("Otro espesor");
  });

  it("pasa las indicaciones de los proveedores que las tienen", () => {
    const [, usuario] = construirMensajes(agruparPendientes([linea(1, "X", "x")]), catalogo, categorias, {
      fichas: [{ id: 1, nombre: "Vidrios del Vinalopó", notas_ia: "Factura el templado por m²" }, { id: 2, nombre: "Otro", notas_ia: null }],
    });
    expect(usuario.content).toContain("Vidrios del Vinalopó: Factura el templado por m²");
    expect(usuario.content).not.toContain("Otro:");
  });
});

describe("validarAsignaciones", () => {
  const textos = agruparPendientes([
    linea(1, "SIL NEUTRA", "sil neutra"),
    linea(2, "TEMPL 8MM INC", "templ 8mm inc"),
    linea(3, "TEMPLADO 8 MM INCOLORO 1500X800", "templado 8 mm incoloro 1500x800", { unidad: "m2" }),
    linea(4, "RARO", "raro"),
  ]);

  it("acepta producto existente, junta los nuevos con el mismo nombre y descarta basura", () => {
    const items = validarAsignaciones(
      {
        asignaciones: [
          { texto: "sil neutra", producto_id: 10, nombre_nuevo: null, categoria_id: null },
          { texto: "templ 8mm inc", producto_id: null, nombre_nuevo: "Vidrio templado  8 mm incoloro", categoria_id: 2 },
          { texto: "templado 8 mm incoloro 1500x800", producto_id: null, nombre_nuevo: "vidrio templado 8 mm incoloro", categoria_id: null },
          { texto: "inventado", producto_id: 10, nombre_nuevo: null, categoria_id: null },
          { texto: "raro", producto_id: 999, nombre_nuevo: "  ", categoria_id: 2 },
          { texto: "sil neutra", producto_id: null, nombre_nuevo: "Duplicado", categoria_id: 3 },
        ],
      },
      textos,
      catalogo,
      categorias,
    );
    expect(items).toEqual([
      { textos: ["sil neutra"], producto_id: 10, nombre: null, categoria_id: null, unidad: null },
      { textos: ["templ 8mm inc", "templado 8 mm incoloro 1500x800"], producto_id: null, nombre: "Vidrio templado 8 mm incoloro", categoria_id: 2, unidad: "ud" },
    ]);
  });

  it("un id de producto que no existe cae a producto nuevo; una categoría desactivada se ignora", () => {
    const items = validarAsignaciones(
      { asignaciones: [{ texto: "raro", producto_id: 999, nombre_nuevo: "Cosa rara", categoria_id: 4 }] },
      textos,
      catalogo,
      categorias,
    );
    expect(items).toEqual([{ textos: ["raro"], producto_id: null, nombre: "Cosa rara", categoria_id: null, unidad: "ud" }]);
  });

  it("un nombre nuevo que ya está en el catálogo (sin tildes ni mayúsculas) se une a ese producto", () => {
    const items = validarAsignaciones(
      { asignaciones: [{ texto: "raro", producto_id: null, nombre_nuevo: "SILICONA NEUTRA TRANSPARENTE 300 ML", categoria_id: 3 }] },
      textos,
      catalogo,
      categorias,
    );
    expect(items).toEqual([{ textos: ["raro"], producto_id: 10, nombre: null, categoria_id: null, unidad: null }]);
  });

  it("una respuesta sin forma no propone nada", () => {
    expect(validarAsignaciones(null, textos, catalogo, categorias)).toEqual([]);
    expect(validarAsignaciones({ asignaciones: "no" }, textos, catalogo, categorias)).toEqual([]);
  });
});

/** Doble mínimo del cliente de Supabase: from(tabla) encadenable + rpc. */
function dobleSupabase(datos: Record<string, unknown[]>) {
  const rpc = vi.fn(async () => ({ data: { productos_creados: 1, alias_creados: 1, lineas_asignadas: 2 }, error: null }));
  const from = (tabla: string) => {
    const cadena: Record<string, unknown> = {};
    for (const m of ["select", "is", "order", "limit", "in"]) cadena[m] = () => cadena;
    cadena.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: datos[tabla] ?? [], error: null }).then(ok);
    return cadena;
  };
  return { supabase: { from, rpc }, rpc };
}

describe("clasificarPendientes", () => {
  it("sin líneas pendientes no llama al modelo", async () => {
    const { supabase, rpc } = dobleSupabase({ productos_factura: [] });
    const llamarModelo = vi.fn();
    const r = await clasificarPendientes({ supabase, llamarModelo });
    expect(r).toEqual({ pendientes: 0, textos: 0, propuestas: 0, aplicado: null });
    expect(llamarModelo).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("manda a la RPC solo lo validado", async () => {
    const { supabase, rpc } = dobleSupabase({
      productos_factura: [
        { id: 1, nombre: "SIL NEUTRA", nombre_normalizado: "sil neutra", unidad: "ud", precio_unitario: 4.14, facturas: { proveedor: "VIDRIOS DEL VINALOPO" } },
        { id: 2, nombre: "Sil neutra", nombre_normalizado: "sil neutra", unidad: "ud", precio_unitario: 4.14, facturas: { proveedor: "VIDRIOS DEL VINALOPO" } },
      ],
      productos_catalogo: catalogo,
      categorias_producto: categorias,
    });
    const llamarModelo = vi.fn(async () => ({
      asignaciones: [{ texto: "sil neutra", producto_id: 10, nombre_nuevo: null, categoria_id: null }],
    }));
    const r = await clasificarPendientes({ supabase, llamarModelo });
    expect(llamarModelo).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("productos_aplicar_clasificacion_ia", {
      p_items: [{ textos: ["sil neutra"], producto_id: 10, nombre: null, categoria_id: null, unidad: null }],
    });
    expect(r).toMatchObject({ pendientes: 2, textos: 1, propuestas: 1, aplicado: { lineas_asignadas: 2 } });
  });
});
