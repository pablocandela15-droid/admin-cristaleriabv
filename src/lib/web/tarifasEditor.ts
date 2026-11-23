// ============================================================================
//  Web › Tarifas: lógica del editor (sin React, se prueba suelta)
// ----------------------------------------------------------------------------
//  La fila `web_tarifas` (id 1) guarda `config` (precios, forma de
//  DEFAULT_PRICING) y `catalogo` (textos y opciones por encima del código: ver
//  ./pricing/tarifas.ts). Aquí se decide qué precio de `config` corresponde a
//  cada campo y opción de la calculadora, mirando dónde los lee `quote()` en
//  ./pricing/categories.ts, y se escriben los cambios sin tocar lo demás.
//
//  Reglas del catálogo (las aplica la web con aplicarCatalogo):
//    · Al tocar las opciones de un campo se guarda su lista COMPLETA y ordenada
//      (las del código incluidas); `activo: false` = oculta. Una opción con un
//      `value` que no está en el código es nueva: su precio se busca en config
//      con ese mismo `value`.
//    · Textos (nombre de categoría, etiqueta y ayuda de un campo): solo se
//      guardan si son distintos de los del código.
//    · Un campo obligatorio no se puede ocultar.
// ============================================================================
import { DEFAULT_PRICING, type PricingConfig } from "./pricing/config";
import { categories, type CategoryDef, type FieldDef, type Opt } from "./pricing/categories";
import type { CampoCatalogo, Catalogo, CategoriaCatalogo, OpcionCatalogo } from "./pricing/tarifas";

export type IdCategoria = keyof typeof categories;
export const IDS_CATEGORIAS = Object.keys(categories) as IdCategoria[];

export type CampoConOpciones = Extract<FieldDef, { options: Opt[] }>;
export const tieneOpciones = (f: FieldDef): f is CampoConOpciones => f.kind === "chips" || f.kind === "select" || f.kind === "multi";

/** Estado del editor: lo que se guarda en la fila de `web_tarifas`. */
export interface EstadoTarifas {
  config: PricingConfig;
  catalogo: Catalogo;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const recortar = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Campos de una categoría (los del código, en orden). */
export const camposCategoria = (id: IdCategoria): FieldDef[] => (categories[id] as CategoryDef).sections.flatMap((s) => s.fields);

/* ------------------------------------------------------------------ */
/* Dónde está el precio de cada campo                                  */
/* ------------------------------------------------------------------ */

/**
 * Cómo se cobra cada opción de un campo:
 *  · factor:  multiplicador sobre el precio por m² (1 = sin recargo);
 *  · euros:   suplemento fijo en € por pieza;
 *  · eurosM2: precio en € por m² de la pieza (armarios).
 */
export type TipoPrecio = "factor" | "euros" | "eurosM2";

export interface PrecioDeOpciones {
  tipo: TipoPrecio;
  /** Ruta en `config` hasta la tabla {valor de la opción: precio}. */
  ruta: string[];
  /**
   * Solo estos valores tienen precio automático: el cálculo de la web solo mira esos (p. ej. los extras del espejo).
   * Una opción nueva de ese campo se ofrece sin precio («se valora en la visita»).
   */
  soloValores?: string[];
  /** 0 € no suma nada pero sale como «se valora en la visita» (extras); si no, 0 = sin recargo. */
  ceroSeValora?: boolean;
}

/** Tablas en € por campo (lo que no es un multiplicador de una categoría por m²). */
const TABLAS_EUROS: Partial<Record<IdCategoria, Record<string, { tipo: TipoPrecio; tabla: string; soloValores?: string[]; ceroSeValora?: boolean }>>> = {
  mamparas: {
    cristal: { tipo: "euros", tabla: "cristal" },
    perfileria: { tipo: "euros", tabla: "perfileria" },
    acabadoPerfil: { tipo: "euros", tabla: "acabadoPerfil" },
    acabadoCristal: { tipo: "euros", tabla: "acabadoCristal", ceroSeValora: true },
  },
  armarios: {
    tipoCristal: { tipo: "eurosM2", tabla: "cristalM2" },
    tipoMadera: { tipo: "eurosM2", tabla: "maderaM2" },
    acabado: { tipo: "eurosM2", tabla: "acabadoM2" },
  },
  otros: { herrajes: { tipo: "euros", tabla: "hardware" } },
  // categories.ts › espejos.quote solo cobra estos dos extras.
  espejos: { extras: { tipo: "euros", tabla: "extras", soloValores: ["iluminacion", "antivaho"], ceroSeValora: true } },
};

/** Dónde lee `quote()` el precio de las opciones de este campo, o null si sus opciones no cambian el precio. */
export function precioDeCampo(cat: IdCategoria, campo: FieldDef, config: PricingConfig): PrecioDeOpciones | null {
  const euros = TABLAS_EUROS[cat]?.[campo.id];
  if (euros) return { tipo: euros.tipo, ruta: [cat, euros.tabla], soloValores: euros.soloValores, ceroSeValora: euros.ceroSeValora };
  // Categorías por m²: m2Quote multiplica por factors[campo][opción] para cada tabla que haya.
  if (campo.kind === "chips" || campo.kind === "select") {
    const factores = (config as unknown as Record<string, { factors?: Record<string, unknown> }>)[cat]?.factors;
    if (esObjeto(factores) && esObjeto(factores[campo.id])) return { tipo: "factor", ruta: [cat, "factors", campo.id] };
  }
  return null;
}

/** ¿Tiene precio automático esta opción? (las nuevas de un campo con lista fija, no) */
export function opcionConPrecio(precio: PrecioDeOpciones | null, valor: string): boolean {
  return !!precio && (!precio.soloValores || precio.soloValores.includes(valor));
}

/* ------------------------------------------------------------------ */
/* Precios sueltos de cada categoría                                   */
/* ------------------------------------------------------------------ */

export type UnidadPrecio = "€" | "€/m²" | "€/cm" | "€/m" | "€/ud." | "cm";

export interface PrecioSuelto {
  ruta: string[];
  etiqueta: string;
  unidad: UnidadPrecio;
  ayuda?: string;
  /** 0 € = «se valora en la visita». */
  ceroSeValora?: boolean;
}

const BASE_M2 = (cat: IdCategoria): PrecioSuelto => ({
  ruta: [cat, "basePerM2"],
  etiqueta: "Precio base por m²",
  unidad: "€/m²",
  ayuda: "Se multiplica por los m² y por los multiplicadores de las opciones elegidas.",
});

/** Etiquetas de los extras (suplementos por pieza) de las categorías por m². */
const ETIQUETAS_EXTRAS: Partial<Record<IdCategoria, Record<string, { etiqueta: string; unidad: UnidadPrecio; ayuda?: string }>>> = {
  domino: {
    extraclaro: { etiqueta: "Suplemento por cristal extraclaro", unidad: "€/ud.", ayuda: "Si el tipo de cristal es «Extraclaro», además de su multiplicador." },
    antical: { etiqueta: "Tratamiento antical", unidad: "€/ud." },
    tirador: { etiqueta: "Tirador", unidad: "€/ud.", ayuda: "Piezas pivotantes o con bisagras." },
    freno: { etiqueta: "Freno", unidad: "€/ud.", ayuda: "Piezas correderas." },
    caset: { etiqueta: "Caset", unidad: "€/ud.", ayuda: "Piezas correderas." },
    varillaMl: { etiqueta: "Varillería decorativa", unidad: "€/m" },
  },
  otros: { taladro: { etiqueta: "Taladro o encaje", unidad: "€/ud." } },
};

const SUELTOS_FIJOS: Record<IdCategoria, PrecioSuelto[]> = {
  mamparas: [
    { ruta: ["mamparas", "base"], etiqueta: "Precio base de la mampara", unidad: "€" },
    { ruta: ["mamparas", "perCmWidth"], etiqueta: "Por cada cm de ancho", unidad: "€/cm" },
    { ruta: ["mamparas", "tallOverCm"], etiqueta: "Altura a partir de la que hay suplemento", unidad: "cm" },
    { ruta: ["mamparas", "tallSurcharge"], etiqueta: "Suplemento por altura", unidad: "€" },
    { ruta: ["mamparas", "extraclaro"], etiqueta: "Cristal extraclaro", unidad: "€", ayuda: "Si el cliente marca «Cristal extraclaro»." },
  ],
  domino: [BASE_M2("domino")],
  espejos: [BASE_M2("espejos")],
  cerramientos: [BASE_M2("cerramientos")],
  aluminio: [BASE_M2("aluminio")],
  barandillas: [BASE_M2("barandillas")],
  otros: [BASE_M2("otros")],
  armarios: [
    { ruta: ["armarios", "casacaMl"], etiqueta: "Casaca de las puertas", unidad: "€/m" },
    { ruta: ["armarios", "tubo4040Ml"], etiqueta: "Tubo 40×40 del marco", unidad: "€/m" },
    { ruta: ["armarios", "tubo6040Ml"], etiqueta: "Tubo 60×40 de la leja", unidad: "€/m" },
    { ruta: ["armarios", "guiaSuperiorMl"], etiqueta: "Guía superior", unidad: "€/m" },
    { ruta: ["armarios", "guiaInferiorMl"], etiqueta: "Guía inferior", unidad: "€/m" },
    { ruta: ["armarios", "tapeta"], etiqueta: "Tapeta (2 por puerta)", unidad: "€/ud." },
    { ruta: ["armarios", "rueda"], etiqueta: "Rueda (2 por puerta)", unidad: "€/ud." },
    { ruta: ["armarios", "tirador"], etiqueta: "Tirador (1 por puerta)", unidad: "€/ud." },
  ],
};

/** Precios de la categoría que no dependen de una opción: base, suplementos, extras por pieza… */
export function preciosSueltos(cat: IdCategoria, config: PricingConfig): PrecioSuelto[] {
  const lista = [...SUELTOS_FIJOS[cat]];
  // Extras de las categorías por m² que no son opciones de un campo (los del espejo van en su tabla de opciones).
  const extras = (config as unknown as Record<string, { extras?: Record<string, unknown> }>)[cat]?.extras;
  const enOpciones = new Set(Object.values(TABLAS_EUROS[cat] ?? {}).filter((t) => t.tabla === "extras").flatMap((t) => t.soloValores ?? []));
  if (esObjeto(extras)) {
    for (const clave of Object.keys(extras)) {
      if (enOpciones.has(clave)) continue;
      const e = ETIQUETAS_EXTRAS[cat]?.[clave];
      lista.push({ ruta: [cat, "extras", clave], etiqueta: e?.etiqueta ?? clave, unidad: e?.unidad ?? "€/ud.", ayuda: e?.ayuda, ceroSeValora: true });
    }
  }
  return lista;
}

/** Precios de la entrega (los usa la web en el paso de entrega). */
export const PRECIOS_ENTREGA: PrecioSuelto[] = [
  { ruta: ["entrega", "envio"], etiqueta: "Envío a domicilio", unidad: "€" },
  { ruta: ["entrega", "montajeMin"], etiqueta: "Montaje orientativo, desde", unidad: "€" },
  { ruta: ["entrega", "montajeMax"], etiqueta: "Montaje orientativo, hasta", unidad: "€" },
];

/* ------------------------------------------------------------------ */
/* Leer y escribir                                                     */
/* ------------------------------------------------------------------ */

export function leerRuta(obj: unknown, ruta: string[]): unknown {
  let actual: unknown = obj;
  for (const parte of ruta) {
    if (!esObjeto(actual)) return undefined;
    actual = actual[parte];
  }
  return actual;
}

/** Copia de `obj` con `valor` en `ruta` (crea los objetos que falten). `undefined` borra la clave. */
export function escribirRuta<T>(obj: T, ruta: string[], valor: unknown): T {
  const raiz = copia(obj) as unknown as Record<string, unknown>;
  let actual = raiz;
  ruta.slice(0, -1).forEach((parte) => {
    if (!esObjeto(actual[parte])) actual[parte] = {};
    actual = actual[parte] as Record<string, unknown>;
  });
  const ultima = ruta[ruta.length - 1];
  if (valor === undefined) delete actual[ultima];
  else actual[ultima] = valor;
  return raiz as unknown as T;
}

export const leerPrecio = (config: PricingConfig, ruta: string[]): number | undefined => {
  const v = leerRuta(config, ruta);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

/** Quita del catálogo lo vacío (campos, categorías sin nada) para no guardar ruido. */
export function limpiarCatalogo(catalogo: Catalogo): Catalogo {
  const categorias: Record<string, CategoriaCatalogo> = {};
  for (const [id, cat] of Object.entries(catalogo.categorias ?? {})) {
    if (!esObjeto(cat)) continue;
    const campos: Record<string, CampoCatalogo> = {};
    for (const [campoId, campo] of Object.entries(cat.campos ?? {})) {
      if (!esObjeto(campo)) continue;
      const limpio = Object.fromEntries(Object.entries(campo).filter(([, v]) => v !== undefined)) as CampoCatalogo;
      if (Object.keys(limpio).length) campos[campoId] = limpio;
    }
    const resto = Object.fromEntries(Object.entries(cat).filter(([k, v]) => k !== "campos" && v !== undefined)) as CategoriaCatalogo;
    const salida: CategoriaCatalogo = Object.keys(campos).length ? { ...resto, campos } : resto;
    if (Object.keys(salida).length) categorias[id] = salida;
  }
  const out: Catalogo = { ...catalogo };
  delete out.categorias;
  return Object.keys(categorias).length ? { ...out, categorias } : out;
}

const catalogoDe = (catalogo: Catalogo, cat: IdCategoria): CategoriaCatalogo => ({ ...(catalogo.categorias?.[cat] ?? {}) });
const campoDe = (catalogo: Catalogo, cat: IdCategoria, campoId: string): CampoCatalogo => ({ ...(catalogo.categorias?.[cat]?.campos?.[campoId] ?? {}) });

function conCategoria(catalogo: Catalogo, cat: IdCategoria, c: CategoriaCatalogo): Catalogo {
  return limpiarCatalogo({ ...catalogo, categorias: { ...(catalogo.categorias ?? {}), [cat]: c } });
}

function conCampo(catalogo: Catalogo, cat: IdCategoria, campoId: string, campo: CampoCatalogo): Catalogo {
  const c = catalogoDe(catalogo, cat);
  return conCategoria(catalogo, cat, { ...c, campos: { ...(c.campos ?? {}), [campoId]: campo } });
}

/* ------------------------------------------------------------------ */
/* Categorías y campos                                                 */
/* ------------------------------------------------------------------ */

export function cambiarActivoCategoria(catalogo: Catalogo, cat: IdCategoria, activo: boolean): Catalogo {
  return conCategoria(catalogo, cat, { ...catalogoDe(catalogo, cat), activo: activo ? undefined : false });
}

/** Nombre o descripción corta: se guarda solo si cambia respecto al código (vacío = el del código). */
export function cambiarTextoCategoria(catalogo: Catalogo, cat: IdCategoria, clave: "nombre" | "short", valor: string): Catalogo {
  const codigo = clave === "nombre" ? categories[cat].name : categories[cat].short;
  const v = recortar(valor);
  return conCategoria(catalogo, cat, { ...catalogoDe(catalogo, cat), [clave]: v && v !== codigo ? v : undefined });
}

export function campoDelCodigo(cat: IdCategoria, campoId: string): FieldDef | undefined {
  return camposCategoria(cat).find((f) => f.id === campoId);
}

/** Etiqueta (vacía = la del código) o ayuda (vacía = sin ayuda) de un campo. */
export function cambiarTextoCampo(catalogo: Catalogo, cat: IdCategoria, campoId: string, clave: "label" | "hint", valor: string): Catalogo {
  const codigo = campoDelCodigo(cat, campoId);
  const campo = campoDe(catalogo, cat, campoId);
  const v = recortar(valor);
  if (clave === "label") campo.label = v && v !== codigo?.label ? v : undefined;
  else campo.hint = v === recortar(codigo?.hint ?? "") ? undefined : v;
  return conCampo(catalogo, cat, campoId, campo);
}

/** Ocultar o volver a enseñar un campo. Los obligatorios no se ocultan nunca. */
export function cambiarActivoCampo(catalogo: Catalogo, cat: IdCategoria, campoId: string, activo: boolean): Catalogo {
  const codigo = campoDelCodigo(cat, campoId);
  if (!activo && codigo?.required) return catalogo;
  return conCampo(catalogo, cat, campoId, { ...campoDe(catalogo, cat, campoId), activo: activo ? undefined : false });
}

/* ------------------------------------------------------------------ */
/* Opciones                                                            */
/* ------------------------------------------------------------------ */

export interface OpcionEditable {
  value: string;
  label: string;
  hint: string;
  activo: boolean;
  /** No está en el código: se puede borrar (las del código solo se ocultan). */
  nueva: boolean;
}

/** Lista completa y ordenada de opciones de un campo: la del catálogo o, si no se ha tocado, la del código. */
export function opcionesEditables(catalogo: Catalogo, cat: IdCategoria, campo: CampoConOpciones): OpcionEditable[] {
  const delCodigo = new Set(campo.options.map((o) => o.value));
  const guardadas = catalogo.categorias?.[cat]?.campos?.[campo.id]?.opciones;
  if (Array.isArray(guardadas) && guardadas.length) {
    const vistas = new Set<string>();
    return guardadas
      .filter((o) => esObjeto(o) && recortar(o.value) && !vistas.has(recortar(o.value)) && vistas.add(recortar(o.value)))
      .map((o) => ({
        value: recortar(o.value),
        label: recortar(o.label) || recortar(o.value),
        hint: recortar(o.hint),
        activo: o.activo !== false,
        nueva: !delCodigo.has(recortar(o.value)),
      }));
  }
  return campo.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint ?? "", activo: true, nueva: false }));
}

/** Guarda la lista completa de opciones del campo (en ese orden). */
export function guardarOpciones(catalogo: Catalogo, cat: IdCategoria, campoId: string, opciones: OpcionEditable[]): Catalogo {
  const lista: OpcionCatalogo[] = opciones.map((o) => ({
    value: o.value,
    label: recortar(o.label) || o.value,
    ...(recortar(o.hint) ? { hint: recortar(o.hint) } : {}),
    ...(o.activo ? {} : { activo: false }),
  }));
  return conCampo(catalogo, cat, campoId, { ...campoDe(catalogo, cat, campoId), opciones: lista });
}

/** Valor para una opción nueva a partir de su nombre: «Hexagonal grande» → «hexagonal-grande» (sin repetir). */
export function valorOpcion(etiqueta: string, existentes: Iterable<string>): string {
  const base =
    etiqueta
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "opcion";
  const usados = new Set(existentes);
  if (!usados.has(base)) return base;
  let n = 2;
  while (usados.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Precio que se propone para una opción nueva: 1 (multiplicador, sin recargo) o 0 €. */
export const precioInicial = (precio: PrecioDeOpciones | null): number | undefined =>
  precio ? (precio.tipo === "factor" ? 1 : 0) : undefined;

/** Añade una opción al final del campo (y su precio, si el campo tiene tabla de precios). */
export function anadirOpcion(
  estado: EstadoTarifas,
  cat: IdCategoria,
  campo: CampoConOpciones,
  etiqueta: string,
  precio?: number,
): { estado: EstadoTarifas; valor: string } {
  const opciones = opcionesEditables(estado.catalogo, cat, campo);
  const valor = valorOpcion(etiqueta, [...opciones.map((o) => o.value), ...campo.options.map((o) => o.value)]);
  const nuevas = [...opciones, { value: valor, label: recortar(etiqueta) || valor, hint: "", activo: true, nueva: true }];
  const donde = precioDeCampo(cat, campo, estado.config);
  const config = opcionConPrecio(donde, valor)
    ? escribirRuta(estado.config, [...donde!.ruta, valor], precio ?? precioInicial(donde))
    : estado.config;
  return { estado: { config, catalogo: guardarOpciones(estado.catalogo, cat, campo.id, nuevas) }, valor };
}

/** Borra una opción NUEVA (y su precio). Las del código no se borran: se ocultan. */
export function quitarOpcion(estado: EstadoTarifas, cat: IdCategoria, campo: CampoConOpciones, valor: string): EstadoTarifas {
  const opciones = opcionesEditables(estado.catalogo, cat, campo);
  const opcion = opciones.find((o) => o.value === valor);
  if (!opcion?.nueva) return estado;
  const donde = precioDeCampo(cat, campo, estado.config);
  const config = donde ? escribirRuta(estado.config, [...donde.ruta, valor], undefined) : estado.config;
  return { config, catalogo: guardarOpciones(estado.catalogo, cat, campo.id, opciones.filter((o) => o.value !== valor)) };
}

/** Mueve una opción (ordenar). */
export function moverOpcion(catalogo: Catalogo, cat: IdCategoria, campo: CampoConOpciones, desde: number, hasta: number): Catalogo {
  const opciones = opcionesEditables(catalogo, cat, campo);
  if (desde === hasta || desde < 0 || hasta < 0 || desde >= opciones.length || hasta >= opciones.length) return catalogo;
  const [o] = opciones.splice(desde, 1);
  opciones.splice(hasta, 0, o);
  return guardarOpciones(catalogo, cat, campo.id, opciones);
}

/** Cambia la etiqueta, la ayuda o si se ve una opción. */
export function cambiarOpcion(
  catalogo: Catalogo,
  cat: IdCategoria,
  campo: CampoConOpciones,
  valor: string,
  cambio: Partial<Pick<OpcionEditable, "label" | "hint" | "activo">>,
): Catalogo {
  const opciones = opcionesEditables(catalogo, cat, campo).map((o) => (o.value === valor ? { ...o, ...cambio } : o));
  return guardarOpciones(catalogo, cat, campo.id, opciones);
}

/** «Restaurar valores por defecto» de una categoría: sus precios y su catálogo vuelven a los del código. */
export function restaurarCategoria(estado: EstadoTarifas, cat: IdCategoria): EstadoTarifas {
  const categorias = { ...(estado.catalogo.categorias ?? {}) };
  delete categorias[cat];
  return {
    config: { ...estado.config, [cat]: copia(DEFAULT_PRICING[cat]) },
    catalogo: limpiarCatalogo({ ...estado.catalogo, categorias }),
  };
}

/** ¿Está la categoría como en el código (precios y catálogo)? */
export function categoriaPorDefecto(estado: EstadoTarifas, cat: IdCategoria): boolean {
  return JSON.stringify(estado.config[cat]) === JSON.stringify(DEFAULT_PRICING[cat]) && !estado.catalogo.categorias?.[cat];
}

/** Precios que no son un número válido (vacíos, negativos o un multiplicador 0): no se puede guardar así. */
export function preciosNoValidos(estado: EstadoTarifas): string[] {
  const errores: string[] = [];
  const revisar = (v: unknown, ruta: string[]) => {
    if (typeof v === "number") {
      const factor = ruta.includes("factors");
      if (!Number.isFinite(v) || v < 0 || (factor && v === 0)) errores.push(ruta.join("."));
    } else if (esObjeto(v)) {
      for (const [k, x] of Object.entries(v)) revisar(x, [...ruta, k]);
    } else if (v === null) {
      errores.push(ruta.join("."));
    }
  };
  for (const [k, v] of Object.entries(estado.config)) if (k !== "version") revisar(v, [k]);
  return errores;
}

/** Igualdad para saber si hay cambios sin guardar. */
export const mismoEstado = (a: EstadoTarifas, b: EstadoTarifas) =>
  JSON.stringify(a.config) === JSON.stringify(b.config) && JSON.stringify(limpiarCatalogo(a.catalogo)) === JSON.stringify(limpiarCatalogo(b.catalogo));
