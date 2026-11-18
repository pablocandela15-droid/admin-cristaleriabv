// CT-REM-FN-01 · ADMITE_INTEGRACION es la lista de funciones que el envoltorio
// deja pasar SIN usuario ni service role. Cada una tiene que defenderse sola.
// Este test falla si:
//   · se añade a la lista una función que no está declarada aquí con su mecanismo;
//   · el código de la función ya no contiene ese mecanismo;
//   · entra una función que actúa en nombre de un usuario (sin control propio).
// Además prueba el envoltorio de verdad: anon/publishable → 401 fuera de la
// lista, y la IP de auditoría = cf-connecting-ip o ÚLTIMO salto de XFF.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMITE_INTEGRACION, clienteConAuditoria, conAuditoriaDePeticion } from "../audit-client";

const FUNCIONES = resolve(__dirname, "../..");

/** Mecanismo de autenticación propia de cada función de la lista (todas las expresiones deben aparecer). */
const AUTENTICACION_PROPIA: Record<string, { mecanismo: string; patrones: RegExp[] }> = {
  "sincronizar-costes-openai": { mecanismo: "x-ocr-secret en tiempo constante", patrones: [/verificarSecreto/] },
  "ia-modelos-openai": { mecanismo: "x-ocr-secret en tiempo constante, fail-closed (pg_cron o SQL con el secreto de Vault) o JWT de super admin", patrones: [/x-ocr-secret/, /compararTiempoConstante/, /exigirSuperAdmin/] },
  "avisos-telegram": { mecanismo: "x-ocr-secret en tiempo constante, fail-closed (pg_cron o SQL con el secreto de Vault) o JWT de super admin", patrones: [/x-ocr-secret/, /compararTiempoConstante/, /exigirSuperAdmin/] },
};

/** Funciones del panel que actúan en nombre de un usuario: nunca pueden estar en la lista. */
const DE_USUARIO = ["analizar-peticion", "servicios-uso", "control-excel", "admin-create-user", "admin-set-super-admin", "auditoria-revertir", "cambiar-mi-contrasena"];

function fuentes(dir: string): string {
  let total = "";
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "__tests__" || nombre === "evals" || nombre === "fixtures") continue;
      total += fuentes(ruta);
    } else if (nombre.endsWith(".ts") && !nombre.endsWith(".test.ts")) {
      total += readFileSync(ruta, "utf8") + "\n";
    }
  }
  return total;
}

describe("ADMITE_INTEGRACION", () => {
  it("son solo los procesos programados (costes de OpenAI, modelos de IA y avisos por Telegram)", () => {
    expect([...ADMITE_INTEGRACION].sort()).toEqual(["avisos-telegram", "ia-modelos-openai", "sincronizar-costes-openai"]);
  });

  it.each(DE_USUARIO)("no incluye %s (actúa en nombre de un usuario)", (fn) => {
    expect(ADMITE_INTEGRACION.has(fn)).toBe(false);
  });

  it("cada función de la lista existe", () => {
    for (const fn of ADMITE_INTEGRACION) expect(statSync(join(FUNCIONES, fn)).isDirectory(), fn).toBe(true);
  });

  it.each([...ADMITE_INTEGRACION])("%s tiene autenticación propia declarada y presente en su código", (fn) => {
    const declarada = AUTENTICACION_PROPIA[fn];
    expect(declarada, `${fn} está en ADMITE_INTEGRACION pero no tiene mecanismo declarado en este test`).toBeDefined();
    const codigo = fuentes(join(FUNCIONES, fn));
    // Envuelta de verdad por el envoltorio con ese nombre.
    expect(codigo).toContain(`"${fn}"`);
    for (const patron of declarada.patrones) {
      expect(patron.test(codigo), `${fn}: falta ${patron} (${declarada.mecanismo})`).toBe(true);
    }
  });

  it("la tabla del test no tiene entradas sobrantes (cada salida de la lista se refleja aquí)", () => {
    expect(Object.keys(AUTENTICACION_PROPIA).sort()).toEqual([...ADMITE_INTEGRACION].sort());
  });
});

describe("conAuditoriaDePeticion: autenticación del envoltorio", () => {
  const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon-jwt", SUPABASE_SERVICE_ROLE_KEY: "service" };
  beforeAll(() => vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } }));
  afterAll(() => vi.unstubAllGlobals());

  const fabrica = () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "x" } }) }, rpc: async () => ({ error: null }) });
  const llamar = async (fuente: string, token?: string) => {
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const res = await conAuditoriaDePeticion(fuente, fabrica, handler)(new Request("https://ejemplo.test/" + fuente, {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {},
    }));
    return { status: res.status, ejecutado: handler.mock.calls.length > 0 };
  };

  it.each([undefined, "anon-jwt", "sb_publishable_xyz"])("analizar-peticion con %s → 401 sin ejecutar el handler", async (token) => {
    expect(await llamar("analizar-peticion", token)).toEqual({ status: 401, ejecutado: false });
  });
  it.each([...ADMITE_INTEGRACION])("%s (de la lista) sí llega a su handler (que se autentica sola)", async (fn) => {
    expect(await llamar(fn, "anon-jwt")).toEqual({ status: 200, ejecutado: true });
  });
  it("service role sigue pasando (llamadas entre funciones del servidor)", async () => {
    expect(await llamar("analizar-peticion", "service")).toEqual({ status: 200, ejecutado: true });
  });
});

describe("conAuditoriaDePeticion: IP de auditoría (CT-REM-FN-03)", () => {
  beforeAll(() => vi.stubGlobal("Deno", { env: { get: (n: string) => ({ SUPABASE_URL: "https://e.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" } as Record<string, string>)[n] } }));
  afterAll(() => vi.unstubAllGlobals());

  async function ipRegistrada(headers: Record<string, string>): Promise<string | null> {
    let vista: string | null = null;
    const transporte = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      vista = new Headers(init?.headers).get("x-audit-ip");
      return new Response("{}");
    });
    const fabrica = (_u: string, _k: string, opciones: { global: { fetch: typeof fetch } }) => opciones.global.fetch;
    const cliente = clienteConAuditoria(fabrica as never, "sincronizar-costes-openai") as unknown as (u: string, k: string, o: unknown) => typeof fetch;
    const handler = async () => {
      const f = cliente("https://e.supabase.co", "service", { global: { fetch: transporte } });
      await f("https://e.supabase.co/rest/v1/x");
      return new Response("{}");
    };
    await conAuditoriaDePeticion("sincronizar-costes-openai", fabrica, handler)(new Request("https://e.test/sincronizar-costes-openai", { method: "POST", headers }));
    return vista;
  }

  it("con cf-connecting-ip se usa esa, aunque XFF diga otra cosa", async () => {
    expect(await ipRegistrada({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" })).toBe("203.0.113.7");
  });
  it("sin cf-connecting-ip se usa el ÚLTIMO salto de XFF, no el primero que pone el cliente", async () => {
    expect(await ipRegistrada({ "x-forwarded-for": "6.6.6.6, 198.51.100.2" })).toBe("198.51.100.2");
  });
});
