import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BarraGuardar } from "@/components/web/contenido/BarraGuardar";
import { useGuardarContenido } from "@/hooks/useWebContenido";
import { etiquetas, limpiarFaq } from "@/lib/web/contenido";
import { mover } from "@/lib/web/fotos";

interface Borrador {
  clave: number;
  q: string;
  a: string;
  tags: string;
}
let siguiente = 0;
const aBorradores = (v: unknown): Borrador[] => limpiarFaq(v).map((p) => ({ clave: siguiente++, q: p.q, a: p.a, tags: p.tags.join(", ") }));
const deBorradores = (l: Borrador[]) => limpiarFaq(l.map((b) => ({ q: b.q, a: b.a, tags: etiquetas(b.tags) })));

/** Preguntas frecuentes de la web: añadir, quitar, ordenar y editar (pregunta, respuesta y palabras clave). */
export function FormFaq({ valor, puedeEditar }: { valor: unknown; puedeEditar: boolean }) {
  const guardar = useGuardarContenido();
  const original = useMemo(() => aBorradores(valor), [valor]);
  const [lista, setLista] = useState<Borrador[]>(original);
  useEffect(() => setLista(original), [original]);
  const cambios = JSON.stringify(deBorradores(lista)) !== JSON.stringify(deBorradores(original));
  const incompletas = lista.filter((b) => (b.q.trim() || b.a.trim()) && !(b.q.trim() && b.a.trim())).length;
  const cambiar = (clave: number, c: Partial<Borrador>) => setLista((l) => l.map((b) => (b.clave === clave ? { ...b, ...c } : b)));
  const dis = !puedeEditar;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Salen en la página de preguntas frecuentes y las usa el asistente de la web para contestar. Las palabras clave ayudan a
        encontrarlas. Si las borras todas, la web vuelve a las suyas de siempre.
      </p>
      {lista.map((b, i) => (
        <Card key={b.clave}>
          <CardContent className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-sm font-semibold text-muted-foreground">{i + 1}.</span>
              <Input
                value={b.q}
                maxLength={200}
                placeholder="¿Pregunta?"
                aria-label={`Pregunta ${i + 1}`}
                disabled={dis}
                onChange={(e) => cambiar(b.clave, { q: e.target.value })}
                className="font-medium"
              />
              {!dis && (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={i === 0} onClick={() => setLista((l) => mover(l, i, i - 1))} aria-label={`Subir la pregunta ${i + 1}`}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={i === lista.length - 1} onClick={() => setLista((l) => mover(l, i, i + 1))} aria-label={`Bajar la pregunta ${i + 1}`}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => setLista((l) => l.filter((x) => x.clave !== b.clave))} aria-label={`Quitar la pregunta ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <Textarea
              value={b.a}
              maxLength={2000}
              rows={3}
              placeholder="Respuesta"
              aria-label={`Respuesta ${i + 1}`}
              disabled={dis}
              onChange={(e) => cambiar(b.clave, { a: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <Label htmlFor={`faq-tags-${b.clave}`} className="shrink-0 text-xs text-muted-foreground">
                Palabras clave
              </Label>
              <Input
                id={`faq-tags-${b.clave}`}
                value={b.tags}
                maxLength={400}
                placeholder="plazo, tiempo, cuánto tarda"
                disabled={dis}
                onChange={(e) => cambiar(b.clave, { tags: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          </CardContent>
        </Card>
      ))}
      {lista.length === 0 && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Sin preguntas: la web enseña las suyas de siempre.</p>}
      {!dis && (
        <Button variant="outline" className="gap-1" onClick={() => setLista((l) => [...l, { clave: siguiente++, q: "", a: "", tags: "" }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Añadir pregunta
        </Button>
      )}
      <BarraGuardar
        puedeEditar={puedeEditar}
        cambios={cambios || incompletas > 0}
        guardando={guardar.isPending}
        error={incompletas ? `${incompletas} pregunta(s) sin pregunta o sin respuesta: complétalas o quítalas.` : null}
        onDescartar={() => setLista(original)}
        onGuardar={() => guardar.mutate({ clave: "faq", valor: deBorradores(lista) })}
        texto="Guardar preguntas"
      />
    </div>
  );
}
