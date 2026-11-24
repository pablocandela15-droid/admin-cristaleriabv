/**
 * resend-webhook/procesar.ts: qué se archiva y qué se hace con cada evento (repo falso, sin red ni base de datos).
 */
import { describe, it, expect, vi } from "vitest";
import { filaEvento, procesarEvento, type RepoWebhook } from "../procesar.ts";

const SID = "0b6c3c0e-1f0a-4f63-9a59-6a2c2f4b6c11";
const ENVIO = "9d2b8a3e-5c4f-4b1a-8e7d-1234567890ab";

function repo(nuevo = true, falla: Partial<Record<keyof RepoWebhook, boolean>> = {}) {
  const r = {
    archivar: vi.fn(async () => {
      if (falla.archivar) throw new Error("bd caída");
      return nuevo;
    }),
    suprimir: vi.fn(async () => {
      if (falla.suprimir) throw new Error("x");
    }),
    darDeBaja: vi.fn(async () => {
      if (falla.darDeBaja) throw new Error("x");
      return 1;
    }),
    desvincularContacto: vi.fn(async () => {}),
  };
  return r satisfies RepoWebhook;
}

describe("filaEvento", () => {
  it("archiva lo justo: tipo sin «email.», destinatario, fecha, metadatos y svix-id (sin el cuerpo del correo)", () => {
    const f = filaEvento({
      type: "email.clicked",
      created_at: "2026-11-24T10:00:00Z",
      data: { email_id: "e1", to: ["ana@example.com"], from: "Cristalería <novedades@example.com>", subject: "Ofertas", html: "<p>secreto</p>",
        click: { link: "https://cristaleriabv.vercel.app/presupuesto" }, tags: { categoria: "newsletter", envio: ENVIO, suscriptor: SID } },
    }, "msg_1");
    expect(f).toEqual({
      email_id: "e1", tipo_evento: "clicked", email_destinatario: "ana@example.com", timestamp_evento: "2026-11-24T10:00:00Z", svix_id: "msg_1",
      metadata: { from: "Cristalería <novedades@example.com>", subject: "Ofertas", categoria: "newsletter", envio_id: ENVIO, suscriptor_id: SID,
        click_link: "https://cristaleriabv.vercel.app/presupuesto" },
    });
  });
  it("fecha rara → null", () => {
    expect(filaEvento({ type: "email.sent", created_at: "ayer", data: { email_id: "e" } }, null).timestamp_evento).toBeNull();
  });
});

describe("procesarEvento", () => {
  it("una entrega solo se archiva", async () => {
    const r = repo();
    expect(await procesarEvento({ type: "email.delivered", data: { email_id: "e1", to: ["a@example.com"] } }, "m1", r, () => {})).toMatchObject({ archivado: true, duplicado: false, suprimida: false, bajas: 0 });
    expect(r.suprimir).not.toHaveBeenCalled();
    expect(r.darDeBaja).not.toHaveBeenCalled();
  });

  it("una queja: archiva, suprime la dirección y da de baja (con el suscriptor de la etiqueta)", async () => {
    const r = repo();
    const res = await procesarEvento({ type: "email.complained", data: { email_id: "e1", to: ["A@Example.com"], tags: { categoria: "newsletter", suscriptor: SID } } }, "m2", r, () => {});
    expect(res).toMatchObject({ suprimida: true, bajas: 1 });
    expect(r.suprimir).toHaveBeenCalledWith({ email: "a@example.com", motivo: "complained", detalle: null, origen_email_id: "e1" });
    expect(r.darDeBaja).toHaveBeenCalledWith({ email: "a@example.com", origen: "queja_spam", suscriptorId: SID });
  });

  it("un evento repetido (mismo svix-id) no se vuelve a procesar", async () => {
    const r = repo(false);
    expect(await procesarEvento({ type: "email.bounced", data: { to: ["a@example.com"] } }, "m3", r, () => {})).toMatchObject({ duplicado: true, bajas: 0 });
    expect(r.suprimir).not.toHaveBeenCalled();
  });

  it("si suprimir o la baja fallan, sigue (el evento ya está archivado)", async () => {
    const r = repo(true, { suprimir: true, darDeBaja: true });
    expect(await procesarEvento({ type: "email.bounced", data: { to: ["a@example.com"] } }, "m4", r, () => {})).toMatchObject({ archivado: true, suprimida: false, bajas: 0 });
  });

  it("si no se puede archivar, lanza (Resend reintentará)", async () => {
    await expect(procesarEvento({ type: "email.sent", data: {} }, "m5", repo(true, { archivar: true }), () => {})).rejects.toThrow(/bd caída/);
  });

  it("contact.deleted desvincula el contacto sin dar de baja", async () => {
    const r = repo();
    expect(await procesarEvento({ type: "contact.deleted", data: { id: "c_9", email: "a@example.com" } }, "m6", r, () => {})).toMatchObject({ desvinculado: true, bajas: 0 });
    expect(r.desvincularContacto).toHaveBeenCalledWith("c_9");
  });
});
