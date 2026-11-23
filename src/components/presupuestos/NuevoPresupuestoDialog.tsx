import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCrearPresupuesto } from "@/hooks/usePresupuestos";
import { condicionesPorDefecto } from "@/lib/presupuestos/documento";

const VALIDEZ_POR_DEFECTO = 30;

interface NuevoPresupuestoDialogProps {
  abierto: boolean;
  onCerrar: () => void;
  onCreado: (id: string) => void;
  /** Nota de los precios de la calculadora (Web › Tarifas), para las condiciones de siempre. */
  notaPrecio?: string;
}

/** «Nuevo presupuesto»: los datos del cliente (basta con el nombre); la base le da el número y se abre para rellenarlo. */
export function NuevoPresupuestoDialog({ abierto, onCerrar, onCreado, notaPrecio }: NuevoPresupuestoDialogProps) {
  const crear = useCrearPresupuesto();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [poblacion, setPoblacion] = useState("");

  useEffect(() => {
    if (!abierto) return;
    setNombre("");
    setTelefono("");
    setEmail("");
    setPoblacion("");
  }, [abierto]);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    crear.mutate(
      {
        cabecera: {
          cliente_nombre: nombre.trim(),
          cliente_telefono: telefono.trim() || null,
          cliente_email: email.trim() || null,
          cliente_poblacion: poblacion.trim() || null,
          validez_dias: VALIDEZ_POR_DEFECTO,
          condiciones: condicionesPorDefecto(notaPrecio, VALIDEZ_POR_DEFECTO),
        },
      },
      {
        onSuccess: ({ id }) => {
          onCerrar();
          onCreado(id);
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={enviar} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo presupuesto</DialogTitle>
            <DialogDescription>Basta con el nombre del cliente: el número lo pone el panel y el resto se rellena después.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nuevo-nombre">
              Cliente <span className="text-destructive">*</span>
            </Label>
            <Input id="nuevo-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} autoFocus required autoComplete="off" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-telefono">Teléfono</Label>
              <Input id="nuevo-telefono" type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-poblacion">Población</Label>
              <Input id="nuevo-poblacion" value={poblacion} onChange={(e) => setPoblacion(e.target.value)} maxLength={120} autoComplete="off" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nuevo-email">Correo</Label>
            <Input id="nuevo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="off" />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!nombre.trim() || crear.isPending} className="gap-1.5">
              {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Crear y abrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
