import { useMemo, useRef, useState } from "react";
import { ImageIcon, Images, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TextoDiferido } from "@/components/web/CamposDiferidos";
import { useGuardarContenido } from "@/hooks/useWebContenido";
import { subirFotoWeb, urlFoto, useAlbumesWeb, useFotosWeb, useRefrescarFotos, type FotoWeb } from "@/hooks/useWebFotos";
import { HUECOS_IMAGEN, imagenElegida, imagenEnLaWeb, type HuecoImagen, type ImagenesWeb } from "@/lib/web/contenido";
import { mensajeErrorWeb, siguienteOrden } from "@/lib/web/fotos";
import { esFotoAdmitida } from "@/lib/web/prepararFoto";

const aImagenes = (v: unknown): ImagenesWeb => (v && typeof v === "object" && !Array.isArray(v) ? (v as ImagenesWeb) : {});

/** Elegir una de las fotos ya subidas (de los books o sueltas). */
function SelectorFoto({ abierto, onCerrar, onElegir }: { abierto: boolean; onCerrar: () => void; onElegir: (f: FotoWeb) => void }) {
  const { data: fotos = [], isLoading } = useFotosWeb("todas", { enabled: abierto });
  const { data: albumes = [] } = useAlbumesWeb({ enabled: abierto });
  const titulos = useMemo(() => new Map(albumes.map((a) => [a.id, a.titulo])), [albumes]);
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Elegir una foto</DialogTitle>
          <DialogDescription>Las fotos de los books y las sueltas. Para usar una nueva, ciérralo y pulsa «Subir una nueva».</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : fotos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay fotos subidas.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {fotos.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onElegir(f)}
                  className="group block w-full overflow-hidden rounded-md border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block aspect-[4/3] bg-muted">
                    <img src={urlFoto(f.ruta)} alt={f.alt} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  </span>
                  <span className="block truncate px-2 py-1 text-xs text-muted-foreground">{f.album_id ? titulos.get(f.album_id) ?? "Book" : "Suelta"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Imágenes fijas de la web (portada, quiénes somos, contacto): la que se ve ahora (la de la web de siempre o la
 * elegida), elegir una de las fotos subidas o subir una nueva (va a sueltas/) y volver a la de siempre. Se guarda
 * al momento.
 */
export function FormImagenes({ valor, puedeEditar }: { valor: unknown; puedeEditar: boolean }) {
  const guardar = useGuardarContenido();
  const refrescar = useRefrescarFotos();
  const { data: sueltas = [] } = useFotosWeb(null, { enabled: puedeEditar });
  const imagenes = aImagenes(valor);
  const [eligiendo, setEligiendo] = useState<HuecoImagen | null>(null);
  const [subiendo, setSubiendo] = useState<HuecoImagen | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const huecoSubida = useRef<HuecoImagen | null>(null);
  const base = import.meta.env.VITE_SUPABASE_URL ?? "";

  const guardarHueco = (hueco: HuecoImagen, nueva: { ruta: string; alt?: string } | null, aviso: string) => {
    const resto = { ...imagenes };
    delete resto[hueco];
    guardar.mutate({ clave: "imagenes", valor: nueva ? { ...resto, [hueco]: nueva } : resto, aviso });
  };

  const subir = async (archivo: File | undefined) => {
    const hueco = huecoSubida.current;
    if (!archivo || !hueco) return;
    if (!esFotoAdmitida(archivo)) {
      toast.error("Tiene que ser una foto (JPG, PNG, WebP o AVIF).");
      return;
    }
    setSubiendo(hueco);
    try {
      const alt = imagenElegida(imagenes, hueco)?.alt ?? "";
      const foto = await subirFotoWeb(archivo, { albumId: null, orden: siguienteOrden(sueltas.map((s) => s.orden)), alt });
      await refrescar();
      guardarHueco(hueco, { ruta: foto.ruta, ...(alt ? { alt } : {}) }, "Imagen subida y puesta en la web");
    } catch (e) {
      toast.error("No se ha podido subir la foto", { description: mensajeErrorWeb(e, "Web · Contenido") });
    } finally {
      setSubiendo(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Las fotos fijas de la web. Mientras no elijas otra, la web enseña la suya de siempre. Las que subas aquí se guardan como fotos
        sueltas (en Fotos › Fotos sueltas).
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {HUECOS_IMAGEN.map(({ clave, titulo, detalle }) => {
          const actual = imagenEnLaWeb(imagenes, clave, base);
          const elegida = imagenElegida(imagenes, clave);
          return (
            <Card key={clave}>
              <CardContent className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{titulo}</h3>
                    <p className="text-xs text-muted-foreground">{detalle}</p>
                  </div>
                  <Badge variant={actual.porDefecto ? "outline" : "secondary"}>{actual.porDefecto ? "La de la web" : "Elegida"}</Badge>
                </div>
                <div className="relative aspect-video overflow-hidden rounded-md bg-muted">
                  <img src={actual.url} alt={actual.alt} loading="lazy" className="h-full w-full object-cover" />
                  {subiendo === clave && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/70" role="status">
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                      <span className="sr-only">Subiendo…</span>
                    </div>
                  )}
                </div>
                {elegida && (
                  <div className="space-y-1">
                    <Label htmlFor={`img-alt-${clave}`} className="text-xs">
                      Descripción de la foto
                    </Label>
                    <TextoDiferido
                      id={`img-alt-${clave}`}
                      valor={elegida.alt ?? ""}
                      placeholder={actual.alt}
                      maxLength={300}
                      disabled={!puedeEditar}
                      onConfirmar={(v) => guardarHueco(clave, { ruta: elegida.ruta, ...(v.trim() ? { alt: v.trim() } : {}) }, "Descripción guardada")}
                      className="h-8 text-sm"
                    />
                  </div>
                )}
                {puedeEditar && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => setEligiendo(clave)} disabled={!!subiendo || guardar.isPending}>
                      <Images className="h-4 w-4" aria-hidden="true" />
                      Elegir de las fotos
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={!!subiendo || guardar.isPending}
                      onClick={() => {
                        huecoSubida.current = clave;
                        input.current?.click();
                      }}
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Subir una nueva
                    </Button>
                    {elegida && (
                      <Button variant="ghost" size="sm" className="gap-1" disabled={guardar.isPending} onClick={() => guardarHueco(clave, null, "Vuelve la imagen de la web")}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Volver a la de la web
                      </Button>
                    )}
                  </div>
                )}
                {!actual.porDefecto && !puedeEditar && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {elegida?.ruta}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          e.target.value = "";
          void subir(archivo);
        }}
      />
      <SelectorFoto
        abierto={!!eligiendo}
        onCerrar={() => setEligiendo(null)}
        onElegir={(f) => {
          if (eligiendo) guardarHueco(eligiendo, { ruta: f.ruta, ...(f.alt ? { alt: f.alt } : {}) }, "Imagen cambiada");
          setEligiendo(null);
        }}
      />
    </div>
  );
}
