import { Link } from "react-router-dom";
import { MousePointerClick } from "lucide-react";
import { esSinMigracionLogs, useEntornoLogs } from "@/hooks/useLogsWeb";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { ComportamientoWeb } from "./ComportamientoWeb";
import { ResumenIa } from "./ResumenIa";

/**
 * Tráfico web › Comportamiento: lo que hacen los visitantes (eventos propios de la web, sin cookies), en el mismo
 * periodo que el resto de la página. Las cifras salen de la misma RPC que Super Admin › Logs › Estadísticas: no hay
 * dos sistemas con cifras distintas. Quien ve Tráfico web lee las cifras agregadas (web_comportamiento); las sesiones
 * y los errores sueltos siguen siendo solo del super admin (Logs).
 */
export function SeccionComportamiento({ desde, hasta }: { desde: string; hasta: string }) {
  const entornoQ = useEntornoLogs();
  const { isSuperAdmin } = useSuperAdmin();
  // El entorno de ESTA base de datos (la demo enseña lo que se ha registrado en la demo).
  const entorno = entornoQ.data ?? null;
  return (
    <section className="space-y-3" data-testid="seccion-comportamiento" data-tour="trafico-comportamiento">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MousePointerClick className="h-4 w-4 text-muted-foreground" aria-hidden /> Comportamiento de los visitantes
        </h2>
        {isSuperAdmin && (
          <Link to="/super-admin/logs?tab=estadisticas" className="text-sm text-primary underline underline-offset-2">Ver recorridos y errores en Logs</Link>
        )}
      </div>
      {entornoQ.isError ? (
        <p className="text-sm text-muted-foreground">
          {esSinMigracionLogs(entornoQ.error)
            ? "El comportamiento estará disponible cuando se aplique la migración de Logs (20261124120000_logs_web)."
            : "No se ha podido leer el comportamiento de los visitantes."}
        </p>
      ) : entorno ? (
        <>
          <ComportamientoWeb desde={desde} hasta={hasta} entorno={entorno} contexto="trafico" />
          <ResumenIa desde={desde} hasta={hasta} entorno={entorno} />
        </>
      ) : null}
    </section>
  );
}
