import { useMemo, useState } from "react";
import { Check, Images, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFotosWeb, urlFotoWeb, type FotoWeb } from "@/hooks/useRrss";
import { cn } from "@/lib/utils";
import { SERVICIOS_RRSS } from "../../../supabase/functions/_shared/rrss/formatos";

/**
 * Elegir fotos de Web › Fotos (las de cada tipo de trabajo, también las que la web aún no enseña) para publicarlas.
 * Se ven por su URL pública (bucket web-fotos); al guardar, el panel las recorta a JPEG y guarda su copia en el cubo
 * de RRSS (la foto de la web no se toca).
 */
export function SelectorFotosWeb({ abierto, onCerrar, max, onElegir }: { abierto: boolean; onCerrar: () => void; max: number; onElegir: (fotos: FotoWeb[]) => void }) {
  const { data, isLoading, isError, error } = useFotosWeb(abierto);
  const [servicio, setServicio] = useState<string>("todos");
  const [elegidas, setElegidas] = useState<string[]>([]);
  const porServicio = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of data ?? []) m.set(f.servicio ?? "sueltas", (m.get(f.servicio ?? "sueltas") ?? 0) + 1);
    return m;
  }, [data]);
  const visibles = (data ?? []).filter((f) => servicio === "todos" || (f.servicio ?? "sueltas") === servicio);
  const alternar = (id: string) => setElegidas((e) => (e.includes(id) ? e.filter((x) => x !== id) : e.length >= max ? e : [...e, id]));
  const cerrar = () => {
    setElegidas([]);
    onCerrar();
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Images className="h-5 w-5" aria-hidden="true" /> Fotos de la web</DialogTitle>
          <DialogDescription>Las fotos de Web › Fotos por tipo de trabajo. Elige {max === 1 ? "una" : `hasta ${max}`}; la de la web no cambia.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de trabajo">
          {[{ slug: "todos", nombre: "Todas" }, ...SERVICIOS_RRSS, { slug: "sueltas", nombre: "Otras de la web" }]
            .filter((s) => s.slug === "todos" || porServicio.has(s.slug))
            .map((s) => (
              <Button key={s.slug} type="button" size="sm" variant={servicio === s.slug ? "default" : "outline"} onClick={() => setServicio(s.slug)}>
                {s.nombre}{s.slug !== "todos" && <span className="ml-1 text-xs opacity-70">{porServicio.get(s.slug)}</span>}
              </Button>
            ))}
        </div>
        <ScrollArea className="h-[55vh] pr-2">
          {isLoading && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando fotos…</p>}
          {isError && <p className="p-4 text-sm text-destructive">{(error as Error).message}</p>}
          {!isLoading && !isError && visibles.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Todavía no hay fotos en Web › Fotos. Súbelas allí (por tipo de trabajo) o usa «Subir fotos o vídeo».</p>
          )}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {visibles.map((f) => {
              const n = elegidas.indexOf(f.id);
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => alternar(f.id)} aria-pressed={n >= 0} aria-label={f.alt || f.titulo || "Foto de la web"}
                    className={cn("relative block aspect-square w-full overflow-hidden rounded-md border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      n >= 0 ? "border-primary" : "border-transparent")}>
                    <img src={urlFotoWeb(f.ruta)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {n >= 0 && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{max > 1 ? n + 1 : <Check className="h-4 w-4" />}</span>}
                    {!f.visible_en_web && <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px]">Oculta en la web</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={cerrar}>Cancelar</Button>
          <Button type="button" disabled={elegidas.length === 0} onClick={() => {
            const porId = new Map((data ?? []).map((f) => [f.id, f]));
            onElegir(elegidas.map((id) => porId.get(id)).filter((f): f is FotoWeb => Boolean(f)));
            cerrar();
          }}>Añadir {elegidas.length > 0 ? `(${elegidas.length})` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
