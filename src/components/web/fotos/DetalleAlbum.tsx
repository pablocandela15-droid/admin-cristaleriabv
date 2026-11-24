import { ArrowLeft, ImageIcon, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { RejillaFotos } from "@/components/web/fotos/RejillaFotos";
import { ZonaSubida } from "@/components/web/fotos/ZonaSubida";
import { useCambiarAlbum, useFotosWeb, type AlbumWeb } from "@/hooks/useWebFotos";
import { nombreServicio } from "@/lib/web/fotos";

interface DetalleAlbumProps {
  /** El book; null = las fotos sueltas (las imágenes de la web y fotos sin book). */
  album: AlbumWeb | null;
  puedeEditar: boolean;
  onVolver: () => void;
  onEditar?: () => void;
}

/** Dónde salen en la web las fotos de un book. */
function dondeSale(album: AlbumWeb): string {
  const tipo = nombreServicio(album.servicio);
  return tipo
    ? `Sus fotos salen en la web con las de ${tipo} (en «Trabajos» y en la página del servicio) y también en su apartado de Fotos.`
    : "Sus fotos salen en la web en «Trabajos» › «Todos», después de los tipos de trabajo.";
}

/** Un book de «Otros books» abierto (o las fotos sueltas): subir, ordenar, editar, ★ inicio, ocultar y borrar. */
export function DetalleAlbum({ album, puedeEditar, onVolver, onEditar }: DetalleAlbumProps) {
  const { data: fotos = [], isLoading, error, refetch } = useFotosWeb(album?.id ?? null);
  const cambiarAlbum = useCambiarAlbum();
  const titulo = album ? album.titulo : "Fotos sueltas";
  const fotoVisible = (f: { publicado: boolean }) => f.publicado && (album ? album.publicado : true);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onVolver} className="gap-1">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Fotos
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{album ? dondeSale(album) : "Las imágenes de la web (Contenido) y las fotos que no son de ningún book."}</p>
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
      ) : fotos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm">{album ? "Este book aún no tiene fotos." : "No hay fotos sueltas."}</p>
          {puedeEditar && <p className="text-xs">Arrástralas a la zona de arriba o pulsa «Elegir fotos».</p>}
        </div>
      ) : (
        <RejillaFotos
          fotos={fotos}
          puedeEditar={puedeEditar}
          etiqueta={`Fotos de ${titulo}`}
          tituloWeb={album ? () => album.titulo : undefined}
          visible={fotoVisible}
        />
      )}
    </div>
  );
}
