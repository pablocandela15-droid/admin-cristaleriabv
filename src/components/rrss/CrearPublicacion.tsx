import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Crop, ExternalLink, Images, Lightbulb, Loader2, Plus, Save, Send, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  subirFichero, urlFotoWeb, useAjustesRrss, useConexionRrss, useGuardarGrupo, usePiezasRrss, usePublicarAhora, useUrlsFirmadas,
  type FotoWeb, type MedioRrss, type PiezaRrss, type ResultadoPublicacion,
} from "@/hooks/useRrss";
import { datosVideo, ENCUADRE_CENTRADO, recortarAJpeg, type Encuadre } from "@/lib/rrss/imagen";
import { cn } from "@/lib/utils";
import { FORMATOS, LIMITES, maxDuracionVideo, proporcionDeFormato, SERVICIOS_RRSS, type FormatoPieza, type Proporcion, type Red } from "../../../supabase/functions/_shared/rrss/formatos";
import { contarTexto, problemasPieza } from "../../../supabase/functions/_shared/rrss/validacion";
import { DialogoProgramar } from "./DialogoProgramar";
import { DialogoTextosIA } from "./DialogoTextosIA";
import { EncuadreImagen } from "./EncuadreImagen";
import { IconoRed } from "./EstadoPublicacion";
import { SelectorFotosWeb } from "./SelectorFotosWeb";
import { VistaPreviaMovil } from "./VistaPreviaMovil";

// ---------------------------------------------------------------------------
// RRSS › Crear (como «Crear» del panel de referencia, en dos columnas): qué publicar (redes, formato, fotos o vídeo
// subidos o de Web › Fotos, encuadre, tipo de trabajo, texto con ayuda de la IA) y así quedará (vista previa en un
// móvil y lo que falta), con «Publicar ahora», «Programar» y «Guardar borrador». Las fotos se recortan a JPEG en el
// navegador y se suben al cubo privado al guardar; Meta las recibe con una URL firmada.
// ---------------------------------------------------------------------------

interface Elemento {
  clave: string;
  tipo: "imagen" | "video";
  origen: "subida" | "web_fotos";
  webFotoId: string | null;
  /** Para recortar (Blob de la subida o URL de Web › Fotos); null si ya está en el cubo (guardada antes). */
  fuente: Blob | string | null;
  vistaLocal: string | null;
  encuadre: Encuadre;
  ruta: string | null;
  /** Hay que recortar y subir otra vez (encuadre o proporción cambiados). */
  sucio: boolean;
  ancho: number | null;
  alto: number | null;
  duracion: number | null;
  bytes: number | null;
  alt: string;
  portadaMs: number | null;
}

const PROPORCIONES_FEED: Array<{ valor: Proporcion; texto: string }> = [
  { valor: "4:5", texto: "Vertical 4:5" },
  { valor: "1:1", texto: "Cuadrada" },
  { valor: "1.91:1", texto: "Apaisada" },
];

const maxElementos = (f: FormatoPieza) => (f === "carrusel" ? LIMITES.carruselMax : 1);
const nuevaClave = () => crypto.randomUUID();

function deMedio(m: MedioRrss): Elemento {
  return {
    clave: m.id ?? nuevaClave(), tipo: m.tipo, origen: m.origen, webFotoId: m.web_foto_id, fuente: null, vistaLocal: null, encuadre: ENCUADRE_CENTRADO,
    ruta: m.ruta, sucio: false, ancho: m.ancho, alto: m.alto, duracion: m.duracion_s, bytes: m.bytes, alt: m.alt_text ?? "", portadaMs: m.portada_ms,
  };
}

export interface AbrirEnCrear {
  /** Abrir un envío guardado (borrador, lista o error). */
  grupoId?: string;
  /** Empezar una nueva con una idea de la IA. */
  idea?: { formato: FormatoPieza; servicio: string | null; caption: string; idea: string };
}

export function CrearPublicacion({ puedeEditar, abrir, onAbierto, onIrA }: { puedeEditar: boolean; abrir?: AbrirEnCrear | null; onAbierto?: () => void; onIrA?: (pestana: string) => void }) {
  const { data: conexion } = useConexionRrss();
  const { data: ajustes } = useAjustesRrss();
  const { data: piezas } = usePiezasRrss();
  const guardar = useGuardarGrupo();
  const publicar = usePublicarAhora();

  const [grupoId, setGrupoId] = useState<string | null>(null);
  const [redes, setRedes] = useState<Red[]>(["instagram"]);
  const [formato, setFormato] = useState<FormatoPieza>("foto");
  const [proporcion, setProporcion] = useState<Proporcion>("4:5");
  const [titulo, setTitulo] = useState("");
  const [servicio, setServicio] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [idea, setIdea] = useState<string | null>(null);
  const [elementos, setElementos] = useState<Elemento[]>([]);
  const [paso, setPaso] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoPublicacion[] | null>(null);
  const [fotosWeb, setFotosWeb] = useState(false);
  const [iaAbierta, setIaAbierta] = useState(false);
  const [programar, setProgramar] = useState<string[] | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [encuadrando, setEncuadrando] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const facebookConectado = Boolean(conexion?.facebook);
  const conectada = Boolean(conexion?.conectada);
  const proporcionEfectiva = proporcionDeFormato(formato, proporcion);

  // Marcar Facebook por defecto (ajustes) en una publicación nueva.
  useEffect(() => {
    if (!grupoId && ajustes?.facebook_por_defecto && facebookConectado && formato !== "story") setRedes((r) => (r.includes("facebook") ? r : [...r, "facebook"]));
  }, [ajustes?.facebook_por_defecto, facebookConectado, grupoId, formato]);

  // Abrir un borrador o una publicación guardada (desde el calendario, el historial o una campaña).
  useEffect(() => {
    if (!abrir?.idea) return;
    setGrupoId(null);
    setFormato(abrir.idea.formato);
    if (abrir.idea.formato === "story") setRedes(["instagram"]);
    setServicio(abrir.idea.servicio);
    setCaption(abrir.idea.caption);
    setIdea(abrir.idea.idea);
    setTitulo("");
    setElementos([]);
    setResultados(null);
    onAbierto?.();
  }, [abrir, onAbierto]);

  useEffect(() => {
    if (!abrir?.grupoId || !piezas) return;
    const grupo = piezas.filter((p) => p.grupo_id === abrir.grupoId);
    if (!grupo.length) return;
    const base = grupo.find((p) => p.red === "instagram") ?? grupo[0];
    setGrupoId(base.grupo_id);
    setRedes(grupo.filter((p) => ["borrador", "lista", "error"].includes(p.estado)).map((p) => p.red));
    setFormato(base.formato);
    setProporcion(base.proporcion === "9:16" ? "4:5" : base.proporcion);
    setTitulo(base.titulo ?? "");
    setServicio(base.servicio);
    setCaption(base.caption);
    setIdea(base.idea);
    setElementos(base.rrss_medios.map(deMedio));
    setResultados(null);
    onAbierto?.();
  }, [abrir, piezas, onAbierto]);

  const rutasCubo = elementos.map((e) => e.ruta).filter((r): r is string => Boolean(r));
  const { data: firmadas } = useUrlsFirmadas(rutasCubo);
  const vista = (e: Elemento) => e.vistaLocal ?? (e.ruta && !e.sucio ? firmadas?.[e.ruta] : null) ?? (typeof e.fuente === "string" ? e.fuente : null) ?? (e.ruta ? firmadas?.[e.ruta] : null) ?? "";

  const reiniciar = () => {
    for (const e of elementos) if (e.vistaLocal) URL.revokeObjectURL(e.vistaLocal);
    setGrupoId(null); setFormato("foto"); setProporcion("4:5"); setTitulo(""); setServicio(null); setCaption(""); setIdea(null);
    setElementos([]); setResultados(null); setRedes(ajustes?.facebook_por_defecto && facebookConectado ? ["instagram", "facebook"] : ["instagram"]);
  };

  const cambiarFormato = (f: FormatoPieza) => {
    if (!f) return;
    setFormato(f);
    if (f === "story") setRedes((r) => r.filter((x) => x !== "facebook"));
    setElementos((els) => els.slice(0, maxElementos(f)).map((e) => ({ ...e, sucio: e.tipo === "imagen" && e.fuente !== null ? true : e.sucio })));
  };
  const cambiarProporcion = (p: Proporcion) => {
    if (!p) return;
    setProporcion(p);
    setElementos((els) => els.map((e) => (e.tipo === "imagen" && e.fuente !== null ? { ...e, sucio: true } : e)));
  };
  const alternarRed = (red: Red, marcada: boolean) => setRedes((r) => (marcada ? [...new Set([...r, red])] : r.filter((x) => x !== red)));

  const hueco = maxElementos(formato) - elementos.length;
  const anadirFicheros = async (ficheros: FileList | null) => {
    if (!ficheros?.length) return;
    const nuevos: Elemento[] = [];
    for (const f of Array.from(ficheros).slice(0, Math.max(0, hueco))) {
      const esVideo = f.type.startsWith("video/") || /\.(mp4|mov)$/i.test(f.name);
      if (esVideo) {
        if (formato === "foto") { toast.error("Una foto no puede ser un vídeo: elige «Reel», «Historia» o «Carrusel»."); continue; }
        if (f.size > LIMITES.bytesFichero) { toast.error(`${f.name}: pasa de 50 MB. Recórtalo o grábalo en 1080p.`); continue; }
        try {
          const d = await datosVideo(f);
          const max = maxDuracionVideo(formato);
          if (d.duracion < LIMITES.videoMinS || d.duracion > max) {
            toast.error(`${f.name}: dura ${Math.round(d.duracion)} s. Aquí tiene que durar de ${LIMITES.videoMinS} s a ${max >= 120 ? `${max / 60} min` : `${max} s`}.`);
            continue;
          }
          nuevos.push({ clave: nuevaClave(), tipo: "video", origen: "subida", webFotoId: null, fuente: f, vistaLocal: URL.createObjectURL(f), encuadre: ENCUADRE_CENTRADO,
            ruta: null, sucio: true, ancho: d.ancho || null, alto: d.alto || null, duracion: Math.round(d.duracion * 100) / 100, bytes: f.size, alt: "", portadaMs: null });
        } catch (e) {
          toast.error((e as Error).message);
        }
      } else {
        if (formato === "reel") { toast.error("Un reel es un vídeo: para fotos elige «Foto» o «Carrusel»."); continue; }
        nuevos.push({ clave: nuevaClave(), tipo: "imagen", origen: "subida", webFotoId: null, fuente: f, vistaLocal: URL.createObjectURL(f), encuadre: ENCUADRE_CENTRADO,
          ruta: null, sucio: true, ancho: null, alto: null, duracion: null, bytes: f.size, alt: "", portadaMs: null });
      }
    }
    if (Array.from(ficheros).length > hueco) toast(`Caben ${maxElementos(formato)} como mucho en este formato.`);
    setElementos((els) => [...els, ...nuevos]);
    if (entrada.current) entrada.current.value = "";
  };
  const anadirFotosWeb = (fotos: FotoWeb[]) => {
    setElementos((els) => [...els, ...fotos.slice(0, Math.max(0, hueco)).map((f): Elemento => ({
      clave: nuevaClave(), tipo: "imagen", origen: "web_fotos", webFotoId: f.id, fuente: urlFotoWeb(f.ruta), vistaLocal: null, encuadre: ENCUADRE_CENTRADO,
      ruta: null, sucio: true, ancho: f.ancho, alto: f.alto, duracion: null, bytes: null, alt: f.alt ?? "", portadaMs: null,
    }))]);
    if (!servicio && fotos[0]?.servicio) setServicio(fotos[0].servicio);
  };
  const mover = (i: number, paso2: number) => setElementos((els) => {
    const j = i + paso2;
    if (j < 0 || j >= els.length) return els;
    const copia = [...els];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });
  const quitar = (clave: string) => setElementos((els) => {
    const e = els.find((x) => x.clave === clave);
    if (e?.vistaLocal) URL.revokeObjectURL(e.vistaLocal);
    return els.filter((x) => x.clave !== clave);
  });
  const cambiar = (clave: string, cambio: Partial<Elemento>) => setElementos((els) => els.map((e) => (e.clave === clave ? { ...e, ...cambio } : e)));

  const cuenta = contarTexto(caption);
  const problemas = useMemo(() => {
    const lista = new Set<string>();
    if (redes.length === 0) lista.add("Marca al menos una red");
    const medios = elementos.map((e) => ({ tipo: e.tipo, duracion_s: e.duracion, bytes: e.tipo === "video" ? e.bytes : null, alt_text: e.alt }));
    for (const red of redes) for (const p of problemasPieza({ red, formato, caption: formato === "story" ? "" : caption }, medios)) lista.add(p);
    if (redes.includes("facebook") && !facebookConectado && conectada) lista.add("No hay página de Facebook conectada");
    if (elementos.some((e) => e.sucio && e.tipo === "imagen" && e.fuente === null)) lista.add("Una foto guardada no se puede recortar de nuevo: quítala y vuelve a añadirla");
    return [...lista];
  }, [redes, formato, caption, elementos, facebookConectado, conectada]);

  /** Recorta y sube lo que falte (fotos con su encuadre, vídeos tal cual). Devuelve los ficheros listos. */
  const prepararMedios = async (soloImagenes = false): Promise<Elemento[]> => {
    const listos: Elemento[] = [];
    let n = 0;
    for (const e of elementos) {
      n++;
      if (soloImagenes && e.tipo !== "imagen") { listos.push(e); continue; }
      if (e.ruta && !e.sucio) { listos.push(e); continue; }
      setPaso(`Preparando ${n} de ${elementos.length}…`);
      if (e.tipo === "imagen") {
        if (!e.fuente) throw new Error("Una foto guardada no se puede recortar de nuevo: quítala y vuelve a añadirla.");
        const r = await recortarAJpeg(e.fuente, proporcionEfectiva, e.encuadre);
        const ruta = await subirFichero(r.blob, "jpg");
        listos.push({ ...e, ruta, sucio: false, ancho: r.ancho, alto: r.alto, bytes: r.blob.size });
      } else {
        const f = e.fuente as File;
        const ruta = await subirFichero(f, /\.mov$/i.test(f.name) || f.type === "video/quicktime" ? "mov" : "mp4");
        listos.push({ ...e, ruta, sucio: false });
      }
    }
    setElementos(listos);
    return listos;
  };

  const guardarTodo = async (estado: "borrador" | "lista"): Promise<PiezaRrss[]> => {
    const listos = await prepararMedios();
    setPaso("Guardando…");
    const medios: MedioRrss[] = listos.map((e, i) => ({
      orden: i, tipo: e.tipo, ruta: e.ruta as string, origen: e.origen, web_foto_id: e.webFotoId, ancho: e.ancho, alto: e.alto,
      duracion_s: e.duracion, bytes: e.bytes, alt_text: e.alt, portada_ms: e.portadaMs,
    }));
    const guardadas = await guardar.mutateAsync({ grupoId, redes, formato, proporcion: proporcionEfectiva, titulo, caption, servicio, estado, medios });
    if (guardadas[0]) setGrupoId(guardadas[0].grupo_id);
    return guardadas;
  };

  const ejecutar = async (accion: "borrador" | "programar" | "publicar") => {
    setResultados(null);
    try {
      const guardadas = await guardarTodo(accion === "borrador" ? "borrador" : "lista");
      if (accion === "borrador") toast.success("Borrador guardado");
      if (accion === "programar") setProgramar(guardadas.map((p) => p.id));
      if (accion === "publicar") {
        setPaso("Publicando… (con vídeo puede tardar un minuto)");
        const r = await publicar.mutateAsync(guardadas.map((p) => p.id));
        setResultados(r.resultados);
        if (r.ok) toast.success(r.resultados.some((x) => x.estado === "procesando") ? "Enviada: Instagram termina de procesar el vídeo y sale sola en unos minutos." : "¡Publicada!");
        else toast.error("Alguna red no se ha podido publicar: mira el detalle.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPaso(null);
    }
  };

  const ocupado = paso !== null;
  const usuario = conexion?.cuenta?.usuario ? `@${conexion.cuenta.usuario}` : null;
  const elementoEncuadre = elementos.find((e) => e.clave === encuadrando) ?? null;

  if (!puedeEditar) return <p className="p-4 text-sm text-muted-foreground">Para crear publicaciones hace falta «Editar» en RRSS.</p>;

  return (
    <div className="grid gap-4 pb-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-lg">{grupoId ? "Editar publicación" : "Nueva publicación"}</CardTitle>
          {grupoId && <Button type="button" variant="ghost" size="sm" onClick={reiniciar}><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Nueva</Button>}
        </CardHeader>
        <CardContent className="space-y-5">
          {!conectada && conexion && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              RRSS aún no está conectado con Instagram: puedes preparar y guardar borradores, pero no publicar ni programar.{" "}
              <button type="button" className="underline" onClick={() => onIrA?.("conexion")}>Ver qué falta</button>
            </p>
          )}
          {idea && <p className="flex gap-2 rounded-md bg-muted p-3 text-sm"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span><strong>Idea de la campaña:</strong> {idea}</span></p>}

          <fieldset className="space-y-2" data-tour="rrss-redes">
            <legend className="text-sm font-medium">Dónde</legend>
            <div className="flex flex-wrap gap-4">
              {(["instagram", "facebook"] as Red[]).map((red) => {
                const desactivada = red === "facebook" && (formato === "story" || (!facebookConectado && conectada));
                return (
                  <Label key={red} className={cn("flex items-center gap-2 font-normal", desactivada && "opacity-60")}>
                    <Checkbox checked={redes.includes(red)} disabled={desactivada || ocupado} onCheckedChange={(v) => alternarRed(red, v === true)} />
                    <IconoRed red={red} /> {red === "instagram" ? "Instagram" : "Facebook"}
                  </Label>
                );
              })}
            </div>
            {formato === "story" && <p className="text-xs text-muted-foreground">Las historias solo se publican en Instagram.</p>}
          </fieldset>

          <div className="space-y-2" data-tour="rrss-formato">
            <Label>Formato</Label>
            <ToggleGroup type="single" value={formato} onValueChange={(v) => cambiarFormato(v as FormatoPieza)} className="flex flex-wrap justify-start gap-1" disabled={ocupado}>
              {FORMATOS.map((f) => <ToggleGroupItem key={f.valor} value={f.valor} variant="outline" className="h-9" title={f.descripcion}>{f.nombre}</ToggleGroupItem>)}
            </ToggleGroup>
            {(formato === "foto" || formato === "carrusel") && (
              <ToggleGroup type="single" value={proporcion} onValueChange={(v) => cambiarProporcion(v as Proporcion)} className="flex flex-wrap justify-start gap-1" disabled={ocupado} aria-label="Recorte">
                {PROPORCIONES_FEED.map((p) => <ToggleGroupItem key={p.valor} value={p.valor} variant="outline" size="sm">{p.texto}</ToggleGroupItem>)}
              </ToggleGroup>
            )}
          </div>

          <div className="space-y-2" data-tour="rrss-medios">
            <Label>{formato === "reel" ? "Vídeo" : formato === "carrusel" ? `Fotos o vídeos (${elementos.length} de ${LIMITES.carruselMax})` : formato === "story" ? "Foto o vídeo" : "Foto"}</Label>
            <ul className="space-y-2">
              {elementos.map((e, i) => (
                <li key={e.clave} className="flex items-start gap-3 rounded-md border p-2">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-muted">
                    {e.tipo === "imagen" ? (vista(e) && <img src={vista(e)} alt="" className="h-full w-full object-cover" />)
                      : (vista(e) && <video src={vista(e)} className="h-full w-full object-cover" muted preload="metadata" />)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {i === 0 && elementos.length > 1 ? "Portada · " : ""}{e.tipo === "video" ? `Vídeo de ${Math.round(e.duracion ?? 0)} s` : e.origen === "web_fotos" ? "Foto de la web" : "Foto subida"}
                      {e.ruta && !e.sucio ? " · lista" : ""}
                    </p>
                    {e.tipo === "imagen" && formato !== "story" && (
                      <Input aria-label="Texto alternativo" placeholder="Texto alternativo (qué se ve, para personas ciegas)" value={e.alt} maxLength={1000}
                        onChange={(ev) => cambiar(e.clave, { alt: ev.target.value })} className="h-8 text-xs" />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    {e.tipo === "imagen" && e.fuente !== null && (
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Encuadrar" onClick={() => setEncuadrando(e.clave)} disabled={ocupado}><Crop className="h-4 w-4" /></Button>
                    )}
                    {elementos.length > 1 && <>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Subir" disabled={i === 0 || ocupado} onClick={() => mover(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Bajar" disabled={i === elementos.length - 1 || ocupado} onClick={() => mover(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    </>}
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Quitar" disabled={ocupado} onClick={() => quitar(e.clave)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
            {hueco > 0 && (
              <div className="flex flex-wrap gap-2">
                <input ref={entrada} type="file" className="hidden" multiple={formato === "carrusel"} onChange={(e) => anadirFicheros(e.target.files)}
                  accept={formato === "foto" ? "image/*" : formato === "reel" ? "video/mp4,video/quicktime" : "image/*,video/mp4,video/quicktime"} data-testid="rrss-entrada-fichero" />
                <Button type="button" variant="outline" onClick={() => entrada.current?.click()} disabled={ocupado}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" /> Subir {formato === "reel" ? "vídeo" : formato === "foto" ? "foto" : "fotos o vídeo"}
                </Button>
                {formato !== "reel" && (
                  <Button type="button" variant="outline" onClick={() => setFotosWeb(true)} disabled={ocupado} data-tour="rrss-fotos-web">
                    <Images className="mr-2 h-4 w-4" aria-hidden="true" /> Elegir de Web › Fotos
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rrss-servicio">Tipo de trabajo</Label>
              <Select value={servicio ?? "ninguno"} onValueChange={(v) => setServicio(v === "ninguno" ? null : v)}>
                <SelectTrigger id="rrss-servicio"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguno">Sin indicar</SelectItem>
                  {SERVICIOS_RRSS.map((s) => <SelectItem key={s.slug} value={s.slug}>{s.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rrss-titulo">Nombre interno (opcional)</Label>
              <Input id="rrss-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} placeholder="Mampara baño calle Mayor" />
            </div>
          </div>

          {formato !== "story" && (
            <div className="space-y-1.5" data-tour="rrss-texto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="rrss-caption">Texto</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setIaAbierta(true)} disabled={ocupado} data-tour="rrss-ia">
                  <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" /> Ayuda de la IA
                </Button>
              </div>
              <Textarea id="rrss-caption" rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={ocupado}
                placeholder="Qué se hizo, qué problema resuelve y cómo pedir presupuesto. Los hashtags, al final." />
              <p className={cn("text-xs", cuenta.caracteres > LIMITES.caption || cuenta.hashtags > LIMITES.hashtags ? "text-destructive" : "text-muted-foreground")}>
                {cuenta.caracteres}/{LIMITES.caption} caracteres · {cuenta.hashtags}/{LIMITES.hashtags} hashtags · {cuenta.menciones} menciones
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <VistaPreviaMovil red={redes[0] ?? "instagram"} formato={formato} proporcion={proporcionEfectiva} caption={formato === "story" ? "" : caption} usuario={usuario}
          elementos={elementos.map((e) => ({ clave: e.clave, tipo: e.tipo, url: vista(e), encuadre: e.tipo === "imagen" && e.fuente !== null && (e.sucio || !e.ruta) ? e.encuadre : null }))} />
        {problemas.length > 0 && (
          <ul className="space-y-1 rounded-md border p-3 text-sm" data-testid="rrss-problemas">
            {problemas.map((p) => <li key={p} className="text-muted-foreground">• {p}</li>)}
          </ul>
        )}
        {paso && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {paso}</p>}
        {resultados && (
          <ul className="space-y-2 rounded-md border p-3 text-sm" data-testid="rrss-resultados">
            {resultados.map((r) => (
              <li key={r.piezaId} className="flex items-start gap-2">
                <IconoRed red={r.red ?? "instagram"} className="mt-0.5" />
                <div className="min-w-0">
                  <p className={cn("font-medium", r.estado === "error" || r.estado === "omitida" || r.estado === "aplazada" ? "text-destructive" : "")}>
                    {r.estado === "publicada" ? "Publicada" : r.estado === "procesando" ? "Enviada (Meta la está procesando)" : r.estado === "aplazada" ? "Sin cupo de publicaciones" : "No se ha publicado"}
                  </p>
                  {r.mensaje && <p className="text-xs text-muted-foreground">{r.mensaje}</p>}
                  {r.error?.comoArreglarlo && <p className="text-xs text-muted-foreground">{r.error.comoArreglarlo}</p>}
                  {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">Verla <ExternalLink className="h-3 w-3" /></a>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2" data-tour="rrss-acciones">
          <Button type="button" onClick={() => setConfirmar(true)} disabled={ocupado || problemas.length > 0 || !conectada}>
            <Send className="mr-2 h-4 w-4" aria-hidden="true" /> Publicar ahora
          </Button>
          <Button type="button" variant="outline" onClick={() => ejecutar("programar")} disabled={ocupado || problemas.length > 0 || !conectada}>
            <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" /> Programar…
          </Button>
          <Button type="button" variant="ghost" onClick={() => ejecutar("borrador")} disabled={ocupado || (elementos.length === 0 && !caption.trim())}>
            <Save className="mr-2 h-4 w-4" aria-hidden="true" /> Guardar borrador
          </Button>
        </div>
      </div>

      <SelectorFotosWeb abierto={fotosWeb} onCerrar={() => setFotosWeb(false)} max={Math.max(1, hueco)} onElegir={anadirFotosWeb} />
      <DialogoTextosIA abierto={iaAbierta} onCerrar={() => setIaAbierta(false)} red={redes.includes("instagram") ? "instagram" : "facebook"} formato={formato} servicio={servicio}
        rutas={elementos.filter((e) => e.tipo === "imagen" && e.ruta && !e.sucio).map((e) => e.ruta as string)} iaDisponible={Boolean(conexion?.configuracion.ia)}
        prepararFotos={elementos.some((e) => e.tipo === "imagen") ? async () => {
          try {
            return (await prepararMedios(true)).filter((e) => e.tipo === "imagen" && e.ruta).map((e) => e.ruta as string);
          } finally {
            setPaso(null);
          }
        } : undefined}
        onElegir={(texto, alt) => {
          setCaption(texto);
          if (alt && elementos[0]?.tipo === "imagen" && !elementos[0].alt) cambiar(elementos[0].clave, { alt });
        }} />
      <DialogoProgramar abierto={programar !== null} onCerrar={() => setProgramar(null)} piezaIds={programar ?? []} onHecho={() => onIrA?.("calendario")} />
      <Dialog open={elementoEncuadre !== null} onOpenChange={(o) => !o && setEncuadrando(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Encuadre</DialogTitle></DialogHeader>
          {elementoEncuadre && (
            <EncuadreImagen src={vista(elementoEncuadre)} proporcion={proporcionEfectiva} valor={elementoEncuadre.encuadre}
              onCambio={(enc) => cambiar(elementoEncuadre.clave, { encuadre: enc, sucio: true })} />
          )}
          <Button type="button" onClick={() => setEncuadrando(null)}>Hecho</Button>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar ahora?</AlertDialogTitle>
            <AlertDialogDescription>
              Se publica ya en {redes.map((r) => (r === "instagram" ? `Instagram${usuario ? ` (${usuario})` : ""}` : `Facebook${conexion?.cuenta?.paginaNombre ? ` (${conexion.cuenta.paginaNombre})` : ""}`)).join(" y ")}.
              Después se puede borrar desde la app, pero no desde el panel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => ejecutar("publicar")}>Publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
