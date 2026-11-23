// Web › Contenido: las filas de web_contenido (negocio, servicios, faq, imagenes). La web las mezcla sobre su código;
// aquí se leen todas y se guarda cada bloque entero (con «Editar» en Web · Contenido; la base lo exige).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ClaveContenido } from "@/lib/web/contenido";
import { mensajeErrorWeb } from "@/lib/web/fotos";

export const CLAVE_WEB_CONTENIDO = ["web-contenido"] as const;

export type ContenidoWeb = Partial<Record<ClaveContenido, unknown>>;

const NOMBRE: Record<ClaveContenido, string> = {
  negocio: "Datos del negocio guardados",
  servicios: "Servicio guardado",
  faq: "Preguntas frecuentes guardadas",
  imagenes: "Imagen guardada",
};

export const useContenidoWeb = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: CLAVE_WEB_CONTENIDO,
    enabled,
    retry: false,
    queryFn: async (): Promise<ContenidoWeb> => {
      const { data, error } = await supabase.from("web_contenido").select("clave, valor");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((f) => [f.clave, f.valor])) as ContenidoWeb;
    },
  });

export function useGuardarContenido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clave, valor }: { clave: ClaveContenido; valor: unknown; aviso?: string }) => {
      const { error } = await supabase.from("web_contenido").upsert({ clave, valor: valor as Json }, { onConflict: "clave" });
      if (error) throw error;
    },
    onSuccess: (_r, { clave, aviso }) => {
      qc.invalidateQueries({ queryKey: CLAVE_WEB_CONTENIDO });
      toast.success(aviso ?? NOMBRE[clave], { description: "Se verá en la web en un minuto, más o menos." });
    },
    onError: (e) => toast.error("No se ha guardado", { description: mensajeErrorWeb(e, "Web · Contenido") }),
  });
}
