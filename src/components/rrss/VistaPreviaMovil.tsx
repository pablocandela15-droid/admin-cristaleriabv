import { useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Send } from "lucide-react";
import { PROPORCIONES, type FormatoPieza, type Proporcion, type Red } from "../../../supabase/functions/_shared/rrss/formatos";
import { estiloRecorteCss, type Encuadre } from "@/lib/rrss/imagen";
import { cn } from "@/lib/utils";

export interface ElementoVista {
  clave: string;
  tipo: "imagen" | "video";
  url: string;
  /** Si la foto aún no está recortada, el encuadre para pintarla como saldrá. */
  encuadre: Encuadre | null;
}

function ImagenRecortada({ url, encuadre, ancho, alto }: { url: string; encuadre: Encuadre | null; ancho: number; alto: number }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const estilo = encuadre && natural ? estiloRecorteCss(natural.w, natural.h, ancho, alto, encuadre) : null;
  return (
    <img
      src={url}
      alt=""
      onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      className={cn("absolute max-w-none", !estilo && "inset-0 h-full w-full object-cover")}
      style={estilo ? { width: estilo.width, height: estilo.height, left: estilo.left, top: estilo.top } : undefined}
    />
  );
}

/**
 * «Así quedará»: la publicación en un móvil (carrusel con flechas y puntos), con la cuenta, el texto recortado como lo
 * enseña Instagram («… más») o entero como Facebook. Solo orientativo: Instagram decide la tipografía final.
 */
export function VistaPreviaMovil({ red, formato, proporcion, elementos, caption, usuario }: {
  red: Red;
  formato: FormatoPieza;
  proporcion: Proporcion;
  elementos: ElementoVista[];
  caption: string;
  usuario: string | null;
}) {
  const [i, setI] = useState(0);
  const p = PROPORCIONES[formato === "story" || formato === "reel" ? "9:16" : proporcion];
  const ancho = 300;
  const alto = Math.round((ancho * p.alto) / p.ancho);
  const actual = elementos[Math.min(i, Math.max(0, elementos.length - 1))];
  const [verMas, setVerMas] = useState(false);
  const corto = caption.length > 125 && !verMas && red === "instagram";

  return (
    <div className="mx-auto w-[300px] max-w-full overflow-hidden rounded-[1.75rem] border-4 border-foreground/80 bg-background shadow-sm" data-testid="rrss-vista-previa">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold">
        <span className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600" aria-hidden="true" />
        <span className="truncate">{usuario ? (red === "instagram" ? usuario : usuario.replace(/^@/, "")) : red === "instagram" ? "tu_cuenta" : "Tu página"}</span>
      </div>
      {red === "facebook" && caption && <p className="whitespace-pre-line px-3 pb-2 text-[13px]">{caption}</p>}
      <div className="relative w-full overflow-hidden bg-muted" style={{ height: alto }}>
        {!actual && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">Añade una foto o un vídeo para ver cómo queda.</p>}
        {actual?.tipo === "imagen" && <ImagenRecortada key={actual.clave} url={actual.url} encuadre={actual.encuadre} ancho={ancho} alto={alto} />}
        {actual?.tipo === "video" && <video key={actual.clave} src={actual.url} className="absolute inset-0 h-full w-full object-cover" muted playsInline controls preload="metadata" />}
        {elementos.length > 1 && (
          <>
            <button type="button" className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 disabled:opacity-30" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 disabled:opacity-30" disabled={i >= elementos.length - 1} onClick={() => setI(i + 1)} aria-label="Siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute right-2 top-2 rounded-full bg-foreground/70 px-2 text-[11px] text-background">{i + 1}/{elementos.length}</span>
          </>
        )}
      </div>
      {formato !== "story" && red === "instagram" && (
        <div className="space-y-1 px-3 py-2">
          <div className="flex gap-3" aria-hidden="true"><Heart className="h-5 w-5" /><MessageCircle className="h-5 w-5" /><Send className="h-5 w-5" /></div>
          {elementos.length > 1 && (
            <div className="flex justify-center gap-1" aria-hidden="true">
              {elementos.map((e, n) => <span key={e.clave} className={cn("h-1.5 w-1.5 rounded-full", n === i ? "bg-sky-500" : "bg-muted-foreground/30")} />)}
            </div>
          )}
          {caption && (
            <p className="whitespace-pre-line text-[13px]">
              <span className="font-semibold">{usuario ?? "tu_cuenta"} </span>
              {corto ? <>{caption.slice(0, 125)}… <button type="button" className="text-muted-foreground" onClick={() => setVerMas(true)}>más</button></> : caption}
            </p>
          )}
        </div>
      )}
      {formato === "story" && <p className="px-3 py-2 text-xs text-muted-foreground">Las historias no llevan texto: duran 24 horas.</p>}
    </div>
  );
}
