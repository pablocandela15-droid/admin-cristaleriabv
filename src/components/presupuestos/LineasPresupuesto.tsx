import { useEffect, useState, type ReactNode } from "react";
import { Calculator, ChevronDown, ChevronUp, PenLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ListaOrdenable } from "@/components/ui/lista-ordenable";
import { cn } from "@/lib/utils";
import { precioConTarifasDeHoy } from "@/lib/presupuestos/lineas";
import { eurosCentimos, formatoCantidad, importeLinea, leerNumero, numeroEditable, redondear2 } from "@/lib/presupuestos/totales";
import type { CambiosLinea, LineaPresupuesto } from "@/lib/presupuestos/tipos";
import type { CategoryDef } from "@/lib/web/pricing/categories";
import type { PricingConfig } from "@/lib/web/pricing/config";

interface LineasPresupuestoProps {
  lineas: LineaPresupuesto[];
  puedeEditar: boolean;
  categorias: Partial<Record<string, CategoryDef>>;
  precios: PricingConfig;
  onCambiar: (linea: LineaPresupuesto, cambios: CambiosLinea) => void;
  onBorrar: (linea: LineaPresupuesto) => void;
  onMover: (desde: number, hasta: number) => void;
  onRecalcular: (linea: LineaPresupuesto) => void;
}

/**
 * Líneas del presupuesto: se ordenan arrastrando (o con las flechas), y descripción, detalle, cantidad y precio se
 * cambian ahí mismo (se guardan al salir del campo). Las de la calculadora se pueden recalcular y avisan si con las
 * tarifas de hoy sale otro precio.
 */
export function LineasPresupuesto({ lineas, puedeEditar, categorias, precios, onCambiar, onBorrar, onMover, onRecalcular }: LineasPresupuestoProps) {
  if (!lineas.length) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="sin-lineas">
        Aún no hay líneas.{puedeEditar ? " Añade una desde la calculadora o escríbela a mano." : ""}
      </div>
    );
  }
  return (
    <ListaOrdenable
      ids={lineas.map((l) => l.id)}
      nombre={(id) => lineas.find((l) => l.id === id)?.descripcion ?? id}
      onMover={puedeEditar ? onMover : () => undefined}
      className="space-y-2"
      aria-label="Líneas del presupuesto"
    >
      {(_id, i, { asa }) => (
        <FilaLinea
          linea={lineas[i]}
          indice={i}
          total={lineas.length}
          asa={puedeEditar ? asa : null}
          puedeEditar={puedeEditar}
          precioHoy={precioConTarifasDeHoy(lineas[i], categorias, precios)}
          onCambiar={onCambiar}
          onBorrar={onBorrar}
          onMover={onMover}
          onRecalcular={onRecalcular}
        />
      )}
    </ListaOrdenable>
  );
}

interface FilaLineaProps {
  linea: LineaPresupuesto;
  indice: number;
  total: number;
  asa: ReactNode;
  puedeEditar: boolean;
  precioHoy: number | null;
  onCambiar: LineasPresupuestoProps["onCambiar"];
  onBorrar: LineasPresupuestoProps["onBorrar"];
  onMover: LineasPresupuestoProps["onMover"];
  onRecalcular: LineasPresupuestoProps["onRecalcular"];
}

const filasTexto = (t: string) => Math.min(10, Math.max(2, t.split("\n").length));

function FilaLinea({ linea, indice, total, asa, puedeEditar, precioHoy, onCambiar, onBorrar, onMover, onRecalcular }: FilaLineaProps) {
  const [descripcion, setDescripcion] = useState(linea.descripcion);
  const [detalle, setDetalle] = useState(linea.detalle ?? "");
  const [cantidad, setCantidad] = useState(numeroEditable(linea.cantidad));
  const [precio, setPrecio] = useState(numeroEditable(linea.precio_unitario));
  // Lo guardado manda cuando cambia (otra pestaña, recalcular, deshacer tras un error).
  useEffect(() => setDescripcion(linea.descripcion), [linea.descripcion]);
  useEffect(() => setDetalle(linea.detalle ?? ""), [linea.detalle]);
  useEffect(() => setCantidad(numeroEditable(linea.cantidad)), [linea.cantidad]);
  useEffect(() => setPrecio(numeroEditable(linea.precio_unitario)), [linea.precio_unitario]);

  const cantidadNum = leerNumero(cantidad);
  const precioNum = leerNumero(precio);
  const cantidadMal = cantidadNum == null || cantidadNum < 0;
  const precioMal = precioNum == null;
  const importe = importeLinea({ cantidad: cantidadMal ? linea.cantidad : (cantidadNum as number), precio_unitario: precioMal ? linea.precio_unitario : (precioNum as number) });
  const tarifaDistinta = precioHoy != null && linea.precio_calculado != null && Math.abs(redondear2(precioHoy - linea.precio_calculado)) >= 0.01;
  const nombre = linea.descripcion || `línea ${indice + 1}`;

  const guardarTexto = () => {
    const d = descripcion.trim();
    const cambios: CambiosLinea = {};
    if (!d) setDescripcion(linea.descripcion);
    else if (d !== linea.descripcion) cambios.descripcion = d.slice(0, 500);
    const det = detalle.trim() ? detalle.replace(/\s+$/, "").slice(0, 5000) : null;
    if (det !== (linea.detalle ?? null)) cambios.detalle = det;
    if (Object.keys(cambios).length) onCambiar(linea, cambios);
  };
  const guardarNumeros = () => {
    const cambios: CambiosLinea = {};
    if (cantidadMal) setCantidad(numeroEditable(linea.cantidad));
    else if (redondear2(cantidadNum as number) !== linea.cantidad) cambios.cantidad = redondear2(cantidadNum as number);
    if (precioMal) setPrecio(numeroEditable(linea.precio_unitario));
    else if (redondear2(precioNum as number) !== linea.precio_unitario) cambios.precio_unitario = redondear2(precioNum as number);
    if (Object.keys(cambios).length) onCambiar(linea, cambios);
  };

  return (
    <div className="rounded-lg border bg-card p-2 sm:p-3" data-testid="linea-presupuesto">
      <div className="flex gap-2">
        {asa && <div className="-ml-1 shrink-0">{asa}</div>}
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {linea.categoria ? (
                <span className="inline-flex items-center gap-1">
                  <Calculator className="h-3 w-3" aria-hidden="true" />
                  Calculadora
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <PenLine className="h-3 w-3" aria-hidden="true" />
                  Manual
                </span>
              )}
              {tarifaDistinta && (
                <button
                  type="button"
                  onClick={() => onRecalcular(linea)}
                  disabled={!puedeEditar}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 enabled:hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  title={`Al añadirla salía ${eurosCentimos(linea.precio_calculado)}; con las tarifas de hoy, ${eurosCentimos(precioHoy)}.`}
                  data-testid="tarifa-distinta"
                >
                  Tarifa de hoy: {eurosCentimos(precioHoy)}
                </button>
              )}
            </div>
            {puedeEditar ? (
              <>
                <Input
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  onBlur={guardarTexto}
                  maxLength={500}
                  aria-label={`Descripción de ${nombre}`}
                  className={cn("font-medium", !descripcion.trim() && "border-destructive")}
                />
                <Textarea
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  onBlur={guardarTexto}
                  maxLength={5000}
                  rows={filasTexto(detalle)}
                  placeholder="Detalle (opcional): medidas, materiales…"
                  aria-label={`Detalle de ${nombre}`}
                  className="min-h-0 resize-y text-xs text-muted-foreground"
                />
              </>
            ) : (
              <>
                <p className="font-medium">{linea.descripcion}</p>
                {linea.detalle && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{linea.detalle}</p>}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2 md:flex-col md:items-end md:justify-between">
            <div className="flex flex-wrap items-end gap-2">
              {puedeEditar ? (
                <>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span className="block">Cantidad</span>
                    <Input
                      value={cantidad}
                      onChange={(e) => setCantidad(e.target.value)}
                      onBlur={guardarNumeros}
                      inputMode="decimal"
                      aria-label={`Cantidad de ${nombre}`}
                      aria-invalid={cantidadMal}
                      className={cn("h-9 w-16 text-right tabular-nums sm:w-20", cantidadMal && "border-destructive")}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span className="block">Precio (€)</span>
                    <Input
                      value={precio}
                      onChange={(e) => setPrecio(e.target.value)}
                      onBlur={guardarNumeros}
                      inputMode="decimal"
                      aria-label={`Precio de ${nombre}`}
                      aria-invalid={precioMal}
                      className={cn("h-9 w-24 text-right tabular-nums sm:w-28", precioMal && "border-destructive")}
                    />
                  </label>
                </>
              ) : (
                <p className="text-sm tabular-nums text-muted-foreground">
                  {formatoCantidad(linea.cantidad)} × {eurosCentimos(linea.precio_unitario)}
                </p>
              )}
              <div className="text-right sm:min-w-24">
                <span className="block text-xs text-muted-foreground">Importe</span>
                <span className="block h-9 font-semibold leading-9 tabular-nums" data-testid="importe-linea">
                  {eurosCentimos(importe)}
                </span>
              </div>
            </div>
            {puedeEditar && (
              <div className="flex items-center">
                {linea.categoria && (
                  <Button variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={() => onRecalcular(linea)} aria-label={`Recalcular ${nombre}`}>
                    <Calculator className="h-4 w-4" aria-hidden="true" />
                    Recalcular
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-9 w-9" disabled={indice === 0} onClick={() => onMover(indice, indice - 1)} aria-label={`Subir ${nombre}`}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" disabled={indice === total - 1} onClick={() => onMover(indice, indice + 1)} aria-label={`Bajar ${nombre}`}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => onBorrar(linea)} aria-label={`Quitar ${nombre}`} title="Quitar la línea">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
