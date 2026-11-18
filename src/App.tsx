import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SuperAdminRoute } from "./components/SuperAdminRoute";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "@/hooks/useAuth";
import { UserRoleProvider } from "@/hooks/useUserRole";
import type { SectionKey } from "@/hooks/useUserRole";
import { SuperAdminProvider } from "@/hooks/useSuperAdmin";
import { useVisualViewportVars } from "@/hooks/useVisualViewportVars";
import { rutaServicios } from "@/components/servicios/pestanas";
import { PanelLayout, CargandoContenido } from "@/components/PanelLayout";
import { CARGADORES_SECCION } from "@/lib/precargaSecciones";
import Auth from "./pages/Auth";
const Dashboard = lazy(CARGADORES_SECCION["/dashboard"]);
const NotFound = lazy(() => import("./pages/NotFound"));
const Usuarios = lazy(CARGADORES_SECCION["/usuarios"]);
const Ayuda = lazy(CARGADORES_SECCION["/ayuda"]);
const Avisos = lazy(CARGADORES_SECCION["/avisos"]);
const Peticiones = lazy(CARGADORES_SECCION["/peticiones"]);
const GestorGasto = lazy(() => import("./pages/GestorGasto"));
const SuperAdminLogin = lazy(() => import("./pages/SuperAdminLogin"));
const SuperAdminPanel = lazy(() => import("./pages/SuperAdminPanel"));
const SuperAdminUsuarios = lazy(() => import("./pages/SuperAdminUsuarios"));
const SuperAdminAuditoria = lazy(() => import("./pages/SuperAdminAuditoria"));
const SuperAdminServicios = lazy(() => import("./pages/SuperAdminServicios"));
const SuperAdminInformes = lazy(() => import("./pages/SuperAdminInformes"));
const SuperAdminTickets = lazy(() => import("./pages/SuperAdminTickets"));

/**
 * Valores por defecto pensados para redes lentas (móvil o wifi del local):
 *   · `staleTime` 30 s: volver a una pantalla (o cambiar Kanban ↔ Plano) no repite lo que se acaba de pedir.
 *   · `retry` 2 con espera creciente y acotada (1 s, 2 s… máx. 8 s), en vez de 3.
 *   · `refetchOnWindowFocus`: sí, pero solo lo que ya está viejo (respeta `staleTime`).
 *   · `networkMode: "offlineFirst"`: sin red se pinta lo que hay en caché y la petición espera a
 *     que vuelva la red en vez de quedarse colgada.
 * Las pruebas crean su propio `QueryClient`: esto no las afecta.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: (intento) => Math.min(1_000 * 2 ** intento, 8_000),
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst",
    },
  },
});

/**
 * Páginas bajo demanda (01-11-2026): antes App importaba las ~25 páginas y
 * todo el panel (gráficas, editor de planos, llamadas de voz…) iba en un único
 * fichero de 3,7 MB que se bajaba entero en cualquier pantalla y otra vez con
 * cada despliegue. Ahora cada página es su propio fichero y se pide al
 * entrar; si tras un despliegue falta el de la versión anterior, la barrera de
 * errores recarga sola (ErrorBoundary › PATRON_CHUNK_OBSOLETO). El acceso
 * (Auth) sigue dentro del fichero inicial para salir al momento.
 */
function CargandoPagina() {
  return (
    <div className="flex min-h-app w-full items-center justify-center" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

const bajoDemanda = (contenido: ReactNode) => <Suspense fallback={<CargandoPagina />}>{contenido}</Suspense>;

/** Publica --vv-h/--vv-top/--vv-bottom (viewport visual, sin teclado) para diálogos y hojas en tablet. */
function VisualViewportVars() {
  useVisualViewportVars();
  return null;
}

/**
 * Barrera de errores de nivel página: cada ruta tiene la suya, ligada al pathname,
 * de modo que un fallo en una sección no se lleva por delante las demás y al navegar
 * a otra sección la barrera se resetea sola.
 */
const pagina = (contenido: ReactNode, requiredSection?: SectionKey | SectionKey[]) => (
  <RouteErrorBoundary>
    <ProtectedRoute requiredSection={requiredSection}>
      {/* Dentro del marco del panel (PanelLayout): el «Cargando» va solo en la zona de contenido. */}
      <Suspense fallback={<CargandoContenido />}>{contenido}</Suspense>
    </ProtectedRoute>
  </RouteErrorBoundary>
);

/**
 * Marco del panel (07/11/2026): menú lateral y cabecera montados UNA vez para todas las secciones; al navegar
 * solo cambia el contenido. `requiredSection={[]}` = solo sesión (cargando a pantalla completa y, sin usuario,
 * a /auth); el permiso de cada sección lo sigue comprobando su ruta con `pagina()`.
 */
const marcoPanel = (
  <RouteErrorBoundary>
    <ProtectedRoute requiredSection={[]}>
      <PanelLayout />
    </ProtectedRoute>
  </RouteErrorBoundary>
);

// Las páginas de /super-admin/* solo las abre un super admin (SuperAdminRoute); se llega por el engranaje
// «Super Admin» del pie del menú (AppSidebar).
const paginaSuperAdmin = (contenido: ReactNode) => (
  <RouteErrorBoundary>
    <SuperAdminRoute>{bajoDemanda(contenido)}</SuperAdminRoute>
  </RouteErrorBoundary>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <VisualViewportVars />
    <AuthProvider queryClient={queryClient}>
      <UserRoleProvider>
        <SuperAdminProvider>
          <TooltipProvider>
            {/* Los toasts viven fuera de la barrera para seguir funcionando si el router falla. */}
            <Toaster />
            <BrowserRouter>
              {/* Barrera de nivel app: último recurso para que nunca quede la pantalla en blanco. */}
              <RouteErrorBoundary
                pantallaCompleta
                titulo="El panel ha sufrido un error inesperado"
                descripcion="No se ha podido mostrar la aplicación. No se ha perdido ningún dato guardado. Pulsa «Reintentar» para volver a cargar la pantalla o «Recargar página» si el problema persiste."
              >
                <Routes>
                  <Route path="/auth" element={<Auth />} />
                  {/* Secciones con menú: un solo marco (PanelLayout) para todas. */}
                  <Route element={marcoPanel}>
                    <Route path="/" element={pagina(<Dashboard />)} />
                    <Route path="/dashboard" element={pagina(<Dashboard />)} />
                    <Route path="/usuarios" element={pagina(<Usuarios />, "usuarios")} />
                    {/* Historial de avisos (campana): para todos los roles. */}
                    <Route path="/avisos" element={pagina(<Avisos />)} />
                    {/* Centro de Ayuda: para todos los roles (sin sección de permisos). */}
                    <Route path="/ayuda" element={pagina(<Ayuda />)} />
                    {/* «Nueva petición» y «Mis peticiones»: para todos los usuarios (sin sección de permisos). */}
                    <Route path="/peticiones" element={pagina(<Peticiones />)} />
                  </Route>
                  <Route path="/super-admin/login" element={bajoDemanda(<SuperAdminLogin />)} />
                  <Route path="/super-admin" element={paginaSuperAdmin(<SuperAdminPanel />)} />
                  <Route path="/super-admin/gestor-gasto" element={paginaSuperAdmin(<GestorGasto />)} />
                  {/* Costes es una pestaña de Servicios: la ruta vieja lleva a ella. */}
                  <Route path="/super-admin/costes" element={<Navigate to={rutaServicios("costes")} replace />} />
                  <Route path="/super-admin/usuarios" element={paginaSuperAdmin(<SuperAdminUsuarios />)} />
                  <Route path="/super-admin/auditoria" element={paginaSuperAdmin(<SuperAdminAuditoria />)} />
                  <Route path="/super-admin/servicios" element={paginaSuperAdmin(<SuperAdminServicios />)} />
                  <Route path="/super-admin/informes" element={paginaSuperAdmin(<SuperAdminInformes />)} />
                  {/* Tickets: las peticiones de los usuarios con el análisis de la IA. */}
                  <Route path="/super-admin/tickets" element={paginaSuperAdmin(<SuperAdminTickets />)} />
                  <Route path="*" element={bajoDemanda(<NotFound />)} />
                </Routes>
              </RouteErrorBoundary>
            </BrowserRouter>
          </TooltipProvider>
        </SuperAdminProvider>
      </UserRoleProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

