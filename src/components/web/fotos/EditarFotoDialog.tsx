import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { urlFoto, useCambiarFoto, type FotoWeb } from "@/hooks/useWebFotos";

/** Título y descripción (alt) de una foto. `tituloWeb`: lo que pone la web si se deja sin título. */
export function EditarFotoDialog({ foto, tituloWeb, onCerrar }: { foto: FotoWeb | null; tituloWeb?: string; onCerrar: () => void }) {
  const cambiar = useCambiarFoto();
  const [titulo, setTitulo] = useState("");
  const [alt, setAlt] = useState("");
  useEffect(() => {
    setTitulo(foto?.titulo ?? "");
    setAlt(foto?.alt ?? "");
  }, [foto]);
  return (
    <Dialog open={!!foto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!foto) return;
            cambiar.mutate({ id: foto.id, cambios: { titulo: titulo.trim() || null, alt: alt.trim() } }, { onSuccess: onCerrar });
          }}
        >
          <DialogHeader>
            <DialogTitle>Editar foto</DialogTitle>
            <DialogDescription>El título sale debajo de la foto y al ampliarla en la web; la descripción la leen los buscadores y los lectores de pantalla.</DialogDescription>
          </DialogHeader>
          {foto && <img src={urlFoto(foto.ruta)} alt="" className="max-h-56 w-full rounded-md bg-muted object-contain" />}
          <div className="space-y-1.5">
            <Label htmlFor="foto-titulo">Título (opcional)</Label>
            <Input id="foto-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder={tituloWeb ? `Sin título, la web pone «${tituloWeb}»` : undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="foto-alt">Descripción de la foto</Label>
            <Input id="foto-alt" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} placeholder="Mampara frontal de cristal templado en un baño de Elche" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={cambiar.isPending}>
              {cambiar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
