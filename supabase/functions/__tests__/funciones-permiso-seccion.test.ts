// CT-REM-FN-02 · Funciones que solo exigían "estar logueado".
//   leer-metricas        → admin / super admin, limite ≤ 500
//   registrar-metrica    → cualquier usuario, pero usuario_id/email SALEN DEL JWT
// (vapi-analytics, sync-google-reviews y buscar-precios-mercado eran del restaurante y ya no existen.)
// Sin red: Supabase simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const USUARIOS: Record<string, { id: string; email: string; admin?: boolean; permisos: Record<string, "view" | "edit"> }> = {
    "jwt-staff": { id: "11111111-1111-4111-8111-111111111111", email: "staff@staff.local", permisos: {} },
    "jwt-admin": { id: "22222222-2222-4222-8222-222222222222", email: "admin@staff.local", admin: true, permisos: {} },
    "jwt-dash": { id: "33333333-3333-4333-8333-333333333333", email: "dash@staff.local", permisos: { dashboard: "view" } },
    "jwt-usuarios": { id: "44444444-4444-4444-8444-444444444444", email: "usuarios@staff.local", permisos: { dashboard: "edit", usuarios: "edit" } },
  };
  const estado = {
    handlers: {} as Record<string, (req: Request) => Promise<Response>>,
    ultimo: null as ((req: Request) => Promise<Response>) | null,
    inserts: [] as unknown[],
    limites: [] as number[],
    fetchs: [] as Array<{ url: string; body: unknown }>,
    rpcs: [] as string[],
  };
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["select", "order", "eq", "gte", "lte"]) b[m] = self;
    b.limit = (n: number) => { estado.limites.push(n); return b; };
    b.insert = async (fila: unknown) => { estado.inserts.push({ tabla, ...(fila as Record<string, unknown>) }); return { error: null }; };
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [{ id: 1 }], error: null });
    return b;
  };
  const cliente = () => ({
    auth: {
      getUser: async (token?: string) => {
        const u = token ? USUARIOS[token] : undefined;
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push(fn);
      const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
      if (fn === "has_section_permission") {
        const p = u?.permisos[args._section as string];
        return { data: args._permission === "edit" ? p === "edit" : !!p, error: null };
      }
      if (fn === "is_admin") return { data: !!u?.admin, error: null };
      if (fn === "is_super_admin") return { data: false, error: null };
      return { data: null, error: null };
    },
    from: (t: string) => builder(t),
  });
  return { USUARIOS, estado, cliente };
});

vi.mock("../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (f: unknown) => f,
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => h.cliente() }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: () => h.cliente() }));
vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.estado.ultimo = fn; } }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  METRICS_SUPABASE_URL: "https://metricas.example.supabase.co",
  METRICS_SUPABASE_SERVICE_ROLE_KEY: "metricas",
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] }, serve: (fn: (r: Request) => Promise<Response>) => { h.estado.ultimo = fn; } });
  // Ninguna de las dos sale a Internet: cualquier fetch queda anotado (y el test lo detecta).
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    h.estado.fetchs.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response("{}");
  }));
  for (const fn of ["leer-metricas", "registrar-metrica"]) {
    await import(`../${fn}/index.ts`);
    h.estado.handlers[fn] = h.estado.ultimo!;
  }
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { h.estado.inserts = []; h.estado.limites = []; h.estado.fetchs = []; h.estado.rpcs = []; });

function llamar(fn: string, token: string | undefined, body: unknown = {}, query = "") {
  return h.estado.handlers[fn](new Request(`https://ejemplo.supabase.co/functions/v1/${fn}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
}

describe("leer-metricas · negativas", () => {
  it.each([undefined, ENV.SUPABASE_ANON_KEY, "sb_publishable_x", "jwt-falso"])("token %s → 401 sin efectos", async (token) => {
    expect((await llamar("leer-metricas", token)).status).toBe(401);
    expect(h.estado.fetchs).toEqual([]);
    expect(h.estado.limites).toEqual([]);
  });
  it("usuario autenticado sin rol de admin → 403 sin efectos", async () => {
    const res = await llamar("leer-metricas", "jwt-staff");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false });
    expect(h.estado.fetchs).toEqual([]);
    expect(h.estado.limites).toEqual([]);
  });
});

describe("leer-metricas", () => {
  it("admin lee y el límite se recorta a 500", async () => {
    const res = await llamar("leer-metricas", "jwt-admin", {}, "?limite=100000");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: 1 }], count: 1 });
    expect(h.estado.limites).toEqual([500]);
  });
  it("límite por defecto 100 y valores raros saneados", async () => {
    await llamar("leer-metricas", "jwt-admin");
    await llamar("leer-metricas", "jwt-admin", {}, "?limite=abc");
    await llamar("leer-metricas", "jwt-admin", {}, "?limite=-5");
    expect(h.estado.limites).toEqual([100, 100, 1]);
  });
  it("ningún permiso de sección basta (ni dashboard ni usuarios con «Editar»): hace falta ser admin", async () => {
    expect((await llamar("leer-metricas", "jwt-dash")).status).toBe(403);
    expect((await llamar("leer-metricas", "jwt-usuarios")).status).toBe(403);
    expect(h.estado.limites).toEqual([]);
  });
  it("solo la tabla de métricas", async () => {
    expect((await llamar("leer-metricas", "jwt-admin", {}, "?tabla=user_roles")).status).toBe(400);
    expect(h.estado.limites).toEqual([]);
  });
});

describe("registrar-metrica", () => {
  it("ignora usuario_id y usuario_email del body: usa los del JWT", async () => {
    const res = await llamar("registrar-metrica", "jwt-staff", {
      evento: "inicio_sesion", usuario_id: "99999999-9999-4999-8999-999999999999", usuario_email: "dueno@cristaleriabv.es", metadata: { user_agent: "x" },
    });
    expect(res.status).toBe(200);
    expect(h.estado.inserts).toHaveLength(1);
    expect(h.estado.inserts[0]).toMatchObject({ tipo: "inicio_sesion", usuario_id: h.USUARIOS["jwt-staff"].id, entidad_id: "staff@staff.local", metadata: { user_agent: "x" } });
    expect(JSON.stringify(h.estado.inserts)).not.toContain("dueno@cristaleriabv.es");
    expect(h.estado.fetchs).toEqual([]);
  });
  it("sin usuario → 401; evento desconocido → 400; sin insertar", async () => {
    expect((await llamar("registrar-metrica", ENV.SUPABASE_ANON_KEY, { evento: "inicio_sesion" })).status).toBe(401);
    expect((await llamar("registrar-metrica", "jwt-staff", { evento: "login_falso_de_otro" })).status).toBe(400);
    expect(h.estado.inserts).toEqual([]);
  });
  it("metadata enorme o no objeto se descarta", async () => {
    await llamar("registrar-metrica", "jwt-staff", { evento: "inicio_sesion", metadata: { x: "a".repeat(5000) } });
    await llamar("registrar-metrica", "jwt-staff", { evento: "inicio_sesion", metadata: ["a"] });
    expect(h.estado.inserts.map((f) => (f as { metadata: unknown }).metadata)).toEqual([{}, {}]);
  });
});
