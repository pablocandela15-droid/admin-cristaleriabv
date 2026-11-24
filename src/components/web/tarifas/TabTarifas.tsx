import { useEffect, useMemo, useRef, useState } from "react";
import { Info, Loader2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { TextoDiferido } from "@/components/web/CamposDiferidos";
import { EditorCategoria, PrecioSueltoInput } from "@/components/web/tarifas/EditorCategoria";
import { ProbarCalculadora } from "@/components/web/tarifas/ProbarCalculadora";
import { useGuardarTarifas, useTarifasWeb } from "@/hooks/useWebTarifas";
import { categories } from "@/lib/web/pricing/categories";
import { DEFAULT_PRICING } from "@/lib/web/pricing/config";
import { cn } from "@/lib/utils";
import {
  IDS_CATEGORIAS,
  PRECIOS_ENTREGA,
  categoriaPorDefecto,
  mismoEstado,
  preciosNoValidos,
  type EstadoTarifas,
  type IdCategoria,
} from "@/lib/web/tarifasEditor";

/**
 * Web › Tarifas: precios y opciones de la calculadora de presupuestos de la web (fila web_tarifas). Se edita en
 * pantalla, se prueba en «Probar» y se guarda todo de una vez. La web lo usa en un minuto.
 */
export function TabTarifas({ puedeEditar }: { puedeEditar: boolean }) {
  const { data, isLoading, error, refetch } = useTarifasWeb();
  const guardar = useGuardarTarifas();
  const [estado, setEstado] = useState<EstadoTarifas | null>(null);
  const [cat, setCat] = useState<IdCategoria>("mamparas");
  const [catProbar, setCatProbar] = useState<IdCategoria>("mamparas");

  const guardado = useMemo<EstadoTarifas | null>(() => (data ? { config: data.config, catalogo: data.catalogo } : null), [data]);
  // Lo guardado entra en el editor al cargar y cuando cambia, salvo que haya cambios a medias (una relectura al volver
  // a la ventana no se los come).
  const anterior = useRef<EstadoTarifas | null>(null);
  useEffect(() => {
    if (!guardado) return;
    setEstado((actual) => (!actual || !anterior.current || mismoEstado(actual, anterior.current) ? guardado : actual));
    anterior.current = guardado;
  }, [guardado]);
  const cambios = !!estado && !!guardado && !mismoEstado(estado, guardado);
  const errores = estado ? preciosNoValidos(estado) : [];

  // Avisar antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!cambios) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [cambios]);

  if (error) return <EstadoErrorCarga titulo="las tarifas de la web" error={error} onReintentar={() => refetch()} />;
  if (isLoading || !estado) {
    return (
      <div className="flex justify-center py-10" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Cargando tarifas…</span>
      </div>
    );
  }

  const elegirCat = (c: IdCategoria) => {
    setCat(c);
    setCatProbar(c);
  };

  return (
    <div className="space-y-4 pb-20">
      <Card className="border-marca-claro/60 bg-marca-niebla/40 dark:bg-muted/30">
        <CardContent className="flex gap-3 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <p>
              <strong>Multiplicador</strong> (×): multiplica el precio por m² de la categoría. <strong>1 = sin recargo</strong>; 1,2 = un 20 % más.
            </p>
            <p>
              <strong>Suplemento en €</strong>: se suma por pieza. En los extras, <strong>0 € = «se valora en la visita»</strong> (el cliente lo ve
              así y no suma nada); en el resto, 0 € = sin recargo.
            </p>
            <p>
              <strong>Todos los precios llevan el IVA incluido</strong>: son lo que paga el cliente. En Presupuestos, la línea se guarda sin IVA y el
              total con IVA es el de la calculadora.
            </p>
            <p className="text-muted-foreground">Prueba los cambios a la derecha (o abajo) antes de guardar. La web los usa en un minuto.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Categorías de la calculadora">
        {IDS_CATEGORIAS.map((id) => {
          const oculta = estado.catalogo.categorias?.[id]?.activo === false;
          const cambiada = !categoriaPorDefecto(estado, id);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={cat === id}
              onClick={() => elegirCat(id)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors pointer-coarse:min-h-11",
                cat === id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                oculta && cat !== id && "text-muted-foreground line-through",
              )}
            >
              {estado.catalogo.categorias?.[id]?.nombre || categories[id].name}
              {cambiada && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-label="con cambios respecto a la web de serie" />}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <EditorCategoria cat={cat} estado={estado} onCambiar={setEstado} puedeEditar={puedeEditar} />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Para todas las categorías</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="nota-precio">Nota que acompaña siempre al precio</Label>
                <TextoDiferido
                  id="nota-precio"
                  valor={estado.config.priceNote}
                  placeholder={DEFAULT_PRICING.priceNote}
                  maxLength={300}
                  disabled={!puedeEditar}
                  onConfirmar={(v) => setEstado({ ...estado, config: { ...estado.config, priceNote: v.trim() || DEFAULT_PRICING.priceNote } })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {PRECIOS_ENTREGA.map((p) => (
                  <PrecioSueltoInput key={p.ruta.join(".")} p={p} estado={estado} onCambiar={setEstado} puedeEditar={puedeEditar} />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="min-w-0 xl:sticky xl:top-2 xl:self-start">
          <ProbarCalculadora estado={estado} cat={catProbar} onCambiarCat={setCatProbar} />
        </div>
      </div>

      {puedeEditar && (cambios || guardar.isPending) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
            <p className={cn("mr-auto text-sm", errores.length ? "text-destructive" : "text-muted-foreground")} role="status">
              {errores.length ? `Hay ${errores.length} precio(s) no válido(s) (vacíos, negativos o un multiplicador 0).` : "Tienes cambios sin guardar."}
            </p>
            <Button variant="outline" onClick={() => guardado && setEstado(guardado)} disabled={guardar.isPending} className="gap-1">
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Descartar
            </Button>
            <Button onClick={() => guardar.mutate(estado)} disabled={guardar.isPending || errores.length > 0} className="gap-1">
              {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Guardar tarifas
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
