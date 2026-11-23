import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FolderOpen, ImageIcon, Images, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { AlbumDialog } from "@/components/web/fotos/AlbumDialog";
import { DetalleAlbum } from "@/components/web/fotos/DetalleAlbum";
import { urlFoto, useAlbumesWeb, useBorrarAlbum, useCambiarAlbum, useFotosWeb, useOrdenarWeb, type AlbumWeb } from "@/hooks/useWebFotos";
import { mover, nombreServicio, ordenesNuevos } from "@/lib/web/fotos";

/** «Sueltas» en la lista: las fotos sin book (imágenes de la web). */
const SUELTAS = "sueltas";

/**
 * Web › Fotos: los «books» de la web. Lista con portada, número de fotos, publicado y orden (arrastrando o con las
 * flechas); al abrir uno, sus fotos. La web enseña en «Trabajos» los books publicados con fotos (si no hay ninguno,
 * su galería de siempre) y, en cada servicio, las fotos de sus books.
 */
export function TabFotos({ puedeEditar }: { puedeEditar: boolean }) {
  const { data: albumes = [], isLoading, error, refetch } = useAlbumesWeb();
  const { data: sueltas = [] } = useFotosWeb(null);
  const cambiar = useCambiarAlbum();
  const ordenar = useOrdenarWeb();
  const borrar = useBorrarAlbum();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<{ album: AlbumWeb | null } | null>(null);
  const [aBorrar, setABorrar] = useState<AlbumWeb | null>(null);
  const [orden, setOrden] = useState<string[] | null>(null);
  useEffect(() => setOrden(null), [albumes]);

  const lista = useMemo(() => {
    if (!orden) return albumes;
    const porId = new Map(albumes.map((a) => [a.id, a]));
    return orden.map((id) => porId.get(id)).filter((a): a is AlbumWeb => !!a);
  }, [albumes, orden]);
  const publicadosConFotos = albumes.filter((a) => a.publicado && a.totalFotos > 0).length;

  const moverAlbum = (desde: number, hasta: number) => {
    const ids = mover(lista.map((a) => a.id), desde, hasta);
    setOrden(ids);
    ordenar.mutate({ tabla: "web_albumes", cambios: ordenesNuevos(ids, new Map(albumes.map((a) => [a.id, a.orden]))) });
  };

  if (abierto) {
    const album = abierto === SUELTAS ? null : albumes.find((a) => a.id === abierto);
    if (album !== undefined) {
      return (
        <>
          <DetalleAlbum album={album} puedeEditar={puedeEditar} onVolver={() => setAbierto(null)} onEditar={album ? () => setDialogo({ album }) : undefined} />
          <AlbumDialog abierto={!!dialogo} album={dialogo?.album} ordenes={albumes.map((a) => a.orden)} onCerrar={() => setDialogo(null)} />
        </>
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold">Books de fotos</h2>
          <p className="text-sm text-muted-foreground">
            {publicadosConFotos
              ? `La web enseña en «Trabajos» ${publicadosConFotos === 1 ? "el book publicado" : `los ${publicadosConFotos} books publicados`}, en este orden.`
              : "Mientras no haya ningún book publicado con fotos, la web enseña su galería de siempre."}
          </p>
        </div>
        {puedeEditar && (
          <Button onClick={() => setDialogo({ album: null })} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo book
          </Button>
        )}
      </div>

      {error ? (
        <EstadoErrorCarga titulo="los books de fotos" error={error} onReintentar={() => refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Cargando books…</span>
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Images className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm">Aún no hay ningún book.</p>
          {puedeEditar && <p className="text-xs">Crea el primero con «Nuevo book», sube sus fotos y publícalo.</p>}
        </div>
      ) : (
        <ListaOrdenable
          ids={lista.map((a) => a.id)}
          nombre={(id) => lista.find((a) => a.id === id)?.titulo ?? id}
          onMover={puedeEditar ? moverAlbum : () => undefined}
          className="space-y-2"
          aria-label="Books de fotos"
        >
          {(id, i, { asa }) => {
            const a = lista[i];
            return (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-2 sm:flex-nowrap">
                  {puedeEditar && <div className="shrink-0">{asa}</div>}
                  <button type="button" onClick={() => setAbierto(id)} className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted" aria-label={`Abrir ${a.titulo}`}>
                    {a.portadaRuta ? (
                      <img src={urlFoto(a.portadaRuta)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-6 w-6" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => setAbierto(id)}>
                      {a.titulo}
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{a.totalFotos === 1 ? "1 foto" : `${a.totalFotos} fotos`}</span>
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
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setAbierto(id)} aria-label="Abrir" title="Abrir">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    {puedeEditar && (
                      <>
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setDialogo({ album: a })} aria-label="Editar" title="Editar">
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

      <button
        type="button"
        onClick={() => setAbierto(SUELTAS)}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left text-sm hover:bg-muted/50"
      >
        <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">Fotos sueltas</span>
          <span className="block text-xs text-muted-foreground">Las que no son de ningún book: las imágenes de la web (Contenido) y las de la portada.</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{sueltas.length === 1 ? "1 foto" : `${sueltas.length} fotos`}</span>
      </button>

      <AlbumDialog
        abierto={!!dialogo}
        album={dialogo?.album}
        ordenes={albumes.map((a) => a.orden)}
        onCerrar={() => setDialogo(null)}
        onGuardado={(id) => !dialogo?.album && setAbierto(id)}
      />
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
    </div>
  );
}
