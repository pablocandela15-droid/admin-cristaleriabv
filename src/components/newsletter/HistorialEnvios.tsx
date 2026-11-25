import { format } from "date-fns";
import { es } from "date-fns/locale";
import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useHistorialEnvios, type EnvioNewsletter } from "@/hooks/useNewsletter";

// Historial de envíos (portado del panel de referencia): cómo salió cada uno y, a partir de los eventos que archiva
// resend-webhook, entregas, aperturas, clics, rebotes y quejas de ESE envío (por la etiqueta del envío o el Broadcast).
// Las aperturas son orientativas: los programas de correo las bloquean o las inflan.

const ETIQUETA_ESTADO: Record<string, string> = {
  enviando: "Enviando",
  completado: "Enviado",
  parcial: "Enviado en parte",
  fallido: "Fallido",
};

function Cifras({ e }: { e: EnvioNewsletter }) {
  const s = e.estadisticas;
  const base = e.canal === "broadcast" ? `${e.total_destinatarios} destinatarios` : `${e.exitosos} de ${e.total_destinatarios} enviados`;
  if (!s) return <span>{base} · las estadísticas aparecerán en cuanto lleguen los primeros datos</span>;
  return (
    <span>
      {base} · {s.entregados} entregados · {s.abiertos} abiertos · {s.clics} con clic
      {s.rebotes ? ` · ${s.rebotes} no entregados` : ""}
      {s.quejas ? ` · ${s.quejas} marcados como spam` : ""}
    </span>
  );
}

export function HistorialEnvios() {
  const { data: envios, isLoading, error } = useHistorialEnvios();
  return (
    <Card className="flex min-h-[8rem] flex-1 flex-col" data-tour="newsletter-historial">
      <CardHeader className="shrink-0 space-y-0.5 p-3 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          Historial de envíos
        </CardTitle>
        <CardDescription className="text-xs">Las últimas newsletters enviadas y cómo salieron.</CardDescription>
      </CardHeader>
      <CardContent data-testid="lista-historial" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pt-0">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">No se pudo cargar el historial.</p>
        ) : !envios?.length ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha enviado ninguna newsletter.</p>
        ) : (
          <ul className="divide-y">
            {envios.map((e) => (
              <li key={e.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-words text-sm font-medium">{e.asunto}</span>
                  <Badge variant={e.canal === "broadcast" ? "default" : "secondary"} className="font-normal">
                    {e.canal === "broadcast" ? "Broadcast" : "Uno a uno"}
                  </Badge>
                  <Badge variant={e.estado === "fallido" ? "destructive" : "outline"} className="font-normal">
                    {ETIQUETA_ESTADO[e.estado] ?? e.estado}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {format(new Date(e.created_at), "d MMM yyyy, HH:mm", { locale: es })} · <Cifras e={e} />
                </p>
                {e.error && e.estado !== "completado" ? <p className="mt-0.5 break-words text-xs text-destructive">{e.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
