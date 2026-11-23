import { useId, type ReactNode } from "react";
import { ChevronRight, FilterX, SearchX, Truck } from "lucide-react";
import { formatDateCorta, formatImporte, plural } from "@/components/facturas/shared/formatters";
import type { Proveedor } from "@/lib/facturas/proveedores";
import type { AgregadoProveedor, DocumentoAgregable } from "@/lib/facturas/resumenCompras";
import { EstadoVacio, FOCO, Hueso, Marca, filaEstado } from "./estilo";

/**
 * Compras › Proveedores: lista a todo el ancho, una fila por proveedor
 * canónico, ordenada por GASTO con IVA (abonos restando), con el periodo
 * elegido. Al tocar un proveedor se DESPLIEGA ahí
 * mismo (acordeón: uno abierto a la vez) con `despliegue`; otro toque lo pliega.
 * Misma fila que Documentos: nombre arriba, datos en gris debajo, importe a la derecha.
 */
export function ListaProveedores({
  proveedores,
  agregados,
  abiertoId,
  cargando,
  hayFiltros,
  onAlternar,
  despliegue,
  onQuitarFiltros,
  fueraDeFiltros = null,
}: {
  /** Ya filtrados y ordenados. */
  proveedores: Proveedor[];
  /** Lo de cada proveedor (clave `#id`) con el periodo elegido. */
  agregados: Map<string, AgregadoProveedor<DocumentoAgregable>>;
  abiertoId: number | null;
  cargando: boolean;
  hayFiltros: boolean;
  onAlternar: (id: number) => void;
  /** El contenido del proveedor desplegado. */
  despliegue: (p: Proveedor) => ReactNode;
  /** «Quitar filtros» en la lista vacía. */
  onQuitarFiltros?: () => void;
  /**
   * El proveedor abierto que se enseña AUNQUE los filtros (texto, periodo) lo
   * dejarían fuera: se rotula «Fuera de los filtros».
   */
  fueraDeFiltros?: number | null;
}) {
  const idBase = useId();
  if (cargando) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">Cargando proveedores…</span>
        <ul className="divide-y divide-border/50" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <Hueso className="h-4 w-4" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Hueso className={`h-3.5 ${i % 2 ? "w-1/3" : "w-1/2"}`} />
                <Hueso className="h-3 w-1/4" />
              </div>
              <Hueso className="h-3.5 w-20" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (proveedores.length === 0) {
    return hayFiltros ? (
      <EstadoVacio
        icono={<SearchX />}
        titulo="Ningún proveedor coincide"
        texto="Prueba con otro nombre o quita el periodo."
        accion={onQuitarFiltros ? { etiqueta: "Quitar filtros", onClick: onQuitarFiltros } : undefined}
      />
    ) : (
      <EstadoVacio icono={<Truck />} titulo="No hay proveedores todavía" texto="Se crean solos al subir facturas." />
    );
  }
  return (
    <ul className="divide-y divide-border/50" aria-label="Proveedores" data-testid="lista-proveedores-compras">
      {proveedores.map((p) => {
        const a = agregados.get(`#${p.id}`);
        const abierto = abiertoId === p.id;
        const docs = a?.documentos.length ?? 0;
        const ultima = a?.ultimaFecha ?? (hayFiltros ? null : p.ultima_fecha);
        const idDespliegue = `${idBase}-${p.id}`;
        return (
          <li key={p.id} data-proveedor-id={p.id}>
            <h3 className={`m-0 text-base font-normal ${abierto ? "sticky top-0 z-10 bg-card" : ""}`}>
              <button
                type="button"
                onClick={() => onAlternar(p.id)}
                aria-expanded={abierto}
                aria-controls={abierto ? idDespliegue : undefined}
                className={`flex min-h-14 w-full items-center gap-2.5 px-3 py-2 text-left active:bg-muted/50 ${filaEstado(abierto)} ${abierto ? "border-b border-border/60" : ""} ${FOCO}`}
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${abierto ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{p.nombre}</span>
                  <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap tabular-nums">
                      {plural(docs, "documento", "documentos")}
                      {ultima ? ` · último ${formatDateCorta(ultima)}` : ""}
                    </span>
                    {fueraDeFiltros === p.id && (
                      <Marca tono="neutro" icono={<FilterX aria-hidden="true" />}>
                        Fuera de los filtros
                      </Marca>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  <span className="text-sm font-semibold tabular-nums">{formatImporte(a?.gasto ?? 0)}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="sr-only"> </span>con IVA
                  </span>
                </span>
              </button>
            </h3>
            {abierto && <div id={idDespliegue}>{despliegue(p)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
