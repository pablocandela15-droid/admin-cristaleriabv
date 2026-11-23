import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NumeroDiferido, TextoDiferido } from "@/components/web/CamposDiferidos";
import {
  anadirOpcion,
  cambiarOpcion,
  escribirRuta,
  explicacionPrecio,
  leerPrecio,
  moverOpcion,
  opcionConPrecio,
  opcionesEditables,
  precioDeCampo,
  precioInicial,
  quitarOpcion,
  type CampoConOpciones,
  type EstadoTarifas,
  type IdCategoria,
  type PrecioDeOpciones,
} from "@/lib/web/tarifasEditor";

const prefijoSufijo = (p: PrecioDeOpciones) =>
  p.tipo === "factor" ? { prefijo: "×" } : p.tipo === "eurosM2" ? { sufijo: "€/m²" } : { sufijo: "€" };

interface TablaOpcionesProps {
  cat: IdCategoria;
  campo: CampoConOpciones;
  estado: EstadoTarifas;
  onCambiar: (e: EstadoTarifas) => void;
  puedeEditar: boolean;
}

/**
 * Opciones de un campo (chips, desplegable o varias): orden, nombre, ayuda, si se ve y, si el campo tiene tabla de
 * precios, el precio de cada opción. Las del código se ocultan (no se borran); las nuevas se pueden borrar.
 */
export function TablaOpciones({ cat, campo, estado, onCambiar, puedeEditar }: TablaOpcionesProps) {
  const opciones = opcionesEditables(estado.catalogo, cat, campo);
  const precio = precioDeCampo(cat, campo, estado.config);
  const [nueva, setNueva] = useState("");
  const [precioNueva, setPrecioNueva] = useState<number | undefined>(undefined);
  const visibles = opciones.filter((o) => o.activo).length;

  const conCatalogo = (catalogo: EstadoTarifas["catalogo"]) => onCambiar({ ...estado, catalogo });
  const anadir = () => {
    if (!nueva.trim()) return;
    onCambiar(anadirOpcion(estado, cat, campo, nueva, precioNueva ?? precioInicial(precio)).estado);
    setNueva("");
    setPrecioNueva(undefined);
  };
  const precioNuevaConTabla = precio && !precio.soloValores;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {precio ? explicacionPrecio(precio) : "Estas opciones no cambian el precio: son para que sepáis qué quiere el cliente."}
        {precio?.soloValores && " Las opciones nuevas de este campo no tienen precio automático (se valoran en la visita)."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-16 py-1 font-medium">Orden</th>
              <th className="py-1 font-medium">Nombre</th>
              <th className="py-1 font-medium">Ayuda (opcional)</th>
              <th className="w-16 py-1 font-medium">Se ve</th>
              {precio && <th className="w-36 py-1 font-medium">{precio.tipo === "factor" ? "Multiplicador" : "Precio"}</th>}
              <th className="w-10 py-1" aria-label="Borrar" />
            </tr>
          </thead>
          <tbody>
            {opciones.map((o, i) => {
              const conPrecio = opcionConPrecio(precio, o.value);
              const ruta = precio ? [...precio.ruta, o.value] : [];
              return (
                <tr key={o.value} className={o.activo ? "" : "text-muted-foreground"}>
                  <td className="py-1">
                    <div className="flex">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!puedeEditar || i === 0} onClick={() => conCatalogo(moverOpcion(estado.catalogo, cat, campo, i, i - 1))} aria-label={`Subir ${o.label}`}>
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!puedeEditar || i === opciones.length - 1} onClick={() => conCatalogo(moverOpcion(estado.catalogo, cat, campo, i, i + 1))} aria-label={`Bajar ${o.label}`}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <TextoDiferido
                        valor={o.label}
                        disabled={!puedeEditar}
                        maxLength={80}
                        aria-label={`Nombre de la opción ${o.value}`}
                        onConfirmar={(v) => conCatalogo(cambiarOpcion(estado.catalogo, cat, campo, o.value, { label: v.trim() || o.label }))}
                        className="h-8"
                      />
                      {o.nueva && <Badge variant="secondary" className="shrink-0">Nueva</Badge>}
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <TextoDiferido
                      valor={o.hint}
                      disabled={!puedeEditar}
                      maxLength={120}
                      aria-label={`Ayuda de la opción ${o.label}`}
                      onConfirmar={(v) => conCatalogo(cambiarOpcion(estado.catalogo, cat, campo, o.value, { hint: v }))}
                      className="h-8"
                    />
                  </td>
                  <td className="py-1">
                    <Switch
                      checked={o.activo}
                      disabled={!puedeEditar || (o.activo && visibles <= 1)}
                      onCheckedChange={(v) => conCatalogo(cambiarOpcion(estado.catalogo, cat, campo, o.value, { activo: v }))}
                      aria-label={`${o.label}: se ve en la web`}
                      title={o.activo && visibles <= 1 ? "Tiene que quedar al menos una opción" : undefined}
                    />
                  </td>
                  {precio && (
                    <td className="py-1">
                      {conPrecio ? (
                        <NumeroDiferido
                          valor={leerPrecio(estado.config, ruta)}
                          disabled={!puedeEditar}
                          mayorQueCero={precio.tipo === "factor"}
                          onConfirmar={(v) => onCambiar({ ...estado, config: escribirRuta(estado.config, ruta, v) })}
                          aria-label={`Precio de ${o.label}`}
                          {...prefijoSufijo(precio)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">Se valora en la visita</span>
                      )}
                    </td>
                  )}
                  <td className="py-1">
                    {o.nueva && puedeEditar && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onCambiar(quitarOpcion(estado, cat, campo, o.value))} aria-label={`Borrar la opción ${o.label}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={nueva}
            maxLength={80}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), anadir())}
            placeholder="Nueva opción (p. ej. Hexagonal)"
            className="h-8 w-60"
            aria-label={`Nueva opción de ${campo.label}`}
          />
          {precioNuevaConTabla && (
            <NumeroDiferido
              valor={precioNueva ?? precioInicial(precio)}
              mayorQueCero={precio.tipo === "factor"}
              onConfirmar={setPrecioNueva}
              aria-label="Precio de la opción nueva"
              {...prefijoSufijo(precio)}
            />
          )}
          <Button size="sm" variant="outline" onClick={anadir} disabled={!nueva.trim()} className="gap-1">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Añadir opción
          </Button>
        </div>
      )}
    </div>
  );
}
