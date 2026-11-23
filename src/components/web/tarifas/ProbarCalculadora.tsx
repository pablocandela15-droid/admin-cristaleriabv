import { useMemo } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalculadoraCampos, ResultadoCalculo } from "@/components/web/CalculadoraCampos";
import { useCalculadora } from "@/hooks/useCalculadora";
import { categories } from "@/lib/web/pricing/categories";
import { resolverTarifas } from "@/lib/web/pricing/tarifas";
import { IDS_CATEGORIAS, type EstadoTarifas, type IdCategoria } from "@/lib/web/tarifasEditor";

interface ProbarCalculadoraProps {
  /** Precios y catálogo tal como están en el editor (sin guardar). */
  estado: EstadoTarifas;
  cat: IdCategoria;
  onCambiarCat: (c: IdCategoria) => void;
}

/** «Probar»: la calculadora de la web con los precios y opciones del editor, aunque aún no se hayan guardado. */
export function ProbarCalculadora({ estado, cat, onCambiarCat }: ProbarCalculadoraProps) {
  const { categorias, precios } = useMemo(() => resolverTarifas(categories, estado), [estado]);
  const calc = useCalculadora(categorias, precios, cat);
  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Probar
          </CardTitle>
          <Button variant="ghost" size="sm" className="gap-1" onClick={calc.reiniciar}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Vaciar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Como la calculadora de la web, con lo que tienes en pantalla (también sin guardar).</p>
        <Select value={cat} onValueChange={(v) => onCambiarCat(v as IdCategoria)}>
          <SelectTrigger aria-label="Categoría que se prueba">
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
      </CardHeader>
      <CardContent className="space-y-4">
        <ResultadoCalculo presupuesto={calc.presupuesto} nota={precios.priceNote} />
        <CalculadoraCampos categoria={calc.categoria} valores={calc.valores} onCambiar={calc.cambiar} />
      </CardContent>
    </Card>
  );
}
