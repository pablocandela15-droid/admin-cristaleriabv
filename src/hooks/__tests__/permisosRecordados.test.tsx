/**
 * Abrir el panel con mala cobertura (09/11/2026): con rol y permisos recordados de ESTE usuario, la ruta
 * protegida se pinta sin esperar a leerlos otra vez; los de otro usuario no valen; al leerlos se guardan; y
 * al cerrar sesión se borran.
 *
 * Providers REALES; solo se simula el cliente Supabase (las lecturas de rol/permisos pueden quedarse colgadas).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const estado = vi.hoisted(() => ({
  callback: null as null | ((evento: string, sesion: unknown) => void),
  sesionActual: null as null | { access_token: string; user: Record<string, unknown> & { id: string } },
  /** true: user_roles, user_permissions y super_admins no contestan nunca (sin cobertura). */
  colgado: false,
}));

vi.mock("sonner");

vi.mock("@/integrations/supabase/client", () => {
  const nunca = () => new Promise<never>(() => {});
  const crearBuilder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.single = () => (estado.colgado ? nunca() : Promise.resolve({ data: { role: "staff" }, error: null }));
    b.maybeSingle = () => (estado.colgado ? nunca() : Promise.resolve({ data: null, error: null }));
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      (estado.colgado && tabla === "user_permissions"
        ? nunca()
        : Promise.resolve({
            data: tabla === "user_permissions" ? [{ section_key: "usuarios", can_view: true, can_edit: false }] : [],
            error: null,
          })
      ).then(ok, ko);
    return b;
  };
  return {
    supabase: {
      // Servidor con auditoría completa (versión 2): el acceso y la salida se registran por RPC.
      rpc: vi.fn(async (nombre: string) => ({ data: nombre === "version_auditoria_panel" ? 2 : "audit-1", error: null })),
      from: (tabla: string) => crearBuilder(tabla),
      auth: {
        getUser: vi.fn(async () => {
          const s = estado.sesionActual;
          return { data: { user: s ? { ...s.user } : null }, error: null };
        }),
        getSession: vi.fn(async () => ({ data: { session: estado.sesionActual }, error: null })),
        onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => {
          estado.callback = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
      functions: { invoke: vi.fn() },
      channel: vi.fn(() => {
        const canal = { on: () => canal, subscribe: () => canal };
        return canal;
      }),
      removeChannel: vi.fn(async () => "ok"),
    },
  };
});

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { UserRoleProvider } from "@/hooks/useUserRole";
import { SuperAdminProvider } from "@/hooks/useSuperAdmin";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CLAVE_PERMISOS, guardarPermisosRecordados, leerPermisosRecordados } from "@/lib/cachePermisos";

const sesion = (id: string) => ({
  access_token: `t-${id}`,
  user: { id, email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" },
});

function Salir() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()}>
      salir
    </button>
  );
}

function montar(qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/usuarios"]}>
        <AuthProvider queryClient={qc}>
          <UserRoleProvider>
            <SuperAdminProvider>
              <Routes>
                <Route
                  path="/usuarios"
                  element={
                    <ProtectedRoute requiredSection="usuarios">
                      <div>pantalla-usuarios</div>
                      <Salir />
                    </ProtectedRoute>
                  }
                />
                <Route path="/ayuda" element={<div>pantalla-ayuda</div>} />
                <Route path="/auth" element={<div>pantalla-auth</div>} />
              </Routes>
            </SuperAdminProvider>
          </UserRoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("rol y permisos recordados (abrir una sección sin esperar a leerlos)", () => {
  beforeEach(() => {
    localStorage.clear();
    estado.callback = null;
    estado.sesionActual = sesion("ana");
    estado.colgado = false;
  });

  it("con lo recordado de ESTE usuario, la página sale aunque la lectura no conteste", async () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: [{ section_key: "usuarios", can_view: true, can_edit: false }], superAdmin: false });
    estado.colgado = true;
    montar();
    expect(await screen.findByText("pantalla-usuarios")).toBeInTheDocument();
  });

  it("lo recordado de OTRO usuario no vale: se espera a leer los de este", async () => {
    guardarPermisosRecordados("bea", { role: "admin", permissions: [{ section_key: "usuarios", can_view: true, can_edit: false }], superAdmin: true });
    estado.colgado = true;
    montar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText("pantalla-usuarios")).not.toBeInTheDocument();
    // Y la copia de «bea» se ha tirado al leerla para «ana».
    expect(leerPermisosRecordados("bea")).toBeNull();
  });

  it("sin nada recordado, al leerlos del servidor se guardan para la próxima vez", async () => {
    montar();
    expect(await screen.findByText("pantalla-usuarios")).toBeInTheDocument();
    await waitFor(() =>
      expect(leerPermisosRecordados("ana")).toEqual({
        role: "staff",
        permissions: [{ section_key: "usuarios", can_view: true, can_edit: false }],
        superAdmin: false,
        // Sección de inicio (11/11/2026): sin elegir.
        seccionInicio: null,
      }),
    );
  });

  it("si el servidor dice otra cosa que lo recordado, manda el servidor", async () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: [{ section_key: "dashboard", can_view: true, can_edit: false }], superAdmin: false });
    montar();
    // Lo recordado no da «usuarios», pero no basta para echar a nadie: se espera a la lectura, que sí lo da.
    // Manda el servidor, y lo recordado queda corregido para la próxima vez.
    expect(await screen.findByText("pantalla-usuarios")).toBeInTheDocument();
    expect(screen.queryByText("pantalla-ayuda")).not.toBeInTheDocument();
    await waitFor(() => expect(leerPermisosRecordados("ana")?.permissions).toEqual([{ section_key: "usuarios", can_view: true, can_edit: false }]));
  });

  it("al cerrar sesión se borran", async () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: [{ section_key: "usuarios", can_view: true, can_edit: false }], superAdmin: false });
    montar();
    const boton = await screen.findByRole("button", { name: "salir" });
    await act(async () => {
      boton.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(localStorage.getItem(CLAVE_PERMISOS)).toBeNull());
    expect(leerPermisosRecordados("ana")).toBeNull();
  });
});
