import { useMemo, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Inbox, Loader2, MessageSquareQuote, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { EtiquetasPresupuesto } from "@/components/presupuestos/Etiquetas";
import { NuevoPresupuestoDialog } from "@/components/presupuestos/NuevoPresupuestoDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCambiarEstado, usePresupuestos, type PresupuestoLista } from "@/hooks/usePresupuestos";
import { useTarifasCalculadora } from "@/hooks/useTarifasCalculadora";
import { condicionesPorDefecto } from "@/lib/presupuestos/documento";
import { ESTADOS_PRESUPUESTO, fechaCorta, hoyIso } from "@/lib/presupuestos/estados";
import { contarPorEstado, filtrarPresupuestos, type FiltroEstado } from "@/lib/presupuestos/filtros";
import { eurosCentimos } from "@/lib/presupuestos/totales";

interface ListaPresupuestosProps {
  puedeEditar: boolean;
  /** Mientras se leen los permisos no se enseña «Solo lectura». */
  cargandoPermisos?: boolean;
  onAbrir: (id: string) => void;
  estado: FiltroEstado;
  onEstado: (estado: FiltroEstado) => void;
  busqueda: string;
  onBusqueda: (q: string) => void;
}

/**
 * Presupuestos › lista: número, cliente, fecha, estado (y «Caducado», y «Web» si llegó de la calculadora) y total.
 * Filtro por estado con las solicitudes pendientes contadas, búsqueda por número, cliente o teléfono y «Nuevo
 * presupuesto». Las solicitudes de la web enseñan lo que escribió el cliente y el precio que vio, y se convierten en
 * borrador con un clic. Tabla en pantallas anchas; tarjetas en el móvil.
 */
export function ListaPresupuestos({ puedeEditar, cargandoPermisos, onAbrir, estado, onEstado, busqueda, onBusqueda }: ListaPresupuestosProps) {
  const { data: todos = [], isLoading, error, refetch } = usePresupuestos();
  const cambiarEstado = useCambiarEstado();
  const { precios } = useTarifasCalculadora({ enabled: puedeEditar });
  const [nuevo, setNuevo] = useState(false);
  const movil = useIsMobile();
  const hoy = hoyIso();

  const cuenta = useMemo(() => contarPorEstado(todos), [todos]);
  const lista = useMemo(() => filtrarPresupuestos(todos, { estado, busqueda }), [todos, estado, busqueda]);

  const convertir = (p: PresupuestoLista) =>
    cambiarEstado.mutate(
      { presupuesto: p, destino: "borrador", condicionesSiFaltan: condicionesPorDefecto(precios.priceNote, p.validez_dias) },
      { onSuccess: () => onAbrir(p.id) },
    );

  const chips = [
    { valor: "todos", etiqueta: "Todos" },
    ...ESTADOS_PRESUPUESTO.map((e) => ({
      valor: e.valor,
      etiqueta: e.plural,
      ...(e.valor === "solicitud" ? { contador: cuenta.solicitud, etiquetaContador: `${cuenta.solicitud} sin atender` } : {}),
    })),
  ];

  return (
    <div className="space-y-4 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Presupuestos</h1>
            {!puedeEditar && !cargandoPermisos && <EtiquetaSoloLectura />}
          </div>
          <p className="text-sm text-muted-foreground">
            Prepara presupuestos con la calculadora de la web (con las tarifas de hoy), descárgalos en PDF y envíalos por WhatsApp o
            correo. Aquí llegan también las solicitudes de la calculadora de la web.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {puedeEditar && (
            <Button onClick={() => setNuevo(true)} className="gap-1.5" data-tour="presupuestos-nuevo">
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              Nuevo presupuesto
            </Button>
          )}
          <BotonAyuda seccion="presupuestos" />
        </div>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div data-tour="presupuestos-filtros">
          <Tabs value={estado} onValueChange={(v) => onEstado(v as FiltroEstado)}>
            <ChipsSubnivel chips={chips} aria-label="Qué presupuestos ver" />
          </Tabs>
        </div>
        <div className="relative w-full lg:max-w-xs" data-tour="presupuestos-buscar">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            placeholder="Número, cliente o teléfono"
            aria-label="Buscar por número, cliente o teléfono"
            className="pl-9 pr-9"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => onBusqueda("")}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Borrar la búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div data-tour="presupuestos-lista">
        {error ? (
          <EstadoErrorCarga titulo="los presupuestos" error={error} onReintentar={() => void refetch()} />
        ) : isLoading ? (
          <div className="flex justify-center py-10" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Cargando presupuestos…</span>
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground" data-testid="sin-presupuestos">
            {todos.length ? <Inbox className="h-8 w-8" aria-hidden="true" /> : <FileText className="h-8 w-8" aria-hidden="true" />}
            <p className="text-sm">
              {todos.length
                ? busqueda
                  ? `Ningún presupuesto coincide con «${busqueda}».`
                  : "No hay presupuestos en este estado."
                : "Aún no hay ningún presupuesto."}
            </p>
            {!todos.length && puedeEditar && <p className="text-xs">Crea el primero con «Nuevo presupuesto». Las solicitudes de la web aparecerán aquí solas.</p>}
          </div>
        ) : movil ? (
          <ul className="space-y-2" aria-label="Presupuestos">
            {lista.map((p) => (
              <li key={p.id} data-testid="presupuesto">
                <TarjetaPresupuesto p={p} hoy={hoy} onAbrir={onAbrir} onConvertir={puedeEditar ? convertir : undefined} convirtiendo={cambiarEstado.isPending} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border">
            <Table aria-label="Presupuestos">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Número</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="w-28">Fecha</TableHead>
                  <TableHead className="w-52">Estado</TableHead>
                  <TableHead className="w-32 text-right">Total</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow key={p.id} data-testid="presupuesto" className="cursor-pointer align-top" onClick={() => onAbrir(p.id)}>
                    <TableCell className="font-medium tabular-nums">
                      <button type="button" className="hover:underline" onClick={(e) => (e.stopPropagation(), onAbrir(p.id))}>
                        {p.numero}
                      </button>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <div className="font-medium">{p.cliente_nombre}</div>
                      {(p.cliente_telefono || p.cliente_poblacion) && (
                        <div className="text-xs text-muted-foreground">{[p.cliente_telefono, p.cliente_poblacion].filter(Boolean).join(" · ")}</div>
                      )}
                      {p.estado === "solicitud" && (
                        <Solicitud p={p} onConvertir={puedeEditar ? convertir : undefined} convirtiendo={cambiarEstado.isPending} />
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{fechaCorta(p.fecha)}</TableCell>
                    <TableCell>
                      <EtiquetasPresupuesto presupuesto={p} hoy={hoy} />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{eurosCentimos(p.total)}</TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!error && !isLoading && lista.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {lista.length === todos.length ? cuantos(todos.length) : `${lista.length} de ${cuantos(todos.length)}`}
          </p>
        )}
      </div>

      {puedeEditar && <NuevoPresupuestoDialog abierto={nuevo} onCerrar={() => setNuevo(false)} onCreado={onAbrir} notaPrecio={precios.priceNote} />}
    </div>
  );
}

const cuantos = (n: number) => (n === 1 ? "1 presupuesto" : `${n.toLocaleString("es-ES")} presupuestos`);

/** Lo que escribió el cliente en la web, el precio que vio y «Convertir en borrador». */
function Solicitud({ p, onConvertir, convirtiendo }: { p: PresupuestoLista; onConvertir?: (p: PresupuestoLista) => void; convirtiendo: boolean }) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/30" data-testid="solicitud-web">
      {p.notas_cliente ? (
        <p className="flex gap-1.5 whitespace-pre-wrap break-words text-foreground">
          <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="line-clamp-3">{p.notas_cliente}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">Sin comentarios del cliente.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">
          Precio web (IVA incl.): <span className="font-semibold text-foreground tabular-nums">{p.precioWeb == null ? "—" : eurosCentimos(p.precioWeb)}</span>
        </span>
        {onConvertir && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 bg-background"
            disabled={convirtiendo}
            onClick={(e) => {
              e.stopPropagation();
              onConvertir(p);
            }}
          >
            Convertir en borrador
          </Button>
        )}
      </div>
    </div>
  );
}

function TarjetaPresupuesto({
  p,
  hoy,
  onAbrir,
  onConvertir,
  convirtiendo,
}: {
  p: PresupuestoLista;
  hoy: string;
  onAbrir: (id: string) => void;
  onConvertir?: (p: PresupuestoLista) => void;
  convirtiendo: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <button type="button" className="block w-full text-left" onClick={() => onAbrir(p.id)} aria-label={`Abrir ${p.numero} de ${p.cliente_nombre}`}>
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold tabular-nums">{p.numero}</span>
          <span className="font-semibold tabular-nums">{eurosCentimos(p.total)}</span>
        </div>
        <div className="mt-0.5 truncate font-medium">{p.cliente_nombre}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{fechaCorta(p.fecha)}</span>
          {p.cliente_telefono && <span>· {p.cliente_telefono}</span>}
        </div>
        <div className="mt-2">
          <EtiquetasPresupuesto presupuesto={p} hoy={hoy} />
        </div>
      </button>
      {p.estado === "solicitud" && <Solicitud p={p} onConvertir={onConvertir} convirtiendo={convirtiendo} />}
    </div>
  );
}
