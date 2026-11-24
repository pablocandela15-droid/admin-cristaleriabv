import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { calcularTotales, eurosCentimos, formatoPorcentaje, redondear2 } from "@/lib/presupuestos/totales";

interface CajaTotalesProps {
  lineas: ReadonlyArray<{ cantidad: number; precio_unitario: number }>;
  /** Lo que hay escrito (texto: se valida aquí). */
  descuento: string;
  iva: string;
  onDescuento: (v: string) => void;
  onIva: (v: string) => void;
  descuentoNum: number | null;
  ivaNum: number | null;
  puedeEditar: boolean;
  /** Total guardado en la base (para avisar si aún no coincide con lo de pantalla). */
  totalGuardado: number;
}

/**
 * Subtotal, descuento (%), base imponible, IVA (%) y total, calculados al momento con lo que hay en pantalla (la base
 * guarda los mismos números al guardar).
 */
export function CajaTotales({ lineas, descuento, iva, onDescuento, onIva, descuentoNum, ivaNum, puedeEditar, totalGuardado }: CajaTotalesProps) {
  const d = descuentoNum ?? 0;
  const i = ivaNum ?? 0;
  const t = calcularTotales(lineas, d, i);
  const pendiente = redondear2(t.total) !== redondear2(totalGuardado);
  const fila = "flex items-center justify-between gap-3 py-1.5";

  return (
    <section className="rounded-lg border bg-card p-4" aria-labelledby="titulo-totales" data-tour="presupuesto-totales">
      <h2 id="titulo-totales" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Totales
      </h2>
      <dl className="divide-y text-sm">
        <div className={fila}>
          <dt>Subtotal</dt>
          <dd className="tabular-nums" data-testid="subtotal">
            {eurosCentimos(t.subtotal)}
          </dd>
        </div>
        <div className={fila}>
          <dt className="flex items-center gap-2">
            Descuento
            {puedeEditar ? (
              <span className="inline-flex items-center gap-1">
                <Input
                  value={descuento}
                  onChange={(e) => onDescuento(e.target.value)}
                  inputMode="decimal"
                  aria-label="Descuento (%)"
                  aria-invalid={descuentoNum == null}
                  className={cn("h-8 w-16 text-right tabular-nums", descuentoNum == null && "border-destructive")}
                />
                <span className="text-muted-foreground">%</span>
              </span>
            ) : (
              <span className="text-muted-foreground">({formatoPorcentaje(d)})</span>
            )}
          </dt>
          <dd className="tabular-nums" data-testid="descuento">
            {t.descuento > 0 ? `-${eurosCentimos(t.descuento)}` : eurosCentimos(0)}
          </dd>
        </div>
        <div className={fila}>
          <dt>Base imponible</dt>
          <dd className="tabular-nums" data-testid="base-imponible">
            {eurosCentimos(t.baseImponible)}
          </dd>
        </div>
        <div className={fila}>
          <dt className="flex items-center gap-2">
            IVA
            {puedeEditar ? (
              <span className="inline-flex items-center gap-1">
                <Input
                  value={iva}
                  onChange={(e) => onIva(e.target.value)}
                  inputMode="decimal"
                  aria-label="IVA (%)"
                  aria-invalid={ivaNum == null}
                  className={cn("h-8 w-16 text-right tabular-nums", ivaNum == null && "border-destructive")}
                />
                <span className="text-muted-foreground">%</span>
              </span>
            ) : (
              <span className="text-muted-foreground">({formatoPorcentaje(i)})</span>
            )}
          </dt>
          <dd className="tabular-nums" data-testid="iva">
            {eurosCentimos(t.iva)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 pt-3 text-lg font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="total">
            {eurosCentimos(t.total)}
          </dd>
        </div>
      </dl>
      {pendiente && (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          Guardado: {eurosCentimos(totalGuardado)} (se pondrá al día al guardar).
        </p>
      )}
    </section>
  );
}
