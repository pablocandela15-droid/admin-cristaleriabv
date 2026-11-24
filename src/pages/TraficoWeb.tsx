import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { BarChart3 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  useEstadoSyncTrafico,
  useFdtMes,
  useSerieTrafico,
  useTendenciaTrafico,
  type FiltroProyecto,
} from "@/hooks/useTraficoWeb";
import { FiltrosTrafico } from "@/components/trafico-web/FiltrosTrafico";
import { resumirSerie, type RangoDias } from "@/components/trafico-web/calculos";
import { AvisosTrafico } from "@/components/trafico-web/AvisosTrafico";
import { KpisTrafico } from "@/components/trafico-web/KpisTrafico";
import { GraficoSerieVisitas } from "@/components/trafico-web/GraficoSerieVisitas";
import { TablaAnomalias } from "@/components/trafico-web/TablaAnomalias";
import { FdtMes } from "@/components/trafico-web/FdtMes";
import { TopPaginas } from "@/components/trafico-web/TopPaginas";
import { Desgloses } from "@/components/trafico-web/Desgloses";
import { EditorPesoPaginas } from "@/components/trafico-web/EditorPesoPaginas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";

// ---------------------------------------------------------------------------
// Tráfico web (/trafico-web): las visitas de la web de la cristalería
// (https://cristaleriabv.vercel.app) que guarda Vercel Web Analytics, copiadas
// cada noche por la Edge Function sync-trafico-web, con tendencia, anomalías,
// páginas, desgloses y la transferencia estimada; y debajo, lo que hacen los
// visitantes (calculadora, solicitudes de presupuesto, WhatsApp, teléfono…) con
// los eventos propios de la web (Logs web). Sección de permisos «trafico_web»:
// «Ver» lee; «Editar» además cambia los pesos por página. Ver docs/TRAFICO-WEB.md.
// ---------------------------------------------------------------------------

const ISO = "yyyy-MM-dd";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_TRAFICO = 360;

function EstadoVacio({ intentado }: { intentado: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center" data-testid="trafico-vacio">
        <div className="rounded-full bg-muted p-3">
          <BarChart3 className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="font-medium">Aún no hay datos: la sincronización se ejecuta cada noche a las 03:30 UTC</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Cada noche se copian las visitas del día anterior desde Vercel Web Analytics. En cuanto llegue la primera
          sincronización aparecerán aquí las gráficas, la tendencia y la estimación de transferencia.
        </p>
        {!intentado && (
          <div className="max-w-lg rounded-md border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Si mañana sigue vacío, falta algo por configurar:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Vercel: Web Analytics activado en el proyecto de la web (Analytics › Enable) y la web desplegada.</li>
              <li>Supabase: la función sync-trafico-web desplegada y el secreto VERCEL_ANALYTICS_TOKEN.</li>
              <li>Supabase › Vault: project_url y ocr_trabajos_secret (los de las tareas programadas del panel).</li>
            </ul>
            <p className="mt-1">El detalle está en docs/TRAFICO-WEB.md del panel.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CargandoPagina() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <Skeleton className="h-[420px]" />
    </div>
  );
}

export default function TraficoWeb() {
  const [proyecto, setProyecto] = useState<FiltroProyecto>("ambos");
  const [dias, setDias] = useState<RangoDias>(30);
  const puedeEditar = useCanAccessSection("trafico_web", "edit").canAccess;

  // Fechas en calendario local; la RPC trabaja con días cerrados (< hoy).
  const hoyStr = format(new Date(), ISO);
  const { hoy, desde, hasta, desdeAnterior } = useMemo(() => {
    const base = new Date(`${hoyStr}T00:00:00`);
    return {
      hoy: hoyStr,
      hasta: format(subDays(base, 1), ISO),
      desde: format(subDays(base, dias), ISO),
      // Se pide también el periodo anterior (misma duración) para el Δ% del KPI.
      desdeAnterior: format(subDays(base, 2 * dias), ISO),
    };
  }, [hoyStr, dias]);

  const serieQ = useSerieTrafico(proyecto, desdeAnterior, hasta);
  const tendenciaQ = useTendenciaTrafico(proyecto, dias);
  const fdtQ = useFdtMes();
  const syncQ = useEstadoSyncTrafico();

  const { serieActual, actual, anterior } = useMemo(() => {
    const filas = serieQ.data ?? [];
    const act = filas.filter((f) => f.fecha >= desde);
    const ant = filas.filter((f) => f.fecha < desde);
    return { serieActual: act, actual: resumirSerie(act), anterior: resumirSerie(ant) };
  }, [serieQ.data, desde]);

  const sinDatos = serieQ.isSuccess && actual.diasConDato === 0 && anterior.diasConDato === 0;

  // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página).
  // Solución provisional de la auditoría para este informe (clase C): subtítulo,
  // filtros y KPIs fijos arriba; avisos, gráfica, transferencia, anomalías y
  // desgloses en una región con scroll propio. Sin medida (jsdom, primer
  // pintado) cae al layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_TRAFICO);
  const kpisListos = !serieQ.isError && !serieQ.isLoading && !sinDatos;

  return (
    <DashboardLayout>
      <div ref={setRaiz} className="flex flex-col gap-3" style={alto ? { height: alto } : undefined}>
        {/* Título con el «?» del tour (como las demás secciones del Admin Panel); debajo, el periodo a la izquierda y
            «Pesos por página» a la derecha, en una sola fila. El origen de los datos (Vercel Web Analytics, con
            estimación de la transferencia) y la hora del último sync van en la línea discreta de debajo de las cifras. */}
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Tráfico web</h1>
          <BotonAyuda seccion="trafico_web" className="-my-2" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div data-tour="trafico-filtros">
            <FiltrosTrafico proyecto={proyecto} onProyectoChange={setProyecto} dias={dias} onDiasChange={setDias} />
          </div>
          {/* `flex-wrap` (Fase 3): a 320 px «Pesos por página» se salía de la pantalla. */}
          <div className="flex flex-wrap items-center gap-2" data-tour="trafico-pesos">
            <EditorPesoPaginas puedeEditar={puedeEditar} />
          </div>
        </div>

        {/* KPIs fijos bajo los filtros. Mientras cargan, su esqueleto va en la región (CargandoPagina). */}
        {kpisListos && (
          <div data-tour="trafico-kpis">
            <KpisTrafico
              actual={actual}
              anterior={anterior}
              tendencia={tendenciaQ.data}
              dias={dias}
              proyecto={proyecto}
              estadosSync={syncQ.data}
            />
          </div>
        )}

        {/* Región con scroll. Los avisos van aquí (y no fijos arriba) porque pueden
            ser varios y dejarían sin sitio al resto. `min-h-48`: suelo de la región;
            si lo fijo no deja sitio (móvil) vuelve el scroll de página. */}
        <div className="min-h-48 flex-1 space-y-5 overflow-y-auto overscroll-contain">
          {serieQ.isError ? (
            <EstadoErrorCarga titulo="las visitas" error={serieQ.error} onReintentar={() => serieQ.refetch()} />
          ) : serieQ.isLoading ? (
            <CargandoPagina />
          ) : sinDatos ? (
            <>
              <AvisosTrafico proyecto={proyecto} estados={syncQ.data} diasConDato={0} />
              <EstadoVacio intentado={(syncQ.data ?? []).some((e) => !!e.ultimo_intento_en)} />
            </>
          ) : (
            <>
              <AvisosTrafico proyecto={proyecto} estados={syncQ.data} diasConDato={actual.diasConDato} mostrarUltimoSync={false} />

              {tendenciaQ.isError && (
                <EstadoErrorCarga titulo="la tendencia" error={tendenciaQ.error} onReintentar={() => tendenciaQ.refetch()} />
              )}

              <div data-tour="trafico-grafica">
                <GraficoSerieVisitas serie={serieActual} tendencia={tendenciaQ.data} hoy={hoy} />
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                {fdtQ.isError ? (
                  <EstadoErrorCarga titulo="la estimación de transferencia" error={fdtQ.error} onReintentar={() => fdtQ.refetch()} />
                ) : fdtQ.isLoading ? (
                  <Skeleton className="h-[320px]" />
                ) : (
                  <FdtMes filas={fdtQ.data ?? []} proyectoSeleccionado={proyecto === "ambos" ? null : proyecto} />
                )}
                <TablaAnomalias serie={serieActual} />
              </div>

              <TopPaginas proyecto={proyecto} desde={desde} hasta={hasta} />
              <Desgloses proyecto={proyecto} desde={desde} hasta={hasta} />
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
