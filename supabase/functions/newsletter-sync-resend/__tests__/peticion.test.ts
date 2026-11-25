/**
 * newsletter-sync-resend/peticion.ts (portado del panel de referencia): acción, autenticación del cron (x-ocr-secret,
 * falla cerrado), estado de la configuración y respuesta de la sincronización (sin emails).
 */
import { describe, it, expect } from "vitest";
import { autenticarCron, construirEstado, leerAccion, respuestaSincronizacion } from "../peticion.ts";
import type { ResumenSync } from "../../_shared/resend-marketing/sync.ts";
import type { PasadaResend } from "../../_shared/resend-marketing/repositorio.ts";

const cab = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("leerAccion", () => {
  it("GET = estado; POST sin cuerpo o sin accion = sincronizar (lo que manda el cron)", () => {
    expect(leerAccion("GET", null)).toBe("estado");
    expect(leerAccion("POST", null)).toBe("sincronizar");
    expect(leerAccion("POST", {})).toBe("sincronizar");
    expect(leerAccion("POST", { accion: "estado" })).toBe("estado");
    expect(leerAccion("POST", { accion: "borrar" })).toBeNull();
    expect(leerAccion("POST", "x")).toBeNull();
  });
});

describe("autenticarCron", () => {
  it("sin la cabecera no es el cron (pasa al JWT)", () => {
    expect(autenticarCron(cab({}), "s")).toEqual({ es: false });
  });
  it("con el secreto correcto, sí; mal → 401; sin secreto configurado → 500 (falla cerrado)", () => {
    expect(autenticarCron(cab({ "x-ocr-secret": "secreto" }), "secreto")).toEqual({ es: true, ok: true });
    expect(autenticarCron(cab({ "x-ocr-secret": "otro" }), "secreto")).toMatchObject({ es: true, ok: false, status: 401 });
    expect(autenticarCron(cab({ "x-ocr-secret": "" }), "secreto")).toMatchObject({ ok: false, status: 401 });
    expect(autenticarCron(cab({ "x-ocr-secret": "x" }), "")).toMatchObject({ ok: false, status: 500 });
  });
});

const pasada = (extra: Partial<PasadaResend> = {}): PasadaResend => ({
  id: "p1", origen: "cron", estado: "ok", iniciada_at: "2026-11-24T05:20:00Z", terminada_at: "2026-11-24T05:20:10Z", segment_id: "seg-bd",
  contactos_resend: 850, contactos_segmento: 849, contactos_ajenos: 1, destinatarios: 849, altas: 1, actualizados: 0, borrados: 0, bajas_resend: 0,
  errores: 0, pendientes: 0, mensaje_error: null, ...extra,
});

describe("construirEstado", () => {
  const base = {
    canal: "broadcast" as const, apiKey: true, webhookSecret: false, remitente: true, ia: false, cronSecret: true, segmentIdEnv: null,
    faltan: [], limite: 1000, ultima: null, ultimaTerminada: null, supabaseUrl: "https://demo.supabase.co/",
  };
  it("qué está configurado (nunca valores), la URL del webhook y la cuota de la última pasada", () => {
    const e = construirEstado({ ...base, ultima: pasada(), ultimaTerminada: pasada() });
    expect(e.configurado).toEqual({ api_key: true, webhook_secret: false, remitente: true, ia: false, cron_secret: true, segment_id: "seg-bd" });
    expect(e.url_webhook).toBe("https://demo.supabase.co/functions/v1/resend-webhook");
    expect([e.contactos_resend, e.nivel_cuota]).toEqual([850, "aviso"]);
    expect(JSON.stringify(e)).not.toMatch(/re_|whsec_/);
  });
  it("el Segment del secreto manda sobre el de la base; sin pasadas, cuota vacía", () => {
    const e = construirEstado({ ...base, segmentIdEnv: " seg-env " });
    expect(e.configurado.segment_id).toBe("seg-env");
    expect([e.contactos_resend, e.nivel_cuota]).toEqual([null, "ok"]);
  });
});

describe("respuestaSincronizacion", () => {
  it("resume sin emails y limita los errores", () => {
    const r: ResumenSync = {
      estado: "parcial", segmentId: "s", segmentoCreado: false, contactosResend: 10, contactosSegmento: 9, ajenos: 1, destinatarios: 9, altas: 2,
      actualizados: 0, anadidosSegmento: 0, quitadosSegmento: 0, borrados: 1, bajasResend: 0,
      errores: Array.from({ length: 30 }, (_, i) => ({ suscriptorId: `s${i}`, accion: "crear", mensaje: "x" })), pendientes: 0, bloqueaEnvio: false, peticiones: 5, mensajeError: null,
    };
    const res = respuestaSincronizacion(r, "p1", 1000);
    expect(res.errores).toHaveLength(20);
    expect(res.total_errores).toBe(30);
    expect(res.success).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/@/);
  });
});
