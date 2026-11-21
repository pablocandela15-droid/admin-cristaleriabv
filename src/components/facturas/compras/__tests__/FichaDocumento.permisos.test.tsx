/**
 * Ficha de documento (Compras) según los permisos (dueño, 06/11/2026):
 *   · solo «Ver»: se consulta (original, importes, líneas), sin «Editar», sin
 *     lápiz en las líneas, sin «Añadir línea» y sin «Preguntar a la IA».
 *   · Subida + «Ver»: corrige lo que subió él (y nada de otros).
 *   · «Editar»: corrige cualquiera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
const h = vi.hoisted(() => ({
  permisos: {} as Permisos,
  subidoPor: null as string | null,
  consultas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const cadena = {
        select: (columnas: string) => {
          h.consultas.push(`${tabla}:${columnas}`);
          return cadena;
        },
        eq: () => cadena,
        maybeSingle: async () => ({ data: tabla === "facturas" ? { subido_por: h.subidoPor } : null, error: null }),
      };
      return cadena;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useUsuarioIdOpcional: () => "u-1" }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({ canAccess: !!h.permisos[seccion]?.[tipo], loading: false }),
}));
vi.mock("@/components/facturas/CosteLecturaDocumento", () => ({ CosteLecturaFactura: () => null }));
vi.mock("@/components/facturas/shared/OriginalIncrustado", () => ({ OriginalIncrustado: () => null }));
vi.mock("@/components/facturas/shared/BotonOriginal", () => ({ BotonOriginal: () => <button type="button">Ver original</button> }));

import { FichaDocumento } from "../FichaDocumento";
import type { Factura } from "@/hooks/useFacturas";

const doc = {
  id: 42, numero_documento: "F-1", proveedor: "P", cif: null, fecha: "2026-09-01",
  subtotal: 10, iva: 1, total: 11, observaciones: null, archivo_path: null, verificada: false,
  productos: [{ id: 1, producto_nombre: "Espejo", cantidad: 2, unidad: "m2", precio_unitario: 5, precio: 10, proveedor: null }],
} as unknown as Factura;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FichaDocumento
        doc={doc}
        avisos={[]}
        onEditar={vi.fn()}
        onAbrirProducto={vi.fn()}
        onAbrirProveedor={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const acciones = () => ({
  editar: screen.queryByRole("button", { name: "Editar" }),
  lapiz: screen.queryByRole("button", { name: "Editar Espejo" }),
  anadir: screen.queryByRole("button", { name: /añadir línea/i }),
});

beforeEach(() => {
  h.permisos = {};
  h.subidoPor = null;
  h.consultas = [];
});
afterEach(cleanup);

describe("FichaDocumento · permisos", () => {
  it("solo «Ver»: consulta sin nada para cambiar (ni pregunta de quién es)", () => {
    h.permisos = { facturas: { view: true } };
    montar();
    expect(screen.getByRole("heading", { name: "Factura F-1" })).toBeInTheDocument();
    expect(screen.getByText("Espejo")).toBeInTheDocument();
    // El original se ve en el visor de la ficha (aquí simulado): no hay botón «Ver original»,
    // y sin «Editar» tampoco queda la caja de acciones vacía.
    expect(screen.queryByRole("button", { name: "Ver original" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Acciones del documento" })).not.toBeInTheDocument();
    expect(acciones()).toEqual({ editar: null, lapiz: null, anadir: null });
    expect(h.consultas).toEqual([]);
  });

  it("Subida + «Ver», documento suyo: lo corrige (cabecera y líneas)", async () => {
    h.permisos = { facturas: { view: true }, facturas_subida: { view: true } };
    h.subidoPor = "u-1";
    montar();
    await waitFor(() => expect(acciones().editar).not.toBeNull());
    expect(acciones().lapiz).not.toBeNull();
    expect(acciones().anadir).not.toBeNull();
    expect(h.consultas).toEqual(["facturas:subido_por"]);
  });

  it("Subida + «Ver», documento de otro: solo consulta", async () => {
    h.permisos = { facturas: { view: true }, facturas_subida: { view: true } };
    h.subidoPor = "otra-persona";
    montar();
    await waitFor(() => expect(h.consultas).toEqual(["facturas:subido_por"]));
    expect(acciones()).toEqual({ editar: null, lapiz: null, anadir: null });
  });

  it("«Editar»: corrige cualquiera sin preguntar de quién es", () => {
    h.permisos = { facturas: { view: true, edit: true } };
    h.subidoPor = "otra-persona";
    montar();
    expect(acciones().editar).not.toBeNull();
    expect(acciones().lapiz).not.toBeNull();
    expect(acciones().anadir).not.toBeNull();
    expect(h.consultas).toEqual([]);
  });
});
