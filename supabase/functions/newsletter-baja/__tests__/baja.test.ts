/**
 * newsletter-baja/baja.ts: un GET nunca da de baja (redirige a la web o solo consulta), el POST de la página y el
 * botón one-click sí, con el token del suscriptor. Dependencias falsas.
 */
import { describe, it, expect, vi } from "vitest";
import { manejarBaja, respuestaBaja, type DependenciasBaja } from "../baja.ts";

const WEB = "https://cristaleriabv.vercel.app";
const T = "f".repeat(64);
const URL_FN = "https://demo.supabase.co/functions/v1/newsletter-baja";

function deps(extra: Partial<DependenciasBaja> = {}) {
  return {
    web: vi.fn(async () => WEB),
    estado: vi.fn(async () => ({ estado: "confirmar" as const, email: "ana@example.com" })),
    baja: vi.fn(async () => ({ estado: "baja_hecha" as const, email: "ana@example.com", fecha_baja: "2026-11-24T10:00:00Z", resend_contact_id: "c_1" })),
    trasBaja: vi.fn(async () => "borrado"),
    log: () => {},
    ...extra,
  };
}

describe("respuestaBaja", () => {
  it("el email va a medias y solo en los estados buenos", () => {
    expect(respuestaBaja("baja_hecha", "ana@example.com", "f")).toEqual({ ok: true, estado: "baja_hecha", email: "an***@example.com", fecha_baja: "f" });
    expect(respuestaBaja("invalido", "ana@example.com")).toEqual({ ok: false, estado: "invalido", email: null, fecha_baja: null });
  });
});

describe("manejarBaja", () => {
  it("GET del navegador: 302 a la página de la web, sin cambiar nada", async () => {
    const d = deps();
    const r = await manejarBaja(new Request(`${URL_FN}?t=${T}&via=header`), d);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(`${WEB}/newsletter/baja?t=${T}`);
    expect(d.baja).not.toHaveBeenCalled();
    expect(d.estado).not.toHaveBeenCalled();
  });

  it("GET en JSON (la página): solo consulta el estado", async () => {
    const d = deps();
    const r = await manejarBaja(new Request(`${URL_FN}?t=${T}&formato=json`, { headers: { Origin: WEB } }), d);
    expect(await r.json()).toEqual({ ok: true, estado: "confirmar", email: "an***@example.com", fecha_baja: null });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    expect(d.baja).not.toHaveBeenCalled();
  });

  it("POST de la página: baja con origen enlace_email y quita el contacto de Resend", async () => {
    const d = deps();
    const r = await manejarBaja(new Request(`${URL_FN}?t=${T}&formato=json`, { method: "POST", headers: { Origin: WEB } }), d);
    expect(await r.json()).toMatchObject({ ok: true, estado: "baja_hecha", email: "an***@example.com" });
    expect(d.baja).toHaveBeenCalledWith(T, "enlace_email");
    expect(d.trasBaja).toHaveBeenCalled();
  });

  it("botón one-click (RFC 8058): POST sin cabeceras ni Origin, origen cabecera_one_click, texto plano", async () => {
    const d = deps();
    const r = await manejarBaja(new Request(`${URL_FN}?t=${T}&via=header`, { method: "POST", body: "List-Unsubscribe=One-Click" }), d);
    expect([r.status, await r.text()]).toEqual([200, "Baja registrada"]);
    expect(d.baja).toHaveBeenCalledWith(T, "cabecera_one_click");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("token inválido: no consulta nada", async () => {
    const d = deps();
    expect(await (await manejarBaja(new Request(`${URL_FN}?t=123&formato=json`, { method: "POST" }), d)).json()).toMatchObject({ estado: "invalido" });
    expect((await manejarBaja(new Request(`${URL_FN}?t=../x&via=header`, { method: "POST" }), d)).status).toBe(400);
    expect(d.baja).not.toHaveBeenCalled();
  });

  it("el enlace de las pruebas y la vista previa dice que es de prueba", async () => {
    expect(await (await manejarBaja(new Request(`${URL_FN}?t=prueba&formato=json`), deps())).json()).toMatchObject({ ok: false, estado: "prueba" });
  });

  it("ya estaba de baja: no vuelve a quitar de Resend", async () => {
    const d = deps({ baja: vi.fn(async () => ({ estado: "ya_estaba" as const, email: "ana@example.com", fecha_baja: "f" })) });
    expect(await (await manejarBaja(new Request(`${URL_FN}?t=${T}&formato=json`, { method: "POST" }), d)).json()).toMatchObject({ estado: "ya_estaba" });
    expect(d.trasBaja).not.toHaveBeenCalled();
  });

  it("si falla quitar de Resend, la baja vale igual; si falla la base de datos, 500", async () => {
    const d = deps({ trasBaja: vi.fn(async () => { throw new Error("resend caído"); }) });
    expect(await (await manejarBaja(new Request(`${URL_FN}?t=${T}&formato=json`, { method: "POST" }), d)).json()).toMatchObject({ estado: "baja_hecha" });
    const mal = deps({ baja: vi.fn(async () => { throw new Error("bd"); }) });
    expect((await manejarBaja(new Request(`${URL_FN}?t=${T}&formato=json`, { method: "POST" }), mal)).status).toBe(500);
  });

  it("en segundo plano si hay EdgeRuntime.waitUntil", async () => {
    const tareas: Promise<unknown>[] = [];
    const d = deps({ enSegundoPlano: (p) => void tareas.push(p) });
    await manejarBaja(new Request(`${URL_FN}?t=${T}&formato=json`, { method: "POST" }), d);
    expect(tareas).toHaveLength(1);
  });
});
