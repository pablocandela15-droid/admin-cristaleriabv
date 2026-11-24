import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Calculator,
  Copy,
  Download,
  FileQuestion,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquareQuote,
  MoreHorizontal,
  PenLine,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { BarraGuardar } from "@/components/web/contenido/BarraGuardar";
import { CajaTotales } from "@/components/presupuestos/CajaTotales";
import { DialogoCalculadora } from "@/components/presupuestos/DialogoCalculadora";
import { EtiquetasPresupuesto } from "@/components/presupuestos/Etiquetas";
import { LineaManualDialog } from "@/components/presupuestos/LineaManualDialog";
import { LineasPresupuesto } from "@/components/presupuestos/LineasPresupuesto";
import {
  useAnadirLinea,
  useBorrarLinea,
  useBorrarPresupuesto,
  useCambiarEstado,
  useCambiarLinea,
  useCrearPresupuesto,
  useGuardarPresupuesto,
  useOrdenarLineas,
  usePresupuesto,
} from "@/hooks/usePresupuestos";
import { useTarifasCalculadora } from "@/hooks/useTarifasCalculadora";
import { useContenidoWeb } from "@/hooks/useWebContenido";
import { cn } from "@/lib/utils";
import { condicionesConValidez, condicionesPorDefecto, negocioParaDocumentos } from "@/lib/presupuestos/documento";
import { enlaceEmail, enlaceWhatsApp } from "@/lib/presupuestos/envio";
import { accionesDeEstado, fechaCorta, hoyIso, validoHasta, type AccionEstado } from "@/lib/presupuestos/estados";
import {
  cambiosFormulario,
  erroresFormulario,
  formularioDe,
  fusionarFormulario,
  leerPorcentaje,
  mismoFormulario,
  presupuestoEnPantalla,
  validezValida,
  type FormularioCabecera,
} from "@/lib/presupuestos/formulario";
import { copiarLineas, mover, ordenesNuevos, precioWeb, siguienteOrdenLinea } from "@/lib/presupuestos/lineas";
import { nombrePdfPresupuesto } from "@/lib/presupuestos/pdf";
import { calcularTotales, eurosCentimos, formatoPorcentaje } from "@/lib/presupuestos/totales";
import type { CambiosLinea, LineaNueva, LineaPresupuesto, PresupuestoConLineas } from "@/lib/presupuestos/tipos";

interface EditorPresupuestoProps {
  id: string;
  puedeEditar: boolean;
  cargandoPermisos?: boolean;
  onVolver: () => void;
  /** Abre otro presupuesto (la copia al duplicar). */
  onAbrir: (id: string) => void;
}

/**
 * Presupuestos › un presupuesto (`/presupuestos?id=…`): cliente, líneas (calculadora o a mano), totales con descuento
 * e IVA, condiciones y notas internas; estado (solicitud → borrador → enviado → aceptado o rechazado), PDF, WhatsApp,
 * correo, duplicar y borrar. Con solo «Ver», todo en lectura (y el PDF se puede descargar).
 */
export function EditorPresupuesto({ id, puedeEditar, cargandoPermisos, onVolver, onAbrir }: EditorPresupuestoProps) {
  const { data, isLoading, error, refetch } = usePresupuesto(id);

  const volver = (
    <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={onVolver}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Presupuestos
    </Button>
  );
  if (error) {
    return (
      <div className="space-y-3">
        {volver}
        <EstadoErrorCarga titulo="el presupuesto" error={error} onReintentar={() => void refetch()} />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Cargando el presupuesto…</span>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        {volver}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground" data-testid="presupuesto-no-existe">
          <FileQuestion className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm">Este presupuesto no existe (puede que se haya borrado).</p>
        </div>
      </div>
    );
  }
  return <Editor key={data.id} p={data} puedeEditar={puedeEditar} cargandoPermisos={cargandoPermisos} volver={volver} onVolver={onVolver} onAbrir={onAbrir} />;
}

interface EditorProps {
  p: PresupuestoConLineas;
  puedeEditar: boolean;
  cargandoPermisos?: boolean;
  volver: ReactNode;
  onVolver: () => void;
  onAbrir: (id: string) => void;
}

function Editor({ p, puedeEditar, cargandoPermisos, volver, onVolver, onAbrir }: EditorProps) {
  const tarifas = useTarifasCalculadora();
  const contenido = useContenidoWeb();
  const negocio = useMemo(() => negocioParaDocumentos(contenido.data?.negocio), [contenido.data]);

  const guardar = useGuardarPresupuesto();
  const cambiarEstado = useCambiarEstado();
  const crear = useCrearPresupuesto();
  const borrar = useBorrarPresupuesto();
  const anadirLinea = useAnadirLinea();
  const cambiarLinea = useCambiarLinea();
  const borrarLinea = useBorrarLinea();
  const ordenarLineas = useOrdenarLineas();

  // ── Formulario de la cabecera (se guarda con la barra de abajo) ─────────
  const [form, setForm] = useState<FormularioCabecera>(() => formularioDe(p));
  const base = useRef<FormularioCabecera>(formularioDe(p));
  useEffect(() => {
    // La base de antes se captura aquí: React puede llamar al actualizador más tarde, con base.current ya cambiado.
    const anterior = base.current;
    const nuevo = formularioDe(p);
    setForm((actual) => fusionarFormulario(actual, anterior, nuevo));
    base.current = nuevo;
  }, [p]);
  const sucio = !mismoFormulario(form, base.current);
  const errores = erroresFormulario(form);
  const valido = Object.keys(errores).length === 0;
  const poner = (k: keyof FormularioCabecera, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const ponerValidez = (v: string) =>
    setForm((f) => {
      const antes = validezValida(f.validez);
      const ahora = validezValida(v);
      return { ...f, validez: v, condiciones: antes && ahora ? (condicionesConValidez(f.condiciones, antes, ahora) ?? "") : f.condiciones };
    });

  const enPantalla = useMemo(() => presupuestoEnPantalla(p, form), [p, form]);
  const totales = calcularTotales(p.lineas, enPantalla.descuento_pct, enPantalla.iva_pct);
  const esSolicitud = p.estado === "solicitud";
  const ocupado = guardar.isPending || cambiarEstado.isPending || crear.isPending || borrar.isPending;

  const guardarCabecera = async () => {
    const cambios = cambiosFormulario(form, p);
    // Escrito distinto pero igual guardado («0» y «0,0», espacios de más): no hay nada que mandar.
    if (!Object.keys(cambios).length && !esSolicitud) {
      setForm(base.current);
      return;
    }
    await guardar.mutateAsync({ id: p.id, cambios, pasarABorrador: esSolicitud });
  };

  /** Antes de enviar o descargar: si hay cambios, se guardan (si no son válidos, no se sigue). */
  const asegurarGuardado = async (): Promise<boolean> => {
    if (!sucio || !puedeEditar) return true;
    if (!valido) {
      toast.error("Revisa los datos marcados antes de seguir");
      return false;
    }
    try {
      await guardarCabecera();
      return true;
    } catch {
      return false;
    }
  };

  // ── Dialogos ────────────────────────────────────────────────────────────
  const [calculadora, setCalculadora] = useState<{ linea: LineaPresupuesto | null } | null>(null);
  const [manual, setManual] = useState(false);
  const [aBorrar, setABorrar] = useState(false);
  const [generando, setGenerando] = useState(false);

  // ── Líneas ──────────────────────────────────────────────────────────────
  const anadir = (linea: LineaNueva, alTerminar?: () => void) =>
    anadirLinea.mutate({ presupuestoId: p.id, linea, orden: siguienteOrdenLinea(p.lineas), pasarABorrador: esSolicitud }, { onSuccess: alTerminar });
  const cambiar = (linea: LineaPresupuesto, cambios: CambiosLinea, aviso?: string, alTerminar?: () => void) =>
    cambiarLinea.mutate({ presupuestoId: p.id, id: linea.id, cambios, pasarABorrador: esSolicitud, aviso }, { onSuccess: alTerminar });
  const quitar = (linea: LineaPresupuesto) =>
    borrarLinea.mutate(
      { presupuestoId: p.id, id: linea.id, pasarABorrador: esSolicitud },
      {
        onSuccess: () =>
          toast.success("Línea quitada", {
            description: linea.descripcion,
            action: {
              label: "Deshacer",
              onClick: () => anadirLinea.mutate({ presupuestoId: p.id, linea: copiarLineas([linea])[0], orden: linea.orden }),
            },
          }),
      },
    );
  const moverLinea = (desde: number, hasta: number) => {
    const ids = mover(p.lineas.map((l) => l.id), desde, hasta);
    const cambios = ordenesNuevos(ids, new Map(p.lineas.map((l) => [l.id, l.orden])));
    if (cambios.length) ordenarLineas.mutate({ presupuestoId: p.id, cambios });
  };

  // ── Estado, duplicar y borrar ───────────────────────────────────────────
  const aplicarEstado = (accion: AccionEstado) =>
    cambiarEstado.mutate({
      presupuesto: p,
      destino: accion.destino,
      condicionesSiFaltan: esSolicitud && accion.destino === "borrador" && !form.condiciones.trim() ? condicionesPorDefecto(tarifas.precios.priceNote, enPantalla.validez_dias) : undefined,
    });

  const duplicar = async () => {
    if (!(await asegurarGuardado())) return;
    const copia = presupuestoEnPantalla(p, form);
    crear.mutate(
      {
        cabecera: {
          cliente_nombre: copia.cliente_nombre,
          cliente_telefono: copia.cliente_telefono,
          cliente_email: copia.cliente_email,
          cliente_direccion: copia.cliente_direccion,
          cliente_poblacion: copia.cliente_poblacion,
          condiciones: copia.condiciones,
          notas_internas: copia.notas_internas,
          validez_dias: copia.validez_dias,
          descuento_pct: copia.descuento_pct,
          iva_pct: copia.iva_pct,
          fecha: hoyIso(),
          estado: "borrador",
        },
        lineas: copiarLineas(p.lineas),
      },
      {
        onSuccess: ({ id, numero }) => {
          toast.success(`Copia creada: ${numero}`, { description: `Es un borrador nuevo con las líneas de ${p.numero}.` });
          onAbrir(id);
        },
      },
    );
  };

  // ── PDF y envíos ────────────────────────────────────────────────────────
  const descargarPdf = async (): Promise<string | null> => {
    if (!(await asegurarGuardado())) return null;
    setGenerando(true);
    try {
      const { descargarPdfPresupuesto } = await import("@/lib/presupuestos/descargar");
      const nombre = await descargarPdfPresupuesto({ presupuesto: enPantalla, lineas: p.lineas, negocio });
      return nombre;
    } catch (e) {
      toast.error("No se ha podido crear el PDF", { description: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setGenerando(false);
    }
  };
  const datosEnvio = { ...enPantalla, total: totales.total };
  const whatsapp = enlaceWhatsApp(datosEnvio, negocio.nombre);
  const avisarMarcarEnviado = (titulo: string, descripcion: string) =>
    toast.success(titulo, {
      description: descripcion,
      duration: 10_000,
      ...(p.estado === "borrador" ? { action: { label: "Marcar como enviado", onClick: () => cambiarEstado.mutate({ presupuesto: p, destino: "enviado" }) } } : {}),
    });
  const enviarWhatsApp = async () => {
    if (!whatsapp || !(await asegurarGuardado())) return;
    window.open(whatsapp, "_blank", "noopener,noreferrer");
    avisarMarcarEnviado("WhatsApp abierto con el mensaje", "Si quieres mandarle también el PDF, descárgalo y adjúntalo en el chat.");
  };
  const enviarEmail = async () => {
    const nombre = await descargarPdf();
    if (!nombre) return;
    window.location.href = enlaceEmail(datosEnvio, negocio.nombre, nombrePdfPresupuesto(p.numero));
    avisarMarcarEnviado("Correo preparado", `Se ha descargado ${nombre}: adjúntalo al correo antes de enviarlo (el correo no lo adjunta solo).`);
  };

  const acciones = puedeEditar ? accionesDeEstado(p) : [];
  const web = p.origen === "web";
  const precioEnLaWeb = web ? precioWeb(p.lineas) : null;
  const soloLectura = !puedeEditar;

  return (
    <div className="space-y-4 pb-4">
      {/* Cabecera: volver, número, estado y acciones */}
      <header className="space-y-2">
        {volver}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tabular-nums">{p.numero}</h1>
              <EtiquetasPresupuesto presupuesto={enPantalla} />
              {soloLectura && !cargandoPermisos && <EtiquetaSoloLectura />}
            </div>
            <p className="text-sm text-muted-foreground">
              {p.cliente_nombre} · {fechaCorta(p.fecha)} · válido hasta el {fechaCorta(validoHasta(enPantalla))}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-tour="presupuesto-estado">
            {acciones.map((a) => (
              <Button
                key={a.destino}
                variant={a.tono === "principal" ? "default" : "outline"}
                className={cn(a.tono === "peligro" && "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive")}
                disabled={ocupado}
                onClick={() => aplicarEstado(a)}
              >
                {a.etiqueta}
              </Button>
            ))}
            {puedeEditar && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Más acciones" title="Más acciones" disabled={ocupado}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void duplicar()}>
                    <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                    Duplicar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setABorrar(true)}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Borrar…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      {/* Solicitud de la web: lo que escribió el cliente y lo que vio */}
      {web && (
        <section
          className={cn("rounded-lg border p-4", esSolicitud ? "border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30" : "bg-card")}
          aria-labelledby="titulo-solicitud"
          data-testid="bloque-solicitud"
        >
          <div className="min-w-0 space-y-1">
            <h2 id="titulo-solicitud" className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareQuote className="h-4 w-4" aria-hidden="true" />
              Solicitud desde la calculadora de la web · {fechaCorta(p.creado_en)}
            </h2>
            {p.notas_cliente ? (
              <p className="whitespace-pre-wrap break-words text-sm">{p.notas_cliente}</p>
            ) : (
              <p className="text-sm text-muted-foreground">El cliente no escribió comentarios.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Precio que vio en la web: <span className="font-semibold text-foreground tabular-nums">{precioEnLaWeb == null ? "—" : eurosCentimos(precioEnLaWeb)}</span>. Va
              como precio de la línea; el total del presupuesto le suma el IVA ({formatoPorcentaje(enPantalla.iva_pct)}).
            </p>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* Cliente */}
          <Seccion titulo="Cliente" tour="presupuesto-cliente">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="cliente_nombre" etiqueta="Nombre" obligatorio error={errores.cliente_nombre} className="sm:col-span-2">
                <Input id="cliente_nombre" value={form.cliente_nombre} onChange={(e) => poner("cliente_nombre", e.target.value)} maxLength={200} disabled={soloLectura} />
              </Campo>
              <Campo id="cliente_telefono" etiqueta="Teléfono">
                <Input id="cliente_telefono" type="tel" inputMode="tel" value={form.cliente_telefono} onChange={(e) => poner("cliente_telefono", e.target.value)} maxLength={40} disabled={soloLectura} />
              </Campo>
              <Campo id="cliente_email" etiqueta="Correo" error={errores.cliente_email}>
                <Input id="cliente_email" type="email" value={form.cliente_email} onChange={(e) => poner("cliente_email", e.target.value)} maxLength={200} disabled={soloLectura} />
              </Campo>
              <Campo id="cliente_direccion" etiqueta="Dirección">
                <Input id="cliente_direccion" value={form.cliente_direccion} onChange={(e) => poner("cliente_direccion", e.target.value)} maxLength={300} disabled={soloLectura} />
              </Campo>
              <Campo id="cliente_poblacion" etiqueta="Población">
                <Input id="cliente_poblacion" value={form.cliente_poblacion} onChange={(e) => poner("cliente_poblacion", e.target.value)} maxLength={120} disabled={soloLectura} />
              </Campo>
            </div>
          </Seccion>

          {/* Líneas */}
          <Seccion
            titulo="Líneas"
            tour="presupuesto-lineas"
            acciones={
              puedeEditar && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" onClick={() => setCalculadora({ linea: null })}>
                    <Calculator className="h-4 w-4" aria-hidden="true" />
                    Añadir desde calculadora
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setManual(true)}>
                    <PenLine className="h-4 w-4" aria-hidden="true" />
                    Línea manual
                  </Button>
                </div>
              )
            }
          >
            <LineasPresupuesto
              lineas={p.lineas}
              puedeEditar={puedeEditar}
              categorias={tarifas.categorias}
              precios={tarifas.precios}
              onCambiar={(l, c) => cambiar(l, c)}
              onBorrar={quitar}
              onMover={moverLinea}
              onRecalcular={(linea) => setCalculadora({ linea })}
            />
          </Seccion>

          {/* Condiciones y notas */}
          <Seccion titulo="Condiciones y notas" tour="presupuesto-condiciones">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="fecha" etiqueta="Fecha" error={errores.fecha}>
                <Input id="fecha" type="date" value={form.fecha} onChange={(e) => poner("fecha", e.target.value)} disabled={soloLectura} />
              </Campo>
              <Campo id="validez" etiqueta="Validez (días)" error={errores.validez} ayuda={errores.validez ? undefined : `Válido hasta el ${fechaCorta(validoHasta(enPantalla))}.`}>
                <Input id="validez" value={form.validez} onChange={(e) => ponerValidez(e.target.value)} inputMode="numeric" disabled={soloLectura} className="w-28" />
              </Campo>
            </div>
            <Campo
              id="condiciones"
              etiqueta="Condiciones"
              ayuda="Salen al final del PDF."
              accion={
                puedeEditar && !form.condiciones.trim() ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => poner("condiciones", condicionesPorDefecto(tarifas.precios.priceNote, enPantalla.validez_dias))}
                  >
                    Poner las de siempre
                  </Button>
                ) : null
              }
            >
              <Textarea id="condiciones" value={form.condiciones} onChange={(e) => poner("condiciones", e.target.value)} maxLength={5000} rows={4} disabled={soloLectura} />
            </Campo>
            <Campo id="notas_internas" etiqueta="Notas internas" ayuda="Solo para el equipo: no salen en el PDF ni en los envíos.">
              <Textarea id="notas_internas" value={form.notas_internas} onChange={(e) => poner("notas_internas", e.target.value)} maxLength={5000} rows={3} disabled={soloLectura} />
            </Campo>
          </Seccion>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <CajaTotales
            lineas={p.lineas}
            descuento={form.descuento}
            iva={form.iva}
            onDescuento={(v) => poner("descuento", v)}
            onIva={(v) => poner("iva", v)}
            descuentoNum={leerPorcentaje(form.descuento)}
            ivaNum={leerPorcentaje(form.iva)}
            puedeEditar={puedeEditar}
            totalGuardado={p.total}
          />

          <section className="space-y-2 rounded-lg border bg-card p-4" aria-labelledby="titulo-enviar" data-tour="presupuesto-enviar">
            <h2 id="titulo-enviar" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {puedeEditar ? "Enviar al cliente" : "Documento"}
            </h2>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => void descargarPdf()} disabled={generando || guardar.isPending}>
              {generando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              Descargar PDF
            </Button>
            {puedeEditar && (
              <>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => void enviarWhatsApp()}
                  disabled={!whatsapp || guardar.isPending}
                  title={whatsapp ? undefined : "Falta un teléfono válido del cliente"}
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Enviar por WhatsApp
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" onClick={() => void enviarEmail()} disabled={generando || guardar.isPending}>
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Enviar por email
                </Button>
                <p className="text-xs text-muted-foreground">
                  {whatsapp ? "" : "Para WhatsApp hace falta el teléfono del cliente. "}
                  El correo y WhatsApp no adjuntan el PDF solos: «Enviar por email» lo descarga para que lo adjuntes tú.
                </p>
              </>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 text-sm" aria-labelledby="titulo-historial">
            <h2 id="titulo-historial" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Historial
            </h2>
            <dl className="space-y-1">
              <Dato etiqueta={web ? "Llegó de la web" : "Creado"} valor={fechaCorta(p.creado_en)} />
              {p.enviado_en && <Dato etiqueta="Enviado" valor={fechaCorta(p.enviado_en)} />}
              {p.respondido_en && <Dato etiqueta={p.estado === "aceptado" ? "Aceptado" : p.estado === "rechazado" ? "Rechazado" : "Respondido"} valor={fechaCorta(p.respondido_en)} />}
            </dl>
          </section>
        </aside>
      </div>

      {/* Solo con cambios: sin ellos no tapa nada (lo guardado se avisa con un mensaje). */}
      {sucio && (
        <BarraGuardar
          cambios={sucio}
          guardando={guardar.isPending}
          onGuardar={() => void guardarCabecera().catch(() => undefined)}
          onDescartar={() => setForm(base.current)}
          puedeEditar={puedeEditar}
          texto={esSolicitud ? "Guardar (pasa a borrador)" : "Guardar cambios"}
          error={!valido ? "Revisa los datos marcados en rojo." : null}
        />
      )}

      <DialogoCalculadora
        abierto={!!calculadora}
        linea={calculadora?.linea}
        categorias={tarifas.categorias}
        precios={tarifas.precios}
        avisoTarifas={tarifas.error ? "No se han podido leer las tarifas de Web › Tarifas: se calcula con los precios de serie de la web." : null}
        guardando={anadirLinea.isPending || cambiarLinea.isPending}
        onAnadir={(linea) => anadir(linea, () => setCalculadora(null))}
        onActualizar={(linea, cambios) => cambiar(linea, cambios, "Línea recalculada", () => setCalculadora(null))}
        onCerrar={() => setCalculadora(null)}
      />
      <LineaManualDialog abierto={manual} guardando={anadirLinea.isPending} onAnadir={(l) => anadir(l, () => setManual(false))} onCerrar={() => setManual(false)} />
      <AlertDialog open={aBorrar} onOpenChange={setABorrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar el presupuesto {p.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra con sus {p.lineas.length === 1 ? "línea" : `${p.lineas.length} líneas`} y no se puede deshacer. Su número no se vuelve a usar. Si el cliente no lo
              quiere, mejor márcalo como rechazado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => borrar.mutate(p, { onSuccess: onVolver })}
            >
              Borrar presupuesto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Seccion({ titulo, acciones, tour, children }: { titulo: string; acciones?: ReactNode; tour?: string; children: ReactNode }) {
  const id = `seccion-${titulo.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby={id} data-tour={tour}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </h2>
        {acciones}
      </div>
      {children}
    </section>
  );
}

function Campo({
  id,
  etiqueta,
  obligatorio,
  error,
  ayuda,
  accion,
  className,
  children,
}: {
  id: string;
  etiqueta: string;
  obligatorio?: boolean;
  error?: string;
  ayuda?: string;
  accion?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {etiqueta}
          {obligatorio && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        {accion}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="tabular-nums">{valor}</dd>
    </div>
  );
}
