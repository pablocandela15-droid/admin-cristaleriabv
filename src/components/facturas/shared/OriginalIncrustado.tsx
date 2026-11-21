import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, FileX2, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ImagenZoom } from "@/components/visores/ImagenZoom";
import { ENLACE_ORIGINAL, VisorPantallaCompleta } from "@/components/visores/VisorPantallaCompleta";
import { VisorPdf } from "@/components/visores/VisorPdf";
import { nombrePdf } from "@/lib/facturas/nombrePdf";

const BUCKET = "facturas-originales";
/** Vida de la URL firmada de la vista previa (más larga que la del botón: la imagen se pide al desplazarse). */
const SEGUNDOS_FIRMA = 600;
/** Se renueva un minuto antes de que caduque. */
const VIDA_CACHE_MS = (SEGUNDOS_FIRMA - 60) * 1000;

const esPdf = (ruta: string) => /\.pdf$/i.test(ruta.split("?")[0]);

/** URL firmada del original, cacheada por ruta; al caducar se vuelve a pedir. */
function useUrlOriginal(archivoPath: string | null) {
  return useQuery({
    queryKey: ["factura-original-url", archivoPath],
    enabled: !!archivoPath,
    staleTime: VIDA_CACHE_MS,
    gcTime: VIDA_CACHE_MS,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(archivoPath as string, SEGUNDOS_FIRMA);
      if (error || !data?.signedUrl) throw new Error(error?.message || "URL no disponible");
      return data.signedUrl;
    },
  });
}

const ENLACE = ENLACE_ORIGINAL;

/** Cabecera común del visor: título pequeño y, a la derecha, un único enlace para abrirlo fuera. */
function CabeceraVisor({ enlace }: { enlace: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Documento original
      </h3>
      {enlace}
    </div>
  );
}

/**
 * EL sitio de la ficha (Compras › Documentos) donde se ve el original, al lado
 * de los datos y sin abrir otra pestaña. El original vive en el bucket privado
 * `facturas-originales` (facturas.archivo_path) y se abre con una URL firmada:
 *   - imagen -> foto en un recuadro con zoom/arrastre/giro; botón de pantalla completa.
 *   - PDF    -> PDF hoja a hoja (VisorPdf) + enlace «Abrir PDF».
 *   - nada   -> estado vacío discreto, en una línea.
 * Solo se monta con la ficha abierta, así que el original no se pide antes.
 */
export function OriginalIncrustado({
  archivoPath,
  titulo,
  relleno = false,
}: {
  archivoPath: string | null;
  titulo: string;
  /** Visor lateral de la ficha: el original ocupa todo el alto disponible (el padre es `flex flex-col`). */
  relleno?: boolean;
}) {
  if (archivoPath) return <OriginalDeStorage archivoPath={archivoPath} titulo={titulo} relleno={relleno} />;
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="sin-original">
      <FileX2 className="h-4 w-4 shrink-0" aria-hidden="true" /> No se guardó el original de este documento.
    </p>
  );
}

/** «Descargar PDF» con el nombre del documento (en el iPad lo abre su visor de PDF, con todas las hojas). */
export function EnlaceDescargarPdf({ url, titulo, className = ENLACE }: { url: string; titulo: string; className?: string }) {
  return (
    <a href={url} download={nombrePdf(titulo)} className={className}>
      <Download className="h-4 w-4" aria-hidden="true" /> Descargar PDF
    </a>
  );
}

function OriginalDeStorage({ archivoPath, titulo, relleno }: { archivoPath: string; titulo: string; relleno: boolean }) {
  const q = useUrlOriginal(archivoPath);
  const pdf = esPdf(archivoPath);
  const url = q.data;
  return (
    <VisorArchivo
      key={url ?? "sin-url"}
      url={url}
      pdf={pdf}
      fallo={q.isError && !q.isFetching}
      mensajeFallo="No se ha podido cargar el documento original."
      onReintentar={() => void q.refetch()}
      enlace={
        url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> {pdf ? "Abrir PDF" : "Abrir"}
          </a>
        )
      }
      titulo={titulo}
      relleno={relleno}
    />
  );
}

/** Lo común: cabecera, cargando, aviso de fallo con «Reintentar», PDF incrustado o foto con zoom y pantalla completa. */
function VisorArchivo({
  url,
  pdf,
  fuentePdf,
  fallo,
  mensajeFallo,
  onReintentar,
  enlace,
  enlacePantallaCompleta = true,
  titulo,
  relleno,
}: {
  url: string | undefined;
  pdf: boolean;
  /** El PDF como Blob. Sin él, VisorPdf descarga `url` (URL firmada de Storage). */
  fuentePdf?: Blob;
  fallo: boolean;
  mensajeFallo: string;
  onReintentar: () => void;
  enlace: ReactNode;
  /** «Abrir en pestaña nueva» en el visor a pantalla completa. */
  enlacePantallaCompleta?: boolean;
  titulo: string;
  relleno: boolean;
}) {
  const [cargada, setCargada] = useState(false);
  const [falloImagen, setFalloImagen] = useState(false);
  const [visor, setVisor] = useState(false);

  const reintentar = () => {
    setFalloImagen(false);
    setCargada(false);
    onReintentar();
  };

  let cuerpo;
  if (fallo || falloImagen) {
    cuerpo = (
      <div role="status" className={`flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground ${relleno ? "m-auto" : ""}`}>
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{mensajeFallo}</span>
        <button type="button" onClick={reintentar} className={ENLACE}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  } else if (!url) {
    cuerpo = (
      <div className={`flex items-center justify-center rounded-md bg-muted/50 ${relleno ? "min-h-0 flex-1" : "h-48"}`} aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando el original" />
      </div>
    );
  } else if (pdf) {
    // Hoja a hoja con pdf.js (13/11/2026): un <object>/<iframe> con el PDF lo
    // bloqueaba la CSP del panel (`object-src 'none'`, `frame-src` sin blob:).
    cuerpo = <VisorPdf fuente={fuentePdf ?? url} titulo={titulo} className={relleno ? "min-h-0 flex-1" : "h-[70dvh] min-h-80"} />;
  } else {
    cuerpo = (
      <div className={relleno ? "flex min-h-0 flex-1 flex-col gap-1" : "space-y-1"}>
        <div className={relleno ? "relative min-h-0 flex-1" : "relative"}>
          {/* Nada de `display:none` mientras carga: una imagen `lazy` oculta no se pide nunca. */}
          {!cargada && <span className="absolute inset-0 z-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />}
          <ImagenZoom
            src={url}
            alt={titulo}
            lazy
            requiereCtrl
            oculta={!cargada}
            onLoad={() => setCargada(true)}
            onError={() => setFalloImagen(true)}
            onPantallaCompleta={() => setVisor(true)}
            className={relleno ? "h-full bg-background" : "h-[55dvh] max-h-[44rem] min-h-72 bg-background"}
          />
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">Ctrl + rueda o pellizca para ampliar · arrastra para moverte · doble clic para acercar</p>
      </div>
    );
  }

  return (
    <section aria-label="Documento original" className={relleno ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"} data-tour="facturas-original">
      <CabeceraVisor enlace={enlace} />
      {cuerpo}
      {url && !pdf && <VisorPantallaCompleta url={url} abierto={visor} onCerrar={() => setVisor(false)} titulo={titulo} conEnlace={enlacePantallaCompleta} />}
    </section>
  );
}
