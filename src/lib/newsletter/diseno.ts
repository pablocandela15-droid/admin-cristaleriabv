// ============================================================================
// Diseño de un correo de la newsletter en el panel (puro)
// ----------------------------------------------------------------------------
// Portado del panel de referencia. Lo que edita el equipo en «Crear y enviar»:
// plantilla (tipo), asunto, etiqueta, texto de vista previa y bloques. El
// modelo de bloques, su validación y las plantillas de partida son los MISMOS
// que usa el envío (supabase/functions/_shared/newsletter/bloques.ts).
// ============================================================================
import {
  plantillaBase,
  textoPlanoDeBloques,
  validarBloques,
  FIRMA,
  URL_PRESUPUESTO,
  type Bloque,
  type PlantillaBase,
  type TipoBloque,
  type TipoNewsletter,
} from "../../../supabase/functions/_shared/newsletter/bloques";

export * from "../../../supabase/functions/_shared/newsletter/bloques";

export interface DisenoNewsletter {
  tipo: TipoNewsletter;
  titulo: string;
  insignia: string;
  preheader: string;
  bloques: Bloque[];
}

/** Fila de newsletter_plantillas (las que guarda el equipo). */
export interface PlantillaGuardada {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: TipoNewsletter;
  titulo: string;
  insignia: string;
  preheader: string;
  bloques: Bloque[];
  origen: "manual" | "ia";
  created_at: string;
  updated_at: string;
}

const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function disenoDePlantilla(p: PlantillaBase | PlantillaGuardada): DisenoNewsletter {
  const base = plantillaBase(p.tipo);
  return {
    tipo: p.tipo,
    titulo: p.titulo,
    insignia: p.insignia || base.insignia,
    preheader: p.preheader,
    bloques: copia(p.bloques),
  };
}

export function bloqueVacio(tipo: TipoBloque): Bloque {
  switch (tipo) {
    case "texto":
      return { tipo, texto: "" };
    case "firma":
      return { tipo, texto: FIRMA };
    case "imagen":
      return { tipo, url: "", alt: "" };
    case "destacado":
      return { tipo, titulo: "", texto: "" };
    case "lista":
      return { tipo, titulo: "", elementos: [{ nombre: "" }] };
    case "datos":
      return { tipo, fecha: "", horario: "", lugar: "", precio: "" };
    case "boton":
      return { tipo, texto: "Calcular mi presupuesto", url: URL_PRESUPUESTO };
    case "cita":
      return { tipo, texto: "", autor: "" };
    case "separador":
      return { tipo };
  }
}

/** Huecos sin rellenar: «[fecha]» (los dejan la IA y las plantillas de partida) o «…». */
export function huecosPorCompletar(d: DisenoNewsletter): string[] {
  const texto = [d.titulo, d.preheader, textoPlanoDeBloques(d.bloques)].join("\n");
  const huecos = new Set<string>();
  for (const m of texto.matchAll(/\[[^\]\n]{1,60}\]/g)) huecos.add(m[0]);
  if (/…/.test(texto)) huecos.add("…");
  return [...huecos];
}

export interface PayloadNewsletter {
  tipo: TipoNewsletter;
  titulo: string;
  mensaje: string;
  bloques: Bloque[];
  insignia?: string;
  preheader?: string;
}

export type ResultadoDiseno = { ok: true; payload: PayloadNewsletter } | { ok: false; error: string };

/** Lo que se manda a enviar-newsletter en `newsletter` (con la versión de texto, para el historial). */
export function payloadDeDiseno(d: DisenoNewsletter): ResultadoDiseno {
  const titulo = d.titulo.trim();
  if (!titulo) return { ok: false, error: "Escribe el asunto del correo." };
  const v = validarBloques(d.bloques);
  if (v.ok === false) return { ok: false, error: v.error };
  const insignia = d.insignia.trim();
  const preheader = d.preheader.trim();
  return {
    ok: true,
    payload: {
      tipo: d.tipo,
      titulo,
      mensaje: textoPlanoDeBloques(v.bloques),
      bloques: v.bloques,
      ...(insignia ? { insignia } : {}),
      ...(preheader ? { preheader } : {}),
    },
  };
}
