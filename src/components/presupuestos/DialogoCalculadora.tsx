import { useMemo, useState } from "react";
import { AlertTriangle, Calculator, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalculadoraCampos, ResultadoCalculo } from "@/components/web/CalculadoraCampos";
import { useCalculadora } from "@/hooks/useCalculadora";
import { cn } from "@/lib/utils";
import { cambiosAlRecalcular, lineaDesdeCalculadora, precioConIva } from "@/lib/presupuestos/lineas";
import { eurosCentimos, formatoPorcentaje, redondear2 } from "@/lib/presupuestos/totales";
import type { CambiosLinea, LineaNueva, LineaPresupuesto } from "@/lib/presupuestos/tipos";
import type { PricingConfig } from "@/lib/web/pricing/config";
import type { CategoriaAplicada } from "@/lib/web/pricing/tarifas";
import { IDS_CATEGORIAS, type IdCategoria } from "@/lib/web/tarifasEditor";

interface DialogoCalculadoraProps {
  abierto: boolean;
  /** Línea que se recalcula; sin ella, se añade una nueva. */
  linea?: LineaPresupuesto | null;
  categorias: Record<IdCategoria, CategoriaAplicada>;
  precios: PricingConfig;
  /** IVA del presupuesto (el de pantalla): el precio de la calculadora lo lleva incluido y la línea se guarda sin él. */
  ivaPct: number;
  /** Aviso si no se han podido leer las tarifas (se calcula con las de serie). */
  avisoTarifas?: string | null;
  guardando?: boolean;
  onAnadir: (linea: LineaNueva) => void;
  onActualizar: (linea: LineaPresupuesto, cambios: CambiosLinea) => void;
  onCerrar: () => void;
}

/**
 * «Añadir desde calculadora»: la calculadora de la web (cualquier categoría, también las ocultas en la web) con las
 * tarifas de hoy. Añade una línea con el nombre de la categoría, lo elegido y el desglose, cantidad 1 y, como el
 * precio de la web lleva el IVA incluido, ese total sin el IVA del presupuesto como precio (el total con IVA es el
 * precio web). Con `linea`, «Recalcular»: abre lo que se guardó y avisa si con las tarifas de hoy sale otro precio.
 */
export function DialogoCalculadora(props: DialogoCalculadoraProps) {
  const { abierto, linea, onCerrar } = props;
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-4xl" data-testid="dialogo-calculadora">
        {/* Se monta de nuevo en cada apertura: empieza con los valores de la línea (o los de partida). */}
        {abierto && <Contenido key={linea?.id ?? "nueva"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

const esIdCategoria = (v: unknown): v is IdCategoria => (IDS_CATEGORIAS as string[]).includes(String(v));

function Contenido({ linea, categorias, precios, ivaPct, avisoTarifas, guardando, onAnadir, onActualizar, onCerrar }: DialogoCalculadoraProps) {
  const inicial: IdCategoria = esIdCategoria(linea?.categoria) ? linea.categoria : (IDS_CATEGORIAS.find((id) => categorias[id].activo) ?? IDS_CATEGORIAS[0]);
  const [cat, setCat] = useState<IdCategoria>(inicial);
  // Estable: useCalculadora los pone una vez, en la categoría de la línea.
  const valoresPartida = useMemo(() => (linea?.valores ? { ...linea.valores } : undefined), [linea]);
  const calc = useCalculadora(categorias, precios, cat, valoresPartida);
  const recalculando = !!linea;
  const listo = calc.presupuesto.ready;
  const nueva = useMemo(
    () => lineaDesdeCalculadora(calc.categoria, calc.valores, calc.presupuesto, ivaPct),
    [calc.categoria, calc.valores, calc.presupuesto, ivaPct],
  );
  const cambios = linea ? cambiosAlRecalcular(linea, calc.categoria, calc.valores, calc.presupuesto, categorias, ivaPct) : null;
  const diferencia =
    recalculando && linea.precio_calculado != null && listo && cat === linea.categoria ? redondear2(calc.presupuesto.total - linea.precio_calculado) : 0;

  const guardar = () => {
    if (!listo) return;
    if (linea && cambios) onActualizar(linea, cambios);
    else onAnadir(nueva);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" aria-hidden="true" />
          {recalculando ? "Recalcular línea" : "Añadir desde la calculadora"}
        </DialogTitle>
        <DialogDescription>
          {recalculando
            ? `Lo que se rellenó al añadirla, calculado con las tarifas de hoy. Cambia lo que haga falta y actualiza la línea: su precio será el de la calculadora sin el IVA (${formatoPorcentaje(ivaPct)}).`
            : `La calculadora de la web con las tarifas de hoy. Sus precios llevan el IVA incluido: la línea se añade con su detalle y ese precio sin el IVA del presupuesto (${formatoPorcentaje(ivaPct)}), así el total con IVA es el de la calculadora.`}
        </DialogDescription>
      </DialogHeader>

      {avisoTarifas && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {avisoTarifas}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="calc-categoria">Categoría</Label>
              <Select value={cat} onValueChange={(v) => esIdCategoria(v) && setCat(v)}>
                <SelectTrigger id="calc-categoria" aria-label="Categoría de la calculadora">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IDS_CATEGORIAS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {categorias[id].name}
                      {categorias[id].activo ? "" : " (oculta en la web)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={calc.reiniciar}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Vaciar
            </Button>
          </div>
          {!categorias[cat].activo && (
            <p className="text-xs text-muted-foreground">Esta categoría está oculta en la calculadora de la web, pero aquí se puede usar.</p>
          )}
          <CalculadoraCampos categoria={calc.categoria} valores={calc.valores} onCambiar={calc.cambiar} />
        </div>

        <div className="min-w-0 space-y-3 md:sticky md:top-0 md:self-start">
          <ResultadoCalculo presupuesto={calc.presupuesto} nota={precios.priceNote} />
          {recalculando && (
            <dl className="space-y-1 rounded-md border p-3 text-sm" data-testid="comparar-tarifas">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Precio en la línea (sin IVA)</dt>
                <dd className="tabular-nums">{eurosCentimos(linea.precio_unitario)}</dd>
              </div>
              {linea.precio_calculado != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Precio web al añadirla (IVA incl.)</dt>
                  <dd className="tabular-nums">{eurosCentimos(linea.precio_calculado)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 font-medium">
                <dt>Con las tarifas de hoy (IVA incl.)</dt>
                <dd className="tabular-nums">{listo ? eurosCentimos(calc.presupuesto.total) : "—"}</dd>
              </div>
              {diferencia !== 0 && (
                <p className={cn("pt-1 text-xs", diferencia > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")} role="status">
                  Con las tarifas de hoy sale {diferencia > 0 ? "más caro" : "más barato"}: {diferencia > 0 ? "+" : ""}
                  {eurosCentimos(diferencia)}.
                </p>
              )}
            </dl>
          )}
          {listo && (
            <div className="rounded-md bg-muted/60 p-3 text-xs" data-testid="vista-linea">
              <p className="font-medium text-foreground">{recalculando ? "La línea quedará así" : "Se añadirá"}:</p>
              <p className="mt-1 font-semibold text-foreground">{recalculando && !cambios?.descripcion ? linea.descripcion : nueva.descripcion}</p>
              <p className="text-muted-foreground" data-testid="vista-linea-precio">
                1 × {eurosCentimos(nueva.precio_unitario)} sin IVA · {eurosCentimos(precioConIva(nueva.precio_unitario, ivaPct))} con IVA ({formatoPorcentaje(ivaPct)})
              </p>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button type="button" onClick={guardar} disabled={!listo || guardando} className="gap-1.5">
          {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {recalculando ? "Actualizar línea" : "Añadir al presupuesto"}
        </Button>
      </DialogFooter>
    </>
  );
}
