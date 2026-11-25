import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Lightbulb, Loader2, Megaphone, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAccionCampana, useCampanasRrss, useConexionRrss, useFechasRrss, useIARrss, type CampanaIA, type CampanaRrss, type IdeaIA } from "@/hooks/useRrss";
import { hoyMadrid, inicioSemana, sumarDias } from "@/lib/rrss/calendario";
import { nombreServicioRrss } from "../../../supabase/functions/_shared/rrss/formatos";
import { NOMBRE_FORMATO } from "./EstadoPublicacion";

// ---------------------------------------------------------------------------
// RRSS › Ideas y campañas (portado de Campañas y la «Sugerencia de la semana» del panel de referencia, para una
// cristalería): las fechas señaladas que vienen (sin IA), ideas para la semana con cómo grabarlas y campañas de 2 a 4
// semanas. La IA solo propone: aceptar una campaña crea BORRADORES con su fecha prevista en el calendario; nada se
// programa ni se publica solo.
// ---------------------------------------------------------------------------

export interface IdeaParaCrear {
  formato: IdeaIA["formato"];
  servicio: string | null;
  caption: string;
  idea: string;
}

const fechaCorta = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });

function FichaCampana({ c, puedeEditar, facebook, onAbrirCalendario }: { c: CampanaRrss; puedeEditar: boolean; facebook: boolean; onAbrirCalendario: () => void }) {
  const accion = useAccionCampana();
  const [marcadas, setMarcadas] = useState<number[]>(() => c.propuesta.piezas.map((_, i) => i));
  const [conFacebook, setConFacebook] = useState(facebook);
  const p: CampanaIA = c.propuesta;
  return (
    <Card data-testid="rrss-campana">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{c.titulo}</CardTitle>
          <Badge variant={c.estado === "aceptada" ? "secondary" : "outline"}>{c.estado === "aceptada" ? "Aceptada" : "Propuesta"}</Badge>
        </div>
        <CardDescription>{fechaCorta(c.desde)} – {fechaCorta(c.hasta)} · {p.piezas.length} publicaciones</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p><strong>Objetivo:</strong> {p.objetivo}</p>
        <p><strong>Para quién:</strong> {p.publico}</p>
        <p><strong>Mensaje:</strong> {p.mensaje}</p>
        {p.razonamiento && <p className="text-muted-foreground">{p.razonamiento}</p>}
        {p.fases.length > 0 && <p className="text-xs text-muted-foreground">Fases: {p.fases.map((f) => `${f.nombre} (${fechaCorta(f.desde)})`).join(" → ")}</p>}
        <ul className="space-y-2">
          {p.piezas.map((x, i) => (
            <li key={i} className="flex gap-2 rounded-md border p-2">
              {c.estado === "propuesta" && puedeEditar && (
                <Checkbox className="mt-1" checked={marcadas.includes(i)} aria-label={`Incluir ${x.titulo}`}
                  onCheckedChange={(v) => setMarcadas((m) => (v === true ? [...m, i] : m.filter((n) => n !== i)))} />
              )}
              <div className="min-w-0">
                <p className="font-medium">{fechaCorta(x.fecha)} {x.hora} · {NOMBRE_FORMATO[x.formato] ?? x.formato} · {nombreServicioRrss(x.servicio) ?? ""}</p>
                <p>{x.titulo}: {x.idea}</p>
                {x.caption && <p className="mt-1 whitespace-pre-line text-muted-foreground">{x.caption} {x.hashtags.join(" ")}</p>}
                {x.porQue && <p className="mt-1 text-xs text-muted-foreground">Por qué: {x.porQue}</p>}
              </div>
            </li>
          ))}
        </ul>
        {c.estado === "propuesta" && puedeEditar && (
          <div className="flex flex-wrap items-center gap-3">
            {facebook && (
              <Label className="flex items-center gap-2 font-normal"><Checkbox checked={conFacebook} onCheckedChange={(v) => setConFacebook(v === true)} /> También en Facebook</Label>
            )}
            <Button type="button" size="sm" disabled={marcadas.length === 0 || accion.isPending}
              onClick={() => accion.mutate({ accion: "aceptar", id: c.id, indices: marcadas, facebook: conFacebook }, {
                onSuccess: (r) => { toast.success(`${r.piezas?.length ?? 0} borradores en el calendario. Añádeles la foto y prográmalos.`); onAbrirCalendario(); },
                onError: (e) => toast.error(e.message),
              })}>
              <Check className="mr-1.5 h-4 w-4" /> Aceptar y llevar al calendario
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={accion.isPending}
              onClick={() => accion.mutate({ accion: "descartar", id: c.id }, { onSuccess: () => toast("Campaña descartada"), onError: (e) => toast.error(e.message) })}>
              <X className="mr-1.5 h-4 w-4" /> Descartar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IdeasCampanasRrss({ puedeEditar, onCrear, onAbrirCalendario }: { puedeEditar: boolean; onCrear: (i: IdeaParaCrear) => void; onAbrirCalendario: () => void }) {
  const { data: conexion } = useConexionRrss();
  const ia = Boolean(conexion?.configuracion.ia);
  const hoy = hoyMadrid();
  const { data: fechas = [] } = useFechasRrss(hoy, sumarDias(hoy, 60));
  const { data: campanas = [] } = useCampanasRrss();
  const ideasIA = useIARrss<{ desde: string; hasta: string; ideas: IdeaIA[] }>();
  const campanaIA = useIARrss<{ campanaId: string; campana: CampanaIA }>();
  const [semana, setSemana] = useState(() => sumarDias(inicioSemana(hoy), 7));
  const [ideas, setIdeas] = useState<IdeaIA[]>([]);
  const [objetivo, setObjetivo] = useState("");
  const [semanas, setSemanas] = useState("3");
  const [porSemana, setPorSemana] = useState("3");
  const opcionesSemana = useMemo(() => [0, 1, 2, 3].map((n) => sumarDias(inicioSemana(hoy), 7 * n)), [hoy]);
  useEffect(() => setIdeas([]), [semana]);

  return (
    <div className="grid gap-4 pb-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card data-tour="rrss-ideas">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-5 w-5" aria-hidden="true" /> Ideas para la semana</CardTitle>
            <CardDescription>Qué publicar y cómo grabarlo con el móvil en el taller o en una obra.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!ia && <p className="text-sm text-muted-foreground" data-testid="rrss-ia-no-disponible">La IA no está disponible: falta configurar OPENAI_API_KEY en Supabase.</p>}
            {ia && puedeEditar && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rrss-semana">Semana</Label>
                  <Select value={semana} onValueChange={setSemana}>
                    <SelectTrigger id="rrss-semana" className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>{opcionesSemana.map((s, n) => <SelectItem key={s} value={s}>{n === 0 ? "Esta semana" : n === 1 ? "La que viene" : `Del ${fechaCorta(s)}`}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button type="button" disabled={ideasIA.isPending}
                  onClick={() => ideasIA.mutate({ accion: "ideas", semana, cuantas: 4 }, { onSuccess: (r) => setIdeas(r.ideas), onError: (e) => toast.error(e.message) })}>
                  {ideasIA.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Pedir ideas a la IA
                </Button>
              </div>
            )}
            <ul className="space-y-2">
              {ideas.map((x, i) => (
                <li key={i} className="space-y-1 rounded-md border p-3 text-sm">
                  <p className="font-medium">{fechaCorta(x.fecha)} · {NOMBRE_FORMATO[x.formato]} · {x.titulo}</p>
                  <p>{x.idea}</p>
                  <p className="text-muted-foreground">«{x.gancho}»</p>
                  <p className="text-xs text-muted-foreground"><strong>Cómo grabarlo:</strong> {x.comoGrabarlo}</p>
                  <p className="text-xs text-muted-foreground">{x.motivo}</p>
                  {puedeEditar && (
                    <Button type="button" size="sm" variant="outline" onClick={() => onCrear({ formato: x.formato, servicio: x.servicio === "otros" ? null : x.servicio, caption: x.gancho, idea: `${x.idea} ${x.comoGrabarlo}` })}>
                      Crear con esta idea
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarPlus className="h-5 w-5" aria-hidden="true" /> Fechas que vienen</CardTitle>
            <CardDescription>Temporada de la cristalería, fiestas de Elche y fechas comerciales (las «sin verificar» conviene confirmarlas).</CardDescription>
          </CardHeader>
          <CardContent>
            {fechas.length === 0 && <p className="text-sm text-muted-foreground">No hay fechas señaladas en los próximos dos meses.</p>}
            <ul className="space-y-2 text-sm">
              {fechas.map((f) => (
                <li key={f.clave}>
                  <p className="font-medium">{f.titulo} <span className="font-normal text-muted-foreground">· {fechaCorta(f.desde)} – {fechaCorta(f.hasta)}{f.verificacion !== "verificada" ? " · sin verificar" : ""}</span></p>
                  {f.idea && <p className="text-muted-foreground">{f.idea}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card data-tour="rrss-campanas">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-5 w-5" aria-hidden="true" /> Campañas</CardTitle>
            <CardDescription>La IA propone una campaña de 2 a 4 semanas. Al aceptarla, sus publicaciones quedan como borradores en el calendario.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!ia && <p className="text-sm text-muted-foreground">La IA no está disponible: falta configurar OPENAI_API_KEY en Supabase.</p>}
            {ia && puedeEditar && (
              <form className="space-y-3" onSubmit={(e) => {
                e.preventDefault();
                campanaIA.mutate({ accion: "campana", descripcion: objetivo, semanas: Number(semanas), piezasPorSemana: Number(porSemana) },
                  { onSuccess: () => { toast.success("Campaña propuesta"); setObjetivo(""); }, onError: (err) => toast.error(err.message) });
              }}>
                <div className="space-y-1.5">
                  <Label htmlFor="rrss-objetivo">¿Qué quieres empujar?</Label>
                  <Textarea id="rrss-objetivo" rows={2} maxLength={500} value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Cerramientos de terraza antes del verano" />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rrss-semanas">Semanas</Label>
                    <Input id="rrss-semanas" type="number" min={2} max={4} value={semanas} onChange={(e) => setSemanas(e.target.value)} className="w-20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rrss-porsemana">Por semana</Label>
                    <Input id="rrss-porsemana" type="number" min={1} max={5} value={porSemana} onChange={(e) => setPorSemana(e.target.value)} className="w-20" />
                  </div>
                  <Button type="submit" disabled={campanaIA.isPending}>
                    {campanaIA.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Proponer campaña
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
        {campanas.map((c) => <FichaCampana key={c.id} c={c} puedeEditar={puedeEditar} facebook={Boolean(conexion?.facebook)} onAbrirCalendario={onAbrirCalendario} />)}
      </div>
    </div>
  );
}
