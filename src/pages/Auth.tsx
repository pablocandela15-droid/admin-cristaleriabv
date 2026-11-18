import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AvisoSesionCaducada } from "@/components/AvisoSesionCaducada";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NEGOCIO } from "@/config/negocio";
import { Logotipo } from "@/components/marca/Logotipo";
import { Oculo, Reflejo } from "@/components/marca/ElementosMarca";
import { precargarAlMontarLogin } from "@/lib/precargaLogin";
import { ESTADO_TRAS_LOGIN } from "@/lib/seccionInicio";

export default function Auth() {
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const [loading, setLoading] = useState(false);

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Mientras se escribe: versión de auditoría, panel-auth despierto y chunks del inicio (lib/precargaLogin.ts).
  useEffect(() => {
    precargarAlMontarLogin();
  }, []);

  // Con la marca de «tras iniciar sesión» (11/11/2026): ProtectedRoute abre la sección de inicio
  // del usuario si tiene una elegida en Usuarios (lib/seccionInicio.ts); si no, el Dashboard de siempre.
  useEffect(() => {
    if (user) {
      navigate("/dashboard", { state: ESTADO_TRAS_LOGIN });
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const normalizedInput = loginEmail.trim();
    // If no @ in login, assume it's a username and append @staff.local
    const loginIdentifier = normalizedInput.includes("@")
      ? normalizedInput.toLowerCase()
      : `${normalizedInput.toLowerCase()}@staff.local`;
    const { error } = await signIn(loginIdentifier, loginPassword);
    if (!error) {
      navigate("/dashboard", { state: ESTADO_TRAS_LOGIN });
    }
    setLoading(false);
  };

  // `min-h-app` + scroll natural: con el teclado abierto en vertical la tarjeta no queda cortada.
  // Estética del manual de marca (portada y web, páginas 01 y 12): portada en azul marino con el logotipo en
  // negativo, el óculo y el reflejo; el formulario, en una tarjeta blanca sobre marfil.
  return (
    <div className="min-h-app grid bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-marca-marino p-12 text-marca-crema lg:flex lg:flex-col xl:p-16">
        <Logotipo variante="horizontalNegativo" className="relative z-10 w-60 xl:w-72" />
        {/* El texto, arriba (bajo el logotipo); el óculo, abajo a la derecha: nunca se pisan. */}
        <div className="relative z-10 mt-16 max-w-sm xl:mt-20 xl:max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-marca-claro">Admin Panel</p>
          <p className="mt-4 font-titulo text-5xl font-light leading-[1.1] text-marca-crema xl:text-6xl">
            {NEGOCIO.tituloAcceso}
          </p>
          <p className="mt-6 text-base leading-relaxed text-white/80">{NEGOCIO.lemaAcceso}</p>
        </div>
        <p className="relative z-10 mt-auto text-xs tracking-wide text-marca-claro/80">{NEGOCIO.nombre} · Uso interno del equipo</p>
        {/* El óculo de la portada del manual, cortado por la esquina, con el reflejo dentro. */}
        <div
          className="pointer-events-none absolute -bottom-28 -right-28 h-[26rem] w-[26rem] rounded-full border border-white/5 xl:-bottom-32 xl:-right-32 xl:h-[32rem] xl:w-[32rem]"
          aria-hidden="true"
        >
          <Oculo className="absolute inset-8" />
          <Reflejo className="absolute left-[22%] top-[22%] h-[30%] w-[30%] text-marca-crema" colorFino="hsl(var(--marca-claro))" />
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">
        {/* Móvil y tablet vertical: banda marina con el logotipo en negativo (el reflejo, en la esquina). */}
        <div className="relative overflow-hidden bg-marca-marino px-6 pb-16 pt-[max(2.5rem,env(safe-area-inset-top))] lg:hidden">
          <Logotipo variante="horizontalNegativo" className="relative z-10 mx-auto w-48 sm:w-56" />
          <Reflejo className="absolute -right-2 top-3 h-16 w-16 text-marca-crema" colorFino="hsl(var(--marca-claro))" />
        </div>

        <div className="relative z-10 -mt-10 flex flex-1 items-start justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:mt-0 lg:items-center lg:p-12">
          <div className="w-full max-w-md">
            <AvisoSesionCaducada />

            <Card className="border-border/70 shadow-[var(--shadow-lg)]">
              <CardHeader>
                <h1 className="font-titulo text-2xl font-semibold leading-tight tracking-tight text-foreground">
                  Acceso al sistema
                </h1>
                <CardDescription>
                  Inicia sesión para acceder al panel de {NEGOCIO.nombre}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email o Usuario</Label>
                    <Input
                      id="login-email"
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      enterKeyHint="next"
                      placeholder="tu@email.com o nombre.usuario"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                    />
                    <p className="text-sm text-muted-foreground">
                      Empleados: usa solo tu nombre de usuario
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Contraseña</Label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      enterKeyHint="go"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <p className="mt-6 text-center text-xs text-muted-foreground lg:hidden">{NEGOCIO.nombre} · Uso interno del equipo</p>
          </div>
        </div>
      </main>
    </div>
  );
}
