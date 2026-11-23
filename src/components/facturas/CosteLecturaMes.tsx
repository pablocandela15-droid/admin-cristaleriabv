import { Sparkles } from "lucide-react";
import { useEstadisticasLectura } from "@/hooks/useEstadisticasLectura";
import { textoResumenLectura } from "@/lib/facturas/costeLectura";
import { fmtEurIa, usdAEur } from "@/lib/gastoIa";
import { cn } from "@/lib/utils";

/** Ventana del resumen: los últimos 30 días naturales (hoy incluido). */
const DIAS = 30;

/**
 * Lo que ha costado leer facturas con IA en los últimos 30 días, en una línea
 * discreta encima de «Cargar»: «Lectura con IA, 30 días: 2,40 € · 31 docs · media
 * 7,7 cént./doc · más cara: …». Sale de `estadisticas_lectura` (lo que guarda
 * el lector en cada factura). Sin documentos medidos, o si falla, no pinta nada:
 * un dato de coste nunca rompe la pantalla.
 */
export function CosteLecturaMes({ className }: { className?: string }) {
  const { data } = useEstadisticasLectura(DIAS);
  const resumen = textoResumenLectura(data);
  if (!data || !resumen) return null;
  const total = data.totalUsd !== null ? fmtEurIa(usdAEur(data.totalUsd)) : null;
  return (
    <p
      className={cn("flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground", className)}
      data-testid="coste-lectura-mes"
      title="Lo que ha costado leer las facturas con IA (OpenAI) en los últimos 30 días."
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        Lectura con IA, {DIAS} días{total ? `: ${total}` : ""} · {resumen}
      </span>
    </p>
  );
}
