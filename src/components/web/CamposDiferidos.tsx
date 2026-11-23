// Campos de texto y de número que guardan al salir del campo (o con Intro), no con cada tecla: así se pueden escribir
// espacios y comas a mitad de palabra aunque lo guardado se recorte, y el resto de la pantalla no se repinta letra a
// letra. El número acepta coma o punto decimal y avisa si no es válido (se queda el último bueno).
import { useEffect, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PropsInput = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "defaultValue">;

export function TextoDiferido({ valor, onConfirmar, ...props }: PropsInput & { valor: string; onConfirmar: (v: string) => void }) {
  const [borrador, setBorrador] = useState(valor);
  useEffect(() => setBorrador(valor), [valor]);
  const confirmar = () => {
    if (borrador !== valor) onConfirmar(borrador);
  };
  return (
    <Input
      {...props}
      value={borrador}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        props.onKeyDown?.(e);
      }}
    />
  );
}

const formatear = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));
const leer = (s: string) => {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function NumeroDiferido({
  valor,
  onConfirmar,
  prefijo,
  sufijo,
  minimo = 0,
  mayorQueCero,
  className,
  ...props
}: PropsInput & {
  valor: number | undefined;
  onConfirmar: (v: number) => void;
  prefijo?: string;
  sufijo?: string;
  minimo?: number;
  /** Un multiplicador 0 dejaría el precio en 0: no vale. */
  mayorQueCero?: boolean;
}) {
  const [borrador, setBorrador] = useState(formatear(valor));
  // Solo si cambia por fuera (restaurar, descartar): lo que se está escribiendo («1,») no se toca.
  useEffect(() => setBorrador((b) => (leer(b) === valor ? b : formatear(valor))), [valor]);
  const n = leer(borrador);
  const valido = n !== null && n >= minimo && (!mayorQueCero || n > 0);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {prefijo && <span className="text-sm text-muted-foreground">{prefijo}</span>}
      <Input
        {...props}
        inputMode="decimal"
        value={borrador}
        aria-invalid={!valido}
        className={cn("w-24 text-right tabular-nums", !valido && "border-destructive focus-visible:ring-destructive")}
        onChange={(e) => {
          setBorrador(e.target.value);
          const v = leer(e.target.value);
          // Al momento (para «Probar»), si ya es un número válido.
          if (v !== null && v >= minimo && (!mayorQueCero || v > 0) && v !== valor) onConfirmar(v);
        }}
        onBlur={() => setBorrador(formatear(valido ? (n as number) : valor))}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      {sufijo && <span className="whitespace-nowrap text-sm text-muted-foreground">{sufijo}</span>}
    </div>
  );
}
