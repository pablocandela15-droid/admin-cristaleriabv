import { useMemo, useState } from "react";
import { Download, FileUp, MailCheck, Search, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { TiraCifras } from "@/components/panel/TiraCifras";
import { FilaPlana, ListaPlana, type OpcionMenuFila } from "@/components/panel/ListaPlana";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { DialogoAltaSuscriptor, DialogoImportarCsv } from "./DialogosSuscriptores";
import { SincronizacionResend } from "./SincronizacionResend";
import { useBajaSuscriptor, useEnviarConfirmaciones, useEstadoNewsletter, useNewsletterSuscriptores, useSuprimirSuscriptor } from "@/hooks/useNewsletter";
import {
  contar,
  esBajaPorEntrega,
  etiquetaOrigenAlta,
  etiquetaOrigenBaja,
  exportarCsv,
  filtrarSuscriptores,
  formatearFecha,
  puedeReenviarConfirmacion,
  ETIQUETA_ESTADO,
  type FiltroEstado,
  type FiltroOrigen,
  type SuscriptorNewsletter,
} from "@/lib/newsletter/suscriptores";

/** Como mucho se pintan estas filas (búsqueda para el resto): la lista no está virtualizada. */
const MAX_FILAS = 300;

function descargar(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Suscriptores (portado del panel de referencia y ampliado): cifras, búsqueda, filtros por estado y origen, alta
 * manual con el consentimiento apuntado, importación y exportación en CSV, reenvío de la confirmación, baja y
 * supresión RGPD. Con solo «Ver» se consulta y se exporta; lo demás pide «Editar». Nadie se activa desde aquí: solo al
 * confirmar desde su correo.
 */
export function GestionSuscriptores({ puedeEditar }: { puedeEditar: boolean }) {
  const { data, isLoading, isError, error, refetch } = useNewsletterSuscriptores();
  const { data: estado } = useEstadoNewsletter();
  const [texto, setTexto] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [filtroOrigen, setFiltroOrigen] = useState<FiltroOrigen>("todos");
  const [alta, setAlta] = useState(false);
  const [importar, setImportar] = useState(false);
  const [aBorrar, setABorrar] = useState<SuscriptorNewsletter | null>(null);
  const [aBaja, setABaja] = useState<SuscriptorNewsletter | null>(null);
  const baja = useBajaSuscriptor();
  const suprimir = useSuprimirSuscriptor();
  const confirmaciones = useEnviarConfirmaciones();

  const filas = useMemo(() => data ?? [], [data]);
  const recuento = useMemo(() => contar(filas), [filas]);
  const visibles = useMemo(() => filtrarSuscriptores(filas, { texto, estado: filtroEstado, origen: filtroOrigen }), [filas, texto, filtroEstado, filtroOrigen]);
  const puedeEnviar = !!estado && estado.faltan.length === 0;
  const pendientesReenviables = useMemo(() => filas.filter((s) => puedeReenviarConfirmacion(s)).length, [filas]);

  if (isError) return <EstadoErrorCarga titulo="los suscriptores" error={error} onReintentar={() => refetch()} />;

  const menuDe = (s: SuscriptorNewsletter): OpcionMenuFila[] => {
    if (!puedeEditar) return [];
    const menu: OpcionMenuFila[] = [];
    if (s.estado === "pendiente") {
      menu.push({ etiqueta: "Reenviar confirmación", icono: MailCheck, onClick: () => confirmaciones.mutate([s.id]), disabled: !puedeEnviar || !puedeReenviarConfirmacion(s) });
    }
    if (s.estado !== "baja") menu.push({ etiqueta: "Dar de baja", icono: UserMinus, onClick: () => setABaja(s) });
    menu.push({ etiqueta: "Borrar sus datos (RGPD)", icono: Trash2, destructiva: true, separadorAntes: true, onClick: () => setABorrar(s) });
    return menu;
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <TiraCifras
        data-testid="cifras-suscriptores"
        className="shrink-0"
        cifras={[
          { etiqueta: "Activos", valor: isLoading ? "—" : recuento.activos, detalle: "reciben la newsletter" },
          { etiqueta: "Pendientes", valor: isLoading ? "—" : recuento.pendientes, detalle: "sin confirmar su email", tono: recuento.pendientes ? "ambar" : undefined },
          { etiqueta: "De baja", valor: isLoading ? "—" : recuento.bajas, detalle: "no reciben nada" },
        ]}
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2" data-tour="newsletter-filtros">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por email o nombre" aria-label="Buscar suscriptores" className="h-10 pl-9" />
        </div>
        <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as FiltroEstado)}>
          <SelectTrigger className="h-10 w-[11rem]" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="activo">Activos</SelectItem>
            <SelectItem value="pendiente">Pendientes</SelectItem>
            <SelectItem value="baja">De baja</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroOrigen} onValueChange={(v) => setFiltroOrigen(v as FiltroOrigen)}>
          <SelectTrigger className="h-10 w-[13rem]" aria-label="Filtrar por origen"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los orígenes</SelectItem>
            <SelectItem value="web_formulario">Formulario de la web</SelectItem>
            <SelectItem value="web_presupuesto">Solicitud de presupuesto</SelectItem>
            <SelectItem value="panel_manual">Añadidos desde el panel</SelectItem>
            <SelectItem value="importacion">Importados</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2" data-tour="newsletter-acciones-suscriptores">
          {puedeEditar && (
            <>
              <Button variant="outline" className="h-10" onClick={() => setAlta(true)}>
                <UserPlus className="mr-2 h-4 w-4" /> Añadir
              </Button>
              <Button variant="outline" className="h-10" onClick={() => setImportar(true)}>
                <FileUp className="mr-2 h-4 w-4" /> Importar CSV
              </Button>
            </>
          )}
          <Button variant="outline" className="h-10" disabled={!visibles.length}
            onClick={() => descargar(`suscriptores-newsletter-${new Date().toISOString().slice(0, 10)}.csv`, exportarCsv(visibles))}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
          {puedeEditar && pendientesReenviables > 0 && (
            <Button variant="outline" className="h-10" disabled={!puedeEnviar || confirmaciones.isPending} onClick={() => confirmaciones.mutate(null)}
              title={puedeEnviar ? undefined : "Falta configurar el envío (Newsletter › Configuración)"}>
              <MailCheck className="mr-2 h-4 w-4" /> Enviar confirmaciones ({pendientesReenviables})
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-[16rem] flex-1 flex-col" data-testid="lista-suscriptores">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <ListaPlana
              scroll
              aria-label="Suscriptores"
              vacio={
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {filas.length ? "Ningún suscriptor coincide con la búsqueda." : "Todavía no hay suscriptores. Se apuntan desde la web (pie de página) y, si lo marcan, al pedir presupuesto."}
                </p>
              }
            >
              {visibles.slice(0, MAX_FILAS).map((s) => (
                <FilaPlana
                  key={s.id}
                  data-testid="fila-suscriptor"
                  titulo={s.estado === "baja" ? <span className="text-muted-foreground line-through">{s.email}</span> : s.email}
                  subtitulo={[
                    s.nombre,
                    etiquetaOrigenAlta(s.origen_alta),
                    s.estado === "baja" ? `Baja: ${formatearFecha(s.fecha_baja)} · ${etiquetaOrigenBaja(s.origen_baja)}` : null,
                    s.estado === "activo" ? `Confirmó el ${formatearFecha(s.fecha_verificacion_email)}` : null,
                    s.estado === "pendiente" ? `Se apuntó el ${formatearFecha(s.consentimiento_at)} · ${s.confirmaciones_enviadas} correo(s) de confirmación` : null,
                  ]}
                  estado={{
                    texto: ETIQUETA_ESTADO[s.estado],
                    tono: s.estado === "activo" ? "verde" : s.estado === "pendiente" ? "ambar" : esBajaPorEntrega(s.origen_baja) ? "rojo" : "gris",
                  }}
                  menu={menuDe(s)}
                  etiquetaMenu={`Acciones de ${s.email}`}
                />
              ))}
            </ListaPlana>
            {visibles.length > MAX_FILAS && (
              <p className="pt-2 text-center text-xs text-muted-foreground">Se enseñan {MAX_FILAS} de {visibles.length}: busca o filtra para ver el resto (la exportación los lleva todos).</p>
            )}
          </>
        )}
      </div>

      {estado?.canal === "broadcast" && <SincronizacionResend activos={isLoading ? undefined : recuento.activos} puedeEditar={puedeEditar} />}

      <DialogoAltaSuscriptor abierto={alta} onAbiertoChange={setAlta} puedeEnviar={puedeEnviar} />
      <DialogoImportarCsv abierto={importar} onAbiertoChange={setImportar} puedeEnviar={puedeEnviar} />

      <AlertDialog open={!!aBaja} onOpenChange={(v) => !v && setABaja(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja a {aBaja?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de recibir la newsletter. La baja queda registrada y no se puede deshacer desde el panel: solo vuelve si se apunta él
              mismo en la web y confirma su correo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={() => aBaja && baja.mutate(aBaja.id)}>Dar de baja</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar los datos de {aBorrar?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Supresión RGPD (cuando la persona pide que se borren sus datos): se borra el suscriptor, sus estadísticas de correo y su
              email del registro de auditoría. No se puede deshacer. Si solo quiere dejar de recibir correos, mejor «Dar de baja».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => aBorrar && suprimir.mutate(aBorrar.id)}>
              Borrar sus datos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
