import { useState } from "react";
import { Building2, HelpCircle, ImageIcon, Loader2, Wrench } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { FormNegocio } from "@/components/web/contenido/FormNegocio";
import { FormServicios } from "@/components/web/contenido/FormServicios";
import { FormFaq } from "@/components/web/contenido/FormFaq";
import { FormImagenes } from "@/components/web/contenido/FormImagenes";
import { useContenidoWeb } from "@/hooks/useWebContenido";

type Bloque = "negocio" | "servicios" | "faq" | "imagenes";

/**
 * Web › Contenido: los textos y las imágenes fijas de la web (tabla web_contenido). La web mezcla lo de aquí sobre
 * lo de su código: lo que se deja vacío lo pone ella. Quien ve Contenido ve también las fotos (para elegir imágenes) y,
 * con «Editar», puede subir fotos sueltas.
 */
export function TabContenido({ puedeEditar }: { puedeEditar: boolean }) {
  const { data, isLoading, error, refetch } = useContenidoWeb();
  const [bloque, setBloque] = useState<Bloque>("negocio");
  if (error) return <EstadoErrorCarga titulo="los textos de la web" error={error} onReintentar={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-10" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Cargando contenido…</span>
      </div>
    );
  }
  return (
    <Tabs value={bloque} onValueChange={(v) => setBloque(v as Bloque)}>
      <PestanasPagina
        nivel={2}
        pestanas={[
          { valor: "negocio", etiqueta: "Datos del negocio", icono: <Building2 /> },
          { valor: "servicios", etiqueta: "Servicios", icono: <Wrench /> },
          { valor: "faq", etiqueta: "Preguntas frecuentes", icono: <HelpCircle /> },
          { valor: "imagenes", etiqueta: "Imágenes de la web", icono: <ImageIcon /> },
        ]}
      />
      <TabsContent value="negocio" className="m-0">
        <FormNegocio valor={data.negocio} puedeEditar={puedeEditar} />
      </TabsContent>
      <TabsContent value="servicios" className="m-0">
        <FormServicios valor={data.servicios} puedeEditar={puedeEditar} />
      </TabsContent>
      <TabsContent value="faq" className="m-0">
        <FormFaq valor={data.faq} puedeEditar={puedeEditar} />
      </TabsContent>
      <TabsContent value="imagenes" className="m-0">
        <FormImagenes valor={data.imagenes} puedeEditar={puedeEditar} />
      </TabsContent>
    </Tabs>
  );
}
