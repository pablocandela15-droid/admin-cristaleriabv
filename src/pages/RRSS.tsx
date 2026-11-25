import { useCallback, useState } from "react";
import { BarChart3, CalendarDays, Lightbulb, Link2, ListChecks, PenSquare } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { CrearPublicacion, type AbrirEnCrear } from "@/components/rrss/CrearPublicacion";
import { CalendarioRrss } from "@/components/rrss/CalendarioRrss";
import { HistorialRrss } from "@/components/rrss/HistorialRrss";
import { IdeasCampanasRrss } from "@/components/rrss/IdeasCampanasRrss";
import { MetricasRrss } from "@/components/rrss/MetricasRrss";
import { ConexionRrss } from "@/components/rrss/ConexionRrss";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useConexionRrss, usePiezasRrss } from "@/hooks/useRrss";

// ---------------------------------------------------------------------------
// Marketing › RRSS (/rrss), portada de la sección RRSS (Instagram, Facebook y métricas) del panel de referencia y
// adaptada a la cristalería. Pestañas: «Crear» (solo con «Editar»), «Calendario», «Publicaciones», «Ideas y
// campañas», «Métricas» y «Conexión y estilo». Sección de permisos «rrss»: «Ver» consulta; «Editar» crea, publica,
// programa, usa la IA, conecta la cuenta y cambia el estilo. Las funciones y la base de datos exigen lo mismo.
// `?tab=conexion` (y `&conexion=ok|…` a la vuelta de Facebook) abre esa pestaña. Ver docs/RRSS.md.
// ---------------------------------------------------------------------------

const ALTURA_MINIMA_RRSS = 420;
const PESTANAS = ["crear", "calendario", "publicaciones", "ideas", "metricas", "conexion"] as const;
type Pestana = (typeof PESTANAS)[number];

const CONTENIDO_PESTANA = "mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

export default function RRSS() {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_RRSS);
  const [pestana, setPestana] = useState<Pestana>(() => {
    const pedida = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return PESTANAS.includes(pedida as Pestana) ? (pedida as Pestana) : "crear";
  });
  const { canAccess: puedeEditar, loading: cargandoPermiso } = useCanAccessSection("rrss", "edit");
  const soloLectura = !cargandoPermiso && !puedeEditar;
  const { data: conexion } = useConexionRrss();
  const { data: piezas } = usePiezasRrss();
  const [abrir, setAbrir] = useState<AbrirEnCrear | null>(null);
  // Sin «Editar» no hay «Crear»: si se pidió (o es la de por defecto), se abre «Publicaciones».
  const visible: Pestana = !puedeEditar && pestana === "crear" ? "publicaciones" : pestana;
  const errores = piezas?.filter((p) => p.estado === "error").length ?? 0;
  const abrirEnCrear = useCallback((grupoId: string) => {
    setAbrir({ grupoId });
    setPestana("crear");
  }, []);
  const yaAbierto = useCallback(() => setAbrir(null), []);

  return (
    <DashboardLayout>
      <div ref={setRaiz} className="flex flex-col gap-2" style={alto ? { height: alto } : undefined}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">RRSS</h1>
          <BotonAyuda seccion="rrss" className="-my-2" />
        </div>
        <Tabs value={visible} onValueChange={(v) => setPestana(v as Pestana)} className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            soloIconosEnMovil
            pestanas={[
              ...(puedeEditar ? [{ valor: "crear", etiqueta: "Crear", icono: <PenSquare />, tour: "rrss-pestana-crear" }] : []),
              { valor: "calendario", etiqueta: "Calendario", icono: <CalendarDays />, tour: "rrss-pestana-calendario" },
              { valor: "publicaciones", etiqueta: "Publicaciones", icono: <ListChecks />, tour: "rrss-pestana-publicaciones", contador: errores || undefined, tonoContador: "rojo" as const, etiquetaContador: `${errores} con error` },
              { valor: "ideas", etiqueta: "Ideas y campañas", etiquetaCorta: "Ideas", icono: <Lightbulb />, tour: "rrss-pestana-ideas" },
              { valor: "metricas", etiqueta: "Métricas", icono: <BarChart3 />, tour: "rrss-pestana-metricas" },
              { valor: "conexion", etiqueta: "Conexión y estilo", etiquetaCorta: "Conexión", icono: <Link2 />, tour: "rrss-pestana-conexion",
                contador: conexion && !conexion.conectada ? 1 : conexion?.caducidad.nivel === "aviso" || conexion?.caducidad.nivel === "caducado" ? 1 : undefined,
                tonoContador: "crema" as const, etiquetaContador: "Falta conectar o renovar" },
            ]}
            acciones={soloLectura ? <EtiquetaSoloLectura /> : undefined}
          />
          {puedeEditar && (
            <TabsContent value="crear" className={CONTENIDO_PESTANA}>
              <CrearPublicacion puedeEditar={puedeEditar} abrir={abrir} onAbierto={yaAbierto} onIrA={(p) => setPestana(p as Pestana)} />
            </TabsContent>
          )}
          <TabsContent value="calendario" className={CONTENIDO_PESTANA}>
            <CalendarioRrss puedeEditar={puedeEditar} onAbrir={abrirEnCrear} />
          </TabsContent>
          <TabsContent value="publicaciones" className={CONTENIDO_PESTANA}>
            <HistorialRrss puedeEditar={puedeEditar} onAbrir={abrirEnCrear} />
          </TabsContent>
          <TabsContent value="ideas" className={CONTENIDO_PESTANA}>
            <IdeasCampanasRrss puedeEditar={puedeEditar} onAbrirCalendario={() => setPestana("calendario")}
              onCrear={(idea) => { setAbrir({ idea }); setPestana("crear"); }} />
          </TabsContent>
          <TabsContent value="metricas" className={CONTENIDO_PESTANA}>
            <MetricasRrss puedeEditar={puedeEditar} />
          </TabsContent>
          <TabsContent value="conexion" className={CONTENIDO_PESTANA}>
            <ConexionRrss puedeEditar={puedeEditar} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
