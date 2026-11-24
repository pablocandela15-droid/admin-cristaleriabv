import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { FlaskConical, Loader2, Save, Send, Sparkles, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { SelectorPlantillaNewsletter, type SeleccionPlantilla } from "./SelectorPlantillaNewsletter";
import { EditorBloquesNewsletter } from "./EditorBloquesNewsletter";
import { DialogoCrearConIA } from "./DialogoCrearConIA";
import { DialogoGuardarPlantilla } from "./DialogoGuardarPlantilla";
import { PreviewNewsletter } from "./PreviewNewsletter";
import { useEnviarNewsletter, useEnviarPruebaNewsletter, useEstadoNewsletter, useNewsletterConfig, useNewsletterSuscriptores } from "@/hooks/useNewsletter";
import { useBorrarPlantillaNewsletter, useNewsletterPlantillas, type RespuestaIA } from "@/hooks/useNewsletterPlantillas";
import { textoSuscriptores } from "@/lib/newsletter/textos";
import { textoCanal } from "@/lib/newsletter/resend";
import { contar } from "@/lib/newsletter/suscriptores";
import {
  disenoDePlantilla,
  huecosPorCompletar,
  payloadDeDiseno,
  plantillaBase,
  LIMITE_INSIGNIA,
  LIMITE_PREHEADER,
  LIMITE_TITULO,
  type DisenoNewsletter,
} from "@/lib/newsletter/diseno";

/**
 * «Crear y enviar» (portado del panel de referencia): plantilla o «Crear con IA», asunto, etiqueta, texto de vista
 * previa y bloques, con la vista previa al lado (ordenador y móvil). Prueba solo a quien la pide (y a la dirección de
 * pruebas de los ajustes) y envío real a los ACTIVOS (confirmaron su email), siempre con confirmación. Sin la
 * configuración de Resend los botones de envío se desactivan y se dice qué falta.
 */
export function CreadorNewsletter({ onIrAConfiguracion }: { onIrAConfiguracion?: () => void }) {
  const [diseno, setDiseno] = useState<DisenoNewsletter | null>(null);
  const [seleccion, setSeleccion] = useState<SeleccionPlantilla>(null);
  const [origen, setOrigen] = useState<"manual" | "ia">("manual");
  const [avisosIA, setAvisosIA] = useState<string[] | null>(null);
  const [dialogoIA, setDialogoIA] = useState(false);
  const [dialogoGuardar, setDialogoGuardar] = useState(false);
  // Clave del envío: se genera al abrir la confirmación; repetir la petición (doble clic, reintento) no reenvía.
  const [clave, setClave] = useState<string | null>(null);

  const { data: suscriptores } = useNewsletterSuscriptores();
  const { data: estado, isLoading: cargandoEstado, isError: errorEstado } = useEstadoNewsletter();
  const { data: config } = useNewsletterConfig();
  const { plantillas: guardadas } = useNewsletterPlantillas();
  const { mutate: borrarPlantilla } = useBorrarPlantillaNewsletter();
  const { mutate: enviarNewsletter, isPending } = useEnviarNewsletter();
  const { mutate: enviarPrueba, isPending: enviandoPrueba } = useEnviarPruebaNewsletter();

  const activos = useMemo(() => contar(suscriptores ?? []).activos, [suscriptores]);
  const resultado = useMemo(() => (diseno ? payloadDeDiseno(diseno) : null), [diseno]);
  const huecos = useMemo(() => (diseno ? huecosPorCompletar(diseno) : []), [diseno]);
  const valido = !!resultado?.ok;
  const faltan = estado?.faltan ?? [];
  const sePuedeEnviar = !!estado && faltan.length === 0;
  const iaDisponible = !!estado?.configurado.ia;

  const cargar = (d: DisenoNewsletter, sel: SeleccionPlantilla, o: "manual" | "ia", avisos: string[] | null = null) => {
    setDiseno(d);
    setSeleccion(sel);
    setOrigen(o);
    setAvisosIA(avisos);
  };
  const cambiar = (parcial: Partial<DisenoNewsletter>) => setDiseno((d) => (d ? { ...d, ...parcial } : d));

  const alPropuestaIA = (r: RespuestaIA) => {
    cargar(r.propuesta, null, "ia", r.avisos);
    toast.success("Propuesta de la IA cargada. Revísala y cámbiala a tu gusto antes de enviarla.");
  };

  const pedirEnvio = () => {
    if (!resultado) return;
    if (resultado.ok === false) {
      toast.error(resultado.error);
      return;
    }
    setClave(crypto.randomUUID());
  };

  const confirmarEnvio = () => {
    if (!resultado?.ok || !clave) return;
    enviarNewsletter(
      { newsletter: resultado.payload, clave },
      {
        onSuccess: () => {
          setDiseno(null);
          setSeleccion(null);
          setAvisosIA(null);
          setClave(null);
        },
        onError: () => setClave(null),
      },
    );
  };

  const probar = () => {
    if (!resultado) return;
    if (resultado.ok === false) {
      toast.error(resultado.error);
      return;
    }
    enviarPrueba(resultado.payload);
  };

  const botonIA = (
    <Button type="button" className="h-11 shrink-0" onClick={() => setDialogoIA(true)} disabled={!iaDisponible} data-tour="newsletter-ia">
      <Sparkles className="mr-2 h-4 w-4" />
      Crear con IA
    </Button>
  );

  return (
    <>
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          {!cargandoEstado && (errorEstado || faltan.length > 0) && (
            <Alert variant="destructive" data-testid="newsletter-falta-configurar">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Todavía no se pueden enviar correos</AlertTitle>
              <AlertDescription className="space-y-2">
                {errorEstado ? (
                  <p>No se pudo comprobar la configuración del envío (falta desplegar las funciones del newsletter).</p>
                ) : (
                  <>
                    <p>Falta configurar:</p>
                    <ul className="list-disc pl-4">
                      {faltan.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </>
                )}
                <p>Puedes preparar el correo y guardarlo como plantilla; enviarlo y la prueba se activan cuando esté todo.</p>
                {onIrAConfiguracion && (
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={onIrAConfiguracion}>
                    Ver la configuración
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 p-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle>Crear newsletter</CardTitle>
                <CardDescription>Elige una plantilla o deja que la IA la redacte, revisa el texto y mira cómo queda.</CardDescription>
              </div>
              {iaDisponible ? (
                botonIA
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} aria-describedby="ia-no-disponible">{botonIA}</span>
                  </TooltipTrigger>
                  <TooltipContent id="ia-no-disponible" className="max-w-xs">
                    {cargandoEstado ? "Comprobando si la IA está disponible…" : "La IA no está disponible: falta la clave de OpenAI (OPENAI_API_KEY) en Supabase."}
                  </TooltipContent>
                </Tooltip>
              )}
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-2">
              {!cargandoEstado && !iaDisponible && (
                <p className="text-xs text-muted-foreground" data-testid="newsletter-ia-desactivada">
                  «Crear con IA» está desactivado: falta la clave de OpenAI (OPENAI_API_KEY) en los secretos de Supabase.
                </p>
              )}
              <div className="space-y-2" data-tour="newsletter-plantillas">
                <Label>Plantilla</Label>
                <SelectorPlantillaNewsletter
                  seleccion={seleccion}
                  guardadas={guardadas}
                  onBase={(tipo) => cargar(disenoDePlantilla(plantillaBase(tipo)), { base: tipo }, "manual")}
                  onGuardada={(p) => cargar(disenoDePlantilla(p), { guardada: p.id }, p.origen)}
                  onBorrar={(p) => {
                    borrarPlantilla(p.id);
                    if (seleccion && "guardada" in seleccion && seleccion.guardada === p.id) setSeleccion(null);
                  }}
                />
              </div>

              {avisosIA && (
                <Alert className="border-accent/40 bg-accent/5">
                  <Sparkles className="h-4 w-4 !text-accent" />
                  <AlertTitle>Propuesta de la IA cargada</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>Revisa el texto: es un borrador. No se envía nada hasta que pulses «Enviar» y lo confirmes.</p>
                    {avisosIA.length > 0 && (
                      <ul className="list-disc pl-4">
                        {avisosIA.map((a) => <li key={a}>{a}</li>)}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {diseno && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="titulo">Asunto</Label>
                    <Input id="titulo" placeholder="Asunto del correo" value={diseno.titulo} maxLength={LIMITE_TITULO}
                      onChange={(e) => cambiar({ titulo: e.target.value })} className="h-11 text-base md:text-base" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="insignia">Etiqueta</Label>
                      <Input id="insignia" value={diseno.insignia} maxLength={LIMITE_INSIGNIA} placeholder={plantillaBase(diseno.tipo).insignia}
                        onChange={(e) => cambiar({ insignia: e.target.value })} className="h-11 text-base md:text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="preheader">Texto junto al asunto</Label>
                      <Input id="preheader" value={diseno.preheader} maxLength={LIMITE_PREHEADER} placeholder="Lo que se lee en la bandeja de entrada"
                        onChange={(e) => cambiar({ preheader: e.target.value })} className="h-11 text-base md:text-sm" />
                    </div>
                  </div>
                  <div className="space-y-2" data-tour="newsletter-bloques">
                    <Label>Contenido</Label>
                    <EditorBloquesNewsletter bloques={diseno.bloques} onChange={(bloques) => cambiar({ bloques })} />
                  </div>
                  {resultado && resultado.ok === false && (
                    <p className="flex items-start gap-2 text-sm text-destructive" role="status">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {resultado.error}
                    </p>
                  )}
                  <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setDialogoGuardar(true)} disabled={!valido}>
                    <Save className="mr-2 h-4 w-4" />
                    Guardar como plantilla
                  </Button>
                </>
              )}

              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Send className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Envío: <strong className="text-foreground">{textoCanal(estado?.canal ?? config?.canal ?? "transaccional").toLowerCase()}</strong>.
                  Cada correo lleva el enlace para darse de baja y los datos del negocio.
                </span>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <Users className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Al enviarla le llegará a <strong className="text-foreground">{textoSuscriptores(activos)}</strong> (solo quien ha confirmado su
                  email). Antes puedes mandarte una prueba.
                </span>
              </div>

              <div className="space-y-2" data-tour="newsletter-enviar">
                <Button className="h-12 w-full" size="lg" onClick={pedirEnvio} disabled={!valido || isPending || !sePuedeEnviar || activos === 0}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Enviar a {textoSuscriptores(activos)}
                </Button>
                <Button className="h-11 w-full" variant="outline" onClick={probar} disabled={!valido || isPending || enviandoPrueba || !sePuedeEnviar} aria-describedby="ayuda-prueba">
                  {enviandoPrueba ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                  Enviar prueba a mi correo
                </Button>
                <p id="ayuda-prueba" className="text-center text-xs text-muted-foreground">
                  La prueba llega solo a tu correo{config?.email_prueba ? ` y a ${config.email_prueba}` : ""}, con «[PRUEBA]» en el asunto. Ningún suscriptor la recibe.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:flex lg:min-h-0 lg:flex-col">
          <Label className="mb-3 block shrink-0">Vista previa del email</Label>
          <PreviewNewsletter diseno={diseno} web={config?.web_url} />
        </div>
      </div>

      <DialogoCrearConIA abierto={dialogoIA} onAbiertoChange={setDialogoIA} actual={diseno} onPropuesta={alPropuestaIA} />
      {diseno && (
        <DialogoGuardarPlantilla abierto={dialogoGuardar} onAbiertoChange={setDialogoGuardar} diseno={diseno} origen={origen}
          onGuardada={(p) => setSeleccion({ guardada: p.id })} />
      )}

      <AlertDialog open={clave !== null} onOpenChange={(v) => !v && !isPending && setClave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar la newsletter a {textoSuscriptores(activos)}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Es un envío real: «{diseno?.titulo}» le llegará a {textoSuscriptores(activos)} y no se puede deshacer.</p>
                {huecos.length > 0 && (
                  <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Quedan huecos sin completar ({huecos.join(", ")}). Revísalos antes de enviar.</span>
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarEnvio(); }} disabled={isPending} className="h-11">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sí, enviar a todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
