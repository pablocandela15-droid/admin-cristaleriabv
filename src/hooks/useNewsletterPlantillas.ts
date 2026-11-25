// ============================================================================
//  Newsletter · plantillas guardadas, «Crear con IA», galería de fotos y datos
//  del negocio para la vista previa. Portado del panel de referencia
//  (useNewsletterPlantillas, SelectorImagenGaleria) y adaptado: la galería son
//  las fotos publicadas de la web (Web › Fotos, bucket web-fotos).
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensajeErrorFuncion } from "@/hooks/useNewsletter";
import { urlFoto } from "@/hooks/useWebFotos";
import { textoErrorCliente } from "@/lib/newsletter/textos";
import { esTipoNewsletter, validarBloques, URL_WEB, type DisenoNewsletter, type PlantillaGuardada, type TipoNewsletter } from "@/lib/newsletter/diseno";
import { negocioDesdeContenido, type DatosNegocio } from "../../supabase/functions/_shared/newsletter/negocio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tablas sin tipos generados (migración 20261124173700)
const db = supabase as any;

const CLAVE = ["newsletter-plantillas"] as const;
const COLUMNAS = "id,nombre,descripcion,tipo,titulo,insignia,preheader,bloques,origen,created_at,updated_at";
const FALTA_TABLA = /does not exist|Could not find the table|PGRST205|42P01/i;

/** Una fila que no valida (editada a mano en la base de datos) no se ofrece: no se podría enviar. */
export function filaAPlantilla(f: Record<string, unknown>): PlantillaGuardada | null {
  const v = validarBloques(f.bloques);
  if (!v.ok || typeof f.id !== "string" || typeof f.nombre !== "string") return null;
  return {
    id: f.id,
    nombre: f.nombre,
    descripcion: typeof f.descripcion === "string" ? f.descripcion : "",
    tipo: esTipoNewsletter(f.tipo) ? f.tipo : "personalizada",
    titulo: typeof f.titulo === "string" ? f.titulo : "",
    insignia: typeof f.insignia === "string" ? f.insignia : "",
    preheader: typeof f.preheader === "string" ? f.preheader : "",
    bloques: v.bloques,
    origen: f.origen === "ia" ? "ia" : "manual",
    created_at: String(f.created_at ?? ""),
    updated_at: String(f.updated_at ?? ""),
  };
}

export function useNewsletterPlantillas() {
  const consulta = useQuery({
    queryKey: CLAVE,
    queryFn: async (): Promise<{ plantillas: PlantillaGuardada[]; disponible: boolean }> => {
      const { data, error } = await db.from("newsletter_plantillas").select(COLUMNAS).order("updated_at", { ascending: false }).limit(100);
      if (error) {
        if (FALTA_TABLA.test(`${error.code ?? ""} ${error.message ?? ""}`)) return { plantillas: [], disponible: false };
        throw new Error(error.message);
      }
      return { plantillas: ((data ?? []) as Record<string, unknown>[]).map(filaAPlantilla).filter((p): p is PlantillaGuardada => !!p), disponible: true };
    },
    staleTime: 60_000,
  });
  return { plantillas: consulta.data?.plantillas ?? [], disponible: consulta.data?.disponible ?? true, cargando: consulta.isLoading };
}

export function useGuardarPlantillaNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nombre, diseno, origen }: { nombre: string; diseno: DisenoNewsletter; origen: "manual" | "ia" }): Promise<PlantillaGuardada> => {
      const v = validarBloques(diseno.bloques);
      if (v.ok === false) throw new Error(v.error);
      const fila = {
        nombre: nombre.trim().slice(0, 80),
        tipo: diseno.tipo,
        titulo: diseno.titulo.trim().slice(0, 150),
        insignia: diseno.insignia.trim().slice(0, 40),
        preheader: diseno.preheader.trim().slice(0, 150),
        bloques: v.bloques,
        origen,
      };
      const { data, error } = await db.from("newsletter_plantillas").insert(fila).select(COLUMNAS).single();
      if (error) {
        if (FALTA_TABLA.test(`${error.code ?? ""} ${error.message ?? ""}`)) throw new Error("Guardar plantillas todavía no está disponible. Avisa al equipo técnico.");
        if (/row-level security|permission/i.test(error.message ?? "")) throw new Error("No tienes permiso para guardar plantillas.");
        throw new Error(error.message);
      }
      const p = filaAPlantilla(data as Record<string, unknown>);
      if (!p) throw new Error("La plantilla guardada no es válida");
      return p;
    },
    onSuccess: (p) => {
      toast.success(`Plantilla «${p.nombre}» guardada.`);
      qc.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(`No se pudo guardar la plantilla. ${e.message}`),
  });
}

export function useBorrarPlantillaNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("newsletter_plantillas").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Plantilla borrada.");
      qc.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(`No se pudo borrar la plantilla. ${e.message}`),
  });
}

// ── «Crear con IA» ──────────────────────────────────────────────────────────

export type TonoIA = "cercano" | "profesional" | "promocional" | "informativo";

export interface PeticionIA {
  descripcion: string;
  tipo: TipoNewsletter | null;
  tono: TonoIA;
  imagenes: string[];
  base: DisenoNewsletter | null;
}

export interface RespuestaIA {
  propuesta: DisenoNewsletter;
  avisos: string[];
  modelo: string;
}

/** Llama a la Edge Function newsletter-ia. Solo PROPONE: no envía ni guarda nada. */
export function useCrearNewsletterIA() {
  return useMutation({
    mutationFn: async (p: PeticionIA): Promise<RespuestaIA> => {
      const { data, error } = await supabase.functions.invoke("newsletter-ia", {
        body: { descripcion: p.descripcion, tipo: p.tipo, tono: p.tono, imagenes: p.imagenes, base: p.base },
      });
      if (error) throw new Error(await mensajeErrorFuncion(error, "La IA no está disponible ahora mismo"));
      const r = data as { ok?: boolean; error?: string; propuesta?: Record<string, unknown>; avisos?: unknown; modelo?: string } | null;
      if (!r?.ok || !r.propuesta) throw new Error(r?.error || "La IA no devolvió ninguna propuesta");
      const v = validarBloques(r.propuesta.bloques);
      if (v.ok === false) throw new Error(`La propuesta de la IA no es válida: ${v.error}`);
      return {
        propuesta: {
          tipo: esTipoNewsletter(r.propuesta.tipo) ? r.propuesta.tipo : p.tipo ?? "personalizada",
          titulo: String(r.propuesta.titulo ?? ""),
          insignia: String(r.propuesta.insignia ?? ""),
          preheader: String(r.propuesta.preheader ?? ""),
          bloques: v.bloques,
        },
        avisos: Array.isArray(r.avisos) ? r.avisos.filter((a): a is string => typeof a === "string") : [],
        modelo: r.modelo ?? "",
      };
    },
    onError: (e: Error) => {
      toast.error(`La IA no ha podido redactar el correo. ${textoErrorCliente(e.message, "La IA no está disponible ahora mismo. Inténtalo más tarde.")}`);
    },
  });
}

// ── Galería y datos del negocio ─────────────────────────────────────────────

export interface FotoGaleria {
  url: string;
  alt: string;
}

/** Fotos publicadas de la web (las más recientes): la galería del correo y de «Crear con IA». */
export function useGaleriaImagenes() {
  return useQuery({
    queryKey: ["newsletter-galeria"],
    queryFn: async (): Promise<FotoGaleria[]> => {
      const { data, error } = await db.from("web_fotos").select("ruta, alt").eq("publicado", true).order("creado_en", { ascending: false }).limit(48);
      if (error) return [];
      return ((data ?? []) as { ruta: string; alt: string | null }[]).map((f) => ({ url: urlFoto(f.ruta), alt: f.alt ?? "" }));
    },
    staleTime: 5 * 60_000,
  });
}

/** Datos del negocio de la web (Web › Contenido) para el pie de la vista previa, como en el correo real. */
export function useNegocioNewsletter(web: string | null | undefined) {
  return useQuery({
    queryKey: ["newsletter-negocio", web ?? URL_WEB],
    queryFn: async (): Promise<DatosNegocio> => {
      const { data } = await db.from("web_contenido").select("valor").eq("clave", "negocio").maybeSingle();
      return negocioDesdeContenido(data?.valor ?? null, web || URL_WEB);
    },
    staleTime: 5 * 60_000,
  });
}
