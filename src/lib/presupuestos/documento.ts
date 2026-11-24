// ============================================================================
//  Presupuestos: datos del negocio para el PDF y los envíos, y condiciones
// ----------------------------------------------------------------------------
//  Los datos salen de Web › Contenido › Datos del negocio (`web_contenido`
//  'negocio', lo mismo que enseña la web) y, lo que falte, de los de siempre
//  (los de la semilla de la migración, que son los del código de la web).
// ============================================================================
import { NEGOCIO } from "@/config/negocio";
import type { NegocioWeb } from "@/lib/web/contenido";

/** Lo que tiene hoy el código de la web (semilla de web_contenido 'negocio'). */
export const NEGOCIO_WEB_POR_DEFECTO: Required<Pick<NegocioWeb, "phones" | "whatsapp" | "email" | "address">> = {
  phones: [
    { label: "Oficina", display: "650 06 63 23", tel: "+34650066323" },
    { label: "Jose Antonio", display: "649 99 40 07", tel: "+34649994007" },
  ],
  whatsapp: "34650066323",
  email: "info@cristaleriabaixvinalopo.es",
  address: { street: "C/ Pío XII, 5", postalCode: "03330", city: "Crevillente", province: "Alicante", country: "España" },
};

export interface NegocioDocumento {
  nombre: string;
  /** Líneas de la dirección («C/ Pío XII, 5», «03330 Crevillente (Alicante)»). */
  direccion: string[];
  /** «650 06 63 23 (Oficina)». */
  telefonos: string[];
  email: string;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Datos del negocio para el documento: los de Web › Contenido y, lo que falte, los de siempre. */
export function negocioParaDocumentos(valor: unknown): NegocioDocumento {
  const n = esObjeto(valor) ? valor : {};
  const porDefecto = NEGOCIO_WEB_POR_DEFECTO;
  const dir = { ...porDefecto.address, ...Object.fromEntries(Object.entries(esObjeto(n.address) ? n.address : {}).filter(([, v]) => texto(v))) };
  const telefonos = (Array.isArray(n.phones) ? n.phones : [])
    .filter(esObjeto)
    .map((t) => ({ display: texto(t.display), label: texto(t.label) }))
    .filter((t) => t.display);
  const lineaCiudad = [texto(dir.postalCode), texto(dir.city)].filter(Boolean).join(" ");
  const provincia = texto(dir.province);
  return {
    nombre: NEGOCIO.nombre,
    direccion: [
      texto(dir.street),
      provincia && provincia !== texto(dir.city) ? `${lineaCiudad} (${provincia})` : lineaCiudad,
    ].filter(Boolean),
    telefonos: (telefonos.length ? telefonos : porDefecto.phones).map((t) => (t.label ? `${t.display} (${t.label})` : t.display)),
    email: texto(n.email) || porDefecto.email,
  };
}

/* ------------------------------------------------------------------ */
/* Condiciones                                                          */
/* ------------------------------------------------------------------ */

const fraseValidez = (dias: number) => `Presupuesto válido durante ${dias} ${dias === 1 ? "día" : "días"} desde su fecha.`;

/** Las condiciones de siempre: la validez y la nota de los precios de la calculadora (Web › Tarifas). */
export function condicionesPorDefecto(notaPrecio: string | null | undefined, validezDias: number): string {
  return [fraseValidez(validezDias), texto(notaPrecio)].filter(Boolean).join("\n");
}

/**
 * Al cambiar los días de validez, si las condiciones dicen la validez anterior con la frase de siempre, se cambia
 * también ahí (lo demás no se toca).
 */
export function condicionesConValidez(condiciones: string | null | undefined, anterior: number, nueva: number): string | null {
  const c = condiciones ?? "";
  if (!c || anterior === nueva) return condiciones ?? null;
  const vieja = fraseValidez(anterior);
  return c.includes(vieja) ? c.replace(vieja, fraseValidez(nueva)) : c;
}
