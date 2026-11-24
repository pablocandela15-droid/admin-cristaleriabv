import { useState } from "react";
import { ImageIcon, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useGaleriaImagenes } from "@/hooks/useNewsletterPlantillas";
import { urlHttpsSegura } from "@/lib/newsletter/diseno";

interface Props {
  imagenSeleccionada?: string;
  onSeleccionar: (url: string | undefined) => void;
  etiqueta?: string;
}

/**
 * Foto del correo (portado del panel de referencia): una de las fotos publicadas de la web (Web › Fotos) o una
 * dirección https:// pegada a mano. Solo https: el correo no admite otra cosa.
 */
export function SelectorImagenGaleria({ imagenSeleccionada, onSeleccionar, etiqueta = "Foto" }: Props) {
  const [open, setOpen] = useState(false);
  const [pegada, setPegada] = useState("");
  const { data: imagenes, isLoading } = useGaleriaImagenes();
  const urlPegada = urlHttpsSegura(pegada);

  const elegir = (url: string | undefined) => {
    onSeleccionar(url);
    setOpen(false);
    setPegada("");
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{etiqueta}</span>
      {imagenSeleccionada ? (
        <div className="relative overflow-hidden rounded-lg border">
          <img src={imagenSeleccionada} alt="Foto elegida" className="h-32 w-full object-cover" />
          <div className="absolute right-1 top-1 flex gap-1">
            <Button variant="secondary" className="h-11" onClick={() => setOpen(true)}>Cambiar</Button>
            <Button variant="destructive" size="icon" className="h-11 w-11" onClick={() => onSeleccionar(undefined)} aria-label="Quitar la foto">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        {!imagenSeleccionada && (
          <DialogTrigger asChild>
            <Button variant="outline" className="h-24 w-full flex-col gap-2">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Elegir foto</span>
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Elegir foto</DialogTitle>
            <DialogDescription>Las fotos publicadas en la web (Web › Fotos) o una dirección https:// de una imagen.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[min(380px,50dvh)]">
            {isLoading ? (
              <div className="grid grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
              </div>
            ) : imagenes && imagenes.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {imagenes.map((img) => (
                  <button
                    key={img.url}
                    type="button"
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80",
                      imagenSeleccionada === img.url ? "border-primary" : "border-transparent",
                    )}
                    onClick={() => elegir(img.url)}
                    aria-label={img.alt ? `Elegir: ${img.alt}` : "Elegir esta foto"}
                  >
                    <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    {imagenSeleccionada === img.url && (
                      <span className="absolute inset-0 flex items-center justify-center bg-primary/20">
                        <Check className="h-8 w-8 text-primary" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">Todavía no hay fotos publicadas en la web. Súbelas en Web › Fotos o pega una dirección abajo.</p>
            )}
          </ScrollArea>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (urlPegada) elegir(urlPegada);
            }}
          >
            <Input value={pegada} onChange={(e) => setPegada(e.target.value)} placeholder="https://…/foto.jpg" aria-label="Dirección https:// de una imagen" className="h-11" inputMode="url" />
            <Button type="submit" className="h-11" disabled={!urlPegada}>Usar</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
