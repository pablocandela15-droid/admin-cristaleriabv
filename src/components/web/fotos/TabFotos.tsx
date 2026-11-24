import { useMemo, useState } from "react";
import { Info, Loader2, Star } from "lucide-react";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { AlbumDialog } from "@/components/web/fotos/AlbumDialog";
import { DetalleAlbum } from "@/components/web/fotos/DetalleAlbum";
import { OtrosBooks } from "@/components/web/fotos/OtrosBooks";
import { SeccionTipo } from "@/components/web/fotos/SeccionTipo";
import { useAlbumesWeb, useFotosWeb, type AlbumWeb } from "@/hooks/useWebFotos";
import { MAX_DESTACADAS_WEB, agruparPorTipo, destacadasEnWeb, textoDestacadas } from "@/lib/web/fotosPorTipo";

/** «Sueltas» en la lista: las fotos sin book (imágenes de la web). */
const SUELTAS = "sueltas";

/**
 * Web › Fotos, por tipo de trabajo: un apartado por cada servicio de la web (Mamparas, Espejos…), en su orden, con
 * su zona de subida y sus fotos. Lo que se sube a un tipo sale en la web en «Trabajos» (filtro de ese tipo), en la
 * página del servicio y, con ★, en el inicio («Espacios que se llenan de luz»). Debajo, plegados, los otros books
 * (hechos a mano) y las fotos sueltas.
 */
export function TabFotos({ puedeEditar }: { puedeEditar: boolean }) {
  const { data: albumes = [], isLoading, error, refetch } = useAlbumesWeb();
  const { data: fotos = [], isLoading: cargandoFotos, error: errorFotos, refetch: refetchFotos } = useFotosWeb("todas");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<{ album: AlbumWeb | null } | null>(null);

  const { tipos, otros } = useMemo(() => agruparPorTipo(albumes, fotos), [albumes, fotos]);
  const sueltas = useMemo(() => fotos.filter((f) => !f.album_id).length, [fotos]);
  const destacadas = useMemo(() => destacadasEnWeb(fotos, albumes), [fotos, albumes]);
  const ordenesAlbumes = albumes.map((a) => a.orden);

  if (abierto) {
    const album = abierto === SUELTAS ? null : albumes.find((a) => a.id === abierto);
    if (album !== undefined) {
      return (
        <>
          <DetalleAlbum album={album} puedeEditar={puedeEditar} onVolver={() => setAbierto(null)} onEditar={album ? () => setDialogo({ album }) : undefined} />
          <AlbumDialog abierto={!!dialogo} album={dialogo?.album} ordenes={ordenesAlbumes} onCerrar={() => setDialogo(null)} />
        </>
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-2">
        <h2 className="text-lg font-semibold">Fotos de los trabajos</h2>
        <p className="text-sm text-muted-foreground">
          Abre un tipo de trabajo y sube sus fotos. Salen en la web en «Trabajos» (con el filtro de ese tipo) y en la página del servicio.
        </p>
        <ul className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" aria-label="Cómo salen en la web">
          <li className="flex gap-2">
            <Star className="mt-0.5 h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-hidden="true" />
            <span>
              Las fotos con estrella salen en el inicio, en «Espacios que se llenan de luz» (hasta {MAX_DESTACADAS_WEB}). Si no marcas ninguna, sale la
              primera foto de cada tipo. <span className="text-muted-foreground">{textoDestacadas(destacadas)}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>Un tipo sin fotos sigue con las fotos de ejemplo de la web hasta que subas las tuyas. Ocultar una foto la quita de la web sin borrarla.</span>
          </li>
        </ul>
      </div>

      {error || errorFotos ? (
        <EstadoErrorCarga
          titulo="las fotos de la web"
          error={error ?? errorFotos}
          onReintentar={() => {
            refetch();
            refetchFotos();
          }}
        />
      ) : isLoading || cargandoFotos ? (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Cargando fotos…</span>
        </div>
      ) : (
        <>
          <section className="space-y-2" aria-label="Tipos de trabajo">
            {tipos.map((t) => (
              <SeccionTipo key={t.servicio} tipo={t} ordenesAlbumes={ordenesAlbumes} puedeEditar={puedeEditar} />
            ))}
          </section>
          <OtrosBooks
            albumes={otros}
            sueltas={sueltas}
            puedeEditar={puedeEditar}
            onAbrir={setAbierto}
            onAbrirSueltas={() => setAbierto(SUELTAS)}
            onNuevo={() => setDialogo({ album: null })}
            onEditar={(album) => setDialogo({ album })}
          />
        </>
      )}

      <AlbumDialog
        abierto={!!dialogo}
        album={dialogo?.album}
        ordenes={ordenesAlbumes}
        onCerrar={() => setDialogo(null)}
        onGuardado={(id) => !dialogo?.album && setAbierto(id)}
      />
    </div>
  );
}
