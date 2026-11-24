/**
 * enviar-newsletter: petición (peticion.ts), envío uno a uno, prueba y confirmaciones (envio.ts), Broadcast
 * (broadcast.ts) y acceso a la base de datos (registro.ts). Resend y Supabase falsos: nunca se llama a nada real.
 */
import { describe, it, expect, vi } from "vitest";
import { leerPeticion, disenoParaHistorial } from "../peticion.ts";
import {
  destinatariosPrueba,
  enviarConfirmacionesPendientes,
  enviarPrueba,
  enviarTransaccional,
  type Destinatario,
  type FilaEnvioNueva,
  type RepoEnvios,
} from "../envio.ts";
import { enviarBroadcast, puedeEnviarBroadcast, type ClienteBroadcast } from "../broadcast.ts";
import { crearRepoEnvios } from "../registro.ts";
import { CONFIG_POR_DEFECTO, type ConfigNewsletter } from "../../_shared/newsletter/enlaces.ts";
import { negocioDesdeContenido } from "../../_shared/newsletter/negocio.ts";
import { MARCA_PIE_BAJA, type DatosNewsletter } from "../../_shared/newsletter/plantillas.ts";
import type { CorreoResend, ResultadoResend } from "../../_shared/resend-marketing/cliente.ts";
import type { ResumenSync } from "../../_shared/resend-marketing/sync.ts";

const CLAVE = "11111111-2222-4333-8444-555555555555";
const TOKEN = (n: number) => String(n).padStart(2, "0").repeat(32);
const CONFIG: ConfigNewsletter = { ...CONFIG_POR_DEFECTO, remitente_email: "novedades@example.com", remitente_nombre: "Cristalería BV", responder_a: "taller@example.com" };
const NEGOCIO = negocioDesdeContenido({ address: { street: "C/ Ejemplo, 1", postalCode: "03000", city: "Pueblo", province: "Alicante" }, email: "info@example.com" }, CONFIG.web_url);
const DATOS: DatosNewsletter = {
  tipo: "oferta",
  titulo: "Mamparas con descuento",
  mensaje: "",
  bloques: [{ tipo: "texto", texto: "Este mes, mamparas a medida." }, { tipo: "boton", texto: "Pedir presupuesto", url: "https://cristaleriabv.vercel.app/presupuesto" }],
};

const ok = <T>(data: T): ResultadoResend<T> => ({ ok: true, status: 200, data });
const ko = (status: number, tipo: string, mensaje: string): ResultadoResend<never> => ({ ok: false, status, tipo, mensaje });

function clienteFalso(fallarA: string[] = []) {
  const enviados: Array<{ c: CorreoResend; k?: string }> = [];
  const cliente = {
    enviarCorreo: vi.fn(async (c: CorreoResend, k?: string) => {
      enviados.push({ c, k });
      return fallarA.includes(c.to[0]) ? ko(422, "validation_error", "Invalid `to` field") : ok({ id: `em_${enviados.length}` });
    }),
  };
  return { cliente, enviados };
}

function repoFalso(destinatarios: Destinatario[], extra: Partial<RepoEnvios> = {}) {
  const creados: FilaEnvioNueva[] = [];
  const terminados: Array<{ id: string; d: unknown }> = [];
  const repo: RepoEnvios = {
    cerrarColgados: vi.fn(async () => {}),
    destinatarios: vi.fn(async () => destinatarios),
    suprimidas: vi.fn(async () => new Set(["suprimida@example.com"])),
    crearEnvio: vi.fn(async (f: FilaEnvioNueva) => (creados.push(f), { ok: true as const, id: "envio-1" })),
    terminarEnvio: vi.fn(async (id: string, d: unknown) => void terminados.push({ id, d })),
    ...extra,
  };
  return { repo, creados, terminados };
}

const dest = (n: number, email = `s${n}@example.com`): Destinatario => ({ id: `0000000${n}-0000-4000-8000-000000000000`, email, nombre: null, baja_token: TOKEN(n) });

describe("leerPeticion", () => {
  const newsletter = { tipo: "oferta", titulo: "Ofertas", mensaje: "", bloques: DATOS.bloques };
  it("la acción es obligatoria y el diseño va anidado: una petición a medias nunca envía", () => {
    expect(leerPeticion({ tipo: "oferta", titulo: "x", mensaje: "y" })).toMatchObject({ ok: false });
    expect(leerPeticion({ accion: "enviar", newsletter })).toEqual({ ok: false, error: "Falta la clave del envío" });
    expect(leerPeticion({ accion: "borrar" })).toMatchObject({ ok: false });
    expect(leerPeticion(null)).toMatchObject({ ok: false });
  });
  it("enviar con clave, prueba y confirmaciones", () => {
    const e = leerPeticion({ accion: "enviar", newsletter, clave: CLAVE.toUpperCase() });
    expect(e.ok && e.peticion).toMatchObject({ accion: "enviar", clave: CLAVE });
    expect(leerPeticion({ accion: "prueba", newsletter })).toMatchObject({ ok: true, peticion: { accion: "prueba" } });
    expect(leerPeticion({ accion: "confirmaciones" })).toEqual({ ok: true, peticion: { accion: "confirmaciones", ids: null } });
    expect(leerPeticion({ accion: "confirmaciones", ids: ["no-uuid"] })).toMatchObject({ ok: false });
  });
  it("valida el diseño como el envío (bloques y enlaces seguros)", () => {
    expect(leerPeticion({ accion: "prueba", newsletter: { ...newsletter, bloques: [{ tipo: "boton", texto: "x", url: "javascript:alert(1)" }] } })).toMatchObject({ ok: false });
  });
  it("el historial guarda el diseño para volver a abrirlo", () => {
    expect(disenoParaHistorial(DATOS)).toEqual({ tipo: "oferta", titulo: "Mamparas con descuento", insignia: "", preheader: "", bloques: DATOS.bloques });
  });
});

describe("enviarTransaccional", () => {
  const base = (repo: RepoEnvios, cliente: ReturnType<typeof clienteFalso>["cliente"], extra = {}) =>
    enviarTransaccional({ repo, cliente, datos: DATOS, config: CONFIG, negocio: NEGOCIO, supabaseUrl: "https://demo.supabase.co", usuarioId: "u1", clave: CLAVE, log: () => {}, ...extra });

  it("un correo por activo, con su enlace de baja, la cabecera one-click, etiquetas e idempotencia; nunca a suprimidas", async () => {
    const { cliente, enviados } = clienteFalso();
    const { repo, creados, terminados } = repoFalso([dest(1), dest(2), dest(3, "suprimida@example.com"), { ...dest(4), baja_token: null }]);
    const r = await base(repo, cliente);
    expect(r).toEqual({ ok: true, envioId: "envio-1", estado: "completado", total: 2, exitosos: 2, fallidos: 0 });
    expect(enviados.map((e) => e.c.to[0])).toEqual(["s1@example.com", "s2@example.com"]);
    const { c, k } = enviados[0];
    expect(k).toBe(`envio-1/${dest(1).id}`);
    expect(c.from).toBe("Cristalería BV <novedades@example.com>");
    expect(c.replyTo).toBe("taller@example.com");
    expect(c.html).toContain(MARCA_PIE_BAJA);
    expect(c.html).toContain(`https://cristaleriabv.vercel.app/newsletter/baja?t=${TOKEN(1)}`);
    expect(c.html).not.toContain(TOKEN(2));
    expect(c.html).toContain("C/ Ejemplo, 1, 03000 Pueblo (Alicante)");
    expect(c.text).toContain(`Darse de baja: https://cristaleriabv.vercel.app/newsletter/baja?t=${TOKEN(1)}`);
    expect(c.headers).toEqual({
      "List-Unsubscribe": `<https://demo.supabase.co/functions/v1/newsletter-baja?t=${TOKEN(1)}&via=header>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(c.tags).toEqual([{ name: "categoria", value: "newsletter" }, { name: "suscriptor", value: dest(1).id }, { name: "envio", value: "envio-1" }]);
    expect(creados[0]).toMatchObject({ canal: "transaccional", total_destinatarios: 2, clave_idempotencia: CLAVE, enviado_por: "u1", asunto: "Mamparas con descuento" });
    expect(terminados).toEqual([{ id: "envio-1", d: { estado: "completado", exitosos: 2, fallidos: 0, error: null } }]);
    expect(repo.cerrarColgados).toHaveBeenCalledWith(15);
  });

  it("si alguno falla, parcial; si fallan todos, fallido y 502", async () => {
    const parcial = await base(repoFalso([dest(1), dest(2)]).repo, clienteFalso(["s2@example.com"]).cliente);
    expect(parcial).toMatchObject({ ok: true, estado: "parcial", exitosos: 1, fallidos: 1 });
    const todo = repoFalso([dest(1)]);
    const r = await base(todo.repo, clienteFalso(["s1@example.com"]).cliente);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(todo.terminados[0].d).toMatchObject({ estado: "fallido", exitosos: 0, fallidos: 1 });
  });

  it("sin activos no crea envío (400); por encima del límite, 409 sin enviar nada", async () => {
    const vacio = repoFalso([]);
    expect(await base(vacio.repo, clienteFalso().cliente)).toMatchObject({ ok: false, status: 400 });
    expect(vacio.repo.crearEnvio).not.toHaveBeenCalled();
    const muchos = repoFalso([dest(1), dest(2), dest(5)]);
    const { cliente } = clienteFalso();
    const r = await base(muchos.repo, cliente, { config: { ...CONFIG, limite_transaccional: 2 } });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toMatch(/Broadcast/);
    expect(cliente.enviarCorreo).not.toHaveBeenCalled();
    // 0 = sin límite.
    expect(await base(repoFalso([dest(1), dest(2), dest(5)]).repo, clienteFalso().cliente, { config: { ...CONFIG, limite_transaccional: 0 } })).toMatchObject({ ok: true, exitosos: 3 });
  });

  it("doble clic (misma clave) u otro envío en marcha: 409 sin enviar", async () => {
    for (const motivo of ["duplicado", "ocupado"] as const) {
      const { cliente } = clienteFalso();
      const { repo } = repoFalso([dest(1)], { crearEnvio: vi.fn(async () => ({ ok: false as const, motivo })) });
      const r = await base(repo, cliente);
      expect(r).toMatchObject({ ok: false, status: 409 });
      expect(cliente.enviarCorreo).not.toHaveBeenCalled();
    }
  });

  it("sin remitente no envía nada (503)", async () => {
    const { repo } = repoFalso([dest(1)]);
    expect(await base(repo, clienteFalso().cliente, { config: { ...CONFIG, remitente_email: null } })).toMatchObject({ ok: false, status: 503 });
    expect(repo.crearEnvio).not.toHaveBeenCalled();
  });

  it("sin tiempo: deja de empezar correos y queda parcial con lo que falte como fallido", async () => {
    let t = 0;
    const { cliente } = clienteFalso();
    cliente.enviarCorreo.mockImplementation(async () => ((t += 60_000), ok({ id: "x" })));
    const { repo, terminados } = repoFalso([dest(1), dest(2), dest(3)]);
    const r = await base(repo, cliente, { ahora: () => t, hastaMs: 100_000 });
    expect(r).toMatchObject({ ok: true, estado: "parcial", exitosos: 2, fallidos: 1 });
    expect((terminados[0].d as { error: string }).error).toMatch(/tiempo/);
  });
});

describe("prueba y confirmaciones", () => {
  it("la prueba va solo a quien la pide y a la dirección de pruebas, con [PRUEBA] y un enlace de baja de muestra", async () => {
    const config = { ...CONFIG, email_prueba: "pruebas@example.com" };
    expect(destinatariosPrueba("Yo@Example.com", config)).toEqual(["yo@example.com", "pruebas@example.com"]);
    expect(destinatariosPrueba("pruebas@example.com", config)).toEqual(["pruebas@example.com"]);
    expect(destinatariosPrueba(null, CONFIG)).toEqual([]);
    const { cliente, enviados } = clienteFalso();
    const r = await enviarPrueba({ cliente, datos: DATOS, config, negocio: NEGOCIO, destinatarios: ["yo@example.com"] });
    expect(r).toEqual({ ok: true, destinatarios: ["yo@example.com"] });
    expect(enviados[0].c.subject).toBe("[PRUEBA] Mamparas con descuento");
    expect(enviados[0].c.html).toContain("/newsletter/baja?t=prueba");
    expect(enviados[0].c.tags).toEqual([{ name: "categoria", value: "newsletter_prueba" }]);
    expect(await enviarPrueba({ cliente, datos: DATOS, config, negocio: NEGOCIO, destinatarios: [] })).toMatchObject({ ok: false, status: 400 });
  });

  it("confirmaciones: una por pendiente preparado; cuenta las que fallan", async () => {
    const preparar = vi.fn(async () => [
      { id: "a", email: "a@example.com", nombre: null, token: TOKEN(1) },
      { id: "b", email: "b@example.com", nombre: "Bea", token: TOKEN(2) },
    ]);
    const enviar = vi.fn(async (p: { id: string }) => p.id === "a");
    expect(await enviarConfirmacionesPendientes({ preparar, enviar, ids: null })).toEqual({ ok: true, enviadas: 1, fallidas: 1 });
    expect(preparar).toHaveBeenCalledWith(null, 50);
  });
});

function resumen(extra: Partial<ResumenSync> = {}): ResumenSync {
  return {
    estado: "ok", segmentId: "seg-1", segmentoCreado: false, contactosResend: 120, contactosSegmento: 120, ajenos: 0, destinatarios: 120,
    altas: 0, actualizados: 0, anadidosSegmento: 0, quitadosSegmento: 0, borrados: 0, bajasResend: 0, errores: [], pendientes: 0,
    bloqueaEnvio: false, peticiones: 2, mensajeError: null, ...extra,
  };
}

describe("Broadcast", () => {
  it("puedeEnviarBroadcast: error, bajas por quitar, límite de contactos y sin destinatarios", () => {
    expect(puedeEnviarBroadcast(resumen(), 1000)).toEqual({ ok: true });
    expect(puedeEnviarBroadcast(resumen({ estado: "error", mensajeError: "401" }), 1000)).toMatchObject({ ok: false, status: 502 });
    expect(puedeEnviarBroadcast(resumen({ bloqueaEnvio: true, pendientes: 4 }), 1000)).toMatchObject({ ok: false, status: 409 });
    expect(puedeEnviarBroadcast(resumen({ contactosResend: 1001 }), 1000)).toMatchObject({ ok: false, status: 409 });
    expect(puedeEnviarBroadcast(resumen({ destinatarios: 0 }), 1000)).toMatchObject({ ok: false, status: 400 });
  });

  function falsos(o: { enviar?: ResultadoResend<{ id: string }>; estado?: ResultadoResend<{ id: string; status?: string }> } = {}) {
    const orden: string[] = [];
    const cuerpos: string[] = [];
    const cliente: ClienteBroadcast = {
      crearBroadcast: vi.fn(async (b) => (orden.push("crear"), cuerpos.push(b.html), ok({ id: "b-1" }))),
      enviarBroadcast: vi.fn(async () => (orden.push("enviar"), o.enviar ?? ok({ id: "b-1" }))),
      obtenerBroadcast: vi.fn(async () => (orden.push("estado"), o.estado ?? ok({ id: "b-1", status: "sent" }))),
    };
    const { repo, creados, terminados } = repoFalso([]);
    const crear = repo.crearEnvio;
    repo.crearEnvio = vi.fn(async (f) => (orden.push("registrar"), crear(f)));
    return { cliente, repo, orden, cuerpos, creados, terminados };
  }
  const enviar = (f: ReturnType<typeof falsos>) =>
    enviarBroadcast({ cliente: f.cliente, repo: f.repo, datos: DATOS, negocio: NEGOCIO, from: "x <novedades@example.com>", segmentId: "seg-1", destinatarios: 120, usuarioId: "u1", clave: CLAVE });

  it("borrador → registro → envío → completado, con el marcador de baja de Resend en el pie", async () => {
    const f = falsos();
    expect(await enviar(f)).toEqual({ ok: true, broadcastId: "b-1", envioId: "envio-1" });
    expect(f.orden).toEqual(["crear", "registrar", "enviar"]);
    expect(f.cuerpos[0]).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(f.creados[0]).toMatchObject({ canal: "broadcast", resend_broadcast_id: "b-1", total_destinatarios: 120 });
    expect(f.terminados[0].d).toMatchObject({ estado: "completado", exitosos: 120 });
  });

  it("respuesta dudosa: pregunta a Resend antes de decir nada", async () => {
    const salio = falsos({ enviar: ko(500, "internal", "x"), estado: ok({ id: "b-1", status: "queued" }) });
    expect(await enviar(salio)).toMatchObject({ ok: true });
    const borrador = falsos({ enviar: ko(0, "network_error", "x"), estado: ok({ id: "b-1", status: "draft" }) });
    expect(await enviar(borrador)).toMatchObject({ ok: false, status: 502 });
    expect(borrador.terminados[0].d).toMatchObject({ estado: "fallido" });
    const nose = falsos({ enviar: ko(502, "bad_gateway", "x"), estado: ko(500, "x", "y") });
    const r = await enviar(nose);
    expect(!r.ok && r.error).toMatch(/No se sabe si la newsletter ha salido/);
    expect(nose.terminados).toEqual([]);
  });
});

describe("crearRepoEnvios (supabase falso)", () => {
  function db(respuestas: Record<string, unknown>) {
    const llamadas: Array<{ tabla: string; op: string; args: unknown[] }> = [];
    const consulta = (tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "lt", "order", "range", "update", "insert", "single"]) {
        q[m] = (...args: unknown[]) => (llamadas.push({ tabla, op: m, args }), q);
      }
      q.then = (r: (v: unknown) => unknown) => r(respuestas[tabla] ?? { data: [], error: null });
      return q;
    };
    return { from: (t: string) => consulta(t), llamadas };
  }

  it("destinatarios: solo activos, con el token de la tabla de claves", async () => {
    const d = db({ newsletter_suscriptores: { data: [{ id: "a", email: "a@example.com", nombre: null, newsletter_claves: { baja_token: TOKEN(1) } }, { id: "b", email: "b@example.com", nombre: "B", newsletter_claves: [] }], error: null } });
    expect(await crearRepoEnvios(d).destinatarios()).toEqual([
      { id: "a", email: "a@example.com", nombre: null, baja_token: TOKEN(1) },
      { id: "b", email: "b@example.com", nombre: "B", baja_token: null },
    ]);
    expect(d.llamadas).toContainEqual({ tabla: "newsletter_suscriptores", op: "eq", args: ["estado", "activo"] });
  });

  it("crearEnvio distingue la misma clave (duplicado) de otro envío en marcha (ocupado)", async () => {
    const dup = db({ newsletter_envios: { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "newsletter_envios_clave_idempotencia_key"' } } });
    expect(await crearRepoEnvios(dup).crearEnvio({} as FilaEnvioNueva)).toEqual({ ok: false, motivo: "duplicado" });
    const ocupado = db({ newsletter_envios: { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "newsletter_envios_uno_enviando"' } } });
    expect(await crearRepoEnvios(ocupado).crearEnvio({} as FilaEnvioNueva)).toEqual({ ok: false, motivo: "ocupado" });
    const bien = db({ newsletter_envios: { data: { id: "e-1" }, error: null } });
    expect(await crearRepoEnvios(bien).crearEnvio({} as FilaEnvioNueva)).toEqual({ ok: true, id: "e-1" });
  });
});
