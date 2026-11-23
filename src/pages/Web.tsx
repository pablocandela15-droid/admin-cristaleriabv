import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator, Clock, FileText, Images } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { TabFotos } from "@/components/web/fotos/TabFotos";
import { TabTarifas } from "@/components/web/tarifas/TabTarifas";
import { TabContenido } from "@/components/web/contenido/TabContenido";
import { usePermisosWeb } from "@/hooks/usePermisosWeb";
import { PESTANAS_WEB, pestanaWebPermitida, pestanasWeb, type PestanaWeb } from "@/lib/web/permisos";
import { AVISO_PUBLICACION_WEB } from "@/lib/web/fotos";

// ---------------------------------------------------------------------------
// Web (/web): lo que se edita de la web de la cristalería. Una pestaña por
// sección de permisos: «Fotos» (books de trabajos), «Tarifas» (precios y
// opciones de la calculadora) y «Contenido» (textos e imágenes). Con solo
// «Ver» la pestaña sale en solo lectura. La web lee los cambios cada minuto.
// ---------------------------------------------------------------------------

const ICONOS: Record<PestanaWeb, JSX.Element> = { fotos: <Images />, tarifas: <Calculator />, contenido: <FileText /> };

const Web = () => {
  const permisos = usePermisosWeb();
  const visibles = pestanasWeb(permisos);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabUrl = pestanaWebPermitida(searchParams.get("tab"), permisos) ?? "fotos";
  const [activa, setActiva] = useState<PestanaWeb>(tabUrl);
  useEffect(() => setActiva(tabUrl), [tabUrl]);

  const cambiar = (v: string) => {
    setActiva(v as PestanaWeb);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", v);
      return p;
    }, { replace: true });
  };

  const soloLectura = !permisos.cargando && visibles.includes(activa) && !permisos[activa].editar;

  return (
    <DashboardLayout>
      <Tabs value={activa} onValueChange={cambiar} className="flex flex-col">
        <PestanasPagina
          accionesDebajoEnMovil
          pestanas={PESTANAS_WEB.filter((p) => visibles.includes(p.valor)).map((p) => ({
            valor: p.valor,
            etiqueta: p.etiqueta,
            icono: ICONOS[p.valor],
          }))}
          acciones={
            <>
              <span className="ml-auto" aria-hidden="true" />
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex" data-testid="aviso-publicacion">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {AVISO_PUBLICACION_WEB}
              </span>
              {soloLectura && <EtiquetaSoloLectura />}
            </>
          }
        />
        <p className="mb-3 text-xs text-muted-foreground md:hidden">{AVISO_PUBLICACION_WEB}</p>
        {visibles.includes("fotos") && (
          <TabsContent value="fotos" className="m-0 outline-none">
            <TabFotos puedeEditar={permisos.fotos.editar} />
          </TabsContent>
        )}
        {visibles.includes("tarifas") && (
          <TabsContent value="tarifas" className="m-0 outline-none">
            <TabTarifas puedeEditar={permisos.tarifas.editar} />
          </TabsContent>
        )}
        {visibles.includes("contenido") && (
          <TabsContent value="contenido" className="m-0 outline-none">
            <TabContenido puedeEditar={permisos.contenido.editar} />
          </TabsContent>
        )}
      </Tabs>
    </DashboardLayout>
  );
};

export default Web;
