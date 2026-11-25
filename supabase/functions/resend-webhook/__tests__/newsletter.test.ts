/**
 * Tests de supabase/functions/resend-webhook/newsletter.ts (portados del panel
 * de referencia): qué eventos de Resend dan de baja del newsletter, a quién y
 * con qué origen; qué se archiva y qué dirección se suprime.
 * Payloads con la forma de resend.com/docs/webhooks/emails/* y
 * resend.com/docs/webhooks/contacts/updated (consultado 2026-10-03).
 */
import { describe, it, expect } from "vitest";
import { decidirBajaNewsletter, leerEtiquetas, idArchivoEvento, destinatarioArchivo, normalizarEmail, patronIlikeExacto, metadatosDe, supresionDe, esCategoriaNewsletter } from "../newsletter.ts";

const SID = "0b6c3c0e-1f0a-4f63-9a59-6a2c2f4b6c11";

const evento = (type: string, data: Record<string, unknown>) => ({ type, created_at: "2026-10-03T10:00:00Z", data });

describe("decidirBajaNewsletter", () => {
  it("queja de spam -> queja_spam, con el suscriptor de la etiqueta", () => {
    const d = decidirBajaNewsletter(
      evento("email.complained", {
        email_id: "e1",
        to: ["Cliente@Example.com"],
        tags: { categoria: "newsletter", suscriptor: SID },
      }),
    );
    expect(d).toEqual({ email: "cliente@example.com", origen: "queja_spam", suscriptorId: SID });
  });

  it("rebote (permanente) -> rebote_permanente", () => {
    const d = decidirBajaNewsletter(
      evento("email.bounced", { email_id: "e1", to: ["a@example.com"], bounce: { type: "Permanent", subType: "General" } }),
    );
    expect(d?.origen).toBe("rebote_permanente");
    expect(d?.suscriptorId).toBeNull();
  });

  it("un rebote marcado como Transient NO da de baja", () => {
    expect(decidirBajaNewsletter(evento("email.bounced", { to: ["a@example.com"], bounce: { type: "Transient" } }))).toBeNull();
  });

  it("supresión de Resend -> suprimido_resend", () => {
    const d = decidirBajaNewsletter(evento("email.suppressed", { to: ["a@example.com"], suppressed: { type: "OnAccountSuppressionList" } }));
    expect(d?.origen).toBe("suprimido_resend");
  });

  it("también da de baja si la queja es de otro correo (sin etiquetas de newsletter)", () => {
    const d = decidirBajaNewsletter(evento("email.complained", { to: ["a@example.com"], tags: { category: "otro" } }));
    expect(d).toEqual({ email: "a@example.com", origen: "queja_spam", suscriptorId: null });
  });

  it("la confirmación también es del newsletter (un rebote de la confirmación da de baja al pendiente por su id)", () => {
    const d = decidirBajaNewsletter(evento("email.bounced", { to: ["a@example.com"], tags: { categoria: "newsletter_confirmacion", suscriptor: SID } }));
    expect(d).toEqual({ email: "a@example.com", origen: "rebote_permanente", suscriptorId: SID });
    expect(esCategoriaNewsletter("newsletter_prueba")).toBe(true);
    expect(esCategoriaNewsletter("newsletterx")).toBe(false);
  });

  it("ignora la etiqueta suscriptor si no es de categoría newsletter o no es un uuid", () => {
    expect(decidirBajaNewsletter(evento("email.complained", { to: ["a@example.com"], tags: { suscriptor: SID } }))?.suscriptorId).toBeNull();
    expect(
      decidirBajaNewsletter(evento("email.complained", { to: ["a@example.com"], tags: { categoria: "newsletter", suscriptor: "1 or 1=1" } }))
        ?.suscriptorId,
    ).toBeNull();
  });

  it("baja en la página de Resend (contact.updated unsubscribed=true) -> resend_baja_nativa", () => {
    const d = decidirBajaNewsletter(evento("contact.updated", { id: "c1", email: "A@Example.com", unsubscribed: true }));
    expect(d).toEqual({ email: "a@example.com", origen: "resend_baja_nativa", suscriptorId: null });
  });

  it("NUNCA reactiva: contact.updated con unsubscribed=false no hace nada", () => {
    expect(decidirBajaNewsletter(evento("contact.updated", { id: "c1", email: "a@example.com", unsubscribed: false }))).toBeNull();
  });

  it("los eventos normales no dan de baja a nadie", () => {
    for (const t of ["email.sent", "email.delivered", "email.opened", "email.clicked", "email.delivery_delayed", "email.failed", "contact.created", "contact.deleted"]) {
      expect(decidirBajaNewsletter(evento(t, { to: ["a@example.com"], email: "a@example.com", unsubscribed: true }))).toBeNull();
    }
  });

  it("sin destinatario válido no hay baja", () => {
    expect(decidirBajaNewsletter(evento("email.complained", { to: [] }))).toBeNull();
    expect(decidirBajaNewsletter(evento("email.complained", { to: ["no-es-un-email"] }))).toBeNull();
    expect(decidirBajaNewsletter({ type: undefined, data: null })).toBeNull();
  });

  it("acepta destinatario con nombre", () => {
    expect(decidirBajaNewsletter(evento("email.suppressed", { to: ["Pepe <Pepe@Example.com>"] }))?.email).toBe("pepe@example.com");
  });
});

describe("leerEtiquetas", () => {
  it("objeto (webhook) y array (envío)", () => {
    expect(leerEtiquetas({ a: "1", b: 2 })).toEqual({ a: "1" });
    expect(leerEtiquetas([{ name: "a", value: "1" }, { name: "b" }])).toEqual({ a: "1" });
    expect(leerEtiquetas(null)).toEqual({});
  });
});

describe("archivo en email_eventos", () => {
  it("usa email_id cuando existe", () => {
    expect(idArchivoEvento(evento("email.sent", { email_id: "e1" }))).toBe("e1");
  });
  it("id sintético para contact.* (email_id es NOT NULL)", () => {
    expect(idArchivoEvento(evento("contact.updated", { id: "c1" }))).toBe("contact.updated:c1");
    expect(idArchivoEvento(evento("suppression.added", {}))).toBe("suppression.added:sin-id");
  });
  it("destinatario: to[0] o email", () => {
    expect(destinatarioArchivo(evento("email.sent", { to: ["a@example.com"] }))).toBe("a@example.com");
    expect(destinatarioArchivo(evento("contact.updated", { email: "c@example.com" }))).toBe("c@example.com");
    expect(destinatarioArchivo(evento("x", {}))).toBeNull();
  });
});

describe("normalizarEmail", () => {
  it("minúsculas y recorte", () => {
    expect(normalizarEmail("  A@EXAMPLE.COM ")).toBe("a@example.com");
    expect(normalizarEmail(3)).toBeNull();
  });
});

describe("patronIlikeExacto (respaldo si falla la RPC newsletter_registrar_baja)", () => {
  // Réplica de ILIKE con la barra invertida como escape, para comprobar el patrón sin base de datos.
  const escaparRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ilike = (valor: string, patron: string) => {
    let re = "";
    for (let i = 0; i < patron.length; i++) {
      const c = patron[i];
      if (c === "\\") re += escaparRe(patron[++i]);
      else if (c === "%") re += ".*";
      else if (c === "_") re += ".";
      else re += escaparRe(c);
    }
    return new RegExp(`^${re}$`, "i").test(valor);
  };

  it("casa con el mismo email aunque cambien las mayúsculas", () => {
    expect(ilike("Ana.Perez@Example.com", patronIlikeExacto("ana.perez@example.com")!)).toBe(true);
  });

  it("escapa % y _: no casa con otros emails", () => {
    expect(patronIlikeExacto("a_b%c@example.com")).toBe("a\\_b\\%c@example.com");
    expect(ilike("aXbYYc@example.com", patronIlikeExacto("a_b%c@example.com")!)).toBe(false);
    expect(ilike("a_b%c@example.com", patronIlikeExacto("a_b%c@example.com")!)).toBe(true);
  });

  it("escapa la barra invertida", () => {
    expect(patronIlikeExacto("a\\b@example.com")).toBe("a\\\\b@example.com");
  });

  it("con un asterisco devuelve null (PostgREST lo trataría como comodín)", () => {
    expect(patronIlikeExacto("a*@example.com")).toBeNull();
  });

  it("no casa con un email que solo lo contiene", () => {
    expect(ilike("xana@example.com", patronIlikeExacto("ana@example.com")!)).toBe(false);
  });
});

describe("metadatosDe (estadísticas por envío)", () => {
  const ENVIO = "9d2b8a3e-5c4f-4b1a-8e7d-1234567890ab";
  it("categoría, envío, suscriptor y broadcast de las etiquetas", () => {
    expect(metadatosDe(evento("email.opened", { tags: { categoria: "newsletter", envio: ENVIO.toUpperCase(), suscriptor: SID }, broadcast_id: "b_1" }))).toEqual({
      categoria: "newsletter", envio_id: ENVIO, suscriptor_id: SID, broadcast_id: "b_1",
    });
  });
  it("descarta ids que no son uuid y categorías raras", () => {
    expect(metadatosDe(evento("email.opened", { tags: { categoria: "<script>", envio: "1; drop", suscriptor: "x" } }))).toEqual({});
  });
});

describe("supresionDe", () => {
  it("rebote permanente, queja y supresión suprimen la dirección", () => {
    expect(supresionDe(evento("email.bounced", { to: ["A@Example.com"], bounce: { type: "Permanent", message: "No existe" } }))).toEqual({ email: "a@example.com", motivo: "bounced", detalle: "No existe" });
    expect(supresionDe(evento("email.complained", { to: ["a@example.com"] }))?.motivo).toBe("complained");
    expect(supresionDe(evento("email.suppressed", { to: ["a@example.com"] }))?.motivo).toBe("suppressed");
  });
  it("un rebote temporal o un evento normal, no", () => {
    expect(supresionDe(evento("email.bounced", { to: ["a@example.com"], bounce: { type: "Transient" } }))).toBeNull();
    expect(supresionDe(evento("email.delivered", { to: ["a@example.com"] }))).toBeNull();
  });
});
