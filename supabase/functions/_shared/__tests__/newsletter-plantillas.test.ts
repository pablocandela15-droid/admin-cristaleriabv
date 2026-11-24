/**
 * Newsletter · bloques, plantillas, pie RGPD, enlaces, datos del negocio y correo de confirmación
 * (_shared/newsletter/*). Portados de los tests del panel de referencia (enviar-newsletter/__tests__/plantillas.test.ts)
 * y adaptados a la cristalería. Código puro: sin red ni Deno.
 */
import { describe, it, expect } from "vitest";
import {
  PLANTILLAS_BASE,
  TIPOS_BLOQUE,
  esEnlacePropio,
  plantillaBase,
  textoPlanoDeBloques,
  urlBotonSegura,
  urlHttpsSegura,
  validarBloques,
  type Bloque,
} from "../newsletter/bloques.ts";
import {
  MARCA_PIE_BAJA,
  asuntoNewsletter,
  cabecerasBaja,
  escapeHtml,
  limiteTransaccional,
  renderNewsletter,
  textoNewsletter,
  tieneEnlaceBaja,
  validarPayload,
} from "../newsletter/plantillas.ts";
import {
  baseWeb,
  configDesdeFila,
  enmascararEmail,
  faltaParaEnviar,
  remitente,
  urlBajaOneClick,
  urlBajaWeb,
  urlConfirmacion,
  CONFIG_POR_DEFECTO,
} from "../newsletter/enlaces.ts";
import { negocioDesdeContenido, negocioPorDefecto, NOMBRE_NEGOCIO } from "../newsletter/negocio.ts";
import { correoConfirmacion } from "../newsletter/confirmacion.ts";
import { enviarConfirmacion, leerAjustes } from "../newsletter/servidor.ts";

const WEB = "https://cristaleriabv.vercel.app";
const BAJA = `${WEB}/newsletter/baja?t=${"a".repeat(64)}&x=1`;
const NEGOCIO = negocioDesdeContenido(
  { phones: [{ display: "600 00 00 00", tel: "+34600000000" }], email: "info@example.com", address: { street: "C/ Ejemplo, 1", postalCode: "03000", city: "Pueblo", province: "Alicante" } },
  WEB,
);
const TODOS: Bloque[] = [
  { tipo: "texto", texto: "Primer párrafo.\n\nSegundo párrafo." },
  { tipo: "imagen", url: "https://example.com/foto.webp", alt: "Mampara de ducha", pie: "Mampara en Elche" },
  { tipo: "destacado", titulo: "Hasta fin de mes", texto: "Medición gratis en Crevillente." },
  { tipo: "lista", titulo: "En oferta", elementos: [{ nombre: "Mampara fija", descripcion: "Vidrio templado 8 mm", precio: "desde 200 €" }] },
  { tipo: "datos", fecha: "Hasta el 30 de noviembre", horario: "9:00 – 13:30", lugar: "Baix Vinalopó", precio: "Según medidas" },
  { tipo: "boton", texto: "Calcular presupuesto", url: `${WEB}/presupuesto` },
  { tipo: "cita", texto: "Quedó perfecto", autor: "Un cliente" },
  { tipo: "separador" },
  { tipo: "firma", texto: "Un saludo,\nEl equipo" },
];

describe("escapeHtml", () => {
  it("escapa los cinco caracteres peligrosos", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("pie de baja obligatorio y datos del responsable (RGPD)", () => {
  const datos = { tipo: "novedades" as const, titulo: "Hola", mensaje: "", bloques: [TODOS[0]] };

  it("todo correo lleva un único pie con el enlace personal, el responsable y la política de privacidad", () => {
    const html = renderNewsletter(datos, BAJA, { negocio: NEGOCIO });
    expect(html.split(MARCA_PIE_BAJA).length - 1).toBe(1);
    expect(tieneEnlaceBaja(html, BAJA)).toBe(true);
    expect(html).toContain("Responsable del tratamiento: Cristalería Baix Vinalopó · C/ Ejemplo, 1, 03000 Pueblo (Alicante) · info@example.com");
    expect(html).toContain(`href="${WEB}/privacidad"`);
    expect(html).toContain("con tu consentimiento");
  });

  it("sin enlace de baja no se pinta el correo", () => {
    expect(() => renderNewsletter(datos, "")).toThrow(/enlace de baja/);
  });

  it("el & del enlace va escapado (HTML válido) y tieneEnlaceBaja detecta otro enlace o la falta del pie", () => {
    const html = renderNewsletter(datos, BAJA);
    expect(html).toContain("&amp;x=1");
    expect(tieneEnlaceBaja(html, `${WEB}/newsletter/baja?t=otro`)).toBe(false);
    expect(tieneEnlaceBaja(html.replace(MARCA_PIE_BAJA, ""), BAJA)).toBe(false);
  });

  it("sin datos del negocio, el pie lleva el nombre y la web (no se inventa dirección ni correo)", () => {
    const html = renderNewsletter(datos, BAJA);
    expect(html).toContain(`Responsable del tratamiento: ${NOMBRE_NEGOCIO}.`);
    expect(negocioPorDefecto(WEB)).toEqual({ nombre: NOMBRE_NEGOCIO, direccion: null, telefono: null, email: null, web: WEB });
  });

  it("la versión de texto lleva el enlace de baja y el responsable", () => {
    const t = textoNewsletter(datos, BAJA, { negocio: NEGOCIO });
    expect(t).toContain(`Darse de baja: ${BAJA}`);
    expect(t).toContain("Primer párrafo.");
    expect(t).toContain("info@example.com");
  });
});

describe("el equipo (o la IA) no puede inyectar HTML ni esconder el pie", () => {
  it("todo texto de los bloques va escapado", () => {
    const html = renderNewsletter({
      tipo: "personalizada",
      titulo: "<script>alert(1)</script>",
      mensaje: "",
      bloques: [{ tipo: "texto", texto: '<style>[data-pie-baja]{display:none}</style><img src=x onerror="y">' }],
    }, BAJA);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<style>[data-pie-baja]");
    expect(html).toContain("&lt;style&gt;");
    expect(tieneEnlaceBaja(html, BAJA)).toBe(true);
  });

  it("validarBloques rechaza imágenes y enlaces peligrosos", () => {
    expect(validarBloques([{ tipo: "imagen", url: "javascript:alert(1)", alt: "" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "imagen", url: "http://example.com/a.jpg", alt: "" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "boton", texto: "Ir", url: "data:text/html,hola" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "boton", texto: "Llamar", url: "tel:+34 600 000 000" }])).toEqual({ ok: true, bloques: [{ tipo: "boton", texto: "Llamar", url: "tel:+34600000000" }] });
  });
});

describe("validarBloques", () => {
  it("acepta todos los tipos, limpia espacios y filas vacías", () => {
    const v = validarBloques([...TODOS, { tipo: "lista", elementos: [{ nombre: "  Espejo  " }, { nombre: "" }] }]);
    expect(v.ok).toBe(true);
    expect(v.ok && v.bloques.at(-1)).toEqual({ tipo: "lista", elementos: [{ nombre: "Espejo" }] });
    expect(TIPOS_BLOQUE).toEqual(["texto", "imagen", "destacado", "lista", "datos", "boton", "cita", "separador", "firma"]);
  });
  it("rechaza tipos de restaurante, vacíos y excesos", () => {
    expect(validarBloques([{ tipo: "platos", platos: [{ nombre: "Arroz" }] }]).ok).toBe(false);
    expect(validarBloques([]).ok).toBe(false);
    expect(validarBloques([{ tipo: "separador" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "texto", texto: "  " }]).ok).toBe(false);
    expect(validarBloques(Array.from({ length: 21 }, () => ({ tipo: "texto", texto: "x" }))).ok).toBe(false);
    expect(validarBloques([{ tipo: "texto", texto: "x".repeat(2001) }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "datos" }]).ok).toBe(false);
  });
  it("la IA solo enlaza a la web de la cristalería (o a un teléfono)", () => {
    expect(esEnlacePropio(`${WEB}/trabajos`)).toBe(true);
    expect(esEnlacePropio("https://www.cristaleriabaixvinalopo.es/contacto")).toBe(true);
    expect(esEnlacePropio("https://otra.example.com/")).toBe(false);
    expect(esEnlacePropio("https://nueva.example.com/x", ["nueva.example.com"])).toBe(true);
    expect(esEnlacePropio("tel:+34600000000")).toBe(true);
    expect(urlHttpsSegura("https://a.example.com/x y")).toBe("https://a.example.com/x%20y");
    expect(urlBotonSegura("tel:123")).toBeNull();
  });
});

describe("plantillas de partida y estética", () => {
  it("son de cristalería: novedades, oferta, temporada, trabajos, consejos, aviso y en blanco (nada de restaurante)", () => {
    expect(PLANTILLAS_BASE.map((p) => p.tipo)).toEqual(["novedades", "oferta", "temporada", "trabajos", "consejos", "aviso", "personalizada"]);
    const texto = JSON.stringify(PLANTILLAS_BASE).toLowerCase();
    for (const palabra of ["reserva", "carta", "menú", "vino", "mesa", "plato", "restaurante"]) expect(texto).not.toContain(palabra);
    for (const p of PLANTILLAS_BASE.filter((x) => x.tipo !== "personalizada")) expect(validarBloques(p.bloques).ok, p.tipo).toBe(true);
    expect(plantillaBase("aviso").nombre).toBe("Aviso");
  });

  it("maquetado con tablas, 600 px, Outlook, modo oscuro, logo y todos los bloques", () => {
    const html = renderNewsletter({ tipo: "oferta", titulo: "Ofertas", mensaje: "", bloques: TODOS, insignia: "Oferta", preheader: "Solo este mes" }, BAJA, { negocio: NEGOCIO });
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain(`${WEB}/brand/icon-512.png`);
    expect(html).toContain("Solo este mes");
    for (const t of ["Segundo párrafo.", "Mampara en Elche", "Medición gratis", "Vidrio templado 8 mm", "desde 200 €", "Hasta el 30 de noviembre", "Horario", "Zona", "Calcular presupuesto", "Quedó perfecto", "El equipo"]) {
      expect(html).toContain(t);
    }
    expect(html).toContain('href="tel:+34600000000"');
  });

  it("un envío sin bloques se pinta con la estética de su plantilla", () => {
    const html = renderNewsletter({ tipo: "oferta", titulo: "Oferta", mensaje: "Mamparas a mitad de precio", imagenUrl: "https://example.com/m.jpg" }, BAJA);
    expect(html).toContain("Mamparas a mitad de precio");
    expect(html).toContain("https://example.com/m.jpg");
    expect(html).toContain("Calcular mi presupuesto");
  });

  it("textoPlanoDeBloques: una versión de texto legible", () => {
    const t = textoPlanoDeBloques(TODOS);
    expect(t).toContain("· Mampara fija (desde 200 €): Vidrio templado 8 mm");
    expect(t).toContain("Fechas: Hasta el 30 de noviembre");
    expect(t).toContain(`Calcular presupuesto: ${WEB}/presupuesto`);
  });
});

describe("validarPayload, asunto y cabeceras", () => {
  it("con bloques, el mensaje se saca de ellos; rechaza tipos desconocidos y textos largos", () => {
    const v = validarPayload({ tipo: "oferta", titulo: "  Oferta \n de invierno ", bloques: [TODOS[0]] });
    expect(v.ok && v.datos).toMatchObject({ titulo: "Oferta   de invierno", mensaje: "Primer párrafo.\n\nSegundo párrafo." });
    expect(validarPayload({ tipo: "nuevo_menu", titulo: "x", mensaje: "y" }).ok).toBe(false);
    expect(validarPayload({ tipo: "oferta", titulo: "x".repeat(151), mensaje: "y" }).ok).toBe(false);
    expect(validarPayload({ tipo: "oferta", titulo: "x", mensaje: "y", insignia: "x".repeat(41) }).ok).toBe(false);
    expect(validarPayload({ tipo: "oferta", titulo: "x", mensaje: "y", imagen_url: "http://x" }).ok).toBe(false);
  });
  it("el asunto no admite saltos de línea; List-Unsubscribe one-click (RFC 8058)", () => {
    expect(asuntoNewsletter("oferta", "Hola\r\nBcc: x@example.com")).toBe("Hola Bcc: x@example.com");
    expect(cabecerasBaja("https://x.example.com/b")).toEqual({ "List-Unsubscribe": "<https://x.example.com/b>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(() => cabecerasBaja("")).toThrow();
  });
  it("límite transaccional: 80 por defecto, 0 lo quita", () => {
    expect(limiteTransaccional(undefined)).toBe(80);
    expect(limiteTransaccional(-1)).toBe(80);
    expect(limiteTransaccional(0)).toBeNull();
    expect(limiteTransaccional(250)).toBe(250);
  });
});

describe("enlaces, remitente y ajustes", () => {
  const T = "b".repeat(64);
  it("las páginas viven en la web (https) y el one-click en la función", () => {
    expect(urlConfirmacion(WEB, T)).toBe(`${WEB}/newsletter/confirmada?t=${T}`);
    expect(urlBajaWeb(`${WEB}/`, T)).toBe(`${WEB}/newsletter/baja?t=${T}`);
    expect(urlBajaOneClick("https://demo.supabase.co/", T)).toBe(`https://demo.supabase.co/functions/v1/newsletter-baja?t=${T}&via=header`);
    expect(baseWeb("http://inseguro.example.com")).toBe(WEB);
    expect(baseWeb("javascript:alert(1)")).toBe(WEB);
    expect(baseWeb("https://www.cristaleriabaixvinalopo.es/")).toBe("https://www.cristaleriabaixvinalopo.es");
  });
  it("email a medias para las páginas", () => {
    expect(enmascararEmail("ana.perez@example.com")).toBe("an***@example.com");
    expect(enmascararEmail("a@example.com")).toBe("a***@example.com");
    expect(enmascararEmail(null)).toBeNull();
  });
  it("remitente «Nombre <email>» sin romper la cabecera; sin email, null", () => {
    expect(remitente("Cristalería BV", "Novedades@Example.com")).toBe("Cristalería BV <novedades@example.com>");
    expect(remitente('Malo "<x>"\r\n', "a@example.com")).toBe("Malo x <a@example.com>");
    expect(remitente("X", null)).toBeNull();
    expect(remitente("X", "no-es-email")).toBeNull();
  });
  it("qué falta para enviar: la clave de Resend y el remitente", () => {
    expect(faltaParaEnviar({ apiKey: false, config: CONFIG_POR_DEFECTO })).toHaveLength(2);
    expect(faltaParaEnviar({ apiKey: true, config: { ...CONFIG_POR_DEFECTO, remitente_email: "n@example.com" } })).toEqual([]);
    expect(configDesdeFila({ canal: "raro" as never, web_url: "ftp://x" })).toMatchObject({ canal: "transaccional", web_url: WEB, limite_transaccional: 80 });
  });
});

describe("correo de confirmación (doble opt-in)", () => {
  it("botón y enlace de texto a la página de la web, caducidad y nada de enviar sin pedirlo", () => {
    const enlace = urlConfirmacion(WEB, "c".repeat(64));
    const c = correoConfirmacion({ enlace, nombre: "Ana", negocio: NEGOCIO });
    expect(c.asunto).toBe("Confirma tu suscripción a las novedades de Cristalería Baix Vinalopó");
    expect(c.html.split(`href="${enlace}"`).length - 1).toBe(2);
    expect(c.html).toContain("Hola, Ana:");
    expect(c.html).toContain("caduca en 7 días");
    expect(c.html).toContain("ignora este correo");
    expect(c.texto).toContain(enlace);
    expect(correoConfirmacion({ enlace, negocio: NEGOCIO }).html).toContain("Hola:");
    expect(correoConfirmacion({ enlace, nombre: "<b>x</b>", negocio: NEGOCIO }).html).not.toContain("<b>x</b>");
  });

  it("enviarConfirmacion: remitente de los ajustes, etiquetas e idempotencia por token", async () => {
    const llamadas: unknown[] = [];
    const cliente = { enviarCorreo: async (c: unknown, k?: string) => (llamadas.push({ c, k }), { ok: true as const, status: 200, data: { id: "em" } }) };
    const config = { ...CONFIG_POR_DEFECTO, remitente_email: "n@example.com" };
    const id = "0b6c3c0e-1f0a-4f63-9a59-6a2c2f4b6c11";
    expect(await enviarConfirmacion(cliente, { id, email: "ana@example.com", nombre: null, token: "d".repeat(64), config, negocio: NEGOCIO })).toBe(true);
    expect(llamadas[0]).toMatchObject({
      k: `confirmacion/${id}/${"d".repeat(16)}`,
      c: { from: "Cristalería Baix Vinalopó <n@example.com>", to: ["ana@example.com"], tags: [{ name: "categoria", value: "newsletter_confirmacion" }, { name: "suscriptor", value: id }] },
    });
    expect(await enviarConfirmacion(cliente, { id, email: "a@example.com", nombre: null, token: "d".repeat(64), config: CONFIG_POR_DEFECTO, negocio: NEGOCIO })).toBe(false);
  });

  it("leerAjustes: newsletter_config y el bloque negocio de la web (sin él, solo nombre y web)", async () => {
    const db = (negocio: unknown, errorNegocio = false) => ({
      from: (t: string) => {
        const q = { select: () => q, eq: () => q, maybeSingle: async () =>
          t === "newsletter_config" ? { data: { remitente_email: "n@example.com", web_url: "https://www.cristaleriabaixvinalopo.es" }, error: null }
            : errorNegocio ? { data: null, error: { message: "x" } } : { data: { valor: negocio }, error: null } };
        return q;
      },
    });
    const a = await leerAjustes(db({ email: "info@example.com" }));
    expect(a.config.remitente_email).toBe("n@example.com");
    expect(a.negocio).toMatchObject({ email: "info@example.com", web: "https://www.cristaleriabaixvinalopo.es" });
    expect((await leerAjustes(db(null, true))).negocio.email).toBeNull();
  });
});
