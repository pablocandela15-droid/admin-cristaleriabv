// ============================================================================
//  Web › Fotos por tipo de trabajo: lógica sin React
// ----------------------------------------------------------------------------
//  Cada tipo de trabajo (los 8 servicios de la web) tiene su book «de tipo»:
//  slug `trabajos-<servicio>`, título = nombre del tipo, servicio = el tipo y
//  publicado. Lo crea el panel la primera vez que se sube una foto a ese tipo.
//  La sección de un tipo enseña las fotos de TODOS los books con ese servicio
//  (también los creados antes), ordenadas por el `orden` de cada foto: así el
//  orden que se ve en el panel es el de la web (/trabajos, la página del
//  servicio y la portada). El resto de books va en «Otros books».
// ============================================================================
import { SERVICIOS_WEB, type SlugServicioWeb } from "./fotos";

/** La web enseña como mucho 8 fotos ★ en «Espacios que se llenan de luz». */
export const MAX_DESTACADAS_WEB = 8;

/** Slug del book de un tipo de trabajo: «mamparas» → «trabajos-mamparas». */
export const slugAlbumTipo = (servicio: SlugServicioWeb) => `trabajos-${servicio}`;

export const esServicioWeb = (v: unknown): v is SlugServicioWeb => SERVICIOS_WEB.some((s) => s.slug === v);

/** ¿Es el book de un tipo de trabajo (el que crea el panel), y no un book hecho a mano? */
export const esAlbumTipo = (a: { slug: string; servicio: string | null }) => esServicioWeb(a.servicio) && a.slug === slugAlbumTipo(a.servicio);

interface AlbumBase {
  id: string;
  slug: string;
  servicio: string | null;
  orden: number;
  publicado: boolean;
}

interface FotoBase {
  id: string;
  album_id: string | null;
  orden: number;
  creado_en: string;
  publicado: boolean;
  destacada: boolean;
}

export interface TipoTrabajo<A extends AlbumBase, F extends FotoBase> {
  servicio: SlugServicioWeb;
  nombre: string;
  /** Su book de tipo, si ya existe (se crea al subir la primera foto). */
  album: A | null;
  /** Todos los books con este servicio (el de tipo y los antiguos), en el orden de la lista de books. */
  albumes: A[];
  /** Las fotos de todos esos books, en el orden en que salen en la web. */
  fotos: F[];
  /** Cuántas de ellas ve la web (publicadas y de un book publicado). */
  visibles: number;
}

/** ¿La ve la web? Publicada y, si es de un book, de uno publicado. */
export function fotoVisibleEnWeb(foto: Pick<FotoBase, "publicado" | "album_id">, albumes: ReadonlyMap<string, Pick<AlbumBase, "publicado">>): boolean {
  if (!foto.publicado) return false;
  if (!foto.album_id) return true;
  return albumes.get(foto.album_id)?.publicado ?? false;
}

/**
 * Orden de las fotos de un tipo (el mismo que usa la web): por su `orden`; a igualdad, por el orden de su book en
 * la lista y, después, por fecha de subida.
 */
export function ordenarFotosTipo<F extends FotoBase>(fotos: readonly F[], posicionAlbum: ReadonlyMap<string, number>): F[] {
  const pos = (f: F) => (f.album_id ? posicionAlbum.get(f.album_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
  return [...fotos].sort((a, b) => a.orden - b.orden || pos(a) - pos(b) || a.creado_en.localeCompare(b.creado_en) || a.id.localeCompare(b.id));
}

/**
 * Reparte books y fotos por tipo de trabajo. `albumes` en el orden de la lista (orden, creado_en). Devuelve los 8
 * tipos en el orden de los servicios de la web y, aparte, los books que no son de tipo (los de «Otros books»; los
 * que tienen servicio salen además en la sección de su tipo). Las fotos sueltas (sin book) no entran.
 */
export function agruparPorTipo<A extends AlbumBase, F extends FotoBase>(
  albumes: readonly A[],
  fotos: readonly F[],
): { tipos: TipoTrabajo<A, F>[]; otros: A[] } {
  const porId = new Map(albumes.map((a) => [a.id, a]));
  const posicion = new Map(albumes.map((a, i) => [a.id, i]));
  const tipos = SERVICIOS_WEB.map(({ slug, nombre }) => {
    const deTipo = albumes.filter((a) => a.servicio === slug);
    const ids = new Set(deTipo.map((a) => a.id));
    const suyas = ordenarFotosTipo(
      fotos.filter((f) => f.album_id && ids.has(f.album_id)),
      posicion,
    );
    return {
      servicio: slug,
      nombre,
      album: deTipo.find(esAlbumTipo) ?? null,
      albumes: deTipo,
      fotos: suyas,
      visibles: suyas.filter((f) => fotoVisibleEnWeb(f, porId)).length,
    };
  });
  return { tipos, otros: albumes.filter((a) => !esAlbumTipo(a)) };
}

/** Fotos ★ que ve la web (publicadas, de un book publicado o sueltas). */
export function destacadasEnWeb<F extends FotoBase>(fotos: readonly F[], albumes: readonly AlbumBase[]): number {
  const porId = new Map(albumes.map((a) => [a.id, a]));
  return fotos.filter((f) => f.destacada && fotoVisibleEnWeb(f, porId)).length;
}

/** Cómo va el inicio de la web («Espacios que se llenan de luz») con las ★ que ve la web. */
export function textoDestacadas(n: number): string {
  if (n === 0) return "Ahora no hay ninguna foto con estrella: el inicio enseña la primera foto de cada tipo.";
  if (n > MAX_DESTACADAS_WEB) return `Hay ${n} fotos con estrella: el inicio enseña las ${MAX_DESTACADAS_WEB} primeras.`;
  return n === 1 ? "Ahora hay 1 foto con estrella en el inicio." : `Ahora hay ${n} fotos con estrella en el inicio.`;
}

const fotosTexto = (n: number) => (n === 1 ? "1 foto" : `${n} fotos`);

/** Resumen de una línea de un tipo (debajo de su nombre): fotos, ocultas, ★ y si la web sigue con las de ejemplo. */
export function resumenTipo(tipo: { fotos: readonly Pick<FotoBase, "destacada">[]; visibles: number }): string {
  const total = tipo.fotos.length;
  if (total === 0) return "Sin fotos: la web enseña las de ejemplo";
  const partes = [fotosTexto(total)];
  const ocultas = total - tipo.visibles;
  if (tipo.visibles === 0) partes.push("ninguna visible: la web enseña las de ejemplo");
  else if (ocultas > 0) partes.push(`${ocultas} ${ocultas === 1 ? "oculta" : "ocultas"}`);
  const destacadas = tipo.fotos.filter((f) => f.destacada).length;
  if (destacadas) partes.push(`★ ${destacadas} en el inicio`);
  return partes.join(" · ");
}

/** Palabras que ponen las cámaras y los móviles en el nombre del fichero (no sirven de título en la web). */
const PALABRAS_DE_CAMARA = new Set(
  [
    "img", "image", "imagen", "imágen", "dsc", "dscn", "dscf", "dcim", "pxl", "mvimg", "photo", "foto", "fotografia", "fotografía",
    "screenshot", "captura", "de", "pantalla", "whatsapp", "at", "a", "las", "the", "edited", "editada", "copia", "copy",
    "portrait", "burst", "hdr", "pano", "snapchat", "signal", "telegram", "received", "scaled", "mmexport", "ig", "instagram",
    "cover", "original", "final", "nueva", "nuevo", "new", "sin", "título", "titulo", "untitled",
  ],
);

/**
 * Título de una foto a partir del nombre de su fichero: «mampara-baño-elche.jpg» → «mampara baño elche». Los
 * nombres que pone el móvil o la cámara («IMG_2034.jpg», «WhatsApp Image 2026-11-24 at 10.32.15.jpeg»,
 * «PXL_20261124_093215.jpg») no dicen nada en la web: devuelve null y la web pone el nombre del tipo.
 */
export function tituloDesdeArchivo(nombre: string): string | null {
  const base = nombre
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
    .trim();
  const conSentido = base
    .split(" ")
    .filter(Boolean)
    .filter((p) => !/^[\d.:,]+$/.test(p))
    .filter((p) => !/^[a-z]*\d{3,}[a-z\d]*$/i.test(p))
    .filter((p) => !PALABRAS_DE_CAMARA.has(p.toLowerCase()));
  return conSentido.length ? base : null;
}
