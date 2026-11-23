import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plegable } from "@/components/panel/Plegable";
import { NumeroDiferido, TextoDiferido } from "@/components/web/CamposDiferidos";
import { TablaOpciones } from "@/components/web/tarifas/TablaOpciones";
import { categories, type FieldDef } from "@/lib/web/pricing/categories";
import {
  cambiarActivoCampo,
  cambiarActivoCategoria,
  cambiarTextoCampo,
  cambiarTextoCategoria,
  categoriaPorDefecto,
  escribirRuta,
  leerPrecio,
  opcionesEditables,
  precioDeCampo,
  preciosSueltos,
  restaurarCategoria,
  tieneOpciones,
  type EstadoTarifas,
  type IdCategoria,
  type PrecioSuelto,
} from "@/lib/web/tarifasEditor";

const TIPO_CAMPO: Record<FieldDef["kind"], string> = {
  number: "Número",
  chips: "Botones (una opción)",
  select: "Desplegable",
  multi: "Varias opciones",
  toggle: "Sí / no",
  text: "Texto",
  textarea: "Texto largo",
};

export function PrecioSueltoInput({
  p,
  estado,
  onCambiar,
  puedeEditar,
}: {
  p: PrecioSuelto;
  estado: EstadoTarifas;
  onCambiar: (e: EstadoTarifas) => void;
  puedeEditar: boolean;
}) {
  const id = `precio-${p.ruta.join("-")}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">
        {p.etiqueta}
      </Label>
      <NumeroDiferido
        id={id}
        valor={leerPrecio(estado.config, p.ruta)}
        disabled={!puedeEditar}
        sufijo={p.unidad}
        onConfirmar={(v) => onCambiar({ ...estado, config: escribirRuta(estado.config, p.ruta, v) })}
      />
      {(p.ayuda || p.ceroSeValora) && (
        <p className="text-xs text-muted-foreground">
          {[p.ayuda, p.ceroSeValora && "0 € = «se valora en la visita»."].filter(Boolean).join(" ")}
        </p>
      )}
    </div>
  );
}

interface EditorCategoriaProps {
  cat: IdCategoria;
  estado: EstadoTarifas;
  onCambiar: (e: EstadoTarifas) => void;
  puedeEditar: boolean;
}

/** Una categoría de la calculadora: si sale en la web, sus textos, sus precios y cada campo con sus opciones. */
export function EditorCategoria({ cat, estado, onCambiar, puedeEditar }: EditorCategoriaProps) {
  const def = categories[cat];
  const catalogo = estado.catalogo.categorias?.[cat];
  const activa = catalogo?.activo !== false;
  const conCatalogo = (c: EstadoTarifas["catalogo"]) => onCambiar({ ...estado, catalogo: c });
  const porDefecto = categoriaPorDefecto(estado, cat);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{catalogo?.nombre || def.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Servicio de la web: /servicios/{def.service} · id <code>{cat}</code>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={activa} disabled={!puedeEditar} onCheckedChange={(v) => conCatalogo(cambiarActivoCategoria(estado.catalogo, cat, v))} />
              {activa ? "Sale en la calculadora" : "Oculta en la web"}
            </label>
            {puedeEditar && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1" disabled={porDefecto}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Restaurar valores por defecto
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Restaurar «{def.name}»?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Sus precios, textos y opciones vuelven a los que trae la web de serie (las opciones nuevas se quitan). Las demás
                      categorías no cambian. No se guarda hasta que pulses «Guardar».
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onCambiar(restaurarCategoria(estado, cat))}>Restaurar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`cat-nombre-${cat}`}>Nombre en la calculadora</Label>
            <TextoDiferido
              id={`cat-nombre-${cat}`}
              valor={catalogo?.nombre ?? ""}
              placeholder={def.name}
              maxLength={80}
              disabled={!puedeEditar}
              onConfirmar={(v) => conCatalogo(cambiarTextoCategoria(estado.catalogo, cat, "nombre", v))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`cat-short-${cat}`}>Descripción corta</Label>
            <TextoDiferido
              id={`cat-short-${cat}`}
              valor={catalogo?.short ?? ""}
              placeholder={def.short}
              maxLength={120}
              disabled={!puedeEditar}
              onConfirmar={(v) => conCatalogo(cambiarTextoCategoria(estado.catalogo, cat, "short", v))}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Vacío = el de la web (el texto gris).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Precios de la categoría</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {preciosSueltos(cat, estado.config).map((p) => (
            <PrecioSueltoInput key={p.ruta.join(".")} p={p} estado={estado} onCambiar={onCambiar} puedeEditar={puedeEditar} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-base">Campos y opciones</CardTitle>
          <p className="text-xs text-muted-foreground">
            Cambia cómo se llama cada campo, su ayuda, si se pregunta y sus opciones (las «formas», acabados…). Los obligatorios no se
            pueden ocultar.
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {def.sections.map((seccion) => (
            <div key={seccion.title} className="pt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{seccion.title}</h4>
              {seccion.fields.map((campo) => {
                const cc = catalogo?.campos?.[campo.id];
                const visible = cc?.activo !== false;
                const opciones = tieneOpciones(campo) ? opcionesEditables(estado.catalogo, cat, campo) : [];
                const precio = precioDeCampo(cat, campo, estado.config);
                const resumen = [
                  TIPO_CAMPO[campo.kind],
                  opciones.length ? `${opciones.filter((o) => o.activo).length} opciones` : null,
                  precio ? (precio.tipo === "factor" ? "con multiplicador" : "con precio") : null,
                  !visible ? "oculto" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Plegable
                    key={campo.id}
                    titulo={
                      <span className="flex items-center gap-2">
                        <span className={visible ? "" : "text-muted-foreground line-through"}>{cc?.label || campo.label}</span>
                        {campo.required && <Badge variant="outline">Obligatorio</Badge>}
                      </span>
                    }
                    resumen={resumen}
                  >
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <div className="space-y-1">
                          <Label htmlFor={`campo-label-${cat}-${campo.id}`}>Pregunta</Label>
                          <TextoDiferido
                            id={`campo-label-${cat}-${campo.id}`}
                            valor={cc?.label ?? ""}
                            placeholder={campo.label}
                            maxLength={80}
                            disabled={!puedeEditar}
                            onConfirmar={(v) => conCatalogo(cambiarTextoCampo(estado.catalogo, cat, campo.id, "label", v))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`campo-hint-${cat}-${campo.id}`}>Ayuda</Label>
                          <TextoDiferido
                            id={`campo-hint-${cat}-${campo.id}`}
                            valor={cc?.hint ?? campo.hint ?? ""}
                            placeholder="Sin ayuda"
                            maxLength={300}
                            disabled={!puedeEditar}
                            onConfirmar={(v) => conCatalogo(cambiarTextoCampo(estado.catalogo, cat, campo.id, "hint", v))}
                          />
                        </div>
                        <label className="flex items-center gap-2 pb-2 text-sm" title={campo.required ? "Es obligatorio: no se puede ocultar" : undefined}>
                          <Switch
                            checked={visible}
                            disabled={!puedeEditar || !!campo.required}
                            onCheckedChange={(v) => conCatalogo(cambiarActivoCampo(estado.catalogo, cat, campo.id, v))}
                          />
                          Se pregunta
                        </label>
                      </div>
                      {campo.kind === "number" && (
                        <p className="text-xs text-muted-foreground">
                          Número en {campo.unit ?? "unidades"}, de {campo.min} a {campo.max}.
                        </p>
                      )}
                      {tieneOpciones(campo) && <TablaOpciones cat={cat} campo={campo} estado={estado} onCambiar={onCambiar} puedeEditar={puedeEditar} />}
                    </div>
                  </Plegable>
                );
              })}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
