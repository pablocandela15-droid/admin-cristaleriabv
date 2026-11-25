import { useEffect, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAjustesRrss, useGuardarAjustes, useIARrss, type AjustesRrss, type PropuestaEstiloIA } from "@/hooks/useRrss";

// ---------------------------------------------------------------------------
// RRSS › Conexión y estilo › Estilo: lo que la IA tiene en cuenta al escribir (zona, tono, guía, hashtags que van
// siempre, llamadas a la acción y palabras a evitar) y dos preferencias (Facebook por defecto, emojis). «Aprender de
// lo publicado» pide a la IA una guía mejorada a partir de las métricas; nunca se aplica sola: se revisa y se guarda.
// ---------------------------------------------------------------------------

type Formulario = Pick<AjustesRrss, "zona" | "tono" | "guia" | "facebook_por_defecto" | "emojis"> & { hashtags: string; ctas: string; evitar: string };

const lista = (texto: string, sep: RegExp) => texto.split(sep).map((x) => x.trim()).filter(Boolean);
const hashtags = (texto: string) => [...new Set(lista(texto, /[\s,]+/).map((h) => `#${h.replace(/^#+/, "")}`))].slice(0, 15);

export function EstiloRrss({ puedeEditar, iaDisponible }: { puedeEditar: boolean; iaDisponible: boolean }) {
  const { data, isLoading } = useAjustesRrss();
  const guardar = useGuardarAjustes();
  const aprender = useIARrss<{ propuesta: PropuestaEstiloIA; publicaciones: number }>();
  const [f, setF] = useState<Formulario | null>(null);
  const [propuesta, setPropuesta] = useState<PropuestaEstiloIA | null>(null);

  useEffect(() => {
    if (data) {
      setF({
        zona: data.zona, tono: data.tono, guia: data.guia, facebook_por_defecto: data.facebook_por_defecto, emojis: data.emojis,
        hashtags: data.hashtags_base.join(" "), ctas: data.ctas.join("\n"), evitar: data.palabras_evitar.join(", "),
      });
    }
  }, [data]);

  const enviar = (extra: Partial<AjustesRrss> = {}, formulario: Formulario | null = f) => {
    if (!formulario) return;
    guardar.mutate({
      zona: formulario.zona.trim(), tono: formulario.tono, guia: formulario.guia.trim(), facebook_por_defecto: formulario.facebook_por_defecto, emojis: formulario.emojis,
      hashtags_base: hashtags(formulario.hashtags), ctas: lista(formulario.ctas, /\n+/).slice(0, 8), palabras_evitar: lista(formulario.evitar, /[,\n]+/).slice(0, 30),
      ...extra,
    }, { onSuccess: () => toast.success("Estilo guardado"), onError: (e) => toast.error(e.message) });
  };

  const aplicar = () => {
    if (!propuesta || !f) return;
    const nuevo: Formulario = { ...f, guia: propuesta.guia, hashtags: propuesta.hashtagsBase.join(" "), ctas: propuesta.ctas.join("\n"),
      evitar: propuesta.palabrasEvitar.join(", ") || f.evitar };
    setF(nuevo);
    enviar({ aprendido_en: new Date().toISOString(), aprendido_resumen: propuesta.resumen.slice(0, 2000) }, nuevo);
    setPropuesta(null);
  };

  return (
    <Card data-tour="rrss-estilo">
      <CardHeader>
        <CardTitle className="text-lg">Estilo de los textos</CardTitle>
        <CardDescription>Lo que tiene en cuenta la IA al proponer textos, hashtags, ideas y campañas. Son preferencias: los textos siempre los revisas tú.</CardDescription>
      </CardHeader>
      <CardContent>
        {(isLoading || !f) && <Skeleton className="h-48 w-full" />}
        {f && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
            <fieldset disabled={!puedeEditar || guardar.isPending} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rrss-zona">Zona que se nombra</Label>
                <Input id="rrss-zona" value={f.zona} maxLength={120} onChange={(e) => setF({ ...f, zona: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rrss-tono">Tono</Label>
                <Select value={f.tono} onValueChange={(v) => setF({ ...f, tono: v as Formulario["tono"] })}>
                  <SelectTrigger id="rrss-tono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cercano">Cercano (el cristalero de confianza)</SelectItem>
                    <SelectItem value="profesional">Profesional (claro y seguro)</SelectItem>
                    <SelectItem value="tecnico">Técnico (explica materiales y soluciones)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="rrss-guia">Guía de estilo</Label>
                <Textarea id="rrss-guia" value={f.guia} maxLength={4000} rows={5} onChange={(e) => setF({ ...f, guia: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rrss-hashtags">Hashtags que van siempre</Label>
                <Input id="rrss-hashtags" value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} placeholder="#cristaleria #elche" />
                <p className="text-xs text-muted-foreground">Separados por espacios; como mucho 15.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rrss-evitar">Palabras a evitar</Label>
                <Input id="rrss-evitar" value={f.evitar} onChange={(e) => setF({ ...f, evitar: e.target.value })} placeholder="barato, chollo" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="rrss-ctas">Llamadas a la acción (una por línea)</Label>
                <Textarea id="rrss-ctas" value={f.ctas} rows={3} onChange={(e) => setF({ ...f, ctas: e.target.value })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <Label htmlFor="rrss-fb" className="font-normal">Marcar también Facebook al crear una publicación</Label>
                <Switch id="rrss-fb" checked={f.facebook_por_defecto} onCheckedChange={(v) => setF({ ...f, facebook_por_defecto: v })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <Label htmlFor="rrss-emojis" className="font-normal">La IA puede usar algún emoji</Label>
                <Switch id="rrss-emojis" checked={f.emojis} onCheckedChange={(v) => setF({ ...f, emojis: v })} />
              </div>
            </fieldset>
            {puedeEditar && (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={guardar.isPending}>
                  {guardar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />} Guardar estilo
                </Button>
                <Button type="button" variant="outline" disabled={!iaDisponible || aprender.isPending} data-tour="rrss-aprender"
                  title={iaDisponible ? undefined : "La IA no está configurada (OPENAI_API_KEY)"}
                  onClick={() => aprender.mutate({ accion: "aprender" }, { onSuccess: (r) => setPropuesta(r.propuesta), onError: (e) => toast.error(e.message) })}>
                  {aprender.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Aprender de lo publicado
                </Button>
              </div>
            )}
            {!iaDisponible && puedeEditar && <p className="text-xs text-muted-foreground">«Aprender de lo publicado» necesita la IA, que no está configurada (falta OPENAI_API_KEY en Supabase).</p>}
            {data?.aprendido_en && (
              <p className="text-xs text-muted-foreground">Última vez que se aprendió de lo publicado: {new Date(data.aprendido_en).toLocaleDateString("es-ES")}. {data.aprendido_resumen}</p>
            )}
          </form>
        )}
        {propuesta && (
          <div className="mt-4 space-y-3 rounded-md border border-primary/40 bg-primary/5 p-4" data-testid="rrss-propuesta-estilo">
            <p className="font-medium">Lo que propone la IA</p>
            <p className="text-sm">{propuesta.resumen}</p>
            {propuesta.cambios.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{propuesta.cambios.map((c) => <li key={c}>{c}</li>)}</ul>}
            <p className="whitespace-pre-line rounded bg-background p-3 text-sm">{propuesta.guia}</p>
            <p className="text-xs text-muted-foreground">Hashtags: {propuesta.hashtagsBase.join(" ")} · Llamadas a la acción: {propuesta.ctas.join(" · ")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={aplicar} disabled={guardar.isPending}>Aplicar al estilo</Button>
              <Button type="button" variant="ghost" onClick={() => setPropuesta(null)}>Descartar</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
