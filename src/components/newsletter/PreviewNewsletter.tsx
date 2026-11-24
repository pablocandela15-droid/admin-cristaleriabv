import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { validarBloques, URL_WEB, type Bloque, type DisenoNewsletter } from "@/lib/newsletter/diseno";
import { useNegocioNewsletter } from "@/hooks/useNewsletterPlantillas";
// MISMA función que usa enviar-newsletter para el correo real (código puro): la vista previa no puede divergir del envío.
import { renderNewsletter } from "../../../supabase/functions/_shared/newsletter/plantillas";
import { urlBajaMuestra } from "../../../supabase/functions/_shared/newsletter/enlaces";

interface PreviewNewsletterProps {
  diseno: DisenoNewsletter | null;
  /** web_url de los ajustes (pie y enlaces de la vista previa). */
  web?: string | null;
}

/**
 * Mientras se edita, un bloque a medias (sin texto, foto sin elegir…) no se pinta, en vez de dejar la vista previa
 * en blanco. El envío sí lo rechaza.
 */
export function bloquesParaVistaPrevia(bloques: readonly Bloque[]): Bloque[] {
  return bloques.flatMap((b): Bloque[] => {
    if (b.tipo === "separador") return [b];
    const v = validarBloques([b]);
    return v.ok ? v.bloques : [];
  });
}

type Pantalla = "escritorio" | "movil";

/**
 * Vista previa del correo (portada del panel de referencia) con el mismo HTML que el envío y el pie con los datos
 * del negocio de la web; se puede ver como en el ordenador (600 px) o como en el móvil (375 px).
 */
export function PreviewNewsletter({ diseno, web }: PreviewNewsletterProps) {
  const [pantalla, setPantalla] = useState<Pantalla>("escritorio");
  const { data: negocio } = useNegocioNewsletter(web);
  const html = useMemo(() => {
    if (!diseno) return "";
    const bloques = bloquesParaVistaPrevia(diseno.bloques);
    return renderNewsletter(
      {
        tipo: diseno.tipo,
        titulo: diseno.titulo.trim() || "Asunto del correo",
        mensaje: "",
        bloques: bloques.length ? bloques : [{ tipo: "texto", texto: "El contenido aparecerá aquí…" }],
        insignia: diseno.insignia,
        preheader: diseno.preheader,
      },
      urlBajaMuestra(web || URL_WEB),
      negocio ? { negocio } : {},
    );
  }, [diseno, negocio, web]);

  if (!diseno) {
    return (
      <Card className="flex min-h-[500px] items-center justify-center bg-muted/30 lg:min-h-0 lg:flex-1">
        <div className="px-6 py-12 text-center">
          <p className="text-muted-foreground">Elige una plantilla o crea el correo con IA para ver aquí cómo quedará</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" data-tour="newsletter-vista-previa">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
        <span className="pl-1">Vista previa del email</span>
        <ToggleGroup
          type="single"
          value={pantalla}
          onValueChange={(v) => v && setPantalla(v as Pantalla)}
          aria-label="Ver la vista previa como en"
          className="gap-1"
        >
          <ToggleGroupItem value="escritorio" aria-label="Ordenador" title="Como en el ordenador" className="h-9 gap-1 px-2 text-xs">
            <Monitor className="h-4 w-4" aria-hidden="true" /> Ordenador
          </ToggleGroupItem>
          <ToggleGroupItem value="movil" aria-label="Móvil" title="Como en el móvil" className="h-9 gap-1 px-2 text-xs">
            <Smartphone className="h-4 w-4" aria-hidden="true" /> Móvil
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="max-h-[640px] overflow-y-auto bg-muted/20 lg:flex lg:max-h-none lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
        <iframe
          srcDoc={html}
          className={cn(
            "mx-auto block min-h-[600px] border-0 bg-white lg:min-h-0 lg:flex-1",
            pantalla === "movil" ? "w-[375px] max-w-full shadow-sm" : "w-full",
          )}
          title={pantalla === "movil" ? "Vista previa del email en el móvil" : "Vista previa del email"}
          sandbox=""
        />
      </div>
      <div className="shrink-0 border-t p-2 text-center text-xs text-muted-foreground">
        El pie con los datos del negocio y el enlace para darse de baja se añade siempre, automáticamente. Cada suscriptor
        recibe su enlace personal y el botón «Cancelar suscripción» de su programa de correo.
      </div>
    </Card>
  );
}
