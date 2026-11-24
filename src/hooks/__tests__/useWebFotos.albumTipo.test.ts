/**
 * Book de un tipo de trabajo (`asegurarAlbumTipo`): se busca por su slug, se crea si no está (título = nombre del
 * tipo, publicado), se vuelve a leer si otra persona lo creó a la vez (23505) y se arregla si estaba sin publicar.
 */
import { describe, expect, it } from "vitest";
import { asegurarAlbumTipo } from "@/hooks/useWebFotos";

type Respuesta = { data: unknown; error: unknown };

/** Cliente falso: responde en orden a cada búsqueda, alta y cambio, y apunta lo que se pidió. */
function clienteFalso({ busquedas = [] as Respuesta[], altas = [] as Respuesta[], cambios = [] as Respuesta[] } = {}) {
  const pedido: { tipo: string; tabla: string; datos?: unknown; filtro?: [string, unknown] }[] = [];
  const cliente = {
    from: (tabla: string) => ({
      select: () => ({
        eq: (col: string, valor: unknown) => ({
          maybeSingle: async () => (pedido.push({ tipo: "buscar", tabla, filtro: [col, valor] }), busquedas.shift() ?? { data: null, error: null }),
        }),
      }),
      insert: (datos: unknown) => ({
        select: () => ({ single: async () => (pedido.push({ tipo: "alta", tabla, datos }), altas.shift() ?? { data: null, error: null }) }),
      }),
      update: (datos: unknown) => ({
        eq: async (col: string, valor: unknown) => (pedido.push({ tipo: "cambio", tabla, datos, filtro: [col, valor] }), cambios.shift() ?? { data: null, error: null }),
      }),
    }),
  };
  return { cliente: cliente as never, pedido };
}

describe("asegurarAlbumTipo", () => {
  it("ya existe: devuelve su id sin crear nada", async () => {
    const { cliente, pedido } = clienteFalso({ busquedas: [{ data: { id: "a1", servicio: "mamparas", publicado: true }, error: null }] });
    await expect(asegurarAlbumTipo("mamparas", { cliente })).resolves.toBe("a1");
    expect(pedido).toEqual([{ tipo: "buscar", tabla: "web_albumes", filtro: ["slug", "trabajos-mamparas"] }]);
  });

  it("no existe: lo crea con el nombre del tipo, publicado y al final de la lista", async () => {
    const { cliente, pedido } = clienteFalso({ altas: [{ data: { id: "nuevo", servicio: "domino", publicado: true }, error: null }] });
    await expect(asegurarAlbumTipo("domino", { cliente, ordenes: [0, 4] })).resolves.toBe("nuevo");
    expect(pedido[1]).toEqual({
      tipo: "alta",
      tabla: "web_albumes",
      datos: { slug: "trabajos-domino", titulo: "Dominó", servicio: "domino", publicado: true, orden: 5 },
    });
    expect(pedido).toHaveLength(2);
  });

  it("otra persona lo crea a la vez (slug repetido): lo vuelve a leer", async () => {
    const { cliente, pedido } = clienteFalso({
      busquedas: [
        { data: null, error: null },
        { data: { id: "del-otro", servicio: "espejos", publicado: true }, error: null },
      ],
      altas: [{ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }],
    });
    await expect(asegurarAlbumTipo("espejos", { cliente })).resolves.toBe("del-otro");
    expect(pedido.map((p) => p.tipo)).toEqual(["buscar", "alta", "buscar"]);
  });

  it("estaba sin publicar (o con otro servicio): lo publica en su tipo", async () => {
    const { cliente, pedido } = clienteFalso({ busquedas: [{ data: { id: "a1", servicio: null, publicado: false }, error: null }] });
    await expect(asegurarAlbumTipo("otros", { cliente })).resolves.toBe("a1");
    expect(pedido[1]).toEqual({ tipo: "cambio", tabla: "web_albumes", datos: { servicio: "otros", publicado: true }, filtro: ["id", "a1"] });
  });

  it("cualquier otro fallo se lanza (p. ej. sin permiso)", async () => {
    const sinPermiso = { code: "42501", message: "new row violates row-level security policy" };
    const { cliente } = clienteFalso({ altas: [{ data: null, error: sinPermiso }] });
    await expect(asegurarAlbumTipo("aluminio", { cliente })).rejects.toBe(sinPermiso);
    const { cliente: c2 } = clienteFalso({ busquedas: [{ data: null, error: { message: "red" } }] });
    await expect(asegurarAlbumTipo("aluminio", { cliente: c2 })).rejects.toEqual({ message: "red" });
  });
});
