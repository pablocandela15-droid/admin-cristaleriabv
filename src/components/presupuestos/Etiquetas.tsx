import { Globe, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { estaCaducado, fechaCorta, infoEstado, validoHasta } from "@/lib/presupuestos/estados";
import type { EstadoPresupuesto, Presupuesto } from "@/lib/presupuestos/tipos";

const BASE = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold";

/** Colores por estado (como las etiquetas de Peticiones): la solicitud en crema, que llama la atención. */
const COLOR_ESTADO: Record<EstadoPresupuesto, string> = {
  solicitud: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  borrador: "border-border bg-muted text-muted-foreground",
  enviado: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  aceptado: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  rechazado: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

export function BadgeEstado({ estado, className }: { estado: EstadoPresupuesto; className?: string }) {
  const info = infoEstado(estado);
  return (
    <span className={cn(BASE, COLOR_ESTADO[estado], className)} title={info.ayuda} data-testid="estado-presupuesto">
      {info.etiqueta}
    </span>
  );
}

/** «Caducado»: enviado y con la validez pasada (no es un estado guardado). */
export function BadgeCaducado({ presupuesto, hoy, className }: { presupuesto: Pick<Presupuesto, "estado" | "fecha" | "validez_dias">; hoy?: string; className?: string }) {
  if (!estaCaducado(presupuesto, hoy)) return null;
  return (
    <span
      className={cn(BASE, "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200", className)}
      title={`Validez pasada el ${fechaCorta(validoHasta(presupuesto))} sin respuesta del cliente`}
      data-testid="caducado"
    >
      <Hourglass className="h-3 w-3" aria-hidden="true" />
      Caducado
    </span>
  );
}

/** «Web»: llegó desde la calculadora de la web. */
export function BadgeWeb({ className }: { className?: string }) {
  return (
    <span className={cn(BASE, "border-primary/30 bg-primary/10 text-primary dark:text-primary-foreground", className)} title="Llegó desde la calculadora de la web" data-testid="origen-web">
      <Globe className="h-3 w-3" aria-hidden="true" />
      Web
    </span>
  );
}

/** Las tres juntas, como salen en la lista y en la cabecera del presupuesto. */
export function EtiquetasPresupuesto({ presupuesto, hoy }: { presupuesto: Pick<Presupuesto, "estado" | "origen" | "fecha" | "validez_dias">; hoy?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <BadgeEstado estado={presupuesto.estado} />
      <BadgeCaducado presupuesto={presupuesto} hoy={hoy} />
      {presupuesto.origen === "web" && <BadgeWeb />}
    </span>
  );
}
