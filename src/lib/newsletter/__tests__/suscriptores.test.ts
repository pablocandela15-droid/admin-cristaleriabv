/**
 * Newsletter en el panel: suscriptores (filtros, recuento, CSV), diseño del correo (lo que se manda a
 * enviar-newsletter) y textos para el equipo. Código puro.
 */
import { describe, it, expect } from "vitest";
import {
  campoCsv,
  contar,
  esBajaPorEntrega,
  etiquetaOrigenAlta,
  etiquetaOrigenBaja,
  exportarCsv,
  filtrarSuscriptores,
  leerCsv,
  puedeReenviarConfirmacion,
  type SuscriptorNewsletter,
} from "../suscriptores";
import { bloqueVacio, disenoDePlantilla, huecosPorCompletar, payloadDeDiseno, plantillaBase, validarBloques, TIPOS_BLOQUE } from "../diseno";
import { textoErrorCliente } from "../textos";
import { motivoAutoSincronizacion, textoCanal, agruparEstadisticas } from "../resend";

const s = (extra: Partial<SuscriptorNewsletter>): SuscriptorNewsletter => ({
  id: "1", email: "ana@example.com", nombre: "Ana Pérez", estado: "activo", origen_alta: "web_formulario", consentimiento_at: "2026-11-01T10:00:00Z",
  consentimiento_detalle: null, fecha_verificacion_email: "2026-11-01T10:05:00Z", confirmaciones_enviadas: 1, confirmacion_enviada_at: "2026-11-01T10:00:00Z",
  fecha_baja: null, origen_baja: null, created_at: "2026-11-01T10:00:00Z", ...extra,
});

const FILAS = [
  s({}),
  s({ id: "2", email: "beto@example.com", nombre: null, estado: "pendiente", origen_alta: "panel_manual", fecha_verificacion_email: null, created_at: "2026-11-03T10:00:00Z" }),
  s({ id: "3", email: "carla@example.com", nombre: "Carla Martínez", estado: "baja", origen_alta: "importacion", fecha_baja: "2026-11-04T10:00:00Z", origen_baja: "queja_spam", created_at: "2026-11-02T10:00:00Z" }),
];

describe("suscriptores", () => {
  it("recuento por estado", () => {
    expect(contar(FILAS)).toEqual({ activos: 1, pendientes: 1, bajas: 1, total: 3 });
  });
  it("búsqueda sin tildes ni mayúsculas, filtros por estado y origen, más recientes primero", () => {
    expect(filtrarSuscriptores(FILAS, {}).map((f) => f.id)).toEqual(["2", "3", "1"]);
    expect(filtrarSuscriptores(FILAS, { texto: "PEREZ" }).map((f) => f.id)).toEqual(["1"]);
    expect(filtrarSuscriptores(FILAS, { texto: "martinez" }).map((f) => f.id)).toEqual(["3"]);
    expect(filtrarSuscriptores(FILAS, { estado: "pendiente" }).map((f) => f.id)).toEqual(["2"]);
    expect(filtrarSuscriptores(FILAS, { origen: "importacion" }).map((f) => f.id)).toEqual(["3"]);
  });
  it("etiquetas en llano", () => {
    expect(etiquetaOrigenAlta("web_presupuesto")).toBe("Solicitud de presupuesto");
    expect(etiquetaOrigenBaja("cabecera_one_click")).toMatch(/Cancelar suscripción/);
    expect(esBajaPorEntrega("rebote_permanente")).toBe(true);
    expect(esBajaPorEntrega("enlace_email")).toBe(false);
  });
  it("reenviar la confirmación: solo pendientes, una al día y cinco como mucho", () => {
    const ahora = Date.parse("2026-11-05T12:00:00Z");
    expect(puedeReenviarConfirmacion(FILAS[0], ahora)).toBe(false);
    expect(puedeReenviarConfirmacion(s({ estado: "pendiente", confirmacion_enviada_at: "2026-11-05T08:00:00Z" }), ahora)).toBe(false);
    expect(puedeReenviarConfirmacion(s({ estado: "pendiente", confirmacion_enviada_at: "2026-11-03T08:00:00Z" }), ahora)).toBe(true);
    expect(puedeReenviarConfirmacion(s({ estado: "pendiente", confirmaciones_enviadas: 5, confirmacion_enviada_at: null }), ahora)).toBe(false);
  });
});

describe("CSV", () => {
  it("exporta con punto y coma, BOM y sin fórmulas (CSV injection)", () => {
    const csv = exportarCsv([s({ nombre: "=HYPERLINK(\"x\")" })]);
    expect(csv.startsWith("﻿email;nombre;estado")).toBe(true);
    expect(csv).toContain(`ana@example.com;"'=HYPERLINK(""x"")";Activo;Formulario de la web`);
    expect(campoCsv("a;b")).toBe('"a;b"');
    expect(campoCsv(null)).toBe("");
  });
  it("importa con cabecera (email y nombre, en cualquier orden), sin duplicados y avisando de las líneas malas", () => {
    const r = leerCsv("﻿Nombre;Email\r\nAna;ANA@example.com\nBeto;beto@example.com\n;ana@example.com\nMal;no-es-un-email\n");
    expect(r).toEqual({ filas: [{ email: "ana@example.com", nombre: "Ana" }, { email: "beto@example.com", nombre: "Beto" }], invalidas: [5], duplicadas: 1 });
  });
  it("sin cabecera: el email en la primera columna; con comas y comillas", () => {
    expect(leerCsv('ana@example.com,"Pérez, Ana"\nbeto@example.com').filas).toEqual([{ email: "ana@example.com", nombre: "Pérez, Ana" }, { email: "beto@example.com", nombre: null }]);
    expect(leerCsv("").filas).toEqual([]);
  });
  it("como mucho 2000 filas", () => {
    const texto = Array.from({ length: 2100 }, (_, i) => `p${i}@example.com`).join("\n");
    expect(leerCsv(texto).filas).toHaveLength(2000);
  });
});

describe("diseño del correo", () => {
  it("una plantilla se copia (editar no cambia la de partida)", () => {
    const d = disenoDePlantilla(plantillaBase("oferta"));
    (d.bloques[0] as { texto: string }).texto = "cambiado";
    expect((plantillaBase("oferta").bloques[0] as { texto: string }).texto).not.toBe("cambiado");
  });
  it("payload: exige asunto y bloques válidos, y lleva la versión de texto", () => {
    const d = { tipo: "aviso" as const, titulo: " Cerramos en agosto ", insignia: "", preheader: "", bloques: [{ tipo: "texto" as const, texto: "Del 1 al 15." }] };
    expect(payloadDeDiseno(d)).toEqual({ ok: true, payload: { tipo: "aviso", titulo: "Cerramos en agosto", mensaje: "Del 1 al 15.", bloques: d.bloques } });
    expect(payloadDeDiseno({ ...d, titulo: " " })).toMatchObject({ ok: false });
    expect(payloadDeDiseno({ ...d, bloques: [{ tipo: "texto", texto: "" }] })).toMatchObject({ ok: false });
  });
  it("huecos por completar: los [corchetes] de las plantillas", () => {
    expect(huecosPorCompletar(disenoDePlantilla(plantillaBase("novedades")))).toContain("[Cuenta aquí la novedad en dos o tres frases.]");
  });
  it("cada bloque vacío del editor tiene su forma (y con contenido valida)", () => {
    for (const t of TIPOS_BLOQUE) expect(bloqueVacio(t).tipo).toBe(t);
    expect(validarBloques([bloqueVacio("boton"), bloqueVacio("firma")]).ok).toBe(true);
  });
});

describe("textos y estado del envío", () => {
  it("traduce los errores técnicos a frases para el equipo", () => {
    expect(textoErrorCliente("Falta configurar la clave de Resend (secreto RESEND_API_KEY en Supabase). No se ha enviado nada.")).toMatch(/Configuración/);
    expect(textoErrorCliente("Esta newsletter ya se ha enviado (se ha pulsado dos veces).")).toMatch(/ya se ha enviado/);
    expect(textoErrorCliente("RESEND_API_KEY 401")).toMatch(/no está disponible/);
    expect(textoErrorCliente("El asunto no puede superar 150 caracteres")).toBe("El asunto no puede superar 150 caracteres");
  });
  it("canal y estadísticas por envío", () => {
    expect(textoCanal("transaccional")).toBe("Uno a uno");
    expect(textoCanal("broadcast")).toMatch(/Broadcast/);
    expect(agruparEstadisticas([{ envio_id: "e", tipo_evento: "opened", eventos: 4, destinatarios: 2 }, { envio_id: "e", tipo_evento: "delivered", eventos: 3, destinatarios: 3 }]).get("e"))
      .toEqual({ entregados: 3, abiertos: 2, clics: 0, rebotes: 0, quejas: 0 });
  });
  it("la lista de envío solo se actualiza sola con el canal Broadcast y la clave", () => {
    const base = { configurado: { api_key: true, webhook_secret: true, remitente: true, ia: true, cron_secret: true, segment_id: null }, ultima_pasada: null, ultima_terminada: null };
    expect(motivoAutoSincronizacion({ ...base, canal: "transaccional" }, 3)).toBeNull();
    expect(motivoAutoSincronizacion({ ...base, canal: "broadcast" }, 3)).toBe("nunca");
    expect(motivoAutoSincronizacion({ ...base, canal: "broadcast", configurado: { ...base.configurado, api_key: false } }, 3)).toBeNull();
  });
});
