import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ShoppingCart, Upload } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { TabCompras } from "@/components/facturas/compras/TabCompras";
import { CosteLecturaMes } from "@/components/facturas/CosteLecturaMes";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { MODOS_COMPRAS, PARAMS_ENLACE_COMPRAS, esNavegacionDeFicha, type ModoCompras } from "@/lib/facturas/compras";
import { pestanaPermitida, pestanasFacturas, type PestanaFacturas } from "@/lib/facturas/permisos";
import { usePermisosFacturas } from "@/hooks/usePermisosFacturas";
import { useContadorDocumentos } from "@/hooks/useContadorDocumentos";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useColaSubidaOpcional } from "@/hooks/useColaSubida";

// Dos pestañas: «Compras» (Documentos · Productos · Proveedores) y «Cargar» (subir y leer facturas).
const PESTANAS = ["compras", "cargar"] as const;
/** Pestaña al entrar en /facturas sin `?tab=`. */
const PESTANA_INICIAL: PestanaFacturas = "compras";
/** Alto mínimo de la página: por debajo, la página hace scroll en vez de apretar más las listas. */
const ALTURA_MINIMA_FACTURAS = 360;

const pestanaDeUrl = (v: string | null): PestanaFacturas | null => {
  // `?tab=productos` o `?tab=documentos` (enlaces de la campana): son modos de Compras.
  if (v === "documentos" || v === "productos") return "compras";
  return (PESTANAS as readonly string[]).includes(v ?? "") ? (v as PestanaFacturas) : null;
};

// Permisos (ver lib/facturas/permisos.ts): «Ver» consulta Compras; «Facturas · Subida», la pestaña Cargar
// (con solo Subida, es la única y los enlaces a Compras llevan a ella); «Editar», todo. Lo que no se puede
// usar se OCULTA y arriba sale «Solo lectura».

const Facturas = () => {
  const permisos = usePermisosFacturas();
  const visibles = pestanasFacturas(permisos);
  // `?tab=cargar`: el indicador de subidas, los toasts y la campana llevan directos a «Cargar».
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: claveNavegacion, state: estadoNavegacion } = useLocation();
  // Abrir o cerrar una ficha de Compras es una entrada del historial (`?doc=` / `?producto=` con la pila en
  // el `state`): no es un enlace nuevo, así que no se vuelve a aplicar como `modoPedido`.
  const esFichaCompras = esNavegacionDeFicha(estadoNavegacion);
  const ultimoModoPedido = useRef<{ modo: ModoCompras; clave: string; doc?: number; mes?: string; prov?: number } | undefined>(undefined);
  const tabPedida: PestanaFacturas = pestanaDeUrl(searchParams.get("tab")) ?? PESTANA_INICIAL;
  // La pedida si se puede ver; si no, la primera que sí (solo Subida: Cargar).
  const tabUrl: PestanaFacturas = pestanaPermitida(tabPedida, permisos) ?? PESTANA_INICIAL;
  const [activeTab, setActiveTab] = useState<PestanaFacturas>(tabUrl);
  // `?tab=productos` (la campana) abre Compras en el modo Productos.
  // `?tab=compras&modo=documentos&doc=<id>` (el «Ver» de Cargar y los avisos de precio) abre ESE documento.
  // `&mes=YYYY-MM` (Documentos de ese mes) y `&prov=<id>` (ese proveedor desplegado).
  const modoPedido = useMemo(() => {
    if (esFichaCompras) return ultimoModoPedido.current;
    const modoUrl = MODOS_COMPRAS.find((m) => m.valor === searchParams.get("modo"))?.valor;
    const docNum = Number(searchParams.get("doc"));
    const doc = Number.isInteger(docNum) && docNum > 0 ? docNum : undefined;
    const mesUrl = searchParams.get("mes");
    const mes = mesUrl && /^\d{4}-\d{2}$/.test(mesUrl) ? mesUrl : undefined;
    const provNum = Number(searchParams.get("prov"));
    const prov = Number.isInteger(provNum) && provNum > 0 ? provNum : undefined;
    const modo: ModoCompras | undefined =
      searchParams.get("tab") === "productos" ? "productos" : (modoUrl ?? (doc || mes ? "documentos" : prov ? "proveedores" : undefined));
    return modo
      ? {
          modo,
          clave: claveNavegacion,
          doc: modo === "documentos" ? doc : undefined,
          mes: modo === "documentos" ? mes : undefined,
          prov: modo === "proveedores" ? prov : undefined,
        }
      : undefined;
  }, [searchParams, claveNavegacion, esFichaCompras]);
  useEffect(() => {
    ultimoModoPedido.current = modoPedido;
  }, [modoPedido]);
  useEffect(() => {
    setActiveTab(tabUrl);
    // `claveNavegacion`: volver a tocar el indicador estando ya en esta URL (pero en otra pestaña) también
    // vuelve a «Cargar».
  }, [tabUrl, claveNavegacion]);
  // Un enlace a una pestaña que no puede ver (solo Subida y `?tab=compras&doc=7`): la URL pasa a la que se
  // ve, sin apilar historial (la cola sabe así que está en Cargar).
  useEffect(() => {
    if (permisos.cargando || tabUrl === tabPedida || searchParams.get("tab") === tabUrl) return;
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tabUrl);
      for (const k of PARAMS_ENLACE_COMPRAS) p.delete(k);
      return p;
    }, { replace: true });
  }, [permisos.cargando, tabUrl, tabPedida, searchParams, setSearchParams]);
  // La pestaña va también a la URL (sin apilar historial): así la cola sabe si estás mirando «Cargar» y no
  // apunta en la campana lo que ya ves.
  const cambiarPestana = (v: string) => {
    setActiveTab(v as PestanaFacturas);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", v);
      // El enlace profundo ya se aplicó: que no vuelva a abrir el documento al volver a Compras.
      for (const k of PARAMS_ENLACE_COMPRAS) p.delete(k);
      return p;
    }, { replace: true });
  };
  const subidas = useColaSubidaOpcional();
  const activosSubida = subidas?.activos ?? 0;
  // Alto de la pantalla, calculado solo: la página ocupa justo lo visible y cada pestaña reparte ese alto
  // por dentro. Sin medida (jsdom, primer pintado) cae al `calc(100dvh-6rem)`.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_FACTURAS);

  // Un `count` de cabeceras para el número de la pestaña. Sin Compras (solo Subida) no se pide.
  const { data: totalDocumentos = 0 } = useContadorDocumentos({ enabled: permisos.consultar });
  // Compras se monta la primera vez que se visita (y luego se queda montada): entrar por Cargar no la
  // descarga, y al volver sigue como estaba.
  const [comprasMontada, setComprasMontada] = useState(activeTab === "compras");
  const veCompras = visibles.includes("compras");
  const veCargar = visibles.includes("cargar");
  // «Solo lectura» en Compras para quien la consulta sin «Editar» (en Cargar sube y corrige lo suyo).
  const soloLectura = permisos.consultar && !permisos.editar && activeTab !== "cargar";
  useEffect(() => {
    if (activeTab === "compras") setComprasMontada(true);
  }, [activeTab]);

  return (
    <DashboardLayout>
      <div
        ref={setRaiz}
        className={`flex flex-col space-y-2 sm:space-y-4 ${alto ? "" : "h-[calc(100vh-6rem)] supports-[height:100dvh]:h-[calc(100dvh-6rem)]"}`}
        style={alto ? { height: alto } : undefined}
      >
        <Tabs value={activeTab} onValueChange={cambiarPestana} className="flex flex-1 flex-col min-h-0">
          <PestanasPagina
            accionesDebajoEnMovil
            pestanas={[
              { valor: "compras", etiqueta: "Compras", icono: <ShoppingCart />, contador: totalDocumentos, tour: "facturas-pestana-compras" },
              {
                valor: "cargar",
                etiqueta: "Cargar",
                icono: <Upload />,
                contador: activosSubida,
                etiquetaContador: `${activosSubida} procesando`,
                contadorEnMovil: true,
                tour: "facturas-pestana-cargar",
              },
            ].filter((p) => visibles.includes(p.valor as PestanaFacturas))}
            acciones={
              <>
                <span className="ml-auto" aria-hidden="true" />
                {soloLectura && <EtiquetaSoloLectura />}
                <BotonAyuda seccion="facturas" className="max-sm:w-9" />
              </>
            }
          />

          <div className="relative min-h-0 flex-1">
            {/* COMPRAS: un buscador, Documentos · Productos · Proveedores, lista compacta y ficha. Ocupa el alto
                de la pestaña; solo la lista y la ficha hacen scroll por dentro. `forceMount`: al volver de Cargar
                sigue la misma búsqueda y la misma ficha abierta. */}
            {veCompras && (
              <TabsContent value="compras" forceMount className="m-0 h-full outline-none data-[state=inactive]:hidden">
                {comprasMontada && <TabCompras modoPedido={modoPedido} />}
              </TabsContent>
            )}

            {/* CARGAR: la tarjeta ocupa el alto de la pestaña y solo su lista hace scroll por dentro. */}
            {veCargar && (
              <TabsContent value="cargar" className="m-0 h-full outline-none data-[state=inactive]:hidden">
                <div className="mx-auto flex h-full max-w-3xl flex-col gap-1">
                  {/* Lo que ha costado leer este mes: de quien consulta Facturas (con solo Subida, no). */}
                  {activeTab === "cargar" && permisos.consultar && (
                    <div className="flex min-w-0 max-w-full shrink-0 items-center justify-end" data-tour="facturas-coste-lectura">
                      <CosteLecturaMes />
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <SubidaFacturas />
                  </div>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Facturas;
