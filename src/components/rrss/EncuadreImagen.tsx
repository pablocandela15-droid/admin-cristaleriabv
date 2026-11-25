import { useRef, useState, type PointerEvent } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { PROPORCIONES, type Proporcion } from "../../../supabase/functions/_shared/rrss/formatos";
import { estiloRecorteCss, fotoPequena, moverEncuadre, rectanguloRecorte, type Encuadre } from "@/lib/rrss/imagen";

/**
 * Encuadre de una foto (portado de EncuadreFoto del panel de referencia): la foto recortada a la proporción, como
 * saldrá; se ARRASTRA para elegir qué parte se ve y el deslizador acerca (zoom). La cuenta es la misma que la del
 * recorte final (src/lib/rrss/imagen.ts).
 */
export function EncuadreImagen({ src, proporcion, valor, onCambio }: { src: string; proporcion: Proporcion; valor: Encuadre; onCambio: (e: Encuadre) => void }) {
  const marco = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const arrastre = useRef<{ x: number; y: number; inicio: Encuadre } | null>(null);
  const s = PROPORCIONES[proporcion];
  const anchoMarco = 260;
  const altoMarco = Math.round((anchoMarco * s.alto) / s.ancho);
  const estilo = natural ? estiloRecorteCss(natural.w, natural.h, anchoMarco, altoMarco, valor) : null;

  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a || !natural) return;
    const rc = rectanguloRecorte(natural.w, natural.h, anchoMarco, altoMarco, a.inicio);
    onCambio(moverEncuadre(a.inicio, e.clientX - a.x, e.clientY - a.y, rc, natural.w, natural.h, anchoMarco));
  };

  return (
    <div className="space-y-3" data-testid="rrss-encuadre">
      <div
        ref={marco}
        role="presentation"
        className="relative mx-auto cursor-grab touch-none select-none overflow-hidden rounded-md border bg-muted active:cursor-grabbing"
        style={{ width: anchoMarco, height: altoMarco }}
        onPointerDown={(e) => {
          arrastre.current = { x: e.clientX, y: e.clientY, inicio: valor };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={mover}
        onPointerUp={() => { arrastre.current = null; }}
        onPointerCancel={() => { arrastre.current = null; }}
      >
        <img
          src={src}
          alt="Encuadre de la foto"
          draggable={false}
          crossOrigin="anonymous"
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="pointer-events-none absolute max-w-none"
          style={estilo ? { width: estilo.width, height: estilo.height, left: estilo.left, top: estilo.top } : { width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rrss-zoom" className="text-xs">Acercar</Label>
        <Slider id="rrss-zoom" min={1} max={3} step={0.05} value={[valor.zoom]} onValueChange={([z]) => onCambio({ ...valor, zoom: z })} aria-label="Acercar" />
      </div>
      {natural && fotoPequena(natural.w, natural.h, proporcion, valor) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">La foto es pequeña para este encuadre: puede verse borrosa. Aleja o elige otra.</p>
      )}
      <p className="text-xs text-muted-foreground">Arrastra la foto para elegir qué parte se ve.</p>
    </div>
  );
}
