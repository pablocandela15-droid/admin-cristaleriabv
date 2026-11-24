import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Copy, Loader2, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useEstadoNewsletter, useGuardarConfigNewsletter, useNewsletterConfig, type ConfigNewsletterPanel } from "@/hooks/useNewsletter";

type Fila = { clave: string; titulo: string; ok: boolean | null; opcional?: boolean; texto: string };

function Linea({ f }: { f: Fila }) {
  const Icono = f.ok ? CheckCircle2 : f.opcional ? CircleDashed : XCircle;
  return (
    <li className="flex items-start gap-3 py-2" data-testid={`config-${f.clave}`} data-ok={f.ok ? "si" : "no"}>
      <Icono className={f.ok ? "mt-0.5 h-5 w-5 shrink-0 text-emerald-600" : f.opcional ? "mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" : "mt-0.5 h-5 w-5 shrink-0 text-destructive"} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {f.titulo} <span className="sr-only">{f.ok ? "(configurado)" : f.opcional ? "(opcional, sin configurar)" : "(falta)"}</span>
        </p>
        <p className="text-xs text-muted-foreground">{f.texto}</p>
      </div>
    </li>
  );
}

/**
 * Newsletter › Configuración: qué está listo y qué falta (sin enseñar nunca los valores de los secretos) y los
 * ajustes que se cambian desde aquí (remitente, responder a, canal, dirección de pruebas, límite, web). Con solo
 * «Ver» se consultan. Lo que hay que hacer en Resend y en Supabase está en docs/NEWSLETTER.md del panel.
 */
export function ConfiguracionNewsletter({ puedeEditar }: { puedeEditar: boolean }) {
  const { data: config, isLoading } = useNewsletterConfig();
  const { data: estado, isLoading: cargandoEstado, isError: errorEstado } = useEstadoNewsletter();
  const guardar = useGuardarConfigNewsletter();
  const [f, setF] = useState<Omit<ConfigNewsletterPanel, "actualizado_en"> | null>(null);

  useEffect(() => {
    if (config) {
      setF({
        remitente_email: config.remitente_email ?? "",
        remitente_nombre: config.remitente_nombre,
        responder_a: config.responder_a ?? "",
        canal: config.canal,
        email_prueba: config.email_prueba ?? "",
        limite_transaccional: config.limite_transaccional,
        web_url: config.web_url,
      });
    }
  }, [config]);

  const filas: Fila[] = [
    {
      clave: "api_key", titulo: "Clave de Resend (RESEND_API_KEY)", ok: estado ? estado.configurado.api_key : null,
      texto: "Secreto de Supabase. Sin él no sale ningún correo y el formulario de la web dice «no disponible». Con el canal Broadcast necesita «Full access».",
    },
    {
      clave: "remitente", titulo: "Remitente", ok: estado ? estado.configurado.remitente : !!config?.remitente_email,
      texto: "Abajo, en «Remitente». Tiene que ser una dirección de un dominio verificado en Resend (p. ej. novedades@tudominio.es).",
    },
    {
      clave: "webhook_secret", titulo: "Webhook de Resend (RESEND_WEBHOOK_SECRET)", ok: estado ? estado.configurado.webhook_secret : null,
      texto: `Para las estadísticas y las bajas automáticas (rebotes y spam). En Resend › Webhooks, añade la dirección ${estado?.url_webhook ?? "…/functions/v1/resend-webhook"} y guarda su «Signing secret» como secreto de Supabase.`,
    },
    {
      clave: "ia", titulo: "IA para «Crear con IA» (OPENAI_API_KEY)", ok: estado ? estado.configurado.ia : null, opcional: true,
      texto: "La misma clave de OpenAI que usa el resto del panel. Sin ella, «Crear con IA» sale desactivado.",
    },
    {
      clave: "cron", titulo: "Tareas programadas (Vault y OCR_TRABAJOS_SECRET)", ok: estado ? estado.configurado.cron_secret : null, opcional: true,
      texto: "Las de siempre del panel: limpian las altas sin confirmar y, con el canal Broadcast, actualizan la lista de envío cada mañana.",
    },
  ];
  if (estado?.canal === "broadcast") {
    filas.push({
      clave: "segment", titulo: "Segment de Resend (RESEND_NEWSLETTER_SEGMENT_ID)", ok: !!estado.configurado.segment_id, opcional: true,
      texto: estado.configurado.segment_id ? `En uso: ${estado.configurado.segment_id}.` : "Opcional: si no se pone, se crea solo el Segment «Newsletter Cristalería BV» la primera vez.",
    });
  }

  const cambiar = (p: Partial<Omit<ConfigNewsletterPanel, "actualizado_en">>) => setF((x) => (x ? { ...x, ...p } : x));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card data-tour="newsletter-config-estado">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Qué hace falta para enviar</CardTitle>
          <CardDescription>
            {cargandoEstado ? "Comprobando…" : errorEstado ? "No se pudo comprobar: falta desplegar las funciones del newsletter." : estado?.faltan.length ? "Todavía falta algo: hasta entonces no sale ningún correo." : "Todo listo para enviar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {cargandoEstado ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ul className="divide-y">{filas.map((x) => <Linea key={x.clave} f={x} />)}</ul>
          )}
          {estado?.url_webhook && (
            <Button type="button" variant="ghost" size="sm" className="mt-2"
              onClick={() => navigator.clipboard?.writeText(estado.url_webhook).then(() => toast.success("Dirección del webhook copiada."), () => undefined)}>
              <Copy className="mr-2 h-4 w-4" /> Copiar la dirección del webhook
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Resend necesita un dominio propio verificado (la web está ahora en cristaleriabv.vercel.app, que no sirve para enviar). Los pasos
            están en docs/NEWSLETTER.md del panel.
          </p>
        </CardContent>
      </Card>

      <Card data-tour="newsletter-config-ajustes">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Ajustes</CardTitle>
          <CardDescription>{puedeEditar ? "Se guardan para todos los envíos." : "Con «Ver» se consultan; cambiarlos pide «Editar» en Newsletter."}</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {isLoading || !f ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (f) guardar.mutate({ ...f, limite_transaccional: Number(f.limite_transaccional) || 0 }); }}>
              <fieldset disabled={!puedeEditar || guardar.isPending} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-remitente">Remitente (email)</Label>
                    <Input id="cfg-remitente" type="email" value={f.remitente_email ?? ""} onChange={(e) => cambiar({ remitente_email: e.target.value })} placeholder="novedades@tudominio.es" className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-nombre">Nombre del remitente</Label>
                    <Input id="cfg-nombre" value={f.remitente_nombre} maxLength={80} onChange={(e) => cambiar({ remitente_nombre: e.target.value })} className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-responder">Responder a (opcional)</Label>
                    <Input id="cfg-responder" type="email" value={f.responder_a ?? ""} onChange={(e) => cambiar({ responder_a: e.target.value })} placeholder="taller@tudominio.es" className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-prueba">Dirección de pruebas (opcional)</Label>
                    <Input id="cfg-prueba" type="email" value={f.email_prueba ?? ""} onChange={(e) => cambiar({ email_prueba: e.target.value })} placeholder="pruebas@tudominio.es" className="h-11" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Cómo se envía</Label>
                  <RadioGroup value={f.canal} onValueChange={(v) => cambiar({ canal: v as "transaccional" | "broadcast" })} className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-3 text-sm">
                      <RadioGroupItem value="transaccional" className="mt-0.5" aria-label="Uno a uno" />
                      <span><strong>Uno a uno</strong> (por defecto): un correo por suscriptor. En el plan gratuito de Resend caben 100 correos al día.</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 text-sm">
                      <RadioGroupItem value="broadcast" className="mt-0.5" aria-label="Broadcast de Resend" />
                      <span><strong>Broadcast de Resend</strong>: para más suscriptores (hasta 1.000 contactos en el plan gratuito de marketing). Usa la lista de envío.</span>
                    </label>
                  </RadioGroup>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-limite">Límite por envío uno a uno</Label>
                    <Input id="cfg-limite" type="number" min={0} max={100000} value={f.limite_transaccional}
                      onChange={(e) => cambiar({ limite_transaccional: Number(e.target.value) })} className="h-11" aria-describedby="cfg-limite-ayuda" />
                    <p id="cfg-limite-ayuda" className="text-xs text-muted-foreground">0 = sin límite (solo con un plan de pago de Resend).</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-web">Web (páginas de confirmación y baja)</Label>
                    <Input id="cfg-web" value={f.web_url} onChange={(e) => cambiar({ web_url: e.target.value })} placeholder="https://cristaleriabv.vercel.app" className="h-11" inputMode="url" />
                  </div>
                </div>
              </fieldset>
              {puedeEditar && (
                <Button type="submit" className="h-11" disabled={guardar.isPending}>
                  {guardar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Guardar ajustes
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
