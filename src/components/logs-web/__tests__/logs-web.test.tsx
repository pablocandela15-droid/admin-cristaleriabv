/**
 * Super Admin › Logs: salud de la recogida, recorrido, comportamiento (mismas
 * definiciones que Tráfico web) con los embudos de la web de la cristalería.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Comportamiento, EstadoRecogidaDatos, EventoWeb } from "@/hooks/useLogsWeb";
import { describirEvento, estadoRecogida, rangoEstadisticas, rangoPeriodo } from "../calculos";
import { EstadoRecogidaAviso } from "../EstadoRecogidaAviso";
import { LineaTiempo } from "../LineaTiempo";
import { etapasEmbudo, variacion } from "@/components/trafico-web/comportamiento/definiciones";

const AHORA = "2026-11-08T12:00:00.000Z";
const estadoBase = (o: Partial<EstadoRecogidaDatos> = {}): EstadoRecogidaDatos => ({
  ahora: AHORA, entorno: "produccion", fuentes: [], primer_evento: "2026-11-01T10:00:00Z", primer_evento_por_categoria: {}, primer_evento_por_tipo: {},
  ingesta: [], proceso: { ultimo_proceso_inicio: AHORA, ultimo_proceso_fin: AHORA, ultimo_proceso_ok: "2026-11-08T11:58:00Z", ultimo_error: null, ultimo_resumen: {}, ultima_purga: null },
  config: { linear_modo: "prueba", entornos_aceptados: ["produccion", "demo"], entornos_ticket: ["produccion"], recoger_actividad: true, recoger_errores_navegador: true },
  vercel_ultimo_dia: { fecha: "2026-11-07", visitas: 40 }, ...o,
});

describe("línea de tiempo con el color del origen", () => {
  it("rojo los fallos de la web, ámbar los externos y gris lo que no depende de la web", () => {
    render(
      <LineaTiempo
        eventos={[
          ev({ id: 1, tipo: "error_js", categoria: "error", mensaje: "TypeError: x is null", ocurrido_en: "2026-11-08T11:00:00Z", secuencia: 1, origen: "web" }),
          ev({ id: 2, tipo: "error_js", categoria: "error", mensaje: "Google Maps JavaScript API error", ocurrido_en: "2026-11-08T11:00:01Z", secuencia: 2 }),
          ev({ id: 3, tipo: "error_peticion", categoria: "error", mensaje: "Sin respuesta de rest:web_tarifas (sin conexión)", propiedades: { status: 0 }, ocurrido_en: "2026-11-08T11:00:02Z", secuencia: 3 }),
          ev({ id: 4, tipo: "pagina_vista", ruta: "/", ocurrido_en: "2026-11-08T11:00:03Z", secuencia: 4 }),
        ]}
      />,
    );
    const filas = screen.getAllByTestId("evento-linea");
    expect(filas.map((f) => f.getAttribute("data-origen"))).toEqual(["web", "externo", "conexion", null]);
    expect(filas[0].className).toMatch(/destructive/);
    expect(filas[1].className).toMatch(/amber/);
    expect(filas[2].className).toMatch(/slate/);
    expect(within(filas[2]).getByTestId("badge-origen")).toHaveTextContent("Conexión del visitante");
  });
});

describe("estadoRecogida: «no hay actividad» ≠ «la recogida se ha parado»", () => {
  it("sin ningún evento todavía: lo dice y no inventa históricos", () => {
    const e = estadoRecogida(estadoBase({ primer_evento: null }));
    expect(e?.nivel).toBe("sin_datos_aun");
    expect(e?.detalle).toMatch(/No hay históricos anteriores/);
  });
  it("Vercel ve visitas y no llega nada del navegador: parada", () => {
    const e = estadoRecogida(estadoBase({ fuentes: [{ fuente: "navegador", ultimo_recibido: "2026-11-06T09:00:00Z", n_1h: 0, n_24h: 0 }] }));
    expect(e?.nivel).toBe("parada");
    expect(e?.detalle).toMatch(/Vercel registró 40 visitas/);
  });
  it("ni nosotros ni Vercel: sin actividad (no es un fallo)", () => {
    const e = estadoRecogida(estadoBase({ fuentes: [{ fuente: "navegador", ultimo_recibido: "2026-11-06T09:00:00Z", n_1h: 0, n_24h: 0 }], vercel_ultimo_dia: { fecha: "2026-11-07", visitas: 0 } }));
    expect(e?.nivel).toBe("sin_actividad");
  });
  it("activa, con aviso si el proceso en segundo plano lleva rato sin terminar", () => {
    expect(estadoRecogida(estadoBase({ fuentes: [{ fuente: "navegador", ultimo_recibido: "2026-11-08T11:55:00Z", n_1h: 12, n_24h: 80 }] }))?.nivel).toBe("ok");
    const e = estadoRecogida(estadoBase({
      fuentes: [{ fuente: "navegador", ultimo_recibido: "2026-11-08T11:55:00Z", n_1h: 12, n_24h: 80 }],
      proceso: { ultimo_proceso_inicio: null, ultimo_proceso_fin: null, ultimo_proceso_ok: "2026-11-08T10:00:00Z", ultimo_error: "linear: falta el secreto LINEAR_API_KEY", ultimo_resumen: {}, ultima_purga: null },
    }));
    expect(e?.nivel).toBe("aviso");
    expect(e?.avisos[0]).toMatch(/LINEAR_API_KEY/);
  });
  it("se pinta con su nivel", () => {
    render(<EstadoRecogidaAviso datos={estadoBase({ primer_evento: null })} />);
    expect(screen.getByTestId("estado-recogida")).toHaveAttribute("data-nivel", "sin_datos_aun");
  });
});

describe("periodos", () => {
  it("rango de la actividad estable dentro del mismo minuto", () => {
    const a = rangoPeriodo("24h", new Date("2026-11-08T12:00:10Z"));
    const b = rangoPeriodo("24h", new Date("2026-11-08T12:00:50Z"));
    expect(a).toEqual(b);
    expect(Date.parse(a.hasta) - Date.parse(a.desde)).toBe(86_400_000 + 60_000);
  });
  it("estadísticas: días cerrados como Tráfico web, u hoy", () => {
    expect(rangoEstadisticas("7", new Date("2026-11-08T12:00:00"))).toEqual({ desde: "2026-11-01", hasta: "2026-11-07" });
    expect(rangoEstadisticas("hoy", new Date("2026-11-08T12:00:00"))).toEqual({ desde: "2026-11-08", hasta: "2026-11-08" });
  });
});

const ev = (o: Partial<EventoWeb>): EventoWeb => ({
  id: 1, evento_id: "x", recibido_en: AHORA, ocurrido_en: AHORA, entorno: "produccion", proyecto: "casa-tomas-story", fuente: "navegador",
  categoria: "actividad", tipo: "clic", accion: null, sesion_id: "s", visitante_id: null, secuencia: 1, ruta: "/", objetivo: null, valor: null,
  propiedades: {}, dispositivo: "movil", navegador: "Safari", so: "iOS", es_bot: false, es_interno: false, es_prueba: false, consentimiento: true,
  version: "0.40", despliegue: null, gravedad: null, huella: null, mensaje: null, pila: null, incidencia_id: null, ...o,
});

describe("recorrido", () => {
  it("un clic no es una operación completada", () => {
    expect(describirEvento(ev({ tipo: "clic", objetivo: "Solicitar presupuesto" }))).toBe("Pulsa «Solicitar presupuesto»");
    expect(describirEvento(ev({ tipo: "presupuesto_solicitado", categoria: "operacion", objetivo: "Mamparas" }))).toBe("✔ Solicitud de presupuesto guardada por el servidor («Mamparas»)");
    expect(describirEvento(ev({ tipo: "calculadora", accion: "calculado", objetivo: "Mamparas", valor: 519.6 }))).toBe("Calculadora: calculado «Mamparas» · 520 € (IVA incl.)");
    expect(describirEvento(ev({ tipo: "contacto_enviado", categoria: "operacion", accion: "whatsapp", objetivo: "visita" }))).toBe("✔ Formulario «visita» enviado (abre WhatsApp con el mensaje)");
    expect(describirEvento(ev({ tipo: "pagina_vista", ruta: "/trabajos", propiedades: { origen_tipo: "qr", campana: "furgoneta" } }))).toBe("Abre /trabajos (entra por qr: furgoneta)");
  });
  it("línea de tiempo en orden, con tiempos relativos y el error resaltado", () => {
    const onIncidencia = vi.fn();
    render(
      <LineaTiempo
        resaltado={3}
        onAbrirIncidencia={onIncidencia}
        eventos={[
          ev({ id: 1, tipo: "pagina_vista", ruta: "/presupuesto", ocurrido_en: "2026-11-08T11:00:00Z", secuencia: 1 }),
          ev({ id: 2, tipo: "calculadora", accion: "categoria", objetivo: "Mamparas", ocurrido_en: "2026-11-08T11:00:30Z", secuencia: 2 }),
          ev({ id: 3, tipo: "error_js", categoria: "error", mensaje: "TypeError", ocurrido_en: "2026-11-08T11:00:31Z", secuencia: 3, incidencia_id: 9 }),
        ]}
      />,
    );
    const filas = screen.getAllByTestId("evento-linea");
    expect(filas.map((f) => f.getAttribute("data-secuencia"))).toEqual(["1", "2", "3"]);
    expect(within(filas[1]).getByText(/\+30 s/)).toBeInTheDocument();
    expect(filas[2].className).toMatch(/ring-destructive/);
    within(filas[2]).getByText("ver incidencia #9").click();
    expect(onIncidencia).toHaveBeenCalledWith(9);
  });
});

const comportamiento = (o: Partial<Comportamiento> = {}): Comportamiento => ({
  periodo: { desde: "2026-10-01", hasta: "2026-10-31", dias: 31, zona: "Europe/Madrid", entorno: "produccion" },
  datos_desde: "2026-10-01T00:00:00Z",
  resumen: { sesiones: 40, visitantes_estimados: 35, paginas_vistas: 160, paginas_por_sesion: 4, sesiones_una_pagina: 10, tiempo_activo_medio_s: 70, tiempo_activo_mediana_s: 45, scroll_medio: 60, sesiones_inicio_operacion: 8, sesiones_con_conversion: 3, conversiones: 3, errores: 2, sesiones_con_error: 2 },
  anterior: { sesiones: 20, visitantes_estimados: 18, paginas_vistas: 70, paginas_por_sesion: 3.5, sesiones_una_pagina: 8, tiempo_activo_medio_s: 60, tiempo_activo_mediana_s: 40, scroll_medio: 55, sesiones_inicio_operacion: 3, sesiones_con_conversion: 1, conversiones: 1, errores: 0, sesiones_con_error: 0 },
  excluidas: { bots: 3, internas_pruebas: 1, incluidas_internas: false },
  serie: [], paginas: [], contenidos: [{ tipo: "servicio", objetivo: "mamparas", n: 9, sesiones: 6 }], clics: [], contactos: [{ accion: "telefono", n: 4, sesiones: 4 }],
  calculadora: [{ categoria: "Mamparas", calculos: 5, sesiones: 4, precio_medio: 540 }], origenes: [], campanas: [], dispositivos: [], horas: [], dias_semana: [],
  tiempo: { menos_10s: 0, de_10s_a_1m: 0, de_1m_a_3m: 0, mas_3m: 0 }, scroll: { hasta_25: 0, de_25_a_50: 0, de_50_a_75: 0, de_75_a_100: 0, vistas_medidas: 0 },
  recorridos: [], ultimas_paginas: [],
  embudos: [{ operacion: "presupuesto", entrada: 40, consulta: 12, inicio: 8, envio: 6, fin: 3, rechazos: 1 }, { operacion: "contacto", entrada: 40, consulta: 4, inicio: 2, envio: 2, fin: 1, rechazos: 0 }],
  formularios: [{ objetivo: "presupuesto", inicios: 8, envios: 6, abandonos: 2, errores_validacion: 1 }], errores_por_ruta: [{ ruta: "/presupuesto", tipo: "error_js", n: 2, sesiones: 2 }], errores_por_operacion: [],
  operaciones_bd: { presupuestos_web: 7, presupuestos_aceptados: 2 }, ...o,
});

describe("definiciones compartidas", () => {
  it("embudo con tasas por paso y sobre la entrada", () => {
    const e = etapasEmbudo({ entrada: 40, consulta: 12, inicio: 8, fin: 3 }, "presupuesto");
    expect(e.map((x) => [x.etiqueta, x.valor, x.pasoPct])).toEqual([["Sesiones", 40, null], ["Usan la calculadora", 12, 30], ["Obtienen un precio", 8, 66.7], ["Solicitud enviada", 3, 37.5]]);
    expect(etapasEmbudo({ entrada: 40, consulta: 4, inicio: 2, fin: 1 }, "contacto").map((x) => x.etiqueta))
      .toEqual(["Sesiones", "Miran contacto o pulsan llamar/WhatsApp", "Empiezan el formulario", "Envían el formulario"]);
    expect(variacion(40, 20)).toBe(100);
    expect(variacion(5, 0)).toBeNull();
  });
});

vi.mock("@/hooks/useTraficoWeb", async (original) => ({
  ...(await original<typeof import("@/hooks/useTraficoWeb")>()),
  useSerieTrafico: () => ({ data: [{ fecha: "2026-10-01", visitas: 400 }], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useLogsWeb", async (original) => ({
  ...(await original<typeof import("@/hooks/useLogsWeb")>()),
  useComportamiento: () => ({ data: comportamiento(), isLoading: false, isError: false }),
}));

describe("ComportamientoWeb (Tráfico web y Logs)", () => {
  it("cifras con definiciones: cobertura frente a Vercel, embudos de la web, calculadora y referencia de la BD", async () => {
    const { ComportamientoWeb } = await import("@/components/trafico-web/comportamiento/ComportamientoWeb");
    render(<TooltipProvider><ComportamientoWeb desde="2026-10-01" hasta="2026-10-31" entorno="produccion" /></TooltipProvider>);
    expect(screen.getByText(/Cobertura: 160 páginas vistas registradas de 400 en Vercel \(40,0 %\)/)).toBeInTheDocument();
    expect(screen.getByText(/7 solicitudes de presupuesto desde la web · 2 presupuestos web aceptados/)).toBeInTheDocument();
    expect(within(screen.getByTestId("embudo-presupuesto")).getByText("Solicitud enviada")).toBeInTheDocument();
    expect(within(screen.getByTestId("embudo-contacto")).getByText("Envían el formulario")).toBeInTheDocument();
    expect(screen.getByText(/Contacto \(clics, no llamadas confirmadas\)/)).toBeInTheDocument();
    expect(screen.getByText(/media 540 €/)).toBeInTheDocument();
    expect(screen.getByText("Servicios con más interés")).toBeInTheDocument();
    expect(screen.getByText("Solicitud de presupuesto")).toBeInTheDocument();
    expect(screen.queryByText(/navegadores, no personas/)).toBeNull();
  });
});
