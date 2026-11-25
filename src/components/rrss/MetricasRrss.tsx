import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { useActualizarMetricas, useConexionRrss, useMetricasRrss, type PublicacionMetricas } from "@/hooks/useRrss";
import { hoyMadrid, sumarDias } from "@/lib/rrss/calendario";
import { cn } from "@/lib/utils";
import { resumirPeriodo, serieDiaria, ultimoDia, type Comparacion } from "../../../supabase/functions/_shared/rrss/resumen";

// ---------------------------------------------------------------------------
// RRSS › Métricas (portado de RRSS › Métricas y «Instagram en detalle» del panel de referencia): seguidores, alcance,
// visualizaciones e interacciones de 7 o 28 días frente al periodo anterior, la gráfica diaria (alcance y
// seguidores), los seguidores de la página de Facebook, «Qué funciona» (formato, tipo de trabajo, día, hora y hashtag,
// con muestra mínima) y las publicaciones con más alcance. Las cifras las captura cada noche rrss-metricas;
// «Actualizar ahora» las pide al momento (con «Editar», como mucho cada 5 minutos).
// ---------------------------------------------------------------------------

const COLOR = { alcance: "var(--viz-1)", seguidores: "var(--viz-2)" };
const TINTA_EJE = "hsl(var(--muted-foreground))";
const LINEA_EJE = "hsl(var(--border))";
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("es-ES"));
const variacion = (c: Comparacion) => (c.variacion === null ? "sin comparación" : `${c.variacion > 0 ? "+" : ""}${c.variacion.toLocaleString("es-ES")} % vs anterior`);
const tasa = (p: PublicacionMetricas) => (p.alcance && p.interacciones !== null ? Math.round((1000 * p.interacciones) / p.alcance) / 10 : null);
const TIPO: Record<string, string> = { REELS: "Reel", STORY: "Historia", FEED: "Publicación", CAROUSEL_ALBUM: "Carrusel" };

export function MetricasRrss({ puedeEditar }: { puedeEditar: boolean }) {
  const { data, isLoading, isError, error } = useMetricasRrss();
  const { data: conexion } = useConexionRrss();
  const actualizar = useActualizarMetricas();
  const [dias, setDias] = useState<"7" | "28">("28");
  const [orden, setOrden] = useState<"alcance" | "recientes">("alcance");

  const instagram = useMemo(() => (data?.cuenta ?? []).filter((f) => f.red === "instagram"), [data]);
  const facebook = useMemo(() => (data?.cuenta ?? []).filter((f) => f.red === "facebook" && typeof f.seguidores === "number"), [data]);
  const hasta = ultimoDia(instagram) ?? sumarDias(hoyMadrid(), -1);
  const resumen = instagram.length ? resumirPeriodo(instagram, hasta, Number(dias)) : null;
  const serie = useMemo(() => serieDiaria(instagram, hasta, 28).map((p) => ({ ...p, etiqueta: `${Number(p.fecha.slice(8))}/${Number(p.fecha.slice(5, 7))}` })), [instagram, hasta]);
  const publicaciones = useMemo(() => [...(data?.publicaciones ?? [])].sort((a, b) =>
    orden === "alcance" ? (b.alcance ?? -1) - (a.alcance ?? -1) : (b.publicado_at ?? "").localeCompare(a.publicado_at ?? "")).slice(0, 20), [data, orden]);
  const ultima = data?.capturas[0] ?? null;
  const faltaPermiso = data?.capturas.find((c) => !c.ok && c.error_tipo === "permiso_insights") && !data?.capturas.find((c) => c.ok);

  const pedir = () => actualizar.mutate(undefined, {
    onSuccess: (r) => toast.success(`Métricas actualizadas${typeof r.publicaciones === "number" ? ` (${r.publicaciones} publicaciones)` : ""}`),
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>No se pueden leer las métricas</AlertTitle><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-wrap items-center gap-2" data-tour="rrss-metricas">
        <ToggleGroup type="single" value={dias} onValueChange={(v) => v && setDias(v as "7" | "28")} aria-label="Periodo">
          <ToggleGroupItem value="7" variant="outline" size="sm">7 días</ToggleGroupItem>
          <ToggleGroupItem value="28" variant="outline" size="sm">28 días</ToggleGroupItem>
        </ToggleGroup>
        <p className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
          {ultima ? `Última actualización: ${new Date(ultima.inicio).toLocaleString("es-ES")}${ultima.ok ? "" : " (falló)"}` : "Aún no se ha capturado ninguna métrica."}
        </p>
        {puedeEditar && conexion?.conectada && (
          <Button type="button" variant="outline" size="sm" className="ml-auto sm:ml-0" onClick={pedir} disabled={actualizar.isPending}>
            {actualizar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />} Actualizar ahora
          </Button>
        )}
      </div>

      {!conexion?.conectada && instagram.length === 0 && (
        <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Sin datos todavía</AlertTitle>
          <AlertDescription>Las métricas salen cuando RRSS está conectado con Instagram: se capturan solas cada noche. Mira «Conexión y estilo».</AlertDescription></Alert>
      )}
      {faltaPermiso && (
        <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Falta el permiso para leer las métricas</AlertTitle>
          <AlertDescription>Al conectar no se aceptó «instagram_manage_insights». Pulsa «Renovar conexión» en «Conexión y estilo» y acepta todos los permisos.</AlertDescription></Alert>
      )}
      {ultima && !ultima.ok && !faltaPermiso && ultima.error && <p className="text-sm text-destructive">La última captura falló: {ultima.error}</p>}

      {resumen && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Instagram, últimos {dias} días</CardTitle>
            <CardDescription>El alcance es la suma del alcance de cada día (una persona que lo vio tres días cuenta tres veces). Meta tarda hasta 48 h en dar los datos.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <TiraCifras cifras={[
              { etiqueta: "Seguidores", valor: num(resumen.metricas.seguidores.actual), detalle: resumen.metricas.seguidores.cambio !== null ? `${resumen.metricas.seguidores.cambio >= 0 ? "+" : ""}${resumen.metricas.seguidores.cambio} en el periodo` : undefined },
              { etiqueta: "Alcance", valor: num(resumen.metricas.alcance.actual), detalle: variacion(resumen.metricas.alcance) },
              { etiqueta: "Visualizaciones", valor: num(resumen.metricas.visualizaciones.actual), detalle: variacion(resumen.metricas.visualizaciones) },
              { etiqueta: "Interacciones", valor: num(resumen.metricas.interacciones.actual), detalle: variacion(resumen.metricas.interacciones) },
              { etiqueta: "Visitas al perfil", valor: num(resumen.metricas.visitasPerfil.actual), detalle: variacion(resumen.metricas.visitasPerfil) },
              ...(facebook.length ? [{ etiqueta: "Seguidores en Facebook", valor: num(facebook[facebook.length - 1].seguidores) }] : []),
            ]} />
            <div className="h-56 w-full" data-testid="rrss-grafica">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke={LINEA_EJE} strokeOpacity={0.7} strokeDasharray="2 4" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: TINTA_EJE }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis yAxisId="a" tick={{ fontSize: 11, fill: TINTA_EJE }} tickLine={false} axisLine={false} width={44} />
                  <YAxis yAxisId="s" orientation="right" tick={{ fontSize: 11, fill: TINTA_EJE }} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v: number, n: string) => [num(v), n === "alcance" ? "Alcance" : "Seguidores"]} labelFormatter={(l) => `Día ${l}`} />
                  <Bar yAxisId="a" dataKey="alcance" fill={COLOR.alcance} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="s" dataKey="seguidores" stroke={COLOR.seguidores} strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.queFunciona && (
        <Card data-testid="rrss-que-funciona">
          <CardHeader className="pb-2"><CardTitle className="text-base">Qué funciona (90 días)</CardTitle>
            <CardDescription>Tasa de interacción = interacciones ÷ alcance. Es lo mismo que tiene en cuenta la IA.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data.queFunciona.aviso && <p className="text-muted-foreground">{data.queFunciona.aviso}</p>}
            {data.queFunciona.suficiente && (
              <ul className="space-y-1">
                {data.queFunciona.conclusiones.map((c) => (
                  <li key={c.eje} className={cn(c.estado === "mejor" ? "font-medium" : "text-muted-foreground")}>{c.estado === "mejor" ? "★ " : "· "}{c.texto}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {publicaciones.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Publicaciones</CardTitle>
            <ToggleGroup type="single" value={orden} onValueChange={(v) => v && setOrden(v as "alcance" | "recientes")} aria-label="Ordenar">
              <ToggleGroupItem value="alcance" variant="outline" size="sm">Más alcance</ToggleGroupItem>
              <ToggleGroupItem value="recientes" variant="outline" size="sm">Recientes</ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {publicaciones.map((p, i) => (
                <li key={p.media_id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                    {p.miniatura_url && <img src={p.miniatura_url} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{p.caption?.split("\n")[0] || TIPO[p.producto ?? ""] || "Publicación"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.publicado_at ? new Date(p.publicado_at).toLocaleDateString("es-ES") : ""} · {TIPO[p.producto === "FEED" && p.tipo_medio === "CAROUSEL_ALBUM" ? "CAROUSEL_ALBUM" : p.producto ?? ""] ?? ""}
                      {" · "}{num(p.alcance)} de alcance · {num(p.interacciones)} interacciones · {num(p.guardados)} guardados{tasa(p) !== null ? ` · ${tasa(p)!.toLocaleString("es-ES")} %` : ""}
                    </p>
                  </div>
                  {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" aria-label="Ver en Instagram" className="shrink-0"><ExternalLink className="h-4 w-4" /></a>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
