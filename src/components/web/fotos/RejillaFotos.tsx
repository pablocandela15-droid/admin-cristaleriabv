import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pencil, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { EditarFotoDialog } from "@/components/web/fotos/EditarFotoDialog";
import { urlFoto, useBorrarFoto, useCambiarFoto, useOrdenarWeb, type FotoWeb } from "@/hooks/useWebFotos";
import { mover, ordenesNuevos } from "@/lib/web/fotos";
import { cn } from "@/lib/utils";

interface RejillaFotosProps {
  /** Las fotos ya en su orden. */
  fotos: FotoWeb[];
  puedeEditar: boolean;
  /** Para el lector de pantalla: «Fotos de Mamparas». */
  etiqueta: string;
  /** Lo que pone la web en una foto sin título (el nombre del tipo o el título del book). */
  tituloWeb?: (foto: FotoWeb) => string | undefined;
  /** Etiquetas de más sobre la foto (p. ej. de qué book viene). */
  extra?: (foto: FotoWeb) => ReactNode;
  /** ¿La ve la web? Sin esto, la que esté publicada. */
  visible?: (foto: FotoWeb) => boolean;
}

/**
 * Rejilla de fotos con sus acciones: mover antes o después, ★ (sale en el inicio de la web), mostrar u ocultar en
 * la web, título y descripción, y borrar. El orden que se ve aquí es el de la web.
 */
export function RejillaFotos({ fotos, puedeEditar, etiqueta, tituloWeb, extra, visible }: RejillaFotosProps) {
  const cambiar = useCambiarFoto();
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

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label={etiqueta}>
        {lista.map((foto, i) => {
          const seVe = visible ? visible(foto) : foto.publicado;
          const nombre = foto.titulo || foto.alt || tituloWeb?.(foto) || "Sin título";
          return (
            <li key={foto.id}>
              <Card className={cn("h-full", !seVe && "opacity-70")}>
                <CardContent className="space-y-2 p-2">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                    <img src={urlFoto(foto.ruta)} alt={foto.alt} loading="lazy" className="h-full w-full object-cover" />
                    <div className="absolute left-1 top-1 flex max-w-[calc(100%-0.5rem)] flex-wrap gap-1">
                      {foto.destacada && (
                        <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500">
                          <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                          Inicio
                        </Badge>
                      )}
                      {!foto.publicado && (
                        <Badge variant="outline" className="gap-1 bg-background/90">
                          <EyeOff className="h-3 w-3" aria-hidden="true" />
                          Oculta
                        </Badge>
                      )}
                      {extra?.(foto)}
                    </div>
                  </div>
                  <p className={cn("truncate text-xs", !foto.titulo && !foto.alt && "text-muted-foreground")} title={nombre}>
                    {nombre}
                  </p>
                  {puedeEditar && (
                    <div className="flex flex-wrap items-center justify-between gap-y-1">
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0 || ordenar.isPending} onClick={() => moverFoto(i, i - 1)} aria-label="Mover antes" title="Mover antes">
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={i === lista.length - 1 || ordenar.isPending}
                          onClick={() => moverFoto(i, i + 1)}
                          aria-label="Mover después"
                          title="Mover después"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn("h-8 w-8", foto.destacada && "text-amber-500 hover:text-amber-600")}
                          onClick={() => cambiar.mutate({ id: foto.id, cambios: { destacada: !foto.destacada } })}
                          aria-pressed={foto.destacada}
                          aria-label="Sale en el inicio de la web"
                          title={foto.destacada ? "Sale en el inicio de la web: pulsa para quitarla" : "Sacarla en el inicio de la web"}
                        >
                          <Star className={cn("h-4 w-4", foto.destacada && "fill-current")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => cambiar.mutate({ id: foto.id, cambios: { publicado: !foto.publicado } })}
                          aria-label={foto.publicado ? "Ocultar en la web" : "Mostrar en la web"}
                          title={foto.publicado ? "Ocultar en la web (no se borra)" : "Mostrar en la web"}
                        >
                          {foto.publicado ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditando(foto)} aria-label="Editar título y descripción" title="Editar título y descripción">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setABorrar(foto)} aria-label="Borrar foto" title="Borrar">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <EditarFotoDialog foto={editando} tituloWeb={editando ? tituloWeb?.(editando) : undefined} onCerrar={() => setEditando(null)} />
      <AlertDialog open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta foto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra de la web y del almacenamiento. Si alguna imagen de la web (Contenido) la usa, esa imagen vuelve a la de siempre
              hasta que elijas otra. No se puede deshacer. Si solo quieres quitarla de la web, ocúltala.
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
    </>
  );
}
