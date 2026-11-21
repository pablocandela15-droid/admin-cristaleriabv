// ============================================================================
//  Facturas › Compras — lecturas de las fichas (RPC de solo lectura, sin IA)
// ----------------------------------------------------------------------------
//  · ficha_proveedor(p_proveedor_id) → ficha de proveedor (qué le compras, cada
//    cuánto, último pedido)
//  · productos_con_subida()          → filtro «Subieron de precio» de Productos
//  Migración 20261121100000_facturas. Si fallan, el error se enseña en su sitio
//  sin romper el resto de la pantalla.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nombresConSubida, normalizarFichaProveedor } from "@/lib/facturas/compras";

export const CLAVE_COMPRAS = "compras";

/** Ficha de un proveedor unificado (qué le compras, cada cuánto, último pedido). */
export const useFichaProveedor = (proveedorId: number | null) =>
  useQuery({
    queryKey: [CLAVE_COMPRAS, "ficha-proveedor", proveedorId],
    enabled: proveedorId !== null,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ficha_proveedor", { p_proveedor_id: proveedorId as number });
      if (error) throw new Error(error.message || "Error en la consulta");
      return normalizarFichaProveedor(data);
    },
  });

/**
 * Productos cuya última compra llegó con aviso de subida de precio (el umbral
 * de Productos › Avisos de precio). Nombres normalizados.
 */
export const useProductosConSubida = (activo: boolean) =>
  useQuery({
    queryKey: [CLAVE_COMPRAS, "subidas"],
    enabled: activo,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.rpc("productos_con_subida");
      if (error) throw new Error(error.message || "Error en la consulta");
      return nombresConSubida(data);
    },
  });
