import { useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CloudCog, Info, Loader2, RefreshCw } from "lucide-react";
import { AyudaPopover } from "@/components/AyudaPopover";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEstadoNewsletter, useSincronizarResend } from "@/hooks/useNewsletter";
import {
  etiquetaOrigenPasada,
  etiquetaPasada,
  motivoAutoSincronizacion,
  nivelCuota,
  porcentajeCuota,
  textoContactosAjenos,
  textoCuota,
} from "@/lib/newsletter/resend";
import { formatoNumero, plural } from "@/lib/newsletter/textos";

// Línea «Lista de envío» (sincronización con Resend Marketing; solo con el canal Broadcast). Portada del panel de
// referencia en su versión compacta. La tabla de suscriptores manda; esto enseña cómo de cuadrada está la copia que
// usa Resend y deja forzar una actualización. Se actualiza sola al abrirse si no cuadra (motivoAutoSincronizacion),
// una vez por montaje y solo con «Editar» (lo mismo que exige la función).

const COLOR_BARRA = { ok: "bg-emerald-500", aviso: "bg-amber-500", lleno: "bg-destructive" } as const;
const TEXTO_AYUDA =
  "Es la copia de los suscriptores activos que usa el servicio de envío para los Broadcasts. La lista de esta página es la que manda: se añaden los activos y se quitan los que se dan de baja. Se actualiza cada mañana, al abrir esta pestaña y justo antes de cada envío.";

function hace(fecha: string | null | undefined): string {
  if (!fecha) return "";
  try {
    return formatDistanceToNow(new Date(fecha), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}

export function SincronizacionResend({ activos, puedeEditar }: { activos?: number | null; puedeEditar: boolean }) {
  const { data: estado, isLoading, error } = useEstadoNewsletter();
  const { mutate: sincronizar, isPending, variables } = useSincronizarResend();

  const decidida = useRef(false);
  useEffect(() => {
    if (decidida.current || isLoading || !estado || activos === undefined) return;
    decidida.current = true;
    if (!puedeEditar || isPending) return;
    if (motivoAutoSincronizacion(estado, activos) === null) return;
    sincronizar({ automatica: true });
  }, [estado, isLoading, activos, puedeEditar, isPending, sincronizar]);
  const actualizandoSola = isPending && variables?.automatica === true;

  if (isLoading) return <Skeleton className="h-9 w-full" />;
  if (error || !estado) {
    return (
      <p className="flex items-start gap-2 border-t border-border/60 pt-3 text-sm text-muted-foreground">
        <CloudCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        La lista de envío no está disponible ahora mismo.
      </p>
    );
  }

  const limite = estado.limite_contactos;
  const usados = estado.contactos_resend;
  const nivel = nivelCuota(usados, limite);
  const aviso = textoCuota(usados, limite);
  const ultima = estado.ultima_pasada;
  const ajenos = textoContactosAjenos(estado.ultima_terminada ?? (ultima?.estado !== "en_curso" ? ultima : null));
  const anchoRelleno = usados && usados > 0 ? Math.max(porcentajeCuota(usados, limite), 3) : 0;
  const hayError = ultima?.estado === "error" || Boolean(ultima?.mensaje_error);

  return (
    <div data-testid="lista-envio-compacta" className="flex shrink-0 flex-col gap-1.5 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <CloudCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Lista de envío
          <AyudaPopover etiqueta="Qué es la lista de envío">{TEXTO_AYUDA}</AyudaPopover>
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          <span className="text-muted-foreground">Contactos</span>
          <span className="whitespace-nowrap font-semibold">{usados ?? "—"} de {formatoNumero(limite)}</span>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Contactos usados del plan"
            aria-valuemin={0} aria-valuemax={limite} aria-valuenow={usados ?? 0}>
            <span className={cn("block h-full rounded-full transition-all", COLOR_BARRA[nivel])} style={{ width: `${anchoRelleno}%` }} />
          </span>
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {actualizandoSola ? (
            <span role="status" className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Actualizando lista de envío…
            </span>
          ) : ultima ? (
            <>
              Actualizada {hace(ultima.terminada_at ?? ultima.iniciada_at)}:{" "}
              <span className={cn("font-medium", ultima.estado === "error" ? "text-destructive" : "text-foreground")}>{etiquetaPasada(ultima)}</span>
            </>
          ) : (
            "Todavía no se ha actualizado nunca."
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {ultima && ultima.estado !== "en_curso" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className={cn("gap-1 text-muted-foreground", hayError && "text-destructive")}>
                  <Info className="h-4 w-4" aria-hidden="true" /> Detalle
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] space-y-2 p-3 text-sm">
                <p>
                  {ultima.destinatarios ?? 0} recibirían el próximo envío · {plural(ultima.altas, "añadido", "añadidos")} · {plural(ultima.borrados, "quitado", "quitados")}
                  {ultima.bajas_resend ? ` · ${plural(ultima.bajas_resend, "baja nueva", "bajas nuevas")}` : ""}
                  {ultima.errores ? ` · ${plural(ultima.errores, "aviso", "avisos")}` : ""}
                  {ultima.pendientes ? ` · ${plural(ultima.pendientes, "cambio pendiente", "cambios pendientes")}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">Origen: {etiquetaOrigenPasada(ultima)}.</p>
                {ajenos ? <p className="text-xs text-muted-foreground">{ajenos}</p> : null}
                {ultima.mensaje_error ? (
                  <details className="text-destructive">
                    <summary className="cursor-pointer select-none py-2">La última actualización tuvo un problema. Detalle técnico</summary>
                    <p className="break-words">{ultima.mensaje_error}</p>
                  </details>
                ) : null}
              </PopoverContent>
            </Popover>
          )}
          {puedeEditar && (
            <Button type="button" variant="outline" size="sm" onClick={() => sincronizar({})} disabled={isPending || !estado.configurado.api_key} aria-label="Actualizar lista de envío">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar
            </Button>
          )}
        </div>
      </div>
      {aviso ? (
        <p className={cn("flex items-start gap-2 text-sm", nivel === "lleno" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {aviso}
        </p>
      ) : null}
    </div>
  );
}
