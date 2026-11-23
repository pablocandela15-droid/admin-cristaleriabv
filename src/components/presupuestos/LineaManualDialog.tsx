import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { eurosCentimos, importeLinea, leerNumero, redondear2 } from "@/lib/presupuestos/totales";
import type { LineaNueva } from "@/lib/presupuestos/tipos";

interface LineaManualDialogProps {
  abierto: boolean;
  guardando?: boolean;
  onAnadir: (linea: LineaNueva) => void;
  onCerrar: () => void;
}

/** «Línea manual»: concepto, detalle, cantidad y precio, sin calculadora (desplazamiento, retirar un cristal…). */
export function LineaManualDialog({ abierto, guardando, onAnadir, onCerrar }: LineaManualDialogProps) {
  const [descripcion, setDescripcion] = useState("");
  const [detalle, setDetalle] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");

  useEffect(() => {
    if (!abierto) return;
    setDescripcion("");
    setDetalle("");
    setCantidad("1");
    setPrecio("");
  }, [abierto]);

  const cantidadNum = leerNumero(cantidad);
  const precioNum = leerNumero(precio);
  const valido = !!descripcion.trim() && cantidadNum != null && cantidadNum >= 0 && precioNum != null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    onAnadir({
      categoria: null,
      valores: null,
      descripcion: descripcion.trim(),
      detalle: detalle.trim() || null,
      cantidad: redondear2(cantidadNum as number),
      precio_unitario: redondear2(precioNum as number),
      precio_calculado: null,
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={enviar} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Línea manual</DialogTitle>
            <DialogDescription>Un concepto sin calculadora: desplazamiento, retirada de un cristal, un herraje suelto…</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="manual-descripcion">
              Concepto <span className="text-destructive">*</span>
            </Label>
            <Input id="manual-descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} autoFocus required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-detalle">Detalle</Label>
            <Textarea id="manual-detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={5000} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-cantidad">Cantidad</Label>
              <Input id="manual-cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" className="text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-precio">Precio unitario (€)</Label>
              <Input id="manual-precio" value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0,00" className="text-right tabular-nums" />
            </div>
          </div>
          <p className="text-right text-sm text-muted-foreground">
            Importe:{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {valido ? eurosCentimos(importeLinea({ cantidad: cantidadNum as number, precio_unitario: precioNum as number })) : "—"}
            </span>
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valido || guardando} className="gap-1.5">
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Añadir línea
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
