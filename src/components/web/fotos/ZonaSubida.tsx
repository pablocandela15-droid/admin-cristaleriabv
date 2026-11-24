import { useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { subirFotoWeb, useRefrescarFotos, type FaseSubida } from "@/hooks/useWebFotos";
import { esFotoAdmitida } from "@/lib/web/prepararFoto";
import { mensajeErrorWeb, siguienteOrden } from "@/lib/web/fotos";

interface Subida {
  clave: string;
  nombre: string;
  fase: FaseSubida;
  error?: string;
}

const PROGRESO: Record<FaseSubida, number> = { preparando: 15, subiendo: 55, guardando: 85, hecha: 100, error: 100 };
const TEXTO: Record<FaseSubida, string> = {
  preparando: "Preparando (2400 px, WebP)…",
  subiendo: "Subiendo…",
  guardando: "Guardando…",
  hecha: "Subida",
  error: "No se ha podido subir",
};

interface ZonaSubidaProps {
  /** Book al que van las fotos; null = fotos sueltas. */
  albumId?: string | null;
  /**
   * Si el book aún puede no existir (el de un tipo de trabajo): devuelve su id, creándolo si hace falta. Se llama una
   * vez por tanda, antes de subir; en vez de `albumId`.
   */
  resolverAlbum?: () => Promise<string>;
  /** `orden` de las fotos que ya hay (las nuevas van detrás, en el orden en que se eligen). */
  ordenes: number[];
  /** Adónde van, para el lector de pantalla y el texto de la zona: «Mamparas». */
  destino?: string;
  className?: string;
}

/**
 * Subir varias fotos a la vez: se arrastran o se eligen. Cada una se reduce a 2400 px por el lado mayor y se pasa a
 * WebP en el navegador, se sube al bucket web-fotos y se guarda con sus medidas. Cada fichero lleva su barra y, si
 * falla, el motivo; las demás siguen.
 */
export function ZonaSubida({ albumId = null, resolverAlbum, ordenes, destino, className }: ZonaSubidaProps) {
  const input = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const refrescar = useRefrescarFotos();
  const ocupada = subidas.some((s) => s.fase !== "hecha" && s.fase !== "error");

  const cambiar = (clave: string, cambio: Partial<Subida>) =>
    setSubidas((lista) => lista.map((s) => (s.clave === clave ? { ...s, ...cambio } : s)));

  async function subir(archivos: File[]) {
    const validas = archivos.filter(esFotoAdmitida);
    const descartadas = archivos.length - validas.length;
    if (descartadas) toast.warning(`${descartadas} fichero(s) no son fotos (JPG, PNG, WebP o AVIF) y no se han subido.`);
    if (!validas.length) return;
    const lote = validas.map((f, i) => ({ archivo: f, clave: `${Date.now()}-${i}-${f.name}` }));
    setSubidas((lista) => [...lista.filter((s) => s.fase !== "hecha"), ...lote.map((l) => ({ clave: l.clave, nombre: l.archivo.name, fase: "preparando" as FaseSubida }))]);
    let album = albumId;
    if (resolverAlbum) {
      try {
        album = await resolverAlbum();
      } catch (e) {
        const error = mensajeErrorWeb(e, "Web · Fotos");
        const claves = new Set(lote.map((l) => l.clave));
        setSubidas((lista) => lista.map((s) => (claves.has(s.clave) ? { ...s, fase: "error" as const, error } : s)));
        await refrescar();
        return;
      }
    }
    let orden = siguienteOrden(ordenes);
    let bien = 0;
    // De una en una: el móvil no se queda sin memoria con fotos de 12-48 Mpx.
    for (const { archivo, clave } of lote) {
      try {
        await subirFotoWeb(archivo, { albumId: album, orden: orden++, alFase: (fase) => cambiar(clave, { fase }) });
        bien++;
      } catch (e) {
        cambiar(clave, { fase: "error", error: mensajeErrorWeb(e, "Web · Fotos") });
      }
    }
    await refrescar();
    if (bien) toast.success(bien === 1 ? "Foto subida" : `${bien} fotos subidas`);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label={destino ? `Subir fotos a ${destino}: arrástralas aquí o pulsa para elegirlas` : "Subir fotos: arrástralas aquí o pulsa para elegirlas"}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          void subir(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          encima ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
        )}
        data-testid="zona-subida"
      >
        <ImagePlus className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{destino ? `Arrastra aquí las fotos de ${destino} o pulsa para elegirlas` : "Arrastra aquí las fotos o pulsa para elegirlas"}</p>
        <p className="text-xs text-muted-foreground">Varias a la vez. Se reducen solas a 2400 px y se guardan en WebP (pesan mucho menos).</p>
        <Button type="button" size="sm" variant="secondary" disabled={ocupada} onClick={(e) => (e.stopPropagation(), input.current?.click())}>
          Elegir fotos
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="hidden"
          onChange={(e) => {
            const archivos = Array.from(e.target.files ?? []);
            e.target.value = "";
            void subir(archivos);
          }}
        />
      </div>
      {subidas.length > 0 && (
        <ul className="space-y-1.5" aria-label="Fotos subiéndose">
          {subidas.map((s) => (
            <li key={s.clave} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                {s.fase === "hecha" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                ) : s.fase === "error" ? (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{s.nombre}</span>
                <span className={cn("shrink-0 text-xs", s.fase === "error" ? "text-destructive" : "text-muted-foreground")}>{TEXTO[s.fase]}</span>
              </div>
              {s.fase !== "hecha" && s.fase !== "error" && <Progress value={PROGRESO[s.fase]} className="mt-1.5 h-1.5" />}
              {s.error && <p className="mt-1 text-xs text-destructive">{s.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
