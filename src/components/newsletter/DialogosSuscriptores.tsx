import { useState } from "react";
import { FileUp, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAltaSuscriptor, useEnviarConfirmaciones, useImportarSuscriptores } from "@/hooks/useNewsletter";
import { leerCsv, type LecturaCsv } from "@/lib/newsletter/suscriptores";

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Nota común: el consentimiento queda apuntado y la persona se activa sola al confirmar desde su correo. */
function NotaDobleOptIn({ puedeEnviar }: { puedeEnviar: boolean }) {
  return (
    <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
      Queda <strong>pendiente de confirmar</strong>: no recibe ninguna newsletter hasta que pulse el enlace del correo de
      confirmación (doble opt-in, como exige la ley).{" "}
      {puedeEnviar ? "El correo de confirmación se le manda al guardar." : "El correo de confirmación se podrá mandar cuando esté configurado el envío."}
    </p>
  );
}

/**
 * Alta manual (Newsletter › Suscriptores › Añadir): email, nombre y CÓMO dio su consentimiento (queda apuntado, con
 * quién lo registra). Exige marcar que la persona lo ha aceptado. Una baja no se reabre desde aquí.
 */
export function DialogoAltaSuscriptor({ abierto, onAbiertoChange, puedeEnviar }: { abierto: boolean; onAbiertoChange: (v: boolean) => void; puedeEnviar: boolean }) {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [detalle, setDetalle] = useState("");
  const [acepta, setAcepta] = useState(false);
  const alta = useAltaSuscriptor();
  const confirmaciones = useEnviarConfirmaciones();
  const valido = EMAIL.test(email.trim()) && detalle.trim().length >= 5 && acepta;

  const cerrar = () => {
    setEmail("");
    setNombre("");
    setDetalle("");
    setAcepta(false);
    onAbiertoChange(false);
  };

  const guardar = () => {
    if (!valido) return;
    alta.mutate(
      { email: email.trim(), nombre: nombre.trim(), detalle: detalle.trim() },
      {
        onSuccess: (r) => {
          if (r.accion === "creado" || r.accion === "ya_pendiente") {
            toast.success(r.accion === "creado" ? "Suscriptor añadido, pendiente de confirmar." : "Ya estaba apuntado, pendiente de confirmar.");
            if (puedeEnviar && r.id) confirmaciones.mutate([r.id]);
            cerrar();
          } else if (r.accion === "ya_activo") {
            toast.info("Ya está suscrito y confirmado.");
            cerrar();
          } else if (r.accion === "baja_previa") {
            toast.error("Se dio de baja antes: solo puede volver apuntándose él mismo en la web.");
          } else {
            toast.error("El correo electrónico no es válido.");
          }
        },
        onError: (e: Error) => toast.error(`No se pudo añadir. ${e.message}`),
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !alta.isPending && (v ? onAbiertoChange(true) : cerrar())}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Añadir suscriptor</DialogTitle>
          <DialogDescription>Solo personas que te hayan pedido recibir las novedades (en la tienda, por escrito, por teléfono…).</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="alta-email">Correo electrónico</Label>
            <Input id="alta-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" placeholder="nombre@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-nombre">Nombre (opcional)</Label>
            <Input id="alta-nombre" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-detalle">Cómo dio su consentimiento</Label>
            <Textarea id="alta-detalle" value={detalle} maxLength={500} rows={2} onChange={(e) => setDetalle(e.target.value)}
              placeholder="Ej.: Lo pidió en la tienda al recoger su mampara y firmó la hoja de pedido." />
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox checked={acepta} onCheckedChange={(v) => setAcepta(v === true)} className="mt-0.5" aria-label="Confirmo que esta persona ha aceptado recibir las novedades por correo" />
            <span>Confirmo que esta persona ha aceptado recibir las novedades por correo.</span>
          </label>
          <NotaDobleOptIn puedeEnviar={puedeEnviar} />
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={cerrar} disabled={alta.isPending}>Cancelar</Button>
          <Button className="h-11" onClick={guardar} disabled={!valido || alta.isPending}>
            {alta.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Añadir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Importar un CSV (una columna de email y, si quieres, otra de nombre). Todos quedan pendientes de confirmar, con el
 * consentimiento apuntado para el lote. Como mucho 2000 filas.
 */
export function DialogoImportarCsv({ abierto, onAbiertoChange, puedeEnviar }: { abierto: boolean; onAbiertoChange: (v: boolean) => void; puedeEnviar: boolean }) {
  const [lectura, setLectura] = useState<LecturaCsv | null>(null);
  const [nombreFichero, setNombreFichero] = useState("");
  const [detalle, setDetalle] = useState("");
  const [acepta, setAcepta] = useState(false);
  const importar = useImportarSuscriptores();
  const confirmaciones = useEnviarConfirmaciones();
  const valido = !!lectura?.filas.length && detalle.trim().length >= 5 && acepta;

  const cerrar = () => {
    setLectura(null);
    setNombreFichero("");
    setDetalle("");
    setAcepta(false);
    onAbiertoChange(false);
  };

  const leer = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      toast.error("El fichero es demasiado grande (máximo 2 MB).");
      return;
    }
    setNombreFichero(f.name);
    setLectura(leerCsv(await f.text()));
  };

  const guardar = () => {
    if (!valido || !lectura) return;
    importar.mutate(
      { filas: lectura.filas, detalle: detalle.trim() },
      {
        onSuccess: (r) => {
          toast.success(`Importación hecha: ${r.creados} nuevos (pendientes de confirmar), ${r.ya_pendientes + r.ya_activos} ya estaban, ${r.bajas_previas} se dieron de baja antes (no se reabren) y ${r.invalidos} no válidos.`);
          if (puedeEnviar && r.creados > 0) confirmaciones.mutate(null);
          cerrar();
        },
        onError: (e: Error) => toast.error(`No se pudo importar. ${e.message}`),
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !importar.isPending && (v ? onAbiertoChange(true) : cerrar())}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar suscriptores (CSV)</DialogTitle>
          <DialogDescription>Un fichero con una columna «email» (y, si quieres, «nombre»). Solo personas que hayan aceptado recibir las novedades.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="importar-fichero">Fichero CSV</Label>
            <Input id="importar-fichero" type="file" accept=".csv,text/csv,text/plain" className="h-11" onChange={(e) => void leer(e.target.files?.[0])} />
          </div>
          {lectura && (
            <p className="text-sm" role="status" data-testid="importar-resumen">
              {nombreFichero}: <strong>{lectura.filas.length}</strong> correos válidos
              {lectura.duplicadas ? `, ${lectura.duplicadas} repetidos` : ""}
              {lectura.invalidas.length ? `, ${lectura.invalidas.length} no válidos (líneas ${lectura.invalidas.slice(0, 8).join(", ")}${lectura.invalidas.length > 8 ? "…" : ""})` : ""}.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="importar-detalle">Cómo dieron su consentimiento</Label>
            <Textarea id="importar-detalle" value={detalle} maxLength={500} rows={2} onChange={(e) => setDetalle(e.target.value)}
              placeholder="Ej.: Clientes que marcaron la casilla de novedades en la hoja de pedido (2025-2026)." />
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox checked={acepta} onCheckedChange={(v) => setAcepta(v === true)} className="mt-0.5" aria-label="Confirmo que todas estas personas han aceptado recibir las novedades por correo" />
            <span>Confirmo que todas estas personas han aceptado recibir las novedades por correo.</span>
          </label>
          <NotaDobleOptIn puedeEnviar={puedeEnviar} />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={cerrar} disabled={importar.isPending}>Cancelar</Button>
          <Button className="h-11" onClick={guardar} disabled={!valido || importar.isPending}>
            {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            Importar {lectura?.filas.length ? lectura.filas.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
