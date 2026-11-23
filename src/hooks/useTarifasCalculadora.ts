import { useMemo } from "react";
import { useTarifasWeb } from "@/hooks/useWebTarifas";
import { categories } from "@/lib/web/pricing/categories";
import { resolverTarifas } from "@/lib/web/pricing/tarifas";

/**
 * Categorías (con el catálogo aplicado, también las ocultas en la web) y precios de la calculadora con las tarifas
 * guardadas en Web › Tarifas. Mientras no hay tarifas (o si no se pueden leer), los precios de serie de la web.
 */
export function useTarifasCalculadora({ enabled = true }: { enabled?: boolean } = {}) {
  const consulta = useTarifasWeb({ enabled });
  const resueltas = useMemo(() => resolverTarifas(categories, consulta.data ?? null), [consulta.data]);
  return { ...resueltas, cargando: consulta.isLoading, error: consulta.error, deSerie: !consulta.data };
}
