import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Copy, Facebook, Instagram, Link2, Loader2, LogOut, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccionConexion, useConexionRrss, useIniciarConexion, type Comprobacion, type EstadoConexion } from "@/hooks/useRrss";
import { cn } from "@/lib/utils";
import { EstiloRrss } from "./EstiloRrss";

// ---------------------------------------------------------------------------
// RRSS › Conexión y estilo. Arriba, la conexión con Instagram y la página de Facebook (botón «Conectar con Facebook»
// con una app de Meta, o token de usuario del sistema en los secretos): sin nada configurado enseña los pasos; con
// la cuenta conectada, quién es, qué permisos tiene, cuándo caduca y «Comprobar». Debajo, el estilo de los textos
// (lo que usa la IA). Nunca se ve ningún token. Ver docs/RRSS.md.
// ---------------------------------------------------------------------------

const RESULTADOS: Record<string, { tipo: "ok" | "aviso" | "error"; texto: string }> = {
  ok: { tipo: "ok", texto: "Instagram y Facebook conectados." },
  elegir: { tipo: "aviso", texto: "Administras varias páginas: elige cuál es la de la cristalería." },
  cancelada: { tipo: "aviso", texto: "Has cancelado la conexión en Facebook. No ha cambiado nada." },
  sin_instagram: { tipo: "error", texto: "Ninguna de tus páginas de Facebook tiene una cuenta de Instagram profesional vinculada." },
  sin_paginas: { tipo: "error", texto: "Tu usuario de Facebook no administra ninguna página (o no le diste permiso al conectar)." },
  error: { tipo: "error", texto: "No se ha podido completar la conexión. Mira el detalle más abajo." },
};

function IconoEstado({ estado }: { estado: Comprobacion["estado"] }) {
  if (estado === "ok") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (estado === "aviso") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />;
  return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />;
}

function Paso({ hecho, titulo, children }: { hecho: boolean | null; titulo: string; children?: React.ReactNode }) {
  const Icono = hecho ? CheckCircle2 : CircleDashed;
  return (
    <li className="flex items-start gap-3 py-2">
      <Icono className={cn("mt-0.5 h-5 w-5 shrink-0", hecho ? "text-emerald-600" : "text-muted-foreground")} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{titulo} <span className="sr-only">{hecho ? "(hecho)" : "(pendiente)"}</span></p>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

function copiar(texto: string) {
  navigator.clipboard?.writeText(texto).then(() => toast.success("Copiado"), () => toast.error("No se pudo copiar"));
}

function SinConectar({ e, puedeEditar }: { e: EstadoConexion; puedeEditar: boolean }) {
  const iniciar = useIniciarConexion();
  return (
    <div className="space-y-4" data-testid="rrss-sin-conectar">
      <p className="text-sm text-muted-foreground">
        RRSS todavía no está conectado: no se puede publicar ni medir nada, y el panel no llama a Instagram ni a Facebook. Esto es lo que hace falta
        (los pasos detallados para quien lleva la parte técnica están en la guía del panel, <code>docs/RRSS.md</code>):
      </p>
      <ol className="divide-y divide-border/60">
        <Paso hecho={null} titulo="1. La cuenta de Instagram, profesional y vinculada a la página de Facebook">
          En la app de Instagram: Configuración › Tipo de cuenta y herramientas › Cambiar a cuenta profesional (Empresa), y en Centro de cuentas, vincúlala a la página de Facebook de la cristalería.
        </Paso>
        <Paso hecho={e.configuracion.appId && e.configuracion.appSecret} titulo="2. Una app de Meta con su identificador y su clave en Supabase">
          Se crea en developers.facebook.com (gratis). Sus datos van en los secretos de Supabase: META_APP_ID y META_APP_SECRET.
          {e.faltan.length > 0 && <> Ahora falta: <strong>{e.faltan.join(", ")}</strong>.</>}
        </Paso>
        <Paso hecho={null} titulo="3. La dirección de vuelta, añadida en la app de Meta">
          {e.redirectUri ? (
            <span className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{e.redirectUri}</code>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => copiar(e.redirectUri as string)}>
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Copiar
              </Button>
            </span>
          ) : "La dirección sale aquí cuando las funciones de RRSS están desplegadas."}
        </Paso>
        <Paso hecho={false} titulo="4. Conectar">
          Pulsa el botón, entra en Facebook con quien administra la página y acepta todos los permisos que pide.
        </Paso>
      </ol>
      {puedeEditar ? (
        <Button type="button" onClick={() => iniciar.mutate(undefined, { onError: (err) => toast.error(err.message) })}
          disabled={!e.puedeConectar || iniciar.isPending} data-tour="rrss-conectar">
          {iniciar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Facebook className="mr-2 h-4 w-4" aria-hidden="true" />}
          Conectar con Facebook
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Para conectar hace falta «Editar» en RRSS.</p>
      )}
      {!e.puedeConectar && puedeEditar && <p className="text-xs text-muted-foreground">El botón se activa cuando estén META_APP_ID y META_APP_SECRET en Supabase.</p>}
    </div>
  );
}

function ElegirPagina({ e, puedeEditar }: { e: EstadoConexion; puedeEditar: boolean }) {
  const accion = useAccionConexion();
  const [elegida, setElegida] = useState(e.candidatas[0]?.id ?? "");
  return (
    <div className="space-y-3" data-testid="rrss-elegir-pagina">
      <p className="text-sm">Administras varias páginas de Facebook con Instagram. ¿Cuál es la de la cristalería?</p>
      <RadioGroup value={elegida} onValueChange={setElegida} className="space-y-2">
        {e.candidatas.map((c) => (
          <Label key={c.id} htmlFor={`pagina-${c.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal">
            <RadioGroupItem id={`pagina-${c.id}`} value={c.id} />
            <span className="min-w-0">
              <span className="block font-medium">{c.nombre ?? c.id}</span>
              <span className="block text-xs text-muted-foreground">Instagram: @{c.instagram?.usuario ?? c.instagram?.id ?? "—"}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {puedeEditar && (
        <Button type="button" disabled={!elegida || accion.isPending}
          onClick={() => accion.mutate({ accion: "elegir_pagina", paginaId: elegida }, { onSuccess: () => toast.success("Página conectada"), onError: (err) => toast.error(err.message) })}>
          {accion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />} Usar esta página
        </Button>
      )}
    </div>
  );
}

function Conectada({ e, puedeEditar }: { e: EstadoConexion; puedeEditar: boolean }) {
  const accion = useAccionConexion();
  const iniciar = useIniciarConexion();
  const avisoCaducidad = e.caducidad.nivel === "aviso" || e.caducidad.nivel === "caducado" || e.estado === "caducada";
  return (
    <div className="space-y-4" data-testid="rrss-conectada">
      <div className="flex flex-wrap items-center gap-3">
        {e.cuenta?.foto ? (
          <img src={e.cuenta.foto} alt="" className="h-12 w-12 rounded-full border object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted"><Instagram className="h-6 w-6" aria-hidden="true" /></div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{e.cuenta?.usuario ? `@${e.cuenta.usuario}` : "Cuenta de Instagram"}</p>
          <p className="text-sm text-muted-foreground">
            {e.cuenta?.paginaNombre ? <>Página de Facebook: {e.cuenta.paginaNombre}</> : e.facebook ? "Página de Facebook conectada" : "Sin página de Facebook: solo Instagram"}
          </p>
        </div>
        <Badge variant={e.estado === "conectada" ? "secondary" : "destructive"}>
          {e.estado === "conectada" ? "Conectada" : e.estado === "caducada" ? "Caducada" : "Con problemas"}
        </Badge>
        <Badge variant="outline">{e.modo === "secretos" ? "Token del sistema" : "Conectada desde el panel"}</Badge>
      </div>
      {avisoCaducidad && (
        <Alert variant={e.caducidad.nivel === "caducado" || e.estado === "caducada" ? "destructive" : "default"} data-testid="rrss-aviso-caducidad">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{e.caducidad.nivel === "aviso" ? "La conexión caduca pronto" : "La conexión ya no funciona"}</AlertTitle>
          <AlertDescription>{e.caducidad.texto}</AlertDescription>
        </Alert>
      )}
      {!avisoCaducidad && <p className="text-sm text-muted-foreground">{e.caducidad.texto}</p>}
      {e.error && <p className="text-sm text-destructive">{e.error}</p>}
      {e.faltanPermisos.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">Faltan permisos: {e.faltanPermisos.join(", ")}. Pulsa «Renovar conexión» y acéptalos todos.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={accion.isPending} data-tour="rrss-comprobar"
          onClick={() => accion.mutate({ accion: "comprobar" }, { onError: (err) => toast.error(err.message) })}>
          {accion.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
          Comprobar conexión
        </Button>
        {puedeEditar && e.modo !== "secretos" && (
          <Button type="button" variant="outline" disabled={iniciar.isPending || !e.puedeConectar} onClick={() => iniciar.mutate(undefined, { onError: (err) => toast.error(err.message) })}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Renovar conexión
          </Button>
        )}
        {puedeEditar && e.modo !== "secretos" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-destructive"><LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Desconectar</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Desconectar Instagram y Facebook?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borran los permisos guardados. Lo programado no se publicará hasta que vuelvas a conectar. Lo ya publicado sigue en Instagram y Facebook.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => accion.mutate({ accion: "desconectar" }, { onSuccess: () => toast.success("Desconectado"), onError: (err) => toast.error(err.message) })}>
                  Desconectar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {e.comprobaciones && (
        <ul className="divide-y divide-border/60 rounded-md border px-3" data-testid="rrss-comprobaciones">
          {e.comprobaciones.map((c) => (
            <li key={c.nombre} className="flex items-start gap-2 py-2 text-sm">
              <IconoEstado estado={c.estado} />
              <div className="min-w-0">
                <p><span className="font-medium">{c.nombre}:</span> {c.detalle}</p>
                {c.comoArreglarlo && c.estado !== "ok" && <p className="text-xs text-muted-foreground">{c.comoArreglarlo}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {e.comprobadoEn && <p className="text-xs text-muted-foreground">Comprobada por última vez: {new Date(e.comprobadoEn).toLocaleString("es-ES")}</p>}
    </div>
  );
}

export function ConexionRrss({ puedeEditar }: { puedeEditar: boolean }) {
  const { data: e, isLoading, isError, error, refetch } = useConexionRrss();

  // Vuelta del «Conectar con Facebook»: /rrss?tab=conexion&conexion=ok|elegir|…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("conexion");
    if (!r) return;
    const info = RESULTADOS[r] ?? RESULTADOS.error;
    if (info.tipo === "ok") toast.success(info.texto);
    else if (info.tipo === "aviso") toast(info.texto);
    else toast.error(info.texto);
    p.delete("conexion");
    window.history.replaceState(null, "", `${window.location.pathname}${p.toString() ? `?${p}` : ""}`);
    refetch();
  }, [refetch]);

  return (
    <div className="space-y-4 pb-4">
      <Card data-tour="rrss-conexion">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Link2 className="h-5 w-5" aria-hidden="true" /> Conexión con Instagram y Facebook</CardTitle>
          <CardDescription>La cuenta profesional de Instagram y la página de Facebook en las que publica el panel. Los permisos se guardan cifrados en el servidor.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <Skeleton className="h-32 w-full" />}
          {isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>No se puede leer la conexión</AlertTitle>
              <AlertDescription>{(error as Error)?.message ?? "Error"}. Si RRSS acaba de instalarse, quizá falte desplegar sus funciones (docs/RRSS.md).</AlertDescription>
            </Alert>
          )}
          {e && (e.estado === "eligiendo_pagina" ? <ElegirPagina e={e} puedeEditar={puedeEditar} />
            : e.conectada || e.estado === "caducada" ? <Conectada e={e} puedeEditar={puedeEditar} />
              : <SinConectar e={e} puedeEditar={puedeEditar} />)}
          {e && e.estado === "error" && !e.conectada && e.error && <p className="mt-3 text-sm text-destructive">{e.error}</p>}
          {e && (
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <li>{e.configuracion.ia ? "✔" : "✘"} IA para los textos {e.configuracion.ia ? "disponible" : "sin configurar (OPENAI_API_KEY)"}</li>
              <li>{e.configuracion.cron ? "✔" : "✘"} Tareas automáticas {e.configuracion.cron ? "(programar y métricas)" : "sin configurar (OCR_TRABAJOS_SECRET y Vault)"}</li>
            </ul>
          )}
        </CardContent>
      </Card>
      <EstiloRrss puedeEditar={puedeEditar} iaDisponible={Boolean(e?.configuracion.ia)} />
    </div>
  );
}
