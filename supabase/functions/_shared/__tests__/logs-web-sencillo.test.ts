/**
 * Logs web · explicación en sencillo: causas conocidas con texto fijo para el
 * dueño, tareas programadas con nombre llano, «qué hizo el cliente» y errores
 * de versión antigua tras publicar.
 */
import { describe, expect, it } from "vitest";
import { causaConocida, IDS_CAUSAS } from "../logs-web/causas";
import { calcularHuella, PATRON_CHUNK_CADUCADO, quitarNotaRecarga } from "../logs-web/huella";
import { afectaTrasPublicar, nombrePagina, queFalloGenerico, resumirRecorrido, tareasDe, TEXTO_ACCION_RECARGA, TEXTO_TRAS_PUBLICAR, type EventoRecorrido } from "../logs-web/sencillo";

const JERGA = /\b(javascript|endpoint|stack|pila|promesa|null|undefined|api|chunk|import|módulo|pg_cron|vite)\b/i;

describe("causas conocidas en sencillo", () => {
  it("«Failed to fetch dynamically imported module» → página antigua que se recarga sola", () => {
    const c = causaConocida({ tipo: "error_promesa", mensaje: "TypeError: Failed to fetch dynamically imported module: https://w/assets/a-AbCd1234.js" });
    expect(c?.sencillo.quePasa).toBe("La página tenía una versión antigua abierta justo cuando publicamos; al recargar ya va bien.");
    expect(c?.sencillo.queHacer).toMatch(/^Nada/);
  });
  it("«Importing a module script failed» (Safari) es lo mismo", () => {
    expect(causaConocida({ tipo: "error_js", mensaje: "TypeError: Importing a module script failed." })?.id).toBe("chunk_caducado");
    expect(PATRON_CHUNK_CADUCADO.test("Unable to preload CSS for /assets/x.css")).toBe(true);
    // Next.js (la web de la cristalería).
    expect(causaConocida({ tipo: "error_js", mensaje: "ChunkLoadError: Failed to load chunk /_next/static/chunks/8a1b2c3d4e5f6a7b.js" })?.id).toBe("chunk_caducado");
  });
  it("«job startup timeout · cron:reanudar-trabajos-ocr» → la tarea que retoma la lectura de facturas no arrancó", () => {
    const c = causaConocida({ tipo: "error_integracion", mensaje: "job startup timeout", objetivo: "cron:reanudar-trabajos-ocr" });
    expect(c?.sencillo.quePasa).toMatch(/^La tarea que retoma la lectura de facturas atascadas no arrancó a tiempo; las facturas pueden tardar más en leerse\./);
    expect(c?.sencillo.quePasa).toMatch(/base de datos estaba saturada/);
  });
  it("las tareas salen también de las muestras (objetivo común «cron:*»)", () => {
    const c = causaConocida({ tipo: "error_integracion", mensaje: "job startup timeout", objetivo: "cron:*", tareas: ["sync-trafico-web", "reanudar-trabajos-ocr", "tarea-nueva"] });
    expect(c?.sencillo.quePasa).toMatch(/^3 tareas automáticas no arrancaron a tiempo \(entre ellas, la que trae las visitas de la web desde Vercel\)/);
    expect(tareasDe({ objetivo: "cron:*", propiedades: { tarea: "x" } })).toEqual(["x"]);
  });
  it("todas las causas tienen texto para el dueño, sin jerga técnica", () => {
    const ejemplos: Record<string, Parameters<typeof causaConocida>[0]> = {
      chunk_caducado: { tipo: "error_js", mensaje: "ChunkLoadError: Loading chunk 3 failed." },
      cron_plataforma: { tipo: "error_integracion", mensaje: "job startup timeout", objetivo: "cron:sync-trafico-web" },
      react_hidratacion: { tipo: "error_react", mensaje: "Minified React error #418" },
      peticion_sin_respuesta: { tipo: "error_peticion", mensaje: "sin respuesta", propiedades: { status: 0 } },
      dns_host_inexistente: { tipo: "error_servidor", mensaje: "dns error: failed to lookup address" },
      falta_secreto: { tipo: "error_servidor", mensaje: "falta_secreto" },
      carga_sin_conexion: { tipo: "error_promesa", mensaje: "TypeError: Failed to fetch dynamically imported module", accion: "sin_conexion" },
      carga_sin_version_nueva: { tipo: "error_promesa", mensaje: "TypeError: Load failed", accion: "sin_version_nueva" },
    };
    expect(Object.keys(ejemplos).sort()).toEqual([...IDS_CAUSAS].sort());
    for (const [id, d] of Object.entries(ejemplos)) {
      const c = causaConocida(d);
      expect(c?.id, id).toBe(id);
      expect(c!.sencillo.quePasa.length, id).toBeGreaterThan(20);
      expect(c!.sencillo.queHacer.length, id).toBeGreaterThan(5);
      expect(`${c!.sencillo.quePasa} ${c!.sencillo.queHacer}`, id).not.toMatch(JERGA);
    }
  });
});

describe("qué falló, sin causa conocida", () => {
  it("por tipo y página, en llano", () => {
    expect(queFalloGenerico({ tipo: "error_peticion", fuente: "navegador", rutas: [{ ruta: "/presupuesto" }] }))
      .toBe("La web pidió datos al servidor y no obtuvo respuesta (o recibió un error) en la calculadora de presupuestos.");
    expect(queFalloGenerico({ tipo: "error_integracion", fuente: "integracion", objetivo: "cron:sync-trafico-web" }))
      .toBe("Falló la tarea automática que trae las visitas de la web desde Vercel. Consecuencia: las cifras de Tráfico web pueden ir con retraso.");
  });
  it("nombres de página conocidos (también en inglés y francés)", () => {
    expect([nombrePagina("/"), nombrePagina("/servicios/mamparas"), nombrePagina("/trabajos"), nombrePagina("/en/contacto"), nombrePagina("/raro")])
      .toEqual(["la portada", "la página de mamparas", "los trabajos (fotos)", "contacto", null]);
  });
});

const ev = (tipo: string, o: Partial<EventoRecorrido> = {}): EventoRecorrido => ({ tipo, categoria: "actividad", accion: null, ruta: "/presupuesto", objetivo: null, propiedades: {}, ...o });

describe("qué hizo el cliente", () => {
  it("entró en la portada con un QR, eligió mampara en la calculadora, calculó 2 precios y pulsó WhatsApp", () => {
    const t = resumirRecorrido([
      ev("pagina_vista", { ruta: "/", propiedades: { origen_tipo: "qr" } }),
      ev("pagina_vista", { ruta: "/presupuesto" }),
      ev("calculadora", { accion: "categoria", objetivo: "Mamparas" }),
      ev("calculadora", { accion: "calculado", valor: 520 }),
      ev("calculadora", { accion: "calculado", valor: 560 }),
      ev("contacto", { accion: "whatsapp" }),
    ]);
    expect(t).toBe("Entró en la portada con un código QR, fue a la calculadora de presupuestos, eligió «Mamparas» en la calculadora, calculó 2 precios y pulsó para escribir por WhatsApp.");
  });
  it("solicitud de presupuesto completa y formulario de visita", () => {
    const t = resumirRecorrido([
      ev("calculadora", { accion: "calculado", valor: 515.4 }),
      ev("formulario", { accion: "inicio", objetivo: "presupuesto" }),
      ev("formulario", { accion: "envio", objetivo: "presupuesto" }),
      ev("presupuesto_solicitado", { categoria: "operacion" }),
      ev("contacto_enviado", { categoria: "operacion", accion: "whatsapp", objetivo: "visita" }),
    ]);
    expect(t).toBe("Calculó un precio (515 €), empezó a rellenar el formulario de solicitud de presupuesto, envió el formulario de solicitud de presupuesto, envió la solicitud de presupuesto (llegó al panel) y abrió WhatsApp con su mensaje ya escrito.");
  });
  it("muchos pasos se recortan a los últimos", () => {
    expect(resumirRecorrido([ev("media", { accion: "abrir", objetivo: "Mamparas en Elche" })])).toBe("Vio fotos de los trabajos.");
    const largo = Array.from({ length: 12 }, (_, i) => ev("clic", { objetivo: `Botón ${i}` }));
    expect(resumirRecorrido(largo, 3)).toBe("… pulsó «Botón 9», pulsó «Botón 10» y pulsó «Botón 11».");
  });
  it("sin actividad (solo errores o técnico): null", () => {
    expect(resumirRecorrido([ev("error_js", { categoria: "error" }), ev("peticion", { categoria: "tecnico" })])).toBeNull();
  });
});

describe("versión antigua tras publicar", () => {
  it("textos de cada ocurrencia y de lo que decidió la web", () => {
    expect(TEXTO_TRAS_PUBLICAR.sin_impacto).toBe("esperado tras publicar · sin impacto");
    expect(TEXTO_TRAS_PUBLICAR.repetido).toBe("no se arregló al recargar · revisar");
    expect(TEXTO_ACCION_RECARGA.recuperado_tras_recarga).toBe("se recargó sola con la versión nueva");
    expect(Object.keys(TEXTO_ACCION_RECARGA).sort()).toEqual(["aviso_version_nueva", "recarga_sin_efecto", "recuperado_tras_recarga", "sin_conexion", "sin_version_nueva"]);
  });
  it("¿afecta?: no, salvo que recargar no lo arregle; y lo que no era versión antigua cuenta aparte", () => {
    expect(afectaTrasPublicar(3, 0)).toBe("No: las 3 veces fueron páginas antiguas abiertas durante una publicación y se recargó sola.");
    expect(afectaTrasPublicar(2, 0, { sinDatos: 1, sinConexion: 1 })).toBe("No: las 2 veces fueron páginas antiguas abiertas durante una publicación y se recargó sola (de 1 no hay datos de después: el navegador del visitante no deja medir; 1 fue sin conexión del visitante).");
    expect(afectaTrasPublicar(4, 2)).toMatch(/^Sí, a veces: 2 veces no se arregló al recargar \(volvió a fallar o siguió con la versión antigua\), así que a esas personas no les funcionó\. Las otras 4 veces/);
    expect(afectaTrasPublicar(1, 0, { otras: 2 })).toMatch(/Además, 2 veces no había versión nueva \(la red o un fichero que falta\): esas cuentan como un error normal\.$/);
  });
  it("la nota que la web añade al mensaje no cambia la huella (si no, una incidencia por build)", async () => {
    const base = "TypeError: Load failed";
    const conNota = `${base} · recuperado: la pestaña se recargó sola con la versión nueva (antes: v1.11.0 · build x7f3k9q2)`;
    expect(quitarNotaRecarga(conNota)).toBe(base);
    expect(quitarNotaRecarga(`${base} · sin conexión: no se recargó`)).toBe(base);
    expect(quitarNotaRecarga("Error · otra cosa")).toBe("Error · otra cosa");
    const h = (mensaje: string) => calcularHuella({ tipo: "error_promesa", fuente: "navegador", mensaje, pila: null, ruta: "/carta", objetivo: null });
    expect(await h(conNota)).toBe(await h(base));
  });
});
