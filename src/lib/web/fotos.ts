// ============================================================================
//  Web › Fotos: utilidades sin React
// ----------------------------------------------------------------------------
//  Rutas en el bucket público «web-fotos» (albumes/<album_id>/<uuid>.webp y
//  sueltas/<uuid>.webp, migración 20261123100000_web_y_presupuestos), slug de
//  los books, servicios de la web y orden de listas.
// ============================================================================

export const BUCKET_FOTOS_WEB = "web-fotos";

/** Lado mayor de las fotos que se suben a la web y calidad WebP (buena en pantalla grande, sin pesar de más). */
export const LADO_MAX_FOTO_WEB = 2400;
export const CALIDAD_WEBP_WEB = 0.85;
/** Lo que acepta el bucket (y el selector de ficheros). */
export const TIPOS_FOTO_WEB = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/** La web vuelve a leer lo del panel cada 60 s. */
export const AVISO_PUBLICACION_WEB = "Los cambios se ven en la web en un minuto, más o menos.";

/** Servicios de la web (slug y nombre), en el orden de su menú. Un book puede ir en la galería de uno. */
export const SERVICIOS_WEB = [
  { slug: "mamparas", nombre: "Mamparas" },
  { slug: "espejos", nombre: "Espejos" },
  { slug: "cerramientos", nombre: "Cerramientos" },
  { slug: "aluminio", nombre: "Aluminio" },
  { slug: "barandillas", nombre: "Barandillas" },
  { slug: "armarios", nombre: "Armarios" },
  { slug: "domino", nombre: "Dominó" },
  { slug: "otros", nombre: "Otros trabajos" },
] as const;
export type SlugServicioWeb = (typeof SERVICIOS_WEB)[number]["slug"];

export const nombreServicio = (slug: string | null | undefined) => SERVICIOS_WEB.find((s) => s.slug === slug)?.nombre ?? null;

/** Dirección de un book a partir de su título: «Mamparas en Elche» → «mamparas-en-elche». */
export function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Lo mismo mientras se escribe: deja el guion del final (si no, no se podría escribir «mamparas-elche»). */
export function slugMientrasEscribe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80);
}

/** ¿Vale como slug? (lo mismo que pide la base: minúsculas, números y guiones sueltos). */
export const slugValido = (slug: string) => slug.length > 0 && slug.length <= 80 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);

const uuid = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Ruta de una foto nueva: la de un book o una suelta. */
export const rutaFotoWeb = (albumId: string | null, id: string = uuid()) =>
  albumId ? `albumes/${albumId}/${id}.webp` : `sueltas/${id}.webp`;

/** URL pública de una ruta del bucket (`base` = URL del proyecto de Supabase). */
export const urlFotoWeb = (base: string, ruta: string) =>
  `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET_FOTOS_WEB}/${ruta.split("/").map(encodeURIComponent).join("/")}`;

/** Copia de la lista con el elemento `desde` movido a `hasta`. */
export function mover<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  const copia = [...lista];
  if (desde < 0 || desde >= copia.length || hasta < 0 || hasta >= copia.length || desde === hasta) return copia;
  const [x] = copia.splice(desde, 1);
  copia.splice(hasta, 0, x);
  return copia;
}

/** Cambios de `orden` para que la lista quede así (solo los que cambian). */
export function ordenesNuevos(ids: readonly string[], actuales: ReadonlyMap<string, number>): { id: string; orden: number }[] {
  return ids.map((id, orden) => ({ id, orden })).filter((x) => actuales.get(x.id) !== x.orden);
}

/** Siguiente `orden` libre (al final). */
export const siguienteOrden = (ordenes: readonly number[]) => (ordenes.length ? Math.max(...ordenes) + 1 : 0);

/** Mensaje claro para los fallos de permisos y de datos repetidos. */
export function mensajeErrorWeb(e: unknown, seccion: string): string {
  const err = e as { message?: string; code?: string; statusCode?: string | number } | null;
  const msg = err?.message ?? "";
  if (err?.code === "42501" || /row-level security|permission denied|Unauthorized/i.test(msg) || String(err?.statusCode) === "403") {
    return `No tienes permiso de edición en ${seccion}.`;
  }
  if (err?.code === "23505" || /duplicate key/i.test(msg)) return "Ya existe uno igual (por ejemplo, la misma dirección).";
  if (/relation .* does not exist|schema cache|PGRST205|404/i.test(msg)) {
    return "La base de datos aún no tiene la web editable (falta aplicar la migración de la web).";
  }
  return msg || "Error desconocido";
}
