import { describe, expect, it } from "vitest";
import {
  agruparEnMensajes, aplicarTopes, type Aviso, construirResumen, cuerpoSendMessage, diaMadrid, enlacePanel, enSilencio, errorSaneado, esAccion, etiquetaTipo,
  fraseAviso, horaMadrid, LIMITE_TELEGRAM, MAX_FALLOS, mensajeAviso, NOMBRE_NEGOCIO, notaTope, pendientesDeEnvio, primeraFrase, queHacer, recortar, rutaPanel,
  silencioAhora, TEXTO_PRUEBA, tipoExcluido, tituloAviso,
} from "../logica";

const AHORA = new Date("2026-11-11T10:00:00Z"); // miércoles, 11:00 en Madrid

let n = 0;
const aviso = (p: Partial<Aviso> = {}): Aviso => ({
  id: `a${++n}`,
  tipo: "peticion_urgente",
  titulo: "Petición urgente: no se guarda la contraseña",
  mensaje: "Al cambiar la contraseña de un usuario no se guarda. Lo ha marcado como urgente.",
  referencia_tipo: "peticion",
  referencia_id: "p-1",
  created_at: new Date(AHORA.getTime() - 10 * 60_000).toISOString(),
  datos: {},
  ...p,
});

const CFG = { tipos_al_momento: ["peticion_urgente", "sistema"], activo_desde: "2026-11-10T00:00:00Z" };

describe("avisos-telegram · textos fijos", () => {
  it("prueba y cabecera con el nombre de Cristalería BV", () => {
    expect(TEXTO_PRUEBA).toBe("Prueba de avisos de Cristalería BV");
    expect(NOMBRE_NEGOCIO).toBe("Cristalería BV");
  });
  it("etiquetas de los tipos (las de la campana); un tipo nuevo sale con su clave legible", () => {
    expect(etiquetaTipo("peticion_urgente")).toBe("Peticiones urgentes");
    expect(etiquetaTipo("sistema")).toBe("Sistema");
    expect(etiquetaTipo("copia_seguridad")).toBe("copia seguridad");
  });
  it("los avisos técnicos de los modelos de IA nunca van a Telegram", () => {
    expect(["ia_modelo_nuevo", "ia_modelo_retirado", "ia_modelo_sin_precio"].every(tipoExcluido)).toBe(true);
    expect(["peticion_urgente", "sistema"].some(tipoExcluido)).toBe(false);
  });
});

describe("avisos-telegram · silencio nocturno", () => {
  it("23–8 cruza la medianoche", () => {
    expect([23, 0, 3, 7].every((h) => enSilencio(h, 23, 8))).toBe(true);
    expect([8, 12, 22].some((h) => enSilencio(h, 23, 8))).toBe(false);
  });
  it("tramo dentro del día y desde = hasta (sin silencio)", () => {
    expect(enSilencio(14, 14, 16)).toBe(true);
    expect(enSilencio(16, 14, 16)).toBe(false);
    expect(enSilencio(5, 5, 5)).toBe(false);
  });
  it("usa la hora de Madrid (invierno UTC+1, verano UTC+2)", () => {
    expect(horaMadrid(new Date("2026-11-11T22:30:00Z"))).toBe(23);
    expect(horaMadrid(new Date("2026-07-01T21:30:00Z"))).toBe(23);
    expect(diaMadrid(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
    const cfg = { silencio_activo: true, silencio_desde: 23, silencio_hasta: 8 };
    expect(silencioAhora(cfg, new Date("2026-11-11T22:30:00Z"))).toBe(true);
    expect(silencioAhora(cfg, new Date("2026-11-11T07:00:00Z"))).toBe(false); // 08:00 en Madrid
    expect(silencioAhora({ ...cfg, silencio_activo: false }, new Date("2026-11-11T22:30:00Z"))).toBe(false);
  });
});

describe("avisos-telegram · pendientes (no reenviar)", () => {
  it("solo tipos marcados, recientes, posteriores a la activación, sin caducar, con campana y sin excluir", () => {
    const bueno = aviso();
    const lista = [
      bueno,
      aviso({ tipo: "copia_seguridad" }), // no marcado
      aviso({ created_at: "2026-11-09T12:00:00Z" }), // anterior a la activación
      aviso({ datos: { campana: false } }),
      aviso({ caduca_en: "2026-11-11T09:00:00Z" }),
      aviso({ tipo: "ia_modelo_nuevo" }), // excluido aunque se marque
    ];
    expect(pendientesDeEnvio(lista, [], { ...CFG, tipos_al_momento: [...CFG.tipos_al_momento, "ia_modelo_nuevo"] }, AHORA).map((a) => a.id)).toEqual([bueno.id]);
  });
  it("lo ya enviado no se vuelve a mandar; los fallos se reintentan hasta MAX_FALLOS", () => {
    const a = aviso();
    const b = aviso({ tipo: "sistema" });
    const c = aviso();
    const envios = [
      { aviso_id: a.id, ok: true },
      ...Array.from({ length: MAX_FALLOS }, () => ({ aviso_id: b.id, ok: false })),
      { aviso_id: c.id, ok: false },
      { aviso_id: null, ok: true }, // la prueba o el resumen: no cuentan
    ];
    expect(pendientesDeEnvio([a, b, c], envios, CFG, AHORA).map((x) => x.id)).toEqual([c.id]);
  });
  it("sin activo_desde no manda nada viejo; nunca más de 24 h; del más antiguo al más nuevo", () => {
    expect(pendientesDeEnvio([aviso()], [], { ...CFG, activo_desde: null }, AHORA)).toEqual([]);
    const nuevo = aviso({ created_at: "2026-11-11T09:58:00Z" });
    const viejo = aviso({ created_at: "2026-11-11T09:00:00Z" });
    const deAyer = aviso({ created_at: "2026-11-10T09:00:00Z" });
    expect(pendientesDeEnvio([nuevo, viejo, deAyer], [], CFG, AHORA).map((x) => x.id)).toEqual([viejo.id, nuevo.id]);
  });
});

describe("avisos-telegram · topes", () => {
  it("tope por hora y por día contando lo ya mandado; lo que sobra queda aparte", () => {
    const l = Array.from({ length: 15 }, (_, i) => i);
    const topes = { hora: 10, dia: 30 };
    expect(aplicarTopes(l, { hora: 0, dia: 0 }, topes)).toEqual({ enviar: l.slice(0, 10), resto: l.slice(10) });
    expect(aplicarTopes(l, { hora: 8, dia: 0 }, topes).enviar).toEqual([0, 1]);
    expect(aplicarTopes(l, { hora: 0, dia: 29 }, topes).enviar).toEqual([0]);
    expect(aplicarTopes(l, { hora: 12, dia: 12 }, topes)).toEqual({ enviar: [], resto: l });
  });
  it("la nota de lo que no cabe dice cuántos y enlaza a los avisos del panel", () => {
    expect(notaTope(5, "https://panel.example/")).toBe("…y 5 avisos más (hay demasiados seguidos: el resto, en el panel).\nVer: https://panel.example/avisos");
    expect(notaTope(1)).toBe("…y 1 aviso más (hay demasiados seguidos: el resto, en el panel).");
  });
});

describe("avisos-telegram · mensajes", () => {
  it("frase corta: la primera frase de texto_telegram, del mensaje o el título", () => {
    expect(fraseAviso(aviso({ datos: { texto_telegram: "  La copia ha fallado.\n Revisa el cron. " } }))).toBe("La copia ha fallado.");
    expect(fraseAviso(aviso({ datos: null }))).toBe("Al cambiar la contraseña de un usuario no se guarda.");
    expect(fraseAviso(aviso({ mensaje: null, datos: null }))).toBe("Petición urgente: no se guarda la contraseña");
    expect(fraseAviso(aviso({ titulo: "", mensaje: null, tipo: "sistema" }))).toBe("Sistema");
  });
  it("no corta antes de una palabra en MAYÚSCULAS (siglas)", () => {
    expect(primeraFrase("Falla el paso 2. OPENAI no responde.")).toBe("Falla el paso 2. OPENAI no responde.");
    expect(primeraFrase("Se ha caído. Revisa el cron.")).toBe("Se ha caído.");
  });
  it("ruta del panel: el ticket de la petición, el enlace del aviso (solo rutas internas) o la campana", () => {
    expect(rutaPanel(aviso())).toBe("/super-admin/tickets?ticket=p-1");
    expect(rutaPanel(aviso({ referencia_id: "a b" }))).toBe("/super-admin/tickets?ticket=a%20b");
    expect(rutaPanel(aviso({ referencia_id: null }))).toBe("/super-admin/tickets");
    expect(rutaPanel(aviso({ tipo: "sistema", referencia_tipo: null, datos: { enlace: "/super-admin/servicios" } }))).toBe("/super-admin/servicios");
    expect(rutaPanel(aviso({ tipo: "sistema", referencia_tipo: null, datos: { enlace: "https://otra.example/x" } }))).toBe("/avisos");
    expect(rutaPanel(aviso({ tipo: "sistema", referencia_tipo: null, datos: null }))).toBe("/avisos");
  });
  it("aviso suelto: título, qué ha pasado, qué hacer y enlace (solo con PANEL_URL válida)", () => {
    const a = aviso();
    expect(queHacer(a)).toBe("míralo en Super Admin › Tickets.");
    expect(mensajeAviso(a, "https://panel.example/")).toBe(
      "Petición urgente: no se guarda la contraseña\n" +
        "Al cambiar la contraseña de un usuario no se guarda.\n" +
        "Qué hacer: míralo en Super Admin › Tickets.\n" +
        "Ver: https://panel.example/super-admin/tickets?ticket=p-1",
    );
    expect(mensajeAviso(a, null)).not.toContain("Ver:");
    expect(mensajeAviso(a, "javascript:alert(1)")).not.toContain("Ver:");
    expect(enlacePanel("javascript:alert(1)", "/x")).toBeNull();
    expect(enlacePanel(" https://panel.example// ", "avisos")).toBe("https://panel.example/avisos");
    // Sin «qué hacer» (sistema) y con la frase igual al título, solo título y enlace.
    const s = aviso({ tipo: "sistema", titulo: "Copia hecha", mensaje: "Copia hecha", referencia_tipo: null, datos: {} });
    expect(queHacer(s)).toBeNull();
    expect(mensajeAviso(s, "https://panel.example")).toBe("Copia hecha\nVer: https://panel.example/avisos");
  });
  it("el título se recorta a 90 caracteres", () => {
    expect(tituloAviso(aviso({ titulo: "t".repeat(200) }))).toHaveLength(90);
  });
  it("todos los avisos sueltos tienen entre 2 y 4 líneas", () => {
    for (const tipo of ["peticion_urgente", "sistema", "copia_seguridad"]) {
      const l = mensajeAviso(aviso({ tipo, mensaje: "Algo ha pasado con 3 cosas. Y una segunda frase larga que no debe salir." }), "https://panel.example").split("\n");
      expect(l.length).toBeGreaterThanOrEqual(2);
      expect(l.length).toBeLessThanOrEqual(4);
      expect(l.join("\n")).not.toContain("segunda frase");
    }
  });
  it("respeta el límite de 4.096 caracteres", () => {
    const largo = aviso({ datos: { texto_telegram: "x".repeat(10_000) } });
    expect(mensajeAviso(largo, "https://panel.example").length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(recortar("abcdef", 4)).toBe("abc…");
    expect(recortar("abc", 4)).toBe("abc");
    const cuerpo = cuerpoSendMessage("-100", "y".repeat(5000));
    expect((cuerpo.text as string).length).toBe(LIMITE_TELEGRAM);
    expect(cuerpo).toMatchObject({ chat_id: "-100", link_preview_options: { is_disabled: true } });
    expect(cuerpo).not.toHaveProperty("parse_mode");
  });
  it("agrupa varios avisos en mensajes de ≤ 4.096 y sabe qué aviso va en cada uno", () => {
    const textos = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(1500));
    const m = agruparEnMensajes(textos);
    expect(m.map((x) => x.indices)).toEqual([[0, 1], [2, 3], [4]]);
    expect(m.every((x) => x.texto.length <= LIMITE_TELEGRAM)).toBe(true);
  });
  it("el error nunca lleva el token", () => {
    expect(errorSaneado("fallo en https://api.telegram.org/bot123456:ABC-def_g/sendMessage")).not.toContain("123456:ABC");
  });
  it("acciones válidas: pendientes, resumen, probar y fallos (ya no hay resumen semanal)", () => {
    expect(["pendientes", "resumen", "probar", "fallos"].every(esAccion)).toBe(true);
    expect(["semanal", "borrar", "", null].some(esAccion)).toBe(false);
  });
});

describe("avisos-telegram · resumen diario", () => {
  it("agrupa por tipo con número y frases, el más numeroso primero", () => {
    const avisos = [
      aviso({ titulo: "Petición urgente: no entra en el panel", mensaje: null, created_at: "2026-11-11T08:00:00Z" }),
      aviso({ created_at: "2026-11-11T09:00:00Z" }),
      aviso({ tipo: "sistema", titulo: "Copia", datos: { texto_telegram: "La copia de seguridad ha fallado." } }),
      aviso({ tipo: "sistema", titulo: "No sale", datos: { campana: false } }),
      aviso({ tipo: "ia_modelo_nuevo", titulo: "Tampoco" }),
      aviso({ titulo: "Viejo", created_at: "2026-11-09T09:00:00Z" }),
      aviso({ titulo: "Caducado", caduca_en: "2026-11-11T09:30:00Z" }),
    ];
    const { texto, total } = construirResumen(avisos, AHORA, "https://panel.example");
    expect(total).toBe(3);
    expect(texto.startsWith("Avisos de Cristalería BV · miércoles 11/11\nÚltimas 24 h: 3 avisos.")).toBe(true);
    expect(texto.indexOf("Peticiones urgentes (2)")).toBeLessThan(texto.indexOf("Sistema (1)"));
    // Las frases, de la más reciente a la más antigua.
    expect(texto).toContain("Peticiones urgentes (2)\n• Al cambiar la contraseña de un usuario no se guarda.\n• Petición urgente: no entra en el panel");
    expect(texto).toContain("• La copia de seguridad ha fallado.");
    for (const fuera of ["No sale", "Tampoco", "Viejo", "Caducado"]) expect(texto).not.toContain(fuera);
    expect(texto.endsWith("\n\nVer todo: https://panel.example/avisos")).toBe(true);
  });
  it("con el mismo número, por orden alfabético; un solo aviso en singular", () => {
    const { texto } = construirResumen([aviso({ tipo: "sistema", titulo: "S" }), aviso({ titulo: "P" })], AHORA);
    expect(texto.indexOf("Peticiones urgentes (1)")).toBeLessThan(texto.indexOf("Sistema (1)"));
    expect(construirResumen([aviso()], AHORA).texto).toContain("Últimas 24 h: 1 aviso.");
  });
  it("como mucho 4 frases por tipo y «…y N más»", () => {
    const avisos = Array.from({ length: 7 }, (_, i) => aviso({ tipo: "sistema", datos: { texto_telegram: `Aviso ${i}` } }));
    const { texto } = construirResumen(avisos, AHORA);
    expect(texto.match(/^• /gm)?.length).toBe(4);
    expect(texto).toContain("…y 3 más.");
  });
  it("sin avisos (o solo los que no cuentan) no manda nada (texto vacío)", () => {
    expect(construirResumen([], AHORA)).toMatchObject({ texto: "", total: 0 });
    expect(construirResumen([aviso({ datos: { campana: false } }), aviso({ tipo: "ia_modelo_retirado" })], AHORA)).toMatchObject({ texto: "", total: 0 });
  });
  it("nunca pasa de 4.096 aunque haya muchos tipos y textos largos", () => {
    const tipos = ["peticion_urgente", "sistema", ...Array.from({ length: 10 }, (_, i) => `tipo_${i}`)];
    const avisos = tipos.flatMap((t) => Array.from({ length: 5 }, () => aviso({ tipo: t, datos: { texto_telegram: "z".repeat(390) } })));
    const { texto } = construirResumen(avisos, AHORA, "https://panel.example");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(texto).toContain("No cabe todo");
    expect(texto).toContain("https://panel.example/avisos");
    const enorme = construirResumen([aviso({ datos: { texto_telegram: "w".repeat(9000) } })], AHORA);
    expect(enorme.texto.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
  });
});
