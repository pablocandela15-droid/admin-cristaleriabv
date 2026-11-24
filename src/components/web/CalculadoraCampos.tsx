// ============================================================================
//  CalculadoraCampos: los campos de una categoría de la calculadora de la web
// ----------------------------------------------------------------------------
//  Pinta cualquier categoría de src/lib/web/pricing/categories.ts (ya pasada
//  por el catálogo con resolverTarifas): número con su unidad, chips, select,
//  varias opciones, sí/no y textos, por secciones y respetando `when` (un campo
//  sale solo si se cumple su condición). Sin estado propio: valores y cambios
//  vienen de fuera (useCalculadora). Lo usan «Probar» en Web › Tarifas y el
//  gestor de presupuestos. `ResultadoCalculo` enseña las líneas y el total.
// ============================================================================
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { arr, str, type CategoryDef, type FieldDef, type Quote, type Values } from "@/lib/web/pricing/categories";
import { euros } from "@/lib/web/calculadora";

interface CalculadoraCamposProps {
  categoria: CategoryDef;
  valores: Values;
  onCambiar: (campo: string, valor: Values[string]) => void;
  deshabilitado?: boolean;
  className?: string;
}

const CLASE_CHIP =
  "inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-sm transition-colors pointer-coarse:min-h-11 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const chip = (activa: boolean) =>
  cn(CLASE_CHIP, activa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted");

function Campo({ campo, valores, onCambiar, deshabilitado }: { campo: FieldDef; valores: Values; onCambiar: CalculadoraCamposProps["onCambiar"]; deshabilitado?: boolean }) {
  const id = useId();
  const valor = valores[campo.id];
  const etiqueta = (
    <Label htmlFor={campo.kind === "chips" || campo.kind === "multi" ? undefined : id} className="text-sm font-medium" id={`${id}-etiqueta`}>
      {campo.label}
      {campo.required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
    </Label>
  );
  const ayuda = campo.hint ? <p className="text-xs leading-snug text-muted-foreground">{campo.hint}</p> : null;

  if (campo.kind === "toggle") {
    return (
      <div className="flex items-start justify-between gap-3 py-1">
        <div className="space-y-0.5">
          {etiqueta}
          {ayuda}
        </div>
        <Switch id={id} checked={Boolean(valor)} onCheckedChange={(v) => onCambiar(campo.id, v)} disabled={deshabilitado} />
      </div>
    );
  }

  let control: JSX.Element | null = null;
  if (campo.kind === "number") {
    control = (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={campo.min}
          max={campo.max}
          step={campo.step ?? "any"}
          placeholder={campo.placeholder}
          value={valor === undefined || valor === null ? "" : String(valor)}
          onChange={(e) => onCambiar(campo.id, e.target.value === "" ? "" : Number(e.target.value))}
          disabled={deshabilitado}
          className="w-32"
          aria-describedby={campo.hint ? `${id}-ayuda` : undefined}
        />
        {campo.unit && <span className="text-sm text-muted-foreground">{campo.unit}</span>}
        <span className="text-xs text-muted-foreground">
          ({campo.min}–{campo.max})
        </span>
      </div>
    );
  } else if (campo.kind === "chips") {
    control = (
      <div role="radiogroup" aria-labelledby={`${id}-etiqueta`} className="flex flex-wrap gap-1.5">
        {campo.options.map((o) => {
          const activa = str(valor) === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={activa}
              className={chip(activa)}
              disabled={deshabilitado}
              onClick={() => onCambiar(campo.id, o.value)}
              title={o.hint}
            >
              {o.label}
              {o.hint && <span className={cn("ml-1 text-xs", activa ? "opacity-80" : "text-muted-foreground")}>· {o.hint}</span>}
            </button>
          );
        })}
      </div>
    );
  } else if (campo.kind === "multi") {
    const elegidas = arr(valor);
    control = (
      <div role="group" aria-labelledby={`${id}-etiqueta`} className="flex flex-wrap gap-1.5">
        {campo.options.map((o) => {
          const activa = elegidas.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={activa}
              className={chip(activa)}
              disabled={deshabilitado}
              onClick={() => onCambiar(campo.id, activa ? elegidas.filter((x) => x !== o.value) : [...elegidas, o.value])}
              title={o.hint}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  } else if (campo.kind === "select") {
    control = (
      <Select value={str(valor) || undefined} onValueChange={(v) => onCambiar(campo.id, v)} disabled={deshabilitado}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue placeholder="Elige una opción" />
        </SelectTrigger>
        <SelectContent>
          {campo.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.hint ? ` · ${o.hint}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (campo.kind === "textarea") {
    control = (
      <Textarea
        id={id}
        value={str(valor)}
        maxLength={campo.maxLength}
        placeholder={campo.placeholder}
        onChange={(e) => onCambiar(campo.id, e.target.value)}
        disabled={deshabilitado}
        rows={3}
      />
    );
  } else if (campo.kind === "text") {
    control = (
      <Input
        id={id}
        value={str(valor)}
        maxLength={campo.maxLength}
        placeholder={campo.placeholder}
        onChange={(e) => onCambiar(campo.id, e.target.value)}
        disabled={deshabilitado}
      />
    );
  }

  return (
    <div className="space-y-1.5" data-campo={campo.id}>
      {etiqueta}
      {control}
      {ayuda && <div id={`${id}-ayuda`}>{ayuda}</div>}
    </div>
  );
}

export function CalculadoraCampos({ categoria, valores, onCambiar, deshabilitado, className }: CalculadoraCamposProps) {
  return (
    <div className={cn("space-y-5", className)}>
      {categoria.sections.map((seccion) => {
        const campos = seccion.fields.filter((f) => !f.when || f.when(valores));
        if (!campos.length) return null;
        return (
          <fieldset key={seccion.title} className="space-y-3">
            <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{seccion.title}</legend>
            {campos.map((campo) => (
              <Campo key={campo.id} campo={campo} valores={valores} onCambiar={onCambiar} deshabilitado={deshabilitado} />
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

/** Líneas del cálculo, lo que se valora en la visita y el total (o lo que falta para calcular). */
export function ResultadoCalculo({ presupuesto, nota, className }: { presupuesto: Quote; nota?: string; className?: string }) {
  if (!presupuesto.ready) {
    return (
      <div className={cn("rounded-md border border-dashed p-3 text-sm text-muted-foreground", className)} role="status">
        {presupuesto.missing.length
          ? `Falta: ${presupuesto.missing.join(", ")}.`
          : "Rellena las medidas para ver el precio."}
      </div>
    );
  }
  return (
    <div className={cn("space-y-2 rounded-md border p-3", className)} role="status" aria-live="polite">
      <ul className="space-y-1 text-sm">
        {presupuesto.lines.map((l, i) => (
          <li key={`${l.label}-${i}`} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {l.label}
              {l.detail && <span className="ml-1 text-xs text-muted-foreground">({l.detail})</span>}
            </span>
            <span className="shrink-0 tabular-nums">{euros(l.amount)}</span>
          </li>
        ))}
      </ul>
      {presupuesto.pending.length > 0 && (
        <p className="text-xs text-muted-foreground">Se valora en la visita: {presupuesto.pending.join(", ")}.</p>
      )}
      <div className="flex items-baseline justify-between border-t pt-2 font-semibold">
        <span>Total orientativo (IVA incl.)</span>
        <span className="tabular-nums" data-testid="total-calculo">
          {euros(presupuesto.total)}
        </span>
      </div>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}
