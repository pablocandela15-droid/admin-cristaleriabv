import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { ComportamientoWeb } from "@/components/trafico-web/comportamiento/ComportamientoWeb";
import { ResumenIa } from "@/components/trafico-web/comportamiento/ResumenIa";
import type { Entorno } from "@/hooks/useLogsWeb";
import { Interruptor } from "./Controles";
import { PERIODOS_ESTADISTICAS, rangoEstadisticas } from "./calculos";

/** Estadísticas de comportamiento con las mismas definiciones y la misma RPC que Tráfico web. */
export function PestanaEstadisticas({ entorno }: { entorno: Entorno | null }) {
  const [periodo, setPeriodo] = useState<string>("30");
  const [incluirInternos, setIncluirInternos] = useState(false);
  const hoyStr = format(new Date(), "yyyy-MM-dd");
  const { desde, hasta } = useMemo(() => rangoEstadisticas(periodo, new Date(`${hoyStr}T12:00:00`)), [periodo, hoyStr]);

  return (
    <div className="space-y-4 pt-3" data-testid="pestana-estadisticas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SelectorSubrayado aria-label="Periodo de las estadísticas" valor={periodo} onCambio={setPeriodo} opciones={[...PERIODOS_ESTADISTICAS]} />
          <Interruptor id="est-internos" etiqueta="Incluir internas y pruebas" valor={incluirInternos} onCambio={setIncluirInternos} />
          <span className="text-xs text-muted-foreground">{desde === hasta ? desde : `${desde} → ${hasta}`} · hora de Madrid · comparado con el periodo anterior de la misma duración</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-11 gap-2">
            <Link to="/trafico-web"><Activity className="h-4 w-4" /> Tráfico web</Link>
          </Button>
        </div>
      </div>
      {entorno ? (
        <>
          <ComportamientoWeb desde={desde} hasta={hasta} entorno={entorno} incluirInternos={incluirInternos} />
          <ResumenIa desde={desde} hasta={hasta} entorno={entorno} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Elige un entorno para ver las estadísticas.</p>
      )}
    </div>
  );
}
