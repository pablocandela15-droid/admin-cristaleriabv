import { useMemo, useState } from "react";
import { ChevronDown, EyeOff, ImageIcon, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RejillaFotos } from "@/components/web/fotos/RejillaFotos";
import { ZonaSubida } from "@/components/web/fotos/ZonaSubida";
import { asegurarAlbumTipo, urlFoto, useCambiarAlbum, type AlbumWeb, type FotoWeb } from "@/hooks/useWebFotos";
import { fotoVisibleEnWeb, resumenTipo, type TipoTrabajo } from "@/lib/web/fotosPorTipo";
import { cn } from "@/lib/utils";

interface SeccionTipoProps {
  tipo: TipoTrabajo<AlbumWeb, FotoWeb>;
  /** `orden` de todos los books (el del tipo, si hay que crearlo, va al final). */
  ordenesAlbumes: number[];
  puedeEditar: boolean;
}

/**
 * Un tipo de trabajo (Mamparas, Espejos…): tarjeta plegable con su nombre, cuántas fotos tiene y, al abrirla, la zona
 * para subir fotos directamente a ese tipo y sus fotos (ordenar, ★ inicio, ocultar, editar y borrar). Incluye las
 * fotos de los books antiguos de ese tipo.
 */
export function SeccionTipo({ tipo, ordenesAlbumes, puedeEditar }: SeccionTipoProps) {
  const [abierto, setAbierto] = useState(false);
  const cambiarAlbum = useCambiarAlbum();
  const porId = useMemo(() => new Map(tipo.albumes.map((a) => [a.id, a])), [tipo.albumes]);
  const otrosBooks = tipo.albumes.filter((a) => a.id !== tipo.album?.id);
  const miniatura = tipo.fotos.find((f) => fotoVisibleEnWeb(f, porId)) ?? tipo.fotos[0];
  const id = `tipo-${tipo.servicio}`;
  // Si su book ya existe y se ve, las fotos van directas; si no, se crea (o se publica) al subir.
  const albumListo = tipo.album?.publicado ? tipo.album.id : null;

  return (
    <Card data-testid={id}>
      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <CollapsibleTrigger className="flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-3">
          <span className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
            {miniatura ? (
              <img src={urlFoto(miniatura.ruta)} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium" id={`${id}-nombre`}>
              {tipo.nombre}
            </span>
            <span className="block text-xs text-muted-foreground">{resumenTipo(tipo)}</span>
          </span>
          <ChevronDown aria-hidden="true" className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
        </CollapsibleTrigger>
        {/* Montado aunque esté plegado: si se pliega mientras sube, la subida sigue y se ve al volver a abrir. */}
        <CollapsibleContent forceMount hidden={!abierto} className="space-y-3 border-t p-3" aria-labelledby={`${id}-nombre`}>
          {tipo.album && !tipo.album.publicado && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">Las fotos de {tipo.nombre} están ocultas en la web.</span>
              {puedeEditar && (
                <Button size="sm" variant="outline" disabled={cambiarAlbum.isPending} onClick={() => tipo.album && cambiarAlbum.mutate({ id: tipo.album.id, cambios: { publicado: true } })}>
                  Mostrar en la web
                </Button>
              )}
            </div>
          )}
          {otrosBooks.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {otrosBooks.length === 1
                ? `Incluye las fotos del book «${otrosBooks[0].titulo}», que también es de ${tipo.nombre} (el book se edita en «Otros books»).`
                : `Incluye las fotos de los books ${otrosBooks.map((a) => `«${a.titulo}»`).join(", ")}, que también son de ${tipo.nombre} (se editan en «Otros books»).`}
            </p>
          )}
          {puedeEditar && (
            <ZonaSubida
              albumId={albumListo}
              resolverAlbum={albumListo ? undefined : () => asegurarAlbumTipo(tipo.servicio, { ordenes: ordenesAlbumes })}
              ordenes={tipo.fotos.map((f) => f.orden)}
              destino={tipo.nombre}
            />
          )}
          {tipo.fotos.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Aún no hay fotos de {tipo.nombre}. Mientras tanto, la web enseña las de ejemplo.
            </p>
          ) : (
            <RejillaFotos
              fotos={tipo.fotos}
              puedeEditar={puedeEditar}
              etiqueta={`Fotos de ${tipo.nombre}`}
              tituloWeb={(f) => (f.album_id ? porId.get(f.album_id)?.titulo : undefined)}
              visible={(f) => fotoVisibleEnWeb(f, porId)}
              extra={(f) => {
                const book = f.album_id ? porId.get(f.album_id) : undefined;
                if (!book || book.id === tipo.album?.id) return null;
                return (
                  <Badge variant="outline" className="max-w-full gap-1 truncate bg-background/90" title={book.publicado ? `Del book «${book.titulo}»` : `Del book «${book.titulo}», sin publicar: no sale en la web`}>
                    {!book.publicado && <EyeOff className="h-3 w-3 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{book.titulo}</span>
                  </Badge>
                );
              }}
            />
          )}
          {tipo.fotos.some((f) => f.destacada) && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />
              Las fotos con la estrella salen en el inicio de la web.
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
