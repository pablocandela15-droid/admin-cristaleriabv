// ============================================================================
//  Web › Fotos: books (web_albumes) y fotos (web_fotos) de la web
// ----------------------------------------------------------------------------
//  Lectura directa de las tablas (RLS: el panel con «Ver» en Web · Fotos o
//  Contenido lo ve todo) y escrituras con «Editar» (la base lo exige). Las
//  fotos van al bucket público web-fotos; borrar una foto borra también su
//  fichero, y borrar un book, los de todas sus fotos.
//
//  Las fotos de cada tipo de trabajo van a su book de tipo
//  (`trabajos-<servicio>`, ver src/lib/web/fotosPorTipo.ts): lo crea
//  `asegurarAlbumTipo` al subir la primera.
//
//  Cualquier cambio invalida ['web-fotos'].
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET_FOTOS_WEB, mensajeErrorWeb, nombreServicio, rutaFotoWeb, siguienteOrden, urlFotoWeb, type SlugServicioWeb } from "@/lib/web/fotos";
import { slugAlbumTipo, tituloDesdeArchivo } from "@/lib/web/fotosPorTipo";
import { prepararFotoWeb } from "@/lib/web/prepararFoto";

export const CLAVE_WEB_FOTOS = "web-fotos";
const SECCION = "Web · Fotos";

export interface FotoWeb {
  id: string;
  album_id: string | null;
  ruta: string;
  titulo: string | null;
  alt: string;
  ancho: number | null;
  alto: number | null;
  orden: number;
  publicado: boolean;
  destacada: boolean;
  creado_en: string;
}

export interface AlbumWeb {
  id: string;
  slug: string;
  titulo: string;
  descripcion: string | null;
  servicio: string | null;
  portada_foto_id: string | null;
  orden: number;
  publicado: boolean;
  creado_en: string;
  /** Número de fotos (publicadas o no). */
  totalFotos: number;
  /** Ruta de la portada: la elegida o, si no hay, la primera foto. */
  portadaRuta: string | null;
}

/** URL pública de una foto del bucket. */
export const urlFoto = (ruta: string) => urlFotoWeb(import.meta.env.VITE_SUPABASE_URL ?? "", ruta);

const COLUMNAS_FOTO = "id, album_id, ruta, titulo, alt, ancho, alto, orden, publicado, destacada, creado_en";

export const useAlbumesWeb = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: [CLAVE_WEB_FOTOS, "albumes"],
    enabled,
    retry: false,
    queryFn: async (): Promise<AlbumWeb[]> => {
      const { data, error } = await supabase
        .from("web_albumes")
        .select("id, slug, titulo, descripcion, servicio, portada_foto_id, orden, publicado, creado_en, fotos:web_fotos(id, ruta, orden)")
        .order("orden", { ascending: true })
        .order("creado_en", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((a) => {
        const fotos = [...((a.fotos ?? []) as { id: string; ruta: string; orden: number }[])].sort((x, y) => x.orden - y.orden);
        const portada = fotos.find((f) => f.id === a.portada_foto_id) ?? fotos[0];
        const { fotos: _f, ...resto } = a;
        void _f;
        return { ...resto, totalFotos: fotos.length, portadaRuta: portada?.ruta ?? null } as AlbumWeb;
      });
    },
  });

/** Fotos de un book (`albumId`), las sueltas (`null`) o todas (`"todas"`). */
export const useFotosWeb = (albumId: string | null | "todas", { enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: [CLAVE_WEB_FOTOS, "fotos", albumId ?? "sueltas"],
    enabled,
    retry: false,
    queryFn: async (): Promise<FotoWeb[]> => {
      let consulta = supabase.from("web_fotos").select(COLUMNAS_FOTO);
      if (albumId === null) consulta = consulta.is("album_id", null);
      else if (albumId !== "todas") consulta = consulta.eq("album_id", albumId);
      const { data, error } = await consulta.order("orden", { ascending: true }).order("creado_en", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FotoWeb[];
    },
  });

function useMutacionFotos<A, R = void>(fn: (a: A) => Promise<R>, ok?: string | ((r: R, a: A) => string | null)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, a) => {
      qc.invalidateQueries({ queryKey: [CLAVE_WEB_FOTOS] });
      const texto = typeof ok === "function" ? ok(r, a) : ok;
      if (texto) toast.success(texto);
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: [CLAVE_WEB_FOTOS] });
      toast.error("No se ha guardado", { description: mensajeErrorWeb(e, SECCION) });
    },
  });
}

export interface DatosAlbum {
  id?: string;
  titulo: string;
  slug: string;
  descripcion: string | null;
  servicio: string | null;
  publicado: boolean;
}

export const useGuardarAlbum = () =>
  useMutacionFotos(
    async (d: DatosAlbum & { ordenes?: number[] }): Promise<string> => {
      const fila = { titulo: d.titulo.trim(), slug: d.slug, descripcion: d.descripcion?.trim() || null, servicio: d.servicio, publicado: d.publicado };
      if (d.id) {
        const { error } = await supabase.from("web_albumes").update(fila).eq("id", d.id);
        if (error) throw error;
        return d.id;
      }
      const { data, error } = await supabase
        .from("web_albumes")
        .insert({ ...fila, orden: siguienteOrden(d.ordenes ?? []) })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    (_r, d) => (d.id ? "Book guardado" : "Book creado"),
  );

export const useCambiarAlbum = () =>
  useMutacionFotos(async ({ id, cambios }: { id: string; cambios: Partial<Pick<AlbumWeb, "publicado" | "portada_foto_id">> }) => {
    const { error } = await supabase.from("web_albumes").update(cambios).eq("id", id);
    if (error) throw error;
  });

/** Borra un book, sus fotos y sus ficheros. */
export const useBorrarAlbum = () =>
  useMutacionFotos(async (id: string) => {
    const { data: fotos, error: e1 } = await supabase.from("web_fotos").select("ruta").eq("album_id", id);
    if (e1) throw e1;
    const rutas = (fotos ?? []).map((f) => f.ruta);
    if (rutas.length) {
      const { error: e2 } = await supabase.storage.from(BUCKET_FOTOS_WEB).remove(rutas);
      if (e2) throw e2;
    }
    const { error } = await supabase.from("web_albumes").delete().eq("id", id);
    if (error) throw error;
  }, "Book borrado");

/** Guarda un orden nuevo (books o fotos): solo los que cambian. */
export const useOrdenarWeb = () =>
  useMutacionFotos(async ({ tabla, cambios }: { tabla: "web_albumes" | "web_fotos"; cambios: { id: string; orden: number }[] }) => {
    const resultados = await Promise.all(cambios.map((c) => supabase.from(tabla).update({ orden: c.orden }).eq("id", c.id)));
    const fallo = resultados.find((r) => r.error);
    if (fallo?.error) throw fallo.error;
  });

export const useCambiarFoto = () =>
  useMutacionFotos(
    async ({ id, cambios }: { id: string; cambios: Partial<Pick<FotoWeb, "titulo" | "alt" | "publicado" | "destacada">> }) => {
      const { error } = await supabase.from("web_fotos").update(cambios).eq("id", id);
      if (error) throw error;
    },
  );

/** Borra una foto y su fichero (si era la portada, el book se queda sin portada: lo hace la base). */
export const useBorrarFoto = () =>
  useMutacionFotos(async (foto: Pick<FotoWeb, "id" | "ruta">) => {
    const { error: e1 } = await supabase.storage.from(BUCKET_FOTOS_WEB).remove([foto.ruta]);
    if (e1) throw e1;
    const { error } = await supabase.from("web_fotos").delete().eq("id", foto.id);
    if (error) throw error;
  }, "Foto borrada");

/** Lo que usa `asegurarAlbumTipo` del cliente de Supabase (para probarlo sin red). */
type ClienteAlbumes = Pick<typeof supabase, "from">;
type FilaAlbumTipo = { id: string; servicio: string | null; publicado: boolean };

/**
 * Id del book de un tipo de trabajo (slug `trabajos-<servicio>`), creándolo si aún no existe: título = nombre del
 * tipo, servicio = el tipo y publicado. Primero lo busca por su slug; si dos personas suben a la vez y la otra lo
 * crea antes (slug repetido, 23505), lo vuelve a leer. Si existe pero con otro servicio o sin publicar, lo arregla:
 * lo que se sube a un tipo tiene que salir en la web en ese tipo.
 */
export async function asegurarAlbumTipo(
  servicio: SlugServicioWeb,
  { ordenes = [], cliente = supabase }: { ordenes?: number[]; cliente?: ClienteAlbumes } = {},
): Promise<string> {
  const slug = slugAlbumTipo(servicio);
  const buscar = async (): Promise<FilaAlbumTipo | null> => {
    const { data, error } = await cliente.from("web_albumes").select("id, servicio, publicado").eq("slug", slug).maybeSingle();
    if (error) throw error;
    return data as FilaAlbumTipo | null;
  };
  let album = await buscar();
  if (!album) {
    const { data, error } = await cliente
      .from("web_albumes")
      .insert({ slug, titulo: nombreServicio(servicio) ?? servicio, servicio, publicado: true, orden: siguienteOrden(ordenes) })
      .select("id, servicio, publicado")
      .single();
    if (error) {
      if (error.code !== "23505") throw error;
      album = await buscar();
      if (!album) throw error;
    } else {
      album = data as FilaAlbumTipo;
    }
  }
  if (album.servicio !== servicio || !album.publicado) {
    const { error } = await cliente.from("web_albumes").update({ servicio, publicado: true }).eq("id", album.id);
    if (error) throw error;
  }
  return album.id;
}

export type FaseSubida = "preparando" | "subiendo" | "guardando" | "hecha" | "error";

/**
 * Sube una foto: la prepara (2400 px, WebP), la sube al bucket y crea su fila. `alFase` avisa de cada paso (para la
 * barra de cada fichero). Si falla al crear la fila, borra el fichero subido.
 */
export async function subirFotoWeb(
  archivo: File,
  { albumId, orden, alt, alFase }: { albumId: string | null; orden: number; alt?: string; alFase?: (f: FaseSubida) => void },
): Promise<FotoWeb> {
  alFase?.("preparando");
  const foto = await prepararFotoWeb(archivo);
  const ruta = rutaFotoWeb(albumId);
  alFase?.("subiendo");
  const { error: e1 } = await supabase.storage
    .from(BUCKET_FOTOS_WEB)
    .upload(ruta, foto.blob, { contentType: foto.blob.type || "image/webp", upsert: false, cacheControl: "31536000" });
  if (e1) throw e1;
  alFase?.("guardando");
  // Sin el «IMG_2034» del móvil: sin título, la web pone el del book (en un tipo, su nombre).
  const titulo = tituloDesdeArchivo(archivo.name);
  const { data, error } = await supabase
    .from("web_fotos")
    .insert({ album_id: albumId, ruta, alt: (alt ?? "").slice(0, 300), titulo, ancho: foto.ancho, alto: foto.alto, orden })
    .select(COLUMNAS_FOTO)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET_FOTOS_WEB).remove([ruta]);
    throw error;
  }
  alFase?.("hecha");
  return data as FotoWeb;
}

/** Invalida las fotos después de una tanda de subidas. */
export function useRefrescarFotos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [CLAVE_WEB_FOTOS] });
}
