import { useMemo, useState } from "react";
import { ExternalLink, Loader2, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBorrarPieza, useMarcarLista, usePiezasRrss, useProgramacionesRrss, usePublicarAhora, useUrlsFirmadas, type PiezaRrss } from "@/hooks/useRrss";
import { textoInstante } from "@/lib/rrss/calendario";
import { nombreServicioRrss } from "../../../supabase/functions/_shared/rrss/formatos";
import { IconoRed, InsigniaEstado, NOMBRE_FORMATO } from "./EstadoPublicacion";

// ---------------------------------------------------------------------------
// RRSS › Publicaciones: todo lo creado (borradores, listas, programadas, publicadas, con error), agrupado por envío
// (Instagram y Facebook juntos). Desde aquí se abre en Crear, se publica, se reintenta un error, se borra un
// borrador o se ve en la red. Los errores salen explicados con cómo arreglarlos.
// ---------------------------------------------------------------------------

type Filtro = "todas" | "borrador" | "programada" | "publicada" | "error";

export function HistorialRrss({ puedeEditar, onAbrir }: { puedeEditar: boolean; onAbrir: (grupoId: string) => void }) {
  const { data: piezas = [], isLoading } = usePiezasRrss();
  const { data: programaciones = [] } = useProgramacionesRrss();
  const publicar = usePublicarAhora();
  const borrar = useBorrarPieza();
  const lista = useMarcarLista();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const programadas = useMemo(() => new Map(programaciones.filter((g) => g.estado === "programada" || g.estado === "publicando").map((g) => [g.pieza_id, g])), [programaciones]);
  const estadoVisible = (p: PiezaRrss) => (programadas.has(p.id) && p.estado !== "publicada" ? "programada" : p.estado);

  const grupos = useMemo(() => {
    const m = new Map<string, PiezaRrss[]>();
    for (const p of piezas) m.set(p.grupo_id, [...(m.get(p.grupo_id) ?? []), p]);
    return [...m.values()]
      .map((g) => g.sort((a, b) => a.red.localeCompare(b.red)).reverse())
      .filter((g) => filtro === "todas" || g.some((p) => {
        const e = estadoVisible(p);
        return filtro === "borrador" ? e === "borrador" || e === "lista" : filtro === "publicada" ? e === "publicada" : filtro === "error" ? e === "error" : e === "programada" || e === "procesando" || e === "publicando";
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piezas, filtro, programadas]);

  const portadas = grupos.map((g) => g[0].rrss_medios.find((m) => m.tipo === "imagen" && !g[0].medios_borrados_at)?.ruta).filter((r): r is string => Boolean(r));
  const { data: urls } = useUrlsFirmadas(portadas);

  return (
    <div className="space-y-3 pb-4" data-tour="rrss-historial">
      <ToggleGroup type="single" value={filtro} onValueChange={(v) => v && setFiltro(v as Filtro)} className="flex flex-wrap justify-start gap-1" aria-label="Filtrar">
        {([["todas", "Todas"], ["borrador", "Borradores y listas"], ["programada", "Programadas"], ["publicada", "Publicadas"], ["error", "Con error"]] as const).map(([v, t]) => (
          <ToggleGroupItem key={v} value={v} variant="outline" size="sm">{t}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      {isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>}
      {!isLoading && grupos.length === 0 && <p className="text-sm text-muted-foreground">No hay publicaciones {filtro === "todas" ? "todavía" : "con ese filtro"}.</p>}
      <ul className="space-y-2">
        {grupos.map((g) => {
          const base = g[0];
          const portada = base.rrss_medios.find((m) => m.tipo === "imagen")?.ruta;
          const editable = g.some((p) => ["borrador", "lista", "error"].includes(p.estado) && !programadas.has(p.id));
          return (
            <li key={base.grupo_id} className="flex gap-3 rounded-md border p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-muted">
                {portada && urls?.[portada] && <img src={urls[portada]} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-medium">{base.titulo || base.caption.split("\n")[0] || NOMBRE_FORMATO[base.formato]}</p>
                <p className="text-xs text-muted-foreground">
                  {NOMBRE_FORMATO[base.formato]}{base.servicio ? ` · ${nombreServicioRrss(base.servicio)}` : ""}
                  {base.fecha_prevista ? ` · prevista el ${base.fecha_prevista.split("-").reverse().join("/")}` : ""} · {new Date(base.updated_at).toLocaleDateString("es-ES")}
                </p>
                <ul className="space-y-1">
                  {g.map((p) => {
                    const prog = programadas.get(p.id);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <IconoRed red={p.red} />
                        <InsigniaEstado estado={estadoVisible(p)} />
                        {prog && <span className="text-muted-foreground">{textoInstante(prog.programada_para)}</span>}
                        {p.publicada_at && <span className="text-muted-foreground">{textoInstante(p.publicada_at)}</span>}
                        {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Verla <ExternalLink className="h-3 w-3" /></a>}
                        {puedeEditar && p.estado === "error" && !prog && (
                          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={lista.isPending || publicar.isPending}
                            onClick={() => lista.mutate(p.id, {
                              onSuccess: () => publicar.mutate([p.id], {
                                onSuccess: (r) => (r.ok ? toast.success("Publicada") : toast.error(r.resultados[0]?.mensaje ?? "No se ha podido publicar")),
                                onError: (e) => toast.error(e.message),
                              }),
                              onError: (e) => toast.error(e.message),
                            })}>
                            <RotateCcw className="mr-1 h-3 w-3" /> Reintentar
                          </Button>
                        )}
                        {puedeEditar && p.estado === "lista" && !prog && (
                          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={publicar.isPending}
                            onClick={() => publicar.mutate([p.id], { onSuccess: (r) => (r.ok ? toast.success("Publicada") : toast.error(r.resultados[0]?.mensaje ?? "No se ha podido publicar")), onError: (e) => toast.error(e.message) })}>
                            <Send className="mr-1 h-3 w-3" /> Publicar
                          </Button>
                        )}
                        {p.error && (p.estado === "error" || p.estado === "publicada") && (
                          <span className={p.estado === "error" ? "w-full text-destructive" : "w-full text-muted-foreground"}>{p.error}{p.como_arreglarlo ? `${/[.!?…]$/.test((p.error ?? "").trim()) ? "" : "."} ${p.como_arreglarlo}` : ""}</span>
                        )}
                        {p.estado === "procesando" && <span className="w-full text-muted-foreground">Instagram está procesando el vídeo; sale sola en unos minutos.</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
              {puedeEditar && (
                <div className="flex shrink-0 flex-col gap-1">
                  {editable && <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Abrir en Crear" onClick={() => onAbrir(base.grupo_id)}><Pencil className="h-4 w-4" /></Button>}
                  {g.every((p) => ["borrador", "lista", "error"].includes(p.estado) && !programadas.has(p.id)) && (
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Borrar" disabled={borrar.isPending}
                      onClick={() => { if (window.confirm("¿Borrar esta publicación? No se ha publicado, así que no se pierde nada en las redes.")) for (const p of g) borrar.mutate(p.id, { onError: (e) => toast.error(e.message) }); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
