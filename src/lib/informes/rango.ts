// ============================================================================
//  Rangos de fechas de los informes (cuentas puras, sin DOM)
// ----------------------------------------------------------------------------
//  Atajos del selector «desde – hasta» de Super Admin › Informes, validación de
//  fechas `YYYY-MM-DD` y el texto corto de un rango («12 ene – 3 mar 2026»).
// ============================================================================

const dos = (n: number) => String(n).padStart(2, "0");
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fecha local (no UTC) como `YYYY-MM-DD`: «hoy» es el día del negocio. */
export const isoLocal = (d: Date): string => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const RE_ISO = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM-DD` que existe de verdad (nada de 31 de febrero). */
export function esFechaIso(v: string | null | undefined): v is string {
  if (!v || !RE_ISO.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export function sumarDiasIso(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`;
}

export interface AtajoPeriodo {
  id: string;
  etiqueta: string;
  desde: string;
  hasta: string;
}

/** Atajos del selector personalizado. */
export function atajosPeriodo(hoy: Date): AtajoPeriodo[] {
  const h = isoLocal(hoy);
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  const ultimoDia = (anio: number, mes0: number) => new Date(anio, mes0 + 1, 0).getDate();
  const mesAnt = m === 0 ? { a: a - 1, m: 11 } : { a, m: m - 1 };
  return [
    { id: "7d", etiqueta: "Últimos 7 días", desde: sumarDiasIso(h, -6), hasta: h },
    { id: "30d", etiqueta: "Últimos 30 días", desde: sumarDiasIso(h, -29), hasta: h },
    { id: "90d", etiqueta: "Últimos 90 días", desde: sumarDiasIso(h, -89), hasta: h },
    { id: "este-mes", etiqueta: "Este mes", desde: `${a}-${dos(m + 1)}-01`, hasta: `${a}-${dos(m + 1)}-${dos(ultimoDia(a, m))}` },
    {
      id: "mes-anterior",
      etiqueta: "Mes anterior",
      desde: `${mesAnt.a}-${dos(mesAnt.m + 1)}-01`,
      hasta: `${mesAnt.a}-${dos(mesAnt.m + 1)}-${dos(ultimoDia(mesAnt.a, mesAnt.m))}`,
    },
    { id: "este-anio", etiqueta: "Este año", desde: `${a}-01-01`, hasta: `${a}-12-31` },
    { id: "anio-pasado", etiqueta: "Año pasado", desde: `${a - 1}-01-01`, hasta: `${a - 1}-12-31` },
  ];
}

/** «5 nov 2025» */
export function fechaCorta(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MESES_CORTOS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(0, 4)}`;
}

/** «12 ene – 3 mar 2026» · «5 nov 2025 – 4 nov 2026» · «7 mar 2026». */
export function textoRango(desde: string, hasta: string): string {
  if (desde === hasta) return fechaCorta(desde);
  // Mismo mes: «1 – 31 oct 2026».
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `${Number(desde.slice(8, 10))} – ${fechaCorta(hasta)}`;
  const corta = fechaCorta(desde);
  return desde.slice(0, 4) === hasta.slice(0, 4) ? `${corta.replace(/ \d{4}$/, "")} – ${fechaCorta(hasta)}` : `${corta} – ${fechaCorta(hasta)}`;
}
