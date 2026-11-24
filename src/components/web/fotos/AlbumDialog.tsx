import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGuardarAlbum, type AlbumWeb } from "@/hooks/useWebFotos";
import { SERVICIOS_WEB, slugMientrasEscribe, slugificar, slugValido } from "@/lib/web/fotos";

const SIN_SERVICIO = "ninguno";

interface AlbumDialogProps {
  abierto: boolean;
  onCerrar: () => void;
  /** El book que se edita; sin él, uno nuevo. */
  album?: AlbumWeb | null;
  /** `orden` de los books que hay (el nuevo va al final). */
  ordenes: number[];
  onGuardado?: (id: string) => void;
}

/** Crear o editar un book: título, dirección (slug, sale sola del título), descripción, tipo de trabajo y si se publica. */
export function AlbumDialog({ abierto, onCerrar, album, ordenes, onGuardado }: AlbumDialogProps) {
  const guardar = useGuardarAlbum();
  const [titulo, setTitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [servicio, setServicio] = useState<string>(SIN_SERVICIO);
  const [publicado, setPublicado] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setTitulo(album?.titulo ?? "");
    setSlug(album?.slug ?? "");
    setSlugTocado(Boolean(album));
    setDescripcion(album?.descripcion ?? "");
    setServicio(album?.servicio ?? SIN_SERVICIO);
    setPublicado(album?.publicado ?? false);
  }, [abierto, album]);

  const cambiarTitulo = (v: string) => {
    setTitulo(v);
    if (!slugTocado) setSlug(slugificar(v));
  };
  const tituloOk = titulo.trim().length > 0 && titulo.trim().length <= 120;
  const slugOk = slugValido(slug);

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tituloOk || !slugOk) return;
    guardar.mutate(
      { id: album?.id, titulo, slug, descripcion: descripcion || null, servicio: servicio === SIN_SERVICIO ? null : servicio, publicado, ordenes },
      {
        onSuccess: (id) => {
          onGuardado?.(id);
          onCerrar();
        },
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={enviar} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{album ? "Editar book" : "Nuevo book de fotos"}</DialogTitle>
            <DialogDescription>
              Un book agrupa las fotos de un trabajo concreto. Para las fotos de un tipo de trabajo no hace falta: súbelas en su
              apartado. Si eliges un tipo, sus fotos salen también con las de ese tipo; si no, en «Trabajos» › «Todos».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="album-titulo">Título</Label>
            <Input id="album-titulo" value={titulo} maxLength={120} onChange={(e) => cambiarTitulo(e.target.value)} placeholder="Mamparas en Crevillente" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="album-slug">Dirección en la web</Label>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span className="shrink-0">/trabajos/</span>
              <Input
                id="album-slug"
                value={slug}
                maxLength={80}
                onChange={(e) => {
                  setSlugTocado(true);
                  setSlug(slugMientrasEscribe(e.target.value));
                }}
                onBlur={() => setSlug((s) => slugificar(s))}
                aria-invalid={slug !== "" && !slugOk}
              />
            </div>
            <p className="text-xs text-muted-foreground">Sale sola del título. Solo minúsculas, números y guiones.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="album-descripcion">Descripción (opcional)</Label>
            <Textarea id="album-descripcion" value={descripcion} maxLength={2000} rows={3} onChange={(e) => setDescripcion(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="album-servicio">Tipo de trabajo</Label>
            <Select value={servicio} onValueChange={setServicio}>
              <SelectTrigger id="album-servicio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_SERVICIO}>Ninguno (solo en «Trabajos» › «Todos»)</SelectItem>
                {SERVICIOS_WEB.map((s) => (
                  <SelectItem key={s.slug} value={s.slug}>
                    {s.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="album-publicado">Publicado</Label>
              <p className="text-xs text-muted-foreground">Mientras no lo publiques, la web no lo enseña.</p>
            </div>
            <Switch id="album-publicado" checked={publicado} onCheckedChange={setPublicado} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!tituloOk || !slugOk || guardar.isPending}>
              {guardar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {album ? "Guardar" : "Crear book"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
