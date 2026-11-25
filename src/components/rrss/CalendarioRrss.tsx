import { useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCancelarProgramacion, usePiezasRrss, useProgramacionesRrss } from "@/hooks/useRrss";
import { agruparPorDia, construirEventos, DIAS_CORTOS, diasVista, hoyMadrid, moverVista, textoInstante, tituloVista, type EventoCalendario, type VistaCalendario } from "@/lib/rrss/calendario";
import { cn } from "@/lib/utils";
import { DialogoProgramar } from "./DialogoProgramar";
import { IconoRed, InsigniaEstado, NOMBRE_FORMATO } from "./EstadoPublicacion";

// ---------------------------------------------------------------------------
// RRSS › Calendario (portado de CalendarioInstagram): lo programado (pendiente, publicándose o con error), lo
// publicado y los borradores con fecha prevista (de las campañas), por semana o por mes, en hora de Madrid. Al pulsar
// una: abrirla en Crear, moverla, cancelarla o verla en la red. Se refresca solo cada minuto.
// ---------------------------------------------------------------------------

function resumen(e: EventoCalendario): string {
  return e.pieza?.titulo || e.pieza?.caption.split("\n")[0] || NOMBRE_FORMATO[e.pieza?.formato ?? ""] || "Publicación";
}

export function CalendarioRrss({ puedeEditar, onAbrir }: { puedeEditar: boolean; onAbrir: (grupoId: string) => void }) {
  const { data: piezas = [] } = usePiezasRrss();
  const { data: programaciones = [], isLoading } = useProgramacionesRrss();
  const cancelar = useCancelarProgramacion();
  const [vista, setVista] = useState<VistaCalendario>("semana");
  const [dia, setDia] = useState(() => hoyMadrid());
  const [abierto, setAbierto] = useState<EventoCalendario | null>(null);
  const [mover, setMover] = useState<EventoCalendario | null>(null);
  const hoy = hoyMadrid();
  const dias = diasVista(vista, dia);
  const porDia = useMemo(() => agruparPorDia(construirEventos(programaciones, piezas)), [programaciones, piezas]);
  const mesActual = dia.slice(0, 7);

  return (
    <div className="space-y-3 pb-4" data-tour="rrss-calendario">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="Anterior" onClick={() => setDia(moverVista(vista, dia, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon" aria-label="Siguiente" onClick={() => setDia(moverVista(vista, dia, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDia(hoy)}>Hoy</Button>
        <h2 className="order-first w-full truncate text-base font-semibold first-letter:uppercase sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">{tituloVista(vista, dia)}</h2>
        <ToggleGroup type="single" value={vista} onValueChange={(v) => v && setVista(v as VistaCalendario)} aria-label="Vista" className="ml-auto sm:ml-0">
          <ToggleGroupItem value="semana" variant="outline" size="sm">Semana</ToggleGroupItem>
          <ToggleGroupItem value="mes" variant="outline" size="sm">Mes</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="hidden grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground md:grid" aria-hidden="true">
        {DIAS_CORTOS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <ol className="grid grid-cols-1 gap-1 md:grid-cols-7">
        {dias.map((d) => {
          const eventos = porDia.get(d) ?? [];
          const fuera = vista === "mes" && d.slice(0, 7) !== mesActual;
          if (vista === "mes" && eventos.length === 0 && fuera) return <li key={d} className="hidden md:block" />;
          return (
            <li key={d} className={cn("min-h-[5.5rem] min-w-0 rounded-md border p-1.5", d === hoy && "border-primary", fuera && "opacity-60", vista === "mes" && eventos.length === 0 && "hidden md:block")}>
              <p className="mb-1 text-xs font-medium"><span className="md:hidden">{DIAS_CORTOS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} </span>{Number(d.slice(8))}</p>
              <ul className="space-y-1">
                {eventos.map((e) => (
                  <li key={e.clave}>
                    <button type="button" onClick={() => setAbierto(e)}
                      className={cn("flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[11px] leading-tight hover:bg-muted",
                        e.tipo === "borrador" && "border-dashed", e.estado === "error" && "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950")}>
                      <IconoRed red={e.red} className="h-3 w-3" />
                      {e.hora && <span className="shrink-0 font-medium">{e.hora}</span>}
                      <span className="min-w-0 truncate">{resumen(e)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      {!isLoading && programaciones.length === 0 && piezas.every((p) => !p.fecha_prevista && p.estado !== "publicada") && (
        <p className="text-sm text-muted-foreground">Aún no hay nada programado. Crea una publicación y pulsa «Programar…», o acepta una campaña en «Ideas y campañas».</p>
      )}

      <Dialog open={abierto !== null} onOpenChange={(o) => !o && setAbierto(null)}>
        <DialogContent className="max-w-md">
          {abierto && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><IconoRed red={abierto.red} /> {resumen(abierto)}</DialogTitle>
                <DialogDescription>
                  {abierto.tipo === "borrador" ? `Borrador previsto para el ${abierto.dia.split("-").reverse().join("/")}` : textoInstante(abierto.instante)} · {NOMBRE_FORMATO[abierto.pieza?.formato ?? ""] ?? ""}
                </DialogDescription>
              </DialogHeader>
              <InsigniaEstado estado={abierto.tipo === "borrador" ? "borrador" : abierto.estado} />
              {abierto.pieza?.caption && <p className="max-h-40 overflow-auto whitespace-pre-line text-sm">{abierto.pieza.caption}</p>}
              {abierto.error && <p className="text-sm text-destructive">{abierto.error}</p>}
              {abierto.intentos > 0 && abierto.estado !== "publicada" && <p className="text-xs text-muted-foreground">Intentos: {abierto.intentos} de 3</p>}
              <div className="flex flex-wrap gap-2">
                {abierto.pieza?.permalink && (
                  <Button asChild variant="outline" size="sm"><a href={abierto.pieza.permalink} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> Verla</a></Button>
                )}
                {puedeEditar && abierto.pieza && ["borrador", "lista", "error"].includes(abierto.pieza.estado) && (
                  <Button type="button" size="sm" onClick={() => { onAbrir(abierto.pieza!.grupo_id); setAbierto(null); }}><Pencil className="mr-1.5 h-4 w-4" /> Abrir en Crear</Button>
                )}
                {puedeEditar && abierto.programacionId && (abierto.estado === "programada" || abierto.estado === "error") && (
                  <>
                    <Button type="button" size="sm" variant="outline" onClick={() => { setMover(abierto); setAbierto(null); }}><CalendarClock className="mr-1.5 h-4 w-4" /> {abierto.estado === "error" ? "Volver a programar" : "Mover"}</Button>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={cancelar.isPending}
                      onClick={() => cancelar.mutate(abierto.programacionId!, { onSuccess: () => { toast.success("Programación cancelada"); setAbierto(null); }, onError: (e) => toast.error(e.message) })}>
                      <XCircle className="mr-1.5 h-4 w-4" /> Cancelar
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <DialogoProgramar abierto={mover !== null} onCerrar={() => setMover(null)} piezaIds={mover ? [mover.piezaId] : []} programacionId={mover?.programacionId} inicial={mover?.instante} />
    </div>
  );
}
