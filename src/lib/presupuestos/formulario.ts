// ============================================================================
//  Presupuestos: formulario de la cabecera (sin React)
// ----------------------------------------------------------------------------
//  Lo que se escribe en el editor (cliente, fecha, validez, descuento, IVA,
//  condiciones y notas) va como texto; aquí se valida, se sacan los cambios
//  respecto a lo guardado y se mezcla con lo que llega de la base mientras se
//  escribe (lo que no se ha tocado se pone al día; lo tocado se respeta).
// ============================================================================
import { leerNumero, numeroEditable, redondear2 } from "./totales";
import type { CabeceraEditable, Presupuesto } from "./tipos";

export interface FormularioCabecera {
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_email: string;
  cliente_direccion: string;
  cliente_poblacion: string;
  fecha: string;
  validez: string;
  descuento: string;
  iva: string;
  condiciones: string;
  notas_internas: string;
}

export function formularioDe(p: Presupuesto): FormularioCabecera {
  return {
    cliente_nombre: p.cliente_nombre ?? "",
    cliente_telefono: p.cliente_telefono ?? "",
    cliente_email: p.cliente_email ?? "",
    cliente_direccion: p.cliente_direccion ?? "",
    cliente_poblacion: p.cliente_poblacion ?? "",
    fecha: p.fecha,
    validez: String(p.validez_dias),
    descuento: numeroEditable(p.descuento_pct),
    iva: numeroEditable(p.iva_pct),
    condiciones: p.condiciones ?? "",
    notas_internas: p.notas_internas ?? "",
  };
}

export const mismoFormulario = (a: FormularioCabecera, b: FormularioCabecera) =>
  (Object.keys(a) as (keyof FormularioCabecera)[]).every((k) => a[k] === b[k]);

/** Mezcla a tres bandas: de lo que llega (`nuevo`), solo lo que el usuario no ha tocado respecto a `base`. */
export function fusionarFormulario(actual: FormularioCabecera, base: FormularioCabecera, nuevo: FormularioCabecera): FormularioCabecera {
  const out = { ...actual };
  for (const k of Object.keys(actual) as (keyof FormularioCabecera)[]) if (actual[k] === base[k]) out[k] = nuevo[k];
  return out;
}

export type ErroresFormulario = Partial<Record<keyof FormularioCabecera, string>>;

const porcentajeValido = (v: string) => {
  const n = leerNumero(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
export const leerPorcentaje = porcentajeValido;

/** Días de validez escritos (entero de 1 a 3.650), o null. */
export function validezValida(v: string): number | null {
  const n = Number(v.trim());
  return /^\d+$/.test(v.trim()) && n >= 1 && n <= 3650 ? n : null;
}

export function erroresFormulario(f: FormularioCabecera): ErroresFormulario {
  const e: ErroresFormulario = {};
  if (!f.cliente_nombre.trim()) e.cliente_nombre = "Pon el nombre del cliente.";
  if (f.cliente_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.cliente_email.trim())) e.cliente_email = "Ese correo no parece válido.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) e.fecha = "Pon una fecha.";
  if (validezValida(f.validez) == null) e.validez = "Entre 1 y 3.650 días.";
  if (porcentajeValido(f.descuento) == null) e.descuento = "Entre 0 y 100.";
  if (porcentajeValido(f.iva) == null) e.iva = "Entre 0 y 100.";
  return e;
}

const textoONull = (v: string, max: number) => (v.trim() ? v.trim().slice(0, max) : null);

/** Lo que cambia respecto a lo guardado (solo con el formulario válido). */
export function cambiosFormulario(f: FormularioCabecera, p: Presupuesto): Partial<CabeceraEditable> {
  const nuevo: CabeceraEditable = {
    // Lo que no es válido se queda como está guardado (el botón de guardar no deja hasta corregirlo).
    cliente_nombre: f.cliente_nombre.trim().slice(0, 200) || p.cliente_nombre,
    cliente_telefono: textoONull(f.cliente_telefono, 40),
    cliente_email: textoONull(f.cliente_email, 200),
    cliente_direccion: textoONull(f.cliente_direccion, 300),
    cliente_poblacion: textoONull(f.cliente_poblacion, 120),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) ? f.fecha : p.fecha,
    validez_dias: validezValida(f.validez) ?? p.validez_dias,
    descuento_pct: redondear2(porcentajeValido(f.descuento) ?? p.descuento_pct),
    iva_pct: redondear2(porcentajeValido(f.iva) ?? p.iva_pct),
    condiciones: f.condiciones.trim() ? f.condiciones.replace(/\s+$/, "").slice(0, 5000) : null,
    notas_internas: f.notas_internas.trim() ? f.notas_internas.replace(/\s+$/, "").slice(0, 5000) : null,
  };
  const cambios: Partial<CabeceraEditable> = {};
  for (const k of Object.keys(nuevo) as (keyof CabeceraEditable)[]) {
    if (nuevo[k] !== (p[k] ?? null)) (cambios as Record<string, unknown>)[k] = nuevo[k];
  }
  return cambios;
}

/** El presupuesto con lo que hay en pantalla (para el PDF y los envíos). */
export function presupuestoEnPantalla(p: Presupuesto, f: FormularioCabecera): Presupuesto {
  return { ...p, ...cambiosFormulario(f, p) };
}
