// Web › Tarifas: la fila única de web_tarifas (config + catálogo). La web la lee con su clave pública; aquí se lee y
// se guarda entera (con «Editar» en Web · Tarifas; la base lo exige). Lo que falte en `config` sale del código
// (mergePricing), así el editor siempre tiene todos los precios.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { mergePricing, type Catalogo } from "@/lib/web/pricing/tarifas";
import type { PricingConfig } from "@/lib/web/pricing/config";
import { limpiarCatalogo, type EstadoTarifas } from "@/lib/web/tarifasEditor";
import { mensajeErrorWeb } from "@/lib/web/fotos";

export const CLAVE_WEB_TARIFAS = ["web-tarifas"] as const;

export interface TarifasGuardadas extends EstadoTarifas {
  actualizadoEn: string | null;
}

export const useTarifasWeb = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: CLAVE_WEB_TARIFAS,
    enabled,
    retry: false,
    queryFn: async (): Promise<TarifasGuardadas> => {
      const { data, error } = await supabase.from("web_tarifas").select("config, catalogo, actualizado_en").eq("id", 1).maybeSingle();
      if (error) throw error;
      const catalogo = data?.catalogo && typeof data.catalogo === "object" && !Array.isArray(data.catalogo) ? (data.catalogo as Catalogo) : {};
      return {
        config: mergePricing((data?.config ?? null) as Partial<PricingConfig> | null),
        catalogo: limpiarCatalogo(catalogo),
        actualizadoEn: data?.actualizado_en ?? null,
      };
    },
  });

export function useGuardarTarifas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (estado: EstadoTarifas) => {
      const { error } = await supabase
        .from("web_tarifas")
        .upsert({ id: 1, config: estado.config as unknown as Json, catalogo: limpiarCatalogo(estado.catalogo) as unknown as Json }, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLAVE_WEB_TARIFAS });
      toast.success("Tarifas guardadas", { description: "La calculadora de la web las usará en un minuto, más o menos." });
    },
    onError: (e) => toast.error("No se han guardado las tarifas", { description: mensajeErrorWeb(e, "Web · Tarifas") }),
  });
}
