import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BarraGuardar } from "@/components/web/contenido/BarraGuardar";
import { useGuardarContenido } from "@/hooks/useWebContenido";
import { SERVICIOS_WEB } from "@/lib/web/fotos";
import { limpiarServicio, lineas, type ServicioWeb, type ServiciosWeb } from "@/lib/web/contenido";
import { cn } from "@/lib/utils";

const aServicios = (v: unknown): ServiciosWeb => (v && typeof v === "object" && !Array.isArray(v) ? (JSON.parse(JSON.stringify(v)) as ServiciosWeb) : {});

/** Borrador de un servicio: las listas como texto (una por línea). */
interface Borrador extends Omit<ServicioWeb, "features" | "ideas"> {
  features: string;
  ideas: string;
}
const aBorrador = (s: ServicioWeb | undefined): Borrador => ({ ...(s ?? {}), features: (s?.features ?? []).join("\n"), ideas: (s?.ideas ?? []).join("\n") });
const deBorrador = (b: Borrador): ServicioWeb => limpiarServicio({ ...b, features: lineas(b.features), ideas: lineas(b.ideas) });

const CAMPOS: { k: keyof Borrador; etiqueta: string; ayuda?: string; max: number; largo?: boolean; filas?: number }[] = [
  { k: "name", etiqueta: "Nombre", max: 60 },
  { k: "short", etiqueta: "Descripción corta", ayuda: "La que sale en la tarjeta del servicio.", max: 120 },
  { k: "headline", etiqueta: "Titular de su página", max: 140 },
  { k: "intro", etiqueta: "Presentación", max: 1200, largo: true, filas: 4 },
  { k: "features", etiqueta: "Lo que incluye", ayuda: "Una por línea.", max: 2000, largo: true, filas: 6 },
  { k: "ideas", etiqueta: "Ideas / tipos de trabajo", ayuda: "Una por línea.", max: 1000, largo: true, filas: 4 },
  { k: "seoTitle", etiqueta: "Título para buscadores", ayuda: "Unos 60 caracteres.", max: 120 },
  { k: "seoDescription", etiqueta: "Descripción para buscadores", ayuda: "Unos 155 caracteres.", max: 300, largo: true, filas: 3 },
];

/** Textos de cada servicio de la web: nombre, descripciones, lo que incluye, ideas y lo que ven los buscadores. */
export function FormServicios({ valor, puedeEditar }: { valor: unknown; puedeEditar: boolean }) {
  const guardar = useGuardarContenido();
  const todos = useMemo(() => aServicios(valor), [valor]);
  const [slug, setSlug] = useState<string>(SERVICIOS_WEB[0].slug);
  const original = useMemo(() => aBorrador(todos[slug]), [todos, slug]);
  const [b, setB] = useState<Borrador>(original);
  useEffect(() => setB(original), [original]);
  const cambios = JSON.stringify(deBorrador(b)) !== JSON.stringify(deBorrador(original));

  const cambiarServicio = (s: string) => {
    if (cambios && !window.confirm("Tienes cambios sin guardar en este servicio. ¿Los descartas?")) return;
    setSlug(s);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Servicios de la web">
        {SERVICIOS_WEB.map((s) => (
          <button
            key={s.slug}
            type="button"
            role="tab"
            aria-selected={slug === s.slug}
            onClick={() => cambiarServicio(s.slug)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-sm transition-colors pointer-coarse:min-h-11",
              slug === s.slug ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
            )}
          >
            {todos[s.slug]?.name || s.nombre}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Página de la web: /servicios/{slug}. Lo que dejes vacío lo pone la web con su texto de siempre.
          </p>
          {CAMPOS.map((c) => {
            const id = `serv-${slug}-${c.k}`;
            const v = String(b[c.k] ?? "");
            return (
              <div key={c.k} className={cn("space-y-1", c.largo && "sm:col-span-2")}>
                <Label htmlFor={id}>{c.etiqueta}</Label>
                {c.largo ? (
                  <Textarea id={id} value={v} maxLength={c.max} rows={c.filas ?? 3} disabled={!puedeEditar} onChange={(e) => setB((x) => ({ ...x, [c.k]: e.target.value }))} />
                ) : (
                  <Input id={id} value={v} maxLength={c.max} disabled={!puedeEditar} onChange={(e) => setB((x) => ({ ...x, [c.k]: e.target.value }))} />
                )}
                {c.ayuda && <p className="text-xs text-muted-foreground">{c.ayuda}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>
      <BarraGuardar
        puedeEditar={puedeEditar}
        cambios={cambios}
        guardando={guardar.isPending}
        onDescartar={() => setB(original)}
        onGuardar={() => guardar.mutate({ clave: "servicios", valor: { ...todos, [slug]: deBorrador(b) } })}
        texto="Guardar servicio"
      />
    </div>
  );
}
