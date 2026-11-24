import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FolderOpen, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { ListaOrdenable } from "@/components/ui/lista-ordenable";
import { urlFoto, useBorrarAlbum, useCambiarAlbum, useOrdenarWeb, type AlbumWeb } from "@/hooks/useWebFotos";
import { mover, nombreServicio, ordenesNuevos } from "@/lib/web/fotos";
import { cn } from "@/lib/utils";

const fotosTexto = (n: number) => (n === 1 ? "1 foto" : `${n} fotos`);

interface OtrosBooksProps {
  /** Los books que no son de un tipo de trabajo (los hechos a mano), en su orden. */
  albumes: AlbumWeb[];
  /** Cuántas fotos sueltas hay (las imágenes de la web). */
  sueltas: number;
  puedeEditar: boolean;
  onAbrir: (id: string) => void;
  onAbrirSueltas: () => void;
  onNuevo: () => void;
  onEditar: (album: AlbumWeb) => void;
}

/**
 * «Otros books»: los books hechos a mano (de un trabajo concreto o sin tipo) y las fotos sueltas, plegado debajo de
 * los tipos. Lista con portada, fotos, tipo, publicado y orden (arrastrando o con las flechas).
 */
export function OtrosBooks({ albumes, sueltas, puedeEditar, onAbrir, onAbrirSueltas, onNuevo, onEditar }: OtrosBooksProps) {
  const cambiar = useCambiarAlbum();
  const ordenar = useOrdenarWeb();
  const borrar = useBorrarAlbum();
  const [abierto, setAbierto] = useState(false);
  const [aBorrar, setABorrar] = useState<AlbumWeb | null>(null);
  const [orden, setOrden] = useState<string[] | null>(null);
  useEffect(() => setOrden(null), [albumes]);

  const lista = useMemo(() => {
    if (!orden) return albumes;
    const porId = new Map(albumes.map((a) => [a.id, a]));
    return orden.map((id) => porId.get(id)).filter((a): a is AlbumWeb => !!a);
  }, [albumes, orden]);

  const moverAlbum = (desde: number, hasta: number) => {
    const ids = mover(lista.map((a) => a.id), desde, hasta);
    setOrden(ids);
    ordenar.mutate({ tabla: "web_albumes", cambios: ordenesNuevos(ids, new Map(albumes.map((a) => [a.id, a.orden]))) });
  };

  const resumen = [albumes.length === 1 ? "1 book" : `${albumes.length} books`, sueltas === 1 ? "1 foto suelta" : `${sueltas} fotos sueltas`].join(" · ");

  return (
    <Card data-testid="otros-books">
      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <div className="flex items-center gap-2 p-2 sm:p-3">
          <CollapsibleTrigger className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDown aria-hidden="true" className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Otros books</span>
              <span className="block text-xs text-muted-foreground">{resumen}</span>
            </span>
          </CollapsibleTrigger>
          {puedeEditar && (
            <Button variant="outline" size="sm" onClick={onNuevo} className="shrink-0 gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuevo book
            </Button>
          )}
        </div>
        <CollapsibleContent className="space-y-3 border-t p-3">
          <p className="text-xs text-muted-foreground">
            Books hechos a mano, de un trabajo concreto. Para las fotos de un tipo de trabajo no hace falta un book: súbelas en su apartado de
            arriba. Las fotos de un book con tipo salen también con las de ese tipo; las de uno sin tipo, en «Trabajos» › «Todos», al final.
          </p>
          {lista.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No hay otros books.</p>
          ) : (
            <ListaOrdenable
              ids={lista.map((a) => a.id)}
              nombre={(id) => lista.find((a) => a.id === id)?.titulo ?? id}
              onMover={puedeEditar ? moverAlbum : () => undefined}
              className="space-y-2"
              aria-label="Otros books"
            >
              {(id, i, { asa }) => {
                const a = lista[i];
                return (
                  <Card>
                    <CardContent className="flex flex-wrap items-center gap-3 p-2 sm:flex-nowrap">
                      {puedeEditar && <div className="shrink-0">{asa}</div>}
                      <button type="button" onClick={() => onAbrir(id)} className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted" aria-label={`Abrir ${a.titulo}`}>
                        {a.portadaRuta ? (
                          <img src={urlFoto(a.portadaRuta)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-6 w-6" aria-hidden="true" />
                          </span>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => onAbrir(id)}>
                          {a.titulo}
                        </button>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{fotosTexto(a.totalFotos)}</span>
                          {nombreServicio(a.servicio) && <Badge variant="secondary">{nombreServicio(a.servicio)}</Badge>}
                          {a.publicado && a.totalFotos === 0 && <span>· publicado sin fotos: la web no lo enseña</span>}
                        </div>
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-sm">
                        <Switch
                          checked={a.publicado}
                          disabled={!puedeEditar || cambiar.isPending}
                          onCheckedChange={(v) => cambiar.mutate({ id: a.id, cambios: { publicado: v } })}
                          aria-label={`Publicar ${a.titulo}`}
                        />
                        <span className="hidden sm:inline">{a.publicado ? "Publicado" : "Sin publicar"}</span>
                      </label>
                      <div className="flex shrink-0 items-center">
                        {puedeEditar && (
                          <>
                            <Button variant="ghost" size="icon" className="h-9 w-9" disabled={i === 0 || ordenar.isPending} onClick={() => moverAlbum(i, i - 1)} aria-label="Subir">
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-9 w-9" disabled={i === lista.length - 1 || ordenar.isPending} onClick={() => moverAlbum(i, i + 1)} aria-label="Bajar">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onAbrir(id)} aria-label="Abrir" title="Abrir">
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                        {puedeEditar && (
                          <>
                            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onEditar(a)} aria-label="Editar" title="Editar">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => setABorrar(a)} aria-label="Borrar" title="Borrar">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              }}
            </ListaOrdenable>
          )}

          <button type="button" onClick={onAbrirSueltas} className="flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left text-sm hover:bg-muted/50">
            <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Fotos sueltas</span>
              <span className="block text-xs text-muted-foreground">Las que no son de ningún book: las imágenes de la web (Contenido) y las de la portada.</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{fotosTexto(sueltas)}</span>
          </button>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar el book «{aBorrar?.titulo}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran también sus {aBorrar?.totalFotos ?? 0} fotos, de la web y del almacenamiento. No se puede deshacer. Si solo
              quieres quitarlo de la web, despublícalo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => aBorrar && borrar.mutate(aBorrar.id, { onSettled: () => setABorrar(null) })}
            >
              Borrar book
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
