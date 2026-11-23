// @vitest-environment node
// web-solicitud-presupuesto (pública): validación del cuerpo, campo trampa, límite por IP (429), CORS y que la IP
// nunca sale de la función (solo su huella). Sin red ni Deno: la base se simula con `registrar`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATEGORIAS_CALCULADORA,
  MAX_SOLICITUDES_HORA,
  esBot,
  huellaIp,
  manejarSolicitud,
  validarSolicitud,
  type DatosSolicitud,
  type DependenciasSolicitud,
} from "../web-solicitud-presupuesto/solicitud";

const BUENA = {
  nombre: "  Eva   Martínez ",
  telefono: "650 00 00 00",
  email: "eva@example.com",
  poblacion: "Elche",
  direccion: "",
  notas: "Mejor por la tarde.\r\nGracias",
  categoria: "mamparas",
  valores: { tipoMampara: "frontal", ancho: 100, alto: 195 },
  total: 515.004,
  resumen: "Tipo de mampara: Frontal\nAncho: 100 cm",
  consentimiento: true,
  website: "",
};

const conCambio = (cambio: Record<string, unknown>) => ({ ...BUENA, ...cambio });

describe("validarSolicitud", () => {
  it("acepta una solicitud correcta y la normaliza", () => {
    const v = validarSolicitud(BUENA);
    expect(v).toEqual({
      ok: true,
      datos: {
        nombre: "Eva Martínez",
        telefono: "650 00 00 00",
        email: "eva@example.com",
        poblacion: "Elche",
        direccion: null,
        notas: "Mejor por la tarde.\nGracias",
        categoria: "mamparas",
        valores: BUENA.valores,
        total: 515,
        resumen: BUENA.resumen,
      },
    });
  });

  it("los opcionales pueden faltar", () => {
    const { email, poblacion, direccion, notas, ...minima } = BUENA;
    void email; void poblacion; void direccion; void notas;
    expect(validarSolicitud(minima)).toMatchObject({ ok: true, datos: { email: null, poblacion: null, notas: null } });
  });

  it.each([
    ["nombre corto", { nombre: "E" }, /nombre/],
    ["nombre largo", { nombre: "x".repeat(121) }, /nombre/],
    ["nombre no texto", { nombre: 42 }, /nombre/],
    ["teléfono corto", { telefono: "123" }, /teléfono/],
    ["teléfono largo", { telefono: "6".repeat(31) }, /teléfono/],
    ["teléfono con letras", { telefono: "llámame ya" }, /teléfono/],
    ["email raro", { email: "no-es-un-email" }, /correo/],
    ["email largo", { email: `${"a".repeat(195)}@b.com` }, /correo/],
    ["notas largas", { notas: "x".repeat(1501) }, /observaciones/],
    ["resumen largo", { resumen: "x".repeat(4001) }, /resumen/],
    ["categoría desconocida", { categoria: "ventanas" }, /tipo de trabajo/],
    ["valores no objeto", { valores: [1, 2] }, /medidas/],
    ["valores de más de 20 KB", { valores: { x: "a".repeat(21 * 1024) } }, /medidas/],
    ["total negativo", { total: -1 }, /precio/],
    ["total enorme", { total: 1_000_001 }, /precio/],
    ["total no numérico", { total: "mucho" }, /precio/],
    ["sin consentimiento", { consentimiento: false }, /privacidad/],
    ["consentimiento como texto", { consentimiento: "true" }, /privacidad/],
  ])("rechaza: %s", (_n, cambio, error) => {
    const v = validarSolicitud(conCambio(cambio));
    expect(v.ok).toBe(false);
    expect(!v.ok && v.error).toMatch(error);
  });

  it("las 8 categorías de la calculadora", () => {
    expect(CATEGORIAS_CALCULADORA).toHaveLength(8);
    for (const categoria of CATEGORIAS_CALCULADORA) expect(validarSolicitud(conCambio({ categoria })).ok).toBe(true);
  });

  it("el total también puede venir como texto numérico", () => {
    expect(validarSolicitud(conCambio({ total: "120.5" }))).toMatchObject({ ok: true, datos: { total: 120.5 } });
  });
});

describe("campo trampa", () => {
  it("relleno = bot; vacío o ausente = persona", () => {
    expect(esBot(conCambio({ website: "http://spam.example" }))).toBe(true);
    expect(esBot(conCambio({ website: "" }))).toBe(false);
    expect(esBot(conCambio({ website: "   " }))).toBe(false);
    expect(esBot({ nombre: "x" })).toBe(false);
  });
});

describe("huellaIp", () => {
  it("HMAC-SHA256 en hexadecimal: estable, distinto por IP y por sal, sin la IP dentro", async () => {
    const a = await huellaIp("203.0.113.7", "sal");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await huellaIp("203.0.113.7", "sal")).toBe(a);
    expect(await huellaIp("203.0.113.8", "sal")).not.toBe(a);
    expect(await huellaIp("203.0.113.7", "otra")).not.toBe(a);
    expect(a).not.toContain("203");
  });
});

describe("manejarSolicitud", () => {
  const llamadas: Array<{ ipHash: string; datos: DatosSolicitud; maxHora: number }> = [];
  let respuesta: "ok" | "limite" | "error" = "ok";
  const deps: DependenciasSolicitud = {
    ip: (req) => req.headers.get("cf-connecting-ip") ?? "",
    sal: "clave-de-servicio",
    async registrar(ipHash, datos, maxHora) {
      llamadas.push({ ipHash, datos, maxHora });
      if (respuesta === "error") throw new Error("caída");
      return respuesta === "ok" ? { ok: true, numero: "P-2026-0007" } : { ok: false, motivo: "limite" };
    },
  };
  const enviar = (cuerpo: unknown, init: RequestInit = {}) =>
    manejarSolicitud(new Request("https://e.supabase.co/functions/v1/web-solicitud-presupuesto", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.4" },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
      ...init,
    }), deps);

  beforeAll(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterAll(() => vi.restoreAllMocks());

  it("OPTIONS: CORS abierto sin credenciales", async () => {
    const r = await manejarSolicitud(new Request("https://e.test/x", { method: "OPTIONS" }), deps);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-allow-headers")).toMatch(/apikey/);
    expect(r.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("solo POST", async () => {
    const r = await manejarSolicitud(new Request("https://e.test/x", { method: "GET" }), deps);
    expect(r.status).toBe(405);
  });

  it("200 {numero} y a la base va la huella de la IP, nunca la IP", async () => {
    llamadas.length = 0;
    respuesta = "ok";
    const r = await enviar(BUENA);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r.json()).toEqual({ numero: "P-2026-0007" });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].ipHash).toBe(await huellaIp("198.51.100.4", "clave-de-servicio"));
    expect(llamadas[0].maxHora).toBe(MAX_SOLICITUDES_HORA);
    expect(JSON.stringify(llamadas[0])).not.toContain("198.51.100.4");
    expect(llamadas[0].datos).not.toHaveProperty("website");
    expect(llamadas[0].datos).not.toHaveProperty("consentimiento");
  });

  it("campo trampa relleno: 200 sin guardar nada", async () => {
    llamadas.length = 0;
    const r = await enviar(conCambio({ website: "spam" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ numero: null });
    expect(llamadas).toHaveLength(0);
  });

  it("400 con el motivo si algo no vale (sin llegar a la base)", async () => {
    llamadas.length = 0;
    const r = await enviar(conCambio({ telefono: "1" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/teléfono/);
    expect((await enviar("{no es json")).status).toBe(400);
    expect((await enviar([1, 2, 3])).status).toBe(400);
    expect((await enviar({ ...BUENA, valores: { x: "a".repeat(41 * 1024) } })).status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });

  it("429 cuando la base dice que se ha pasado el límite", async () => {
    respuesta = "limite";
    const r = await enviar(BUENA);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/varias solicitudes/);
  });

  it("500 si la base falla, sin detalles internos", async () => {
    respuesta = "error";
    const r = await enviar(BUENA);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/caída/);
  });
});
