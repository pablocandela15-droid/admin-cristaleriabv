import { useState } from "react";
import { ExternalLink, FileImage, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BUCKET = "facturas-originales";
/** Vida de la URL firmada. Corta a propósito: el enlace no debe poder reenviarse. */
const SEGUNDOS_FIRMA = 120;

interface BotonOriginalProps {
  archivoPath: string | null;
  /**
   * `fila`: icono del tipo de archivo (PDF / imagen) en una fila de lista, 44 × 44.
   * `ficha`: icono y palabra corta (desde `sm`). `mobile`: botón a todo el ancho con el texto.
   */
  variant: "mobile" | "ficha" | "fila";
  /**
   * Texto del botón en `mobile`. En `ficha` es el nombre accesible («Ver original») y el texto
   * visible es la palabra corta que queda tras quitar el «Ver »; en `fila`, solo el nombre accesible.
   */
  label?: string;
}

/**
 * Abre el documento original, que vive en el bucket PRIVADO `facturas-originales`
 * (facturas.archivo_path): se pide una URL firmada corta en el momento de abrirlo.
 *
 * Sin original NO se devuelve `null`: se pinta el botón deshabilitado con el porqué
 * en el `title`. Lo que no aplica a una fila sale apagado, nunca se quita, porque si
 * no los botones bailan de sitio al bajar por la lista.
 */
export function BotonOriginal({ archivoPath, variant, label = "Ver original" }: BotonOriginalProps) {
  const [cargando, setCargando] = useState(false);
  // `ficha`: solo icono en estrecho, icono + palabra corta desde `sm`, con el nombre accesible siempre puesto.
  const corto = label.replace(/^Ver /i, "").replace(/^./, (c) => c.toUpperCase());
  const texto = variant === "mobile" ? label : variant === "ficha" ? <span className="hidden sm:inline">{corto}</span> : null;

  const clases =
    variant === "fila"
      ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
      : variant === "ficha"
        ? "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted active:bg-muted/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
        : "inline-flex h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-md bg-accent px-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40";

  if (!archivoPath) {
    return (
      <button
        type="button"
        disabled
        className={clases}
        title="No se guardó el documento original de este registro"
        aria-label="Ver original: no se guardó el documento original de este registro"
      >
        <ExternalLink className="h-4 w-4" />
        {texto}
      </button>
    );
  }

  // En la fila, el icono dice qué es el original: PDF o foto.
  const IconoArchivo = variant !== "fila" ? ExternalLink : /\.pdf(\?|$)/i.test(archivoPath) ? FileText : FileImage;
  const icono = cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <IconoArchivo className="h-4 w-4" aria-hidden="true" />;

  // Bucket privado: hay que firmar la URL en el momento de abrirla.
  const abrir = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cargando) return;
    setCargando(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(archivoPath, SEGUNDOS_FIRMA);
      if (error || !data?.signedUrl) throw new Error(error?.message || "URL no disponible");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[facturas] No se pudo abrir el original:", err);
      toast.error("No se ha podido abrir el documento original");
    } finally {
      setCargando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={cargando}
      className={clases}
      title="Ver el documento original"
      aria-label={variant === "mobile" ? undefined : label}
    >
      {icono}
      {texto}
    </button>
  );
}
