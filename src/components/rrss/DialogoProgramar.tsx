import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProgramar, useReprogramar, type RespuestaProgramar } from "@/hooks/useRrss";
import { limitesFecha, textoInstante, validarProgramacion, valorInicial } from "@/lib/rrss/calendario";

/**
 * Programar (o mover) una publicación: fecha y hora de Madrid, de 10 minutos a 75 días. Si en la misma red hay otra
 * a ±30 minutos, lo avisa y pide confirmarlo (la RPC vuelve a comprobarlo todo). Portado de ProgramarPiezaDialog.
 */
export function DialogoProgramar({ abierto, onCerrar, piezaIds, programacionId, inicial, onHecho }: {
  abierto: boolean;
  onCerrar: () => void;
  /** Piezas a programar (las redes del mismo envío, a la misma hora). */
  piezaIds: string[];
  /** Mover una programación concreta. */
  programacionId?: string | null;
  inicial?: string | null;
  onHecho?: () => void;
}) {
  const programar = useProgramar();
  const reprogramar = useReprogramar();
  const [{ fecha, hora }, setValor] = useState(() => valorInicial(inicial));
  const [conflictos, setConflictos] = useState<RespuestaProgramar["conflictos"] | null>(null);
  useEffect(() => {
    if (abierto) {
      setValor(valorInicial(inicial));
      setConflictos(null);
    }
  }, [abierto, inicial]);
  const v = validarProgramacion(fecha, hora);
  const { min, max } = limitesFecha();
  const ocupado = programar.isPending || reprogramar.isPending;

  const enviar = (confirmar: boolean) => {
    if (v.ok === false) return;
    const instante = (v as { instante: Date }).instante;
    const fin = {
      onSuccess: (r: RespuestaProgramar) => {
        if (r.ok === false && r.requiereConfirmacion) {
          setConflictos(r.conflictos ?? []);
          return;
        }
        toast.success(`Programada para el ${textoInstante(instante)}`);
        onHecho?.();
        onCerrar();
      },
      onError: (e: Error) => toast.error(e.message),
    };
    if (programacionId) reprogramar.mutate({ id: programacionId, instante, confirmar }, fin);
    else programar.mutate({ piezaIds, instante, confirmar }, fin);
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" aria-hidden="true" /> {programacionId ? "Mover la publicación" : "Programar la publicación"}</DialogTitle>
          <DialogDescription>Hora de Madrid. El panel la publica solo a esa hora (con unos minutos de margen).</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rrss-fecha">Día</Label>
            <Input id="rrss-fecha" type="date" value={fecha} min={min} max={max} onChange={(e) => { setValor({ fecha: e.target.value, hora }); setConflictos(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rrss-hora">Hora</Label>
            <Input id="rrss-hora" type="time" value={hora} step={300} onChange={(e) => { setValor({ fecha, hora: e.target.value }); setConflictos(null); }} />
          </div>
        </div>
        {v.ok === false && <p className="text-sm text-destructive">{(v as { error: string }).error}</p>}
        {conflictos && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" role="alert">
            Ya hay {conflictos.length === 1 ? "otra publicación programada" : `${conflictos.length} publicaciones programadas`} en esa red a menos de 30 minutos
            ({conflictos.map((c) => textoInstante(c.programadaPara)).join(", ")}). Mejor separarlas; si quieres, prográmala igualmente.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCerrar}>Cancelar</Button>
          {conflictos ? (
            <Button type="button" disabled={!v.ok || ocupado} onClick={() => enviar(true)}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Programar igualmente</Button>
          ) : (
            <Button type="button" disabled={!v.ok || ocupado} onClick={() => enviar(false)}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{programacionId ? "Mover" : "Programar"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
