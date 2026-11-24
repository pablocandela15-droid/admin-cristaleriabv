import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, ImageIcon, Loader2, Pencil, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { ZonaSubida } from "@/components/web/fotos/ZonaSubida";
import {
  urlFoto,
  useBorrarFoto,
  useCambiarAlbum,
  useCambiarFoto,
  useFotosWeb,
  useOrdenarWeb,
  type AlbumWeb,
  type FotoWeb,
} from "@/hooks/useWebFotos";
import { mover, nombreServicio, ordenesNuevos } from "@/lib/web/fotos";

interface DetalleAlbumProps {
  /** El book; null = las fotos sueltas (las imágenes de la web y fotos sin book). */
  album: AlbumWeb | null;
  puedeEditar: boolean;
  onVolver: () => void;
  onEditar?: () => void;
}

function EditarFotoDialog({ foto, onCerrar }: { foto: FotoWeb | null; onCerrar: () => void }) {
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
            <DialogDescription>El título sale al ampliar la foto en la web; la descripción la leen los buscadores y los lectores de pantalla.</DialogDescription>
          </DialogHeader>
          {foto && <img src={urlFoto(foto.ruta)} alt="" className="max-h-56 w-full rounded-md object-contain bg-muted" />}
          <div className="space-y-1.5">
            <Label htmlFor="foto-titulo">Título (opcional)</Label>
            <Input id="foto-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
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

/** Un book abierto (o las fotos sueltas): subir, ordenar, editar, portada, destacadas, publicar y borrar. */
export function DetalleAlbum({ album, puedeEditar, onVolver, onEditar }: DetalleAlbumProps) {
  const { data: fotos = [], isLoading, error, refetch } = useFotosWeb(album?.id ?? null);
  const cambiarAlbum = useCambiarAlbum();
  const cambiarFoto = useCambiarFoto();
  const ordenar = useOrdenarWeb();
  const borrar = useBorrarFoto();
  const [editando, setEditando] = useState<FotoWeb | null>(null);
  const [aBorrar, setABorrar] = useState<FotoWeb | null>(null);
  // Orden mientras se guarda (para que no salte al pulsar varias veces seguidas).
  const [orden, setOrden] = useState<string[] | null>(null);
  useEffect(() => setOrden(null), [fotos]);
  const lista = useMemo(() => {
    if (!orden) return fotos;
    const porId = new Map(fotos.map((f) => [f.id, f]));
    return orden.map((id) => porId.get(id)).filter((f): f is FotoWeb => !!f);
  }, [fotos, orden]);

  const moverFoto = (desde: number, hasta: number) => {
    const ids = mover(lista.map((f) => f.id), desde, hasta);
    setOrden(ids);
    ordenar.mutate({ tabla: "web_fotos", cambios: ordenesNuevos(ids, new Map(fotos.map((f) => [f.id, f.orden]))) });
  };

  const portadaId = album ? album.portada_foto_id ?? lista[0]?.id ?? null : null;
  const titulo = album ? album.titulo : "Fotos sueltas";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onVolver} className="gap-1">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Books
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{titulo}</h2>
          <p className="text-xs text-muted-foreground">
            {album
              ? [`/trabajos/${album.slug}`, nombreServicio(album.servicio) && `Galería de ${nombreServicio(album.servicio)}`].filter(Boolean).join(" · ")
              : "Las imágenes de la web (Contenido) y las fotos que no son de ningún book."}
          </p>
        </div>
        {album && (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={album.publicado}
              disabled={!puedeEditar || cambiarAlbum.isPending}
              onCheckedChange={(v) => cambiarAlbum.mutate({ id: album.id, cambios: { publicado: v } })}
              aria-label="Publicado en la web"
            />
            {album.publicado ? "Publicado" : "Sin publicar"}
          </label>
        )}
        {album && puedeEditar && onEditar && (
          <Button variant="outline" size="sm" onClick={onEditar} className="gap-1">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar book
          </Button>
        )}
      </div>

      {puedeEditar && <ZonaSubida albumId={album?.id ?? null} ordenes={fotos.map((f) => f.orden)} />}

      {error ? (
        <EstadoErrorCarga titulo="las fotos" error={error} onReintentar={() => refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Cargando fotos…</span>
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm">{album ? "Este book aún no tiene fotos." : "No hay fotos sueltas."}</p>
          {puedeEditar && <p className="text-xs">Arrástralas a la zona de arriba o pulsa «Elegir fotos».</p>}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label={`Fotos de ${titulo}`}>
          {lista.map((foto, i) => (
            <li key={foto.id}>
              <Card className={foto.publicado ? "" : "opacity-70"}>
                <CardContent className="space-y-2 p-2">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                    <img src={urlFoto(foto.ruta)} alt={foto.alt} loading="lazy" className="h-full w-full object-cover" />
                    <div className="absolute left-1 top-1 flex flex-wrap gap-1">
                      {album && foto.id === portadaId && <Badge className="bg-primary/90">Portada</Badge>}
                      {foto.destacada && <Badge variant="secondary">En inicio</Badge>}
                      {!foto.publicado && (
                        <Badge variant="outline" className="gap-1 bg-background/90">
                          <EyeOff className="h-3 w-3" aria-hidden="true" />
                          Oculta
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="truncate text-xs" title={foto.titulo ?? foto.alt}>
                    {foto.titulo || foto.alt || <span className="text-muted-foreground">Sin título</span>}
                  </p>
                  {puedeEditar && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex">
                          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0 || ordenar.isPending} onClick={() => moverFoto(i, i - 1)} aria-label="Mover antes">
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === lista.length - 1 || ordenar.isPending} onClick={() => moverFoto(i, i + 1)} aria-label="Mover después">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex">
                          {album && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={foto.id === album.portada_foto_id || cambiarAlbum.isPending}
                              onClick={() => cambiarAlbum.mutate({ id: album.id, cambios: { portada_foto_id: foto.id } })}
                              aria-label="Poner de portada"
                              title="Poner de portada"
                            >
                              <Star className={foto.id === portadaId ? "h-4 w-4 fill-current" : "h-4 w-4"} />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditando(foto)} aria-label="Editar título y descripción" title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setABorrar(foto)} aria-label="Borrar foto" title="Borrar">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <label className="flex items-center justify-between gap-2 text-xs">
                        <span>Publicada</span>
                        <Switch checked={foto.publicado} onCheckedChange={(v) => cambiarFoto.mutate({ id: foto.id, cambios: { publicado: v } })} aria-label="Publicada" />
                      </label>
                      <label className="flex items-center justify-between gap-2 text-xs" title="Sale en la portada de la web">
                        <span>En la portada de la web</span>
                        <Switch checked={foto.destacada} onCheckedChange={(v) => cambiarFoto.mutate({ id: foto.id, cambios: { destacada: v } })} aria-label="En la portada de la web" />
                      </label>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <EditarFotoDialog foto={editando} onCerrar={() => setEditando(null)} />
      <AlertDialog open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta foto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra de la web y del almacenamiento. Si alguna imagen de la web (Contenido) la usa, esa imagen vuelve a la de siempre
              hasta que elijas otra. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => aBorrar && borrar.mutate(aBorrar, { onSettled: () => setABorrar(null) })}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
