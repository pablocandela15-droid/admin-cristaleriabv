import { useState } from "react";
import { BarChart3, Send, Settings2, Users } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { CreadorNewsletter } from "@/components/newsletter/CreadorNewsletter";
import { GestionSuscriptores } from "@/components/newsletter/GestionSuscriptores";
import { EstadisticasNewsletter } from "@/components/newsletter/EstadisticasNewsletter";
import { HistorialEnvios } from "@/components/newsletter/HistorialEnvios";
import { ConfiguracionNewsletter } from "@/components/newsletter/ConfiguracionNewsletter";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCanAccessSection } from "@/hooks/useUserRole";

// ---------------------------------------------------------------------------
// Marketing › Newsletter (/newsletter), portada del panel de referencia y adaptada a la cristalería. Pestañas:
// «Crear y enviar» (solo con «Editar»), «Suscriptores», «Estadísticas» (con el historial) y «Configuración» (qué
// falta y ajustes). Sección de permisos «newsletter»: «Ver» consulta; «Editar» crea, envía, da de alta y de baja y
// cambia los ajustes. Las funciones y la base de datos exigen lo mismo. Ver docs/NEWSLETTER.md.
// ---------------------------------------------------------------------------

/** Suelo (px) del alto de la página: por debajo deja de encoger y la página hace scroll. */
const ALTURA_MINIMA_NEWSLETTER = 360;
const PESTANAS = ["crear", "suscriptores", "estadisticas", "configuracion"] as const;
type Pestana = (typeof PESTANAS)[number];

/** `data-[state=inactive]:hidden`: Radix deja montadas las pestañas inactivas con `hidden` y un `flex` le gana. */
const CONTENIDO_PESTANA = "mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

export default function Newsletter() {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_NEWSLETTER);
  // `?tab=suscriptores` (o estadisticas, configuracion) abre directamente esa pestaña.
  const [pestana, setPestana] = useState<Pestana>(() => {
    const pedida = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return PESTANAS.includes(pedida as Pestana) ? (pedida as Pestana) : "crear";
  });
  const { canAccess: puedeEditar, loading: cargandoPermiso } = useCanAccessSection("newsletter", "edit");
  const soloLectura = !cargandoPermiso && !puedeEditar;
  // Sin «Editar» no hay «Crear y enviar»: si se pidió (o es la de por defecto), se abre «Suscriptores».
  const visible = !puedeEditar && pestana === "crear" ? "suscriptores" : pestana;

  return (
    <DashboardLayout>
      <div ref={setRaiz} className="flex flex-col gap-2" style={alto ? { height: alto } : undefined}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Newsletter</h1>
          <BotonAyuda seccion="newsletter" className="-my-2" />
        </div>
        <Tabs value={visible} onValueChange={(v) => setPestana(v as Pestana)} className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            pestanas={[
              ...(puedeEditar ? [{ valor: "crear", etiqueta: "Crear y enviar", etiquetaCorta: "Crear", icono: <Send />, tour: "newsletter-pestana-crear" }] : []),
              { valor: "suscriptores", etiqueta: "Suscriptores", icono: <Users />, tour: "newsletter-pestana-suscriptores" },
              { valor: "estadisticas", etiqueta: "Estadísticas", icono: <BarChart3 />, tour: "newsletter-pestana-estadisticas" },
              { valor: "configuracion", etiqueta: "Configuración", etiquetaCorta: "Ajustes", icono: <Settings2 />, tour: "newsletter-pestana-configuracion" },
            ]}
            acciones={soloLectura ? <EtiquetaSoloLectura /> : undefined}
          />
          {puedeEditar && (
            <TabsContent value="crear" className={`${CONTENIDO_PESTANA} lg:flex lg:flex-col lg:overflow-hidden`}>
              <CreadorNewsletter onIrAConfiguracion={() => setPestana("configuracion")} />
            </TabsContent>
          )}
          <TabsContent value="suscriptores" className={CONTENIDO_PESTANA}>
            <GestionSuscriptores puedeEditar={puedeEditar} />
          </TabsContent>
          <TabsContent value="estadisticas" className={CONTENIDO_PESTANA}>
            <EstadisticasNewsletter historial={<HistorialEnvios />} />
          </TabsContent>
          <TabsContent value="configuracion" className={CONTENIDO_PESTANA}>
            <ConfiguracionNewsletter puedeEditar={puedeEditar} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
