// Dashboard › «Accesos rápidos»: las secciones del menú lateral que el usuario puede abrir (las mismas reglas
// que AppSidebar: permisos y módulos activados en Control del Panel), en su orden, como tarjetas grandes para
// la tablet. El Dashboard no sale (ya se está en él).
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutGrid } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useAdminFeatureToggles } from "@/hooks/useAdminFeatureToggles";
import { useAuth } from "@/hooks/useAuth";
import { MODULOS_MENU, moduloActivo, tienePermisoModulo } from "@/lib/modulosPanel";
import { nombreVisible } from "@/lib/usuario-actual";
import { precargarSeccion } from "@/lib/precargaSecciones";
import { NEGOCIO } from "@/config/negocio";
import { cn } from "@/lib/utils";

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AccesosRapidos() {
  const { user } = useAuth();
  const { permissions, loading } = useUserRole();
  const { isSuperAdmin, loading: superLoading } = useSuperAdmin();
  const { isEnabled, loading: togglesLoading } = useAdminFeatureToggles();
  const cargando = loading || superLoading || togglesLoading;

  const modulos = cargando
    ? []
    : MODULOS_MENU.filter(
        (m) =>
          m.clave !== "dashboard" &&
          moduloActivo(m, isEnabled) &&
          tienePermisoModulo(m, permissions, isSuperAdmin),
      );
  const nombre = user ? nombreVisible(user) : null;

  return (
    <Card data-testid="widget-accesos">
      <CardHeader className="px-4 py-2.5 sm:px-5">
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-semibold">
          <span>{nombre ? `Hola, ${nombre}` : "Bienvenido"}</span>
          <span className="text-sm font-normal text-muted-foreground">{NEGOCIO.nombre}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 sm:px-5">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          Accesos rápidos
        </h2>
        {cargando ? (
          <p className="text-sm text-muted-foreground" role="status">Cargando…</p>
        ) : modulos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tienes otras secciones disponibles.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {modulos.map((m) => {
              const Icono = m.icono;
              return (
                <li key={m.clave}>
                  <Link
                    to={m.rutas[0]}
                    onMouseEnter={() => precargarSeccion(m.rutas[0])}
                    onTouchStart={() => precargarSeccion(m.rutas[0])}
                    onFocus={() => precargarSeccion(m.rutas[0])}
                    className={cn(
                      "flex min-h-14 items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50",
                      FOCO,
                    )}
                  >
                    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icono className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{m.nombre}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{m.descripcion}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
