import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useIsBelow } from "@/hooks/use-mobile";

import { AccesosRapidos } from "@/components/dashboard/widgets/AccesosRapidos";
import { AvisosDashboard } from "@/components/dashboard/widgets/AvisosDashboard";

/**
 * ALTO DE LA PANTALLA (06/10/2026, regla para todo el panel: «que no haya scroll vertical: el alto de la página es
 * el alto de la pantalla del dispositivo»). `useAlturaDisponible`: alto del viewport visual − posición del bloque −
 * relleno inferior del <main>, recalculado al redimensionar, girar la tablet o plegar el menú. El Dashboard mide
 * justo eso y lo reparte: «Accesos rápidos» arriba, con su alto natural; «Avisos» debajo, con lo que sobra.
 *
 * SUELO (px): por debajo el bloque no encoge más y, solo entonces, la página hace scroll.
 */
export const ALTURA_MINIMA_DASHBOARD = 420;
/** Móvil (< 768 px): las tarjetas de acceso van una debajo de otra y ocupan más. */
export const ALTURA_MINIMA_DASHBOARD_MOVIL = 640;

export default function Dashboard() {
  // Sin medida (jsdom, primer pintado sin layout) cae al layout de siempre: cada widget con su alto natural.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const movil = useIsBelow(768);
  const alto = useAlturaDisponible(raiz, movil ? ALTURA_MINIMA_DASHBOARD_MOVIL : ALTURA_MINIMA_DASHBOARD);
  const medida = alto !== null;

  return (
    <DashboardLayout>
      <div
        ref={setRaiz}
        data-testid="dashboard"
        data-altura-fija={medida ? String(alto) : undefined}
        className="flex min-w-0 flex-col gap-3 sm:gap-4"
        style={medida ? { height: alto } : undefined}
      >
        <div data-testid="dashboard-accesos" className="min-h-0 flex-none">
          <AccesosRapidos />
        </div>
        <div data-testid="modulo-avisos" className="min-h-0 min-w-0 flex-1">
          <AvisosDashboard />
        </div>
      </div>
    </DashboardLayout>
  );
}
