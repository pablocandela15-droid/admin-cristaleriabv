/**
 * newsletter-alta/alta.ts: alta pública desde la web (origen, campo trampa, consentimiento, límite por IP, doble opt-in)
 * y confirmación. Dependencias falsas: sin red ni base de datos.
 */
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { esBot, huellaIp, manejarAlta, validarAlta, MENSAJE_OK, TEXTOS_CONSENTIMIENTO, type DependenciasAlta } from "../alta.ts";
import { CONFIG_POR_DEFECTO } from "../../_shared/newsletter/enlaces.ts";
import { negocioPorDefecto } from "../../_shared/newsletter/negocio.ts";

const WEB = "https://cristaleriabv.vercel.app";
const TOKEN = "e".repeat(64);
const CONFIG = { ...CONFIG_POR_DEFECTO, remitente_email: "novedades@example.com" };

function deps(extra: Partial<DependenciasAlta> = {}) {
  const d = {
    ip: "203.0.113.7",
    sal: "sal-secreta",
    apiKey: true,
    leerConfig: vi.fn(async () => ({ config: CONFIG, negocio: negocioPorDefecto(WEB) })),
    registrar: vi.fn(async () => ({ ok: true as const, accion: "pendiente", enviar: true, id: "id-1", token: TOKEN, email: "ana@example.com" })),
    enviarConfirmacion: vi.fn(async () => true),
    confirmar: vi.fn(async () => ({ estado: "confirmada" as const, email: "ana@example.com" })),
    log: () => {},
    ...extra,
  };
  return d;
}

const peticion = (cuerpo: unknown, origen: string | null = WEB, metodo = "POST") =>
  new Request("https://demo.supabase.co/functions/v1/newsletter-alta", {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(origen ? { Origin: origen } : {}) },
    body: metodo === "POST" ? (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  });

const ALTA = { email: " Ana@Example.com ", nombre: "Ana", consentimiento: true, website: "" };

describe("validarAlta", () => {
  it("email válido, nombre opcional, consentimiento obligatorio y origen de la web", () => {
    expect(validarAlta(ALTA)).toEqual({ ok: true, datos: { email: "ana@example.com", nombre: "Ana", origen: "web_formulario" } });
    expect(validarAlta({ ...ALTA, origen: "web_presupuesto" })).toMatchObject({ ok: true, datos: { origen: "web_presupuesto" } });
    expect(validarAlta({ ...ALTA, consentimiento: "true" })).toMatchObject({ ok: false });
    expect(validarAlta({ ...ALTA, consentimiento: undefined })).toMatchObject({ ok: false });
    expect(validarAlta({ ...ALTA, email: "no-es-email" })).toMatchObject({ ok: false });
    expect(validarAlta({ ...ALTA, email: `${"a".repeat(250)}@example.com` })).toMatchObject({ ok: false });
    expect(validarAlta({ ...ALTA, nombre: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(validarAlta({ ...ALTA, origen: "panel_manual" })).toMatchObject({ ok: false });
    expect(validarAlta({ ...ALTA, nombre: "  Ana\n\tMaría " })).toMatchObject({ ok: true, datos: { nombre: "Ana María" } });
  });
  it("campo trampa", () => {
    expect(esBot({ website: "https://spam.example.com" })).toBe(true);
    expect(esBot({ website: "  " })).toBe(false);
    expect(esBot({})).toBe(false);
  });
  it("huella de la IP: HMAC-SHA256 con sal (nunca la IP)", async () => {
    const h = await huellaIp("203.0.113.7", "sal");
    expect(h).toBe(createHmac("sha256", "sal").update("newsletter-alta:203.0.113.7").digest("hex"));
    expect(h).not.toContain("203.0.113.7");
  });
});

describe("manejarAlta: protección", () => {
  it("solo los orígenes de la web: otro origen → 403 sin tocar nada; el preflight también", async () => {
    const d = deps();
    const r = await manejarAlta(peticion(ALTA, "https://malo.example.com"), d);
    expect(r.status).toBe(403);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(d.registrar).not.toHaveBeenCalled();
    expect((await manejarAlta(peticion(null, null), d)).status).toBe(403);
    expect((await manejarAlta(new Request("https://x/", { method: "OPTIONS", headers: { Origin: "https://malo.example.com" } }), d)).status).toBe(403);
    const pre = await manejarAlta(new Request("https://x/", { method: "OPTIONS", headers: { Origin: WEB } }), d);
    expect([pre.status, pre.headers.get("Access-Control-Allow-Origin")]).toEqual([204, WEB]);
    for (const demo of ["https://cristaleriabv-git-staging-pablo1505.vercel.app", "http://localhost:3000"]) {
      expect((await manejarAlta(peticion(ALTA, demo), deps())).status, demo).toBe(200);
    }
  });

  it("campo trampa relleno: 200 como si nada, sin guardar ni enviar", async () => {
    const d = deps();
    const r = await manejarAlta(peticion({ ...ALTA, website: "bot" }), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, mensaje: MENSAJE_OK });
    expect(d.registrar).not.toHaveBeenCalled();
    expect(d.enviarConfirmacion).not.toHaveBeenCalled();
  });

  it("sin consentimiento, cuerpo raro o demasiado grande: 400", async () => {
    expect((await manejarAlta(peticion({ ...ALTA, consentimiento: false }), deps())).status).toBe(400);
    expect((await manejarAlta(peticion("{no-json"), deps())).status).toBe(400);
    expect((await manejarAlta(peticion({ ...ALTA, relleno: "x".repeat(5000) }), deps())).status).toBe(400);
    expect((await manejarAlta(peticion({ ...ALTA, accion: "borrar" }), deps())).status).toBe(400);
    expect((await manejarAlta(peticion(null, WEB, "PUT"), deps())).status).toBe(405);
  });

  it("GET (el servidor de la web, sin Origin): solo si se puede apuntar alguien, sin guardar nada", async () => {
    const d = deps();
    const r = await manejarAlta(peticion(null, null, "GET"), d);
    expect([r.status, await r.json()]).toEqual([200, { ok: true, disponible: true }]);
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(d.registrar).not.toHaveBeenCalled();
    expect(await (await manejarAlta(peticion(null, null, "GET"), deps({ apiKey: false }))).json()).toEqual({ ok: true, disponible: false });
    const sinRemitente = deps({ leerConfig: vi.fn(async () => ({ config: CONFIG_POR_DEFECTO, negocio: negocioPorDefecto(WEB) })) });
    expect(await (await manejarAlta(peticion(null, null, "GET"), sinRemitente)).json()).toEqual({ ok: true, disponible: false });
    const falla = deps({ leerConfig: vi.fn(async () => { throw new Error("sin base"); }) });
    expect(await (await manejarAlta(peticion(null, null, "GET"), falla)).json()).toEqual({ ok: true, disponible: false });
  });

  it("sin RESEND_API_KEY o sin remitente: 503 «no disponible» y no se guarda nada", async () => {
    for (const d of [deps({ apiKey: false }), deps({ leerConfig: vi.fn(async () => ({ config: CONFIG_POR_DEFECTO, negocio: negocioPorDefecto(WEB) })) })]) {
      const r = await manejarAlta(peticion(ALTA), d);
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ ok: false, motivo: "no_configurado" });
      expect(d.registrar).not.toHaveBeenCalled();
    }
  });

  it("límite por huella de IP: 429", async () => {
    const r = await manejarAlta(peticion(ALTA), deps({ registrar: vi.fn(async () => ({ ok: false as const, motivo: "limite" as const })) }));
    expect(r.status).toBe(429);
  });
});

describe("manejarAlta: doble opt-in", () => {
  it("guarda el consentimiento con el texto de la casilla y la huella, y manda la confirmación con el token", async () => {
    const d = deps();
    const r = await manejarAlta(peticion({ ...ALTA, origen: "web_presupuesto" }), d);
    expect([r.status, await r.json()]).toEqual([200, { ok: true, mensaje: MENSAJE_OK }]);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    const [ipHash, datos, texto, max] = d.registrar.mock.calls[0];
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(datos).toEqual({ email: "ana@example.com", nombre: "Ana", origen: "web_presupuesto" });
    expect(texto).toBe(TEXTOS_CONSENTIMIENTO.web_presupuesto);
    expect(max).toBe(5);
    expect(d.enviarConfirmacion).toHaveBeenCalledWith(expect.objectContaining({ id: "id-1", email: "ana@example.com", token: TOKEN, nombre: "Ana" }));
  });

  it("misma respuesta si ya estaba suscrito (no dice quién está), sin otro correo", async () => {
    const d = deps({ registrar: vi.fn(async () => ({ ok: true as const, accion: "ya_activo", enviar: false })) });
    const r = await manejarAlta(peticion(ALTA), d);
    expect(await r.json()).toEqual({ ok: true, mensaje: MENSAJE_OK });
    expect(d.enviarConfirmacion).not.toHaveBeenCalled();
  });

  it("si Resend no acepta la confirmación: 502 para que lo intente más tarde", async () => {
    expect((await manejarAlta(peticion(ALTA), deps({ enviarConfirmacion: vi.fn(async () => false) }))).status).toBe(502);
    expect((await manejarAlta(peticion(ALTA), deps({ enviarConfirmacion: vi.fn(async () => { throw new Error("red"); }) }))).status).toBe(502);
  });

  it("confirmar: token mal formado → inválido sin consultar; bueno → confirmada con el email a medias", async () => {
    const d = deps();
    expect(await (await manejarAlta(peticion({ accion: "confirmar", t: "x" }), d)).json()).toEqual({ ok: false, estado: "invalido", email: null });
    expect(d.confirmar).not.toHaveBeenCalled();
    expect(await (await manejarAlta(peticion({ accion: "confirmar", t: TOKEN }), d)).json()).toEqual({ ok: true, estado: "confirmada", email: "an***@example.com" });
    const caducado = deps({ confirmar: vi.fn(async () => ({ estado: "caducado" as const, email: "ana@example.com" })) });
    expect(await (await manejarAlta(peticion({ accion: "confirmar", t: TOKEN }), caducado)).json()).toEqual({ ok: false, estado: "caducado", email: null });
  });
});
