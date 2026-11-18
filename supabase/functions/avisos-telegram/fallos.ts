// ============================================================================
//  avisos-telegram · fallos internos para desarrolladores (12/11/2026)
//  Lógica pura (sin Deno ni red), probada en __tests__/fallos.test.ts.
//
//  Para un TIPO NUEVO: registrarlo con fallo_interno_registrar('<tipo>', datos)
//  (SQL) y, si quieres un formato propio, añadir una entrada a FORMATOS. Sin
//  formato propio sale el genérico (tipo + datos).
// ============================================================================
import { LIMITE_TELEGRAM, recortar, ZONA } from "./logica.ts";

export interface Fallo {
  id: number;
  tipo: string;
  datos: Record<string, unknown>;
  usuario: string | null;
  created_at: string;
}

/** Datos que la función añade buscando en la base (hoy, ninguno: se deja para tipos nuevos). */
export type Contexto = Record<string, never>;

const limpio = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function horaLegible(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "?";
  return new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

type Formato = (f: Fallo, ctx: Contexto) => string;

/** «Además: N más desde …»: los que llegaron agrupados (fallos_internos_agrupar, 15 min) desde el aviso anterior. */
function ademas(d: Record<string, unknown>, uno: string, varios: string): string[] {
  const n = Number(d.acumulados_antes);
  if (!(Number.isInteger(n) && n > 0)) return [];
  const ids = Array.isArray(d.acumulados_ids) ? d.acumulados_ids.map((x) => limpio(String(x))).filter(Boolean) : [];
  return [
    `Además: ${n} ${n === 1 ? uno : varios} más desde ${horaLegible(limpio(d.acumulados_desde))} (se agrupan: un aviso cada 15 min como mucho).`,
    ...(ids.length ? [`Ids: ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? "…" : ""}`] : []),
  ];
}

const diaHora = (v: unknown): string => horaLegible(limpio(v) || null);

const FORMATOS: Record<string, Formato> = {
  // 18/11/2026: los registra el vigilante (vigilante_fallos_telegram), ya agrupados y con tope.
  openai_sin_creditos: (f) => {
    const d = f.datos;
    return [
      "OpenAI sin créditos o con error de facturación",
      `Llamadas a la IA fallidas por esto: ${Number(d.trabajos) || "?"}${limpio(d.desde) ? ` (desde ${diaHora(d.desde)})` : ""}`,
      ...(limpio(d.ejemplo) ? [`Error: ${recortar(limpio(d.ejemplo), 250)}`] : []),
      "Qué hacer: revisa el saldo y la facturación de OpenAI; hasta entonces lo que usa IA (análisis de tickets) no funciona.",
    ].join("\n");
  },
  cron_caido: (f) => {
    const d = f.datos;
    const crons = Array.isArray(d.crons) ? (d.crons as Record<string, unknown>[]).slice(0, 8) : [];
    return [
      "Tarea programada sin éxito",
      ...crons.map((c) => `- ${limpio(c.job)}: ${Number(c.minutos) ? `${Math.round(Number(c.minutos))} min` : "mucho tiempo"} sin éxito (máx. ${Number(c.maximo) || "?"})${limpio(c.error) ? ` · ${recortar(limpio(c.error), 100)}` : ""}`),
      ...(crons.length === 0 ? ["- (sin detalle)"] : []),
    ].join("\n");
  },
};

/** Texto de un fallo (tipo conocido o genérico), siempre ≤ LIMITE_TELEGRAM. */
export function mensajeFallo(f: Fallo, ctx: Contexto = {}): string {
  const formato = FORMATOS[f.tipo];
  const texto = formato
    ? formato(f, ctx)
    : [
      `Fallo interno: ${f.tipo.replace(/_/g, " ")}`,
      ...(f.usuario ? [`Usuario: ${f.usuario}`] : []),
      `Hora: ${horaLegible(f.created_at)}`,
      recortar(JSON.stringify(f.datos), 2500),
      ...ademas(f.datos, "fallo", "fallos"),
    ].join("\n");
  return recortar(texto, LIMITE_TELEGRAM);
}
