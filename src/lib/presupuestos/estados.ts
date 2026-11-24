// ============================================================================
//  Presupuestos: estados, «Caducado» y cambios de estado (sin React)
// ----------------------------------------------------------------------------
//  solicitud → borrador → enviado → aceptado | rechazado. «Caducado» no es un
//  estado guardado: un presupuesto enviado cuya validez (fecha + validez_dias)
//  ya ha pasado sale con esa marca hasta que el cliente responde.
//    · Marcar como enviado pone enviado_en; aceptado y rechazado, respondido_en.
//    · Volver a borrador los quita (se prepara de nuevo).
// ============================================================================
import type { EstadoPresupuesto, Presupuesto } from "./tipos";

export interface InfoEstado {
  valor: EstadoPresupuesto;
  etiqueta: string;
  /** Para los filtros («Solicitudes», «Borradores»…). */
  plural: string;
  ayuda: string;
}

export const ESTADOS_PRESUPUESTO: readonly InfoEstado[] = [
  { valor: "solicitud", etiqueta: "Solicitud", plural: "Solicitudes", ayuda: "Ha llegado desde la calculadora de la web: revísala y conviértela en borrador." },
  { valor: "borrador", etiqueta: "Borrador", plural: "Borradores", ayuda: "Se está preparando: el cliente aún no lo tiene." },
  { valor: "enviado", etiqueta: "Enviado", plural: "Enviados", ayuda: "El cliente ya lo tiene: falta su respuesta." },
  { valor: "aceptado", etiqueta: "Aceptado", plural: "Aceptados", ayuda: "El cliente lo ha aceptado." },
  { valor: "rechazado", etiqueta: "Rechazado", plural: "Rechazados", ayuda: "El cliente no lo quiere (o se ha descartado la solicitud)." },
];

export const esEstadoPresupuesto = (v: unknown): v is EstadoPresupuesto => ESTADOS_PRESUPUESTO.some((e) => e.valor === v);

export const infoEstado = (estado: EstadoPresupuesto): InfoEstado =>
  ESTADOS_PRESUPUESTO.find((e) => e.valor === estado) ?? ESTADOS_PRESUPUESTO[1];

/* ------------------------------------------------------------------ */
/* Fechas (AAAA-MM-DD, en hora local)                                  */
/* ------------------------------------------------------------------ */

const dosCifras = (n: number) => String(n).padStart(2, "0");

/** Hoy en AAAA-MM-DD (hora local). */
export function hoyIso(ahora: Date = new Date()): string {
  return `${ahora.getFullYear()}-${dosCifras(ahora.getMonth() + 1)}-${dosCifras(ahora.getDate())}`;
}

/** AAAA-MM-DD + n días. */
export function sumarDias(fechaIso: string, dias: number): string {
  const [a, m, d] = fechaIso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return fechaIso;
  return hoyIso(new Date(a, m - 1, d + Math.round(dias || 0)));
}

/** «23/11/2026» a partir de AAAA-MM-DD (o de una marca de tiempo). */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split("-").reverse().join("/");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${dosCifras(d.getDate())}/${dosCifras(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Último día en que vale el presupuesto (fecha + validez_dias). */
export const validoHasta = (p: Pick<Presupuesto, "fecha" | "validez_dias">): string => sumarDias(p.fecha, p.validez_dias);

/** Enviado y con la validez pasada (sin respuesta del cliente). */
export function estaCaducado(p: Pick<Presupuesto, "estado" | "fecha" | "validez_dias">, hoy: string = hoyIso()): boolean {
  return p.estado === "enviado" && validoHasta(p) < hoy;
}

/* ------------------------------------------------------------------ */
/* Cambios de estado                                                   */
/* ------------------------------------------------------------------ */

export interface AccionEstado {
  destino: EstadoPresupuesto;
  etiqueta: string;
  /** principal = el paso normal; peligro = rechazar; secundaria = deshacer. */
  tono: "principal" | "secundaria" | "peligro";
}

/** Los botones de estado que tiene cada uno, en orden. */
export function accionesDeEstado(p: Pick<Presupuesto, "estado" | "enviado_en">): AccionEstado[] {
  switch (p.estado) {
    case "solicitud":
      return [
        { destino: "borrador", etiqueta: "Convertir en borrador", tono: "principal" },
        { destino: "rechazado", etiqueta: "Descartar solicitud", tono: "peligro" },
      ];
    case "borrador":
      return [{ destino: "enviado", etiqueta: "Marcar como enviado", tono: "principal" }];
    case "enviado":
      return [
        { destino: "aceptado", etiqueta: "Aceptado", tono: "principal" },
        { destino: "rechazado", etiqueta: "Rechazado", tono: "peligro" },
        { destino: "borrador", etiqueta: "Volver a borrador", tono: "secundaria" },
      ];
    case "aceptado":
    case "rechazado":
      return [
        ...(p.enviado_en ? [{ destino: "enviado" as const, etiqueta: "Volver a enviado", tono: "secundaria" as const }] : []),
        { destino: "borrador", etiqueta: "Reabrir como borrador", tono: "secundaria" },
      ];
    default:
      return [];
  }
}

export type CambiosEstado = Pick<Presupuesto, "estado"> & Partial<Pick<Presupuesto, "enviado_en" | "respondido_en">>;

/**
 * Lo que se guarda al pasar a `destino`: enviado pone enviado_en (o conserva el de antes al deshacer una respuesta),
 * aceptado y rechazado ponen respondido_en, y volver a borrador quita los dos.
 */
export function cambiosEstado(
  actual: Pick<Presupuesto, "estado" | "enviado_en">,
  destino: EstadoPresupuesto,
  ahora: Date = new Date(),
): CambiosEstado {
  const marca = ahora.toISOString();
  switch (destino) {
    case "borrador":
    case "solicitud":
      return { estado: destino, enviado_en: null, respondido_en: null };
    case "enviado": {
      const deshace = (actual.estado === "aceptado" || actual.estado === "rechazado") && !!actual.enviado_en;
      return { estado: "enviado", enviado_en: deshace ? actual.enviado_en : marca, respondido_en: null };
    }
    case "aceptado":
    case "rechazado":
      return { estado: destino, respondido_en: marca };
  }
}

/** Texto del aviso al cambiar de estado. */
export function avisoCambioEstado(destino: EstadoPresupuesto, numero: string): string {
  switch (destino) {
    case "borrador":
      return `${numero} pasa a borrador`;
    case "enviado":
      return `${numero} marcado como enviado`;
    case "aceptado":
      return `${numero} aceptado`;
    case "rechazado":
      return `${numero} rechazado`;
    default:
      return `${numero} actualizado`;
  }
}
