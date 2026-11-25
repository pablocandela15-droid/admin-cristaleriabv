import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorRrss, useIARrss, type VarianteIA } from "@/hooks/useRrss";
import type { FormatoPieza, Red } from "../../../supabase/functions/_shared/rrss/formatos";

const ENFOQUE: Record<VarianteIA["enfoque"], string> = { trabajo: "El trabajo", problema: "Lo que resuelve", consejo: "Un consejo" };

/**
 * «Ayuda de la IA» para el texto (como «Proponer 3 textos» del panel de referencia): la persona cuenta qué se hizo y
 * la IA, que ve las fotos ya subidas, propone tres textos con sus hashtags y el texto alternativo. Solo propone: al
 * elegir uno se rellena el texto y nada más.
 */
export function DialogoTextosIA({ abierto, onCerrar, red, formato, servicio, rutas, prepararFotos, onElegir, iaDisponible }: {
  abierto: boolean;
  onCerrar: () => void;
  red: Red;
  formato: FormatoPieza;
  servicio: string | null;
  /** Fotos ya subidas al cubo que verá la IA (las 3 primeras). */
  rutas: string[];
  /** Recorta y sube las fotos que aún no están en el cubo (para que la IA las vea); devuelve sus rutas. */
  prepararFotos?: () => Promise<string[]>;
  onElegir: (texto: string, altText: string) => void;
  iaDisponible: boolean;
}) {
  const ia = useIARrss<{ variantes: VarianteIA[]; descartadas: Array<{ motivos: string[] }> }>();
  const [descripcion, setDescripcion] = useState("");
  const [tono, setTono] = useState<string>("estilo");
  const [variantes, setVariantes] = useState<VarianteIA[]>([]);
  const [preparando, setPreparando] = useState(false);
  const pedir = async () => {
    let fotos = rutas;
    if (prepararFotos) {
      setPreparando(true);
      try {
        fotos = await prepararFotos();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setPreparando(false);
      }
    }
    ia.mutate(
    { accion: "textos", red, formato, servicio, descripcion, rutas: fotos.slice(0, 3), ...(tono !== "estilo" ? { tono } : {}) },
    {
      onSuccess: (r) => setVariantes(r.variantes),
      onError: (e) => {
        const motivos = e instanceof ErrorRrss && Array.isArray(e.cuerpo?.descartadas) ? (e.cuerpo?.descartadas as Array<{ motivos: string[] }>).flatMap((d) => d.motivos).slice(0, 2).join(" ") : "";
        toast.error(`${e.message}${motivos ? ` (${motivos})` : ""}`);
      },
    },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" aria-hidden="true" /> Ayuda de la IA para el texto</DialogTitle>
          <DialogDescription>Cuéntale qué se hizo y dónde (sin datos del cliente). La IA ve las fotos ya subidas y propone tres textos; tú eliges y lo revisas.</DialogDescription>
        </DialogHeader>
        {!iaDisponible ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground" data-testid="rrss-ia-no-disponible">
            La IA no está disponible: falta configurar la clave de OpenAI (OPENAI_API_KEY) en Supabase. Puedes escribir el texto a mano.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rrss-ia-desc">¿Qué se hizo?</Label>
              <Textarea id="rrss-ia-desc" rows={3} maxLength={800} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Mampara de dos hojas correderas con perfil negro en un baño de Elche. Sustituye a una cortina." />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rrss-ia-tono">Tono</Label>
                <Select value={tono} onValueChange={setTono}>
                  <SelectTrigger id="rrss-ia-tono" className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estilo">El del estilo guardado</SelectItem>
                    <SelectItem value="cercano">Cercano</SelectItem>
                    <SelectItem value="profesional">Profesional</SelectItem>
                    <SelectItem value="tecnico">Técnico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" onClick={pedir} disabled={ia.isPending || preparando}>
                {ia.isPending || preparando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
                {variantes.length ? "Proponer otros" : "Proponer 3 textos"}
              </Button>
              {rutas.length === 0 && !prepararFotos && <p className="text-xs text-muted-foreground">Sin fotos, la IA escribe sin verlas.</p>}
            </div>
            <ul className="space-y-3" data-testid="rrss-variantes">
              {variantes.map((v, i) => (
                <li key={i} className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ENFOQUE[v.enfoque]}</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{v.caption}</p>
                  <p className="mt-1 text-sm text-sky-700 dark:text-sky-300">{v.hashtags.join(" ")}</p>
                  {v.avisos.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{v.avisos.join(" ")}</p>}
                  <Button type="button" size="sm" className="mt-2" onClick={() => {
                    onElegir(`${v.caption}${v.hashtags.length ? `\n\n${v.hashtags.join(" ")}` : ""}`, v.altText);
                    onCerrar();
                  }}>Usar este</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter><Button type="button" variant="ghost" onClick={onCerrar}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
