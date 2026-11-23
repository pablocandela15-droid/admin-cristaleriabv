import { Loader2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Guardar / Descartar al pie de un formulario de Contenido (solo con cambios y permiso de edición). */
export function BarraGuardar({
  cambios,
  guardando,
  onGuardar,
  onDescartar,
  puedeEditar,
  texto = "Guardar",
  error,
}: {
  cambios: boolean;
  guardando: boolean;
  onGuardar: () => void;
  onDescartar: () => void;
  puedeEditar: boolean;
  texto?: string;
  error?: string | null;
}) {
  if (!puedeEditar) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
      <p className={error ? "mr-auto text-sm text-destructive" : "mr-auto text-sm text-muted-foreground"} role="status">
        {error ?? (cambios ? "Tienes cambios sin guardar." : "Todo guardado.")}
      </p>
      <Button variant="outline" onClick={onDescartar} disabled={!cambios || guardando} className="gap-1">
        <Undo2 className="h-4 w-4" aria-hidden="true" />
        Descartar
      </Button>
      <Button onClick={onGuardar} disabled={!cambios || guardando || !!error} className="gap-1">
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        {texto}
      </Button>
    </div>
  );
}
