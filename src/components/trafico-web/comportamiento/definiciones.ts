/**
 * Definiciones de las métricas de comportamiento. Las MISMAS en Tráfico web,
 * en Super Admin › Logs › Estadísticas y en el informe en PDF: cualquier texto
 * que explique una cifra sale de aquí, y el cálculo, de la RPC
 * `web_comportamiento` (20261124120000_logs_web.sql). Nada se recalcula en el
 * navegador salvo tasas y variaciones sobre esas cifras.
 */

export const ZONA_HORARIA = "Europe/Madrid";

export const DEFINICIONES = {
  visitas:
    "Páginas vistas que cuenta Vercel Web Analytics: todos los visitantes, sin cookies. Es la cifra de referencia del volumen (días en UTC).",
  sesiones:
    "Visitas seguidas desde una misma pestaña del navegador; 30 minutos sin actividad (o recargar la página) abren otra. La web no usa cookies ni guarda nada en el navegador, y no cuenta a quien tiene activado «No rastrear»: es una parte de las visitas.",
  visitantes:
    "No se cuentan visitantes: la web no guarda ningún identificador en el navegador (sin cookies). Para el volumen de personas, usa los visitantes de Vercel (arriba), que tampoco usa cookies.",
  paginasVistas: "Páginas vistas dentro de esas sesiones.",
  cobertura:
    "Páginas vistas registradas por la web frente a las páginas vistas de Vercel en el mismo periodo. Orientativa: Vercel cuenta días en UTC y aquí se usa la hora de Madrid, y no se cuenta a quien tiene «No rastrear».",
  tiempoActivo:
    "Tiempo con la página visible y en primer plano (se para al cambiar de pestaña o bloquear el móvil). Se usa la mediana: unas pocas sesiones larguísimas no la mueven.",
  scroll: "Hasta dónde baja el visitante en cada página vista (máximo alcanzado, en % del alto de la página).",
  conversion:
    "Operación COMPLETADA: solicitud de presupuesto guardada por el servidor (llega a Presupuestos › Solicitudes) o formulario de contacto o de visita técnica enviado (abre WhatsApp con el mensaje escrito). Pulsar un botón no cuenta.",
  embudo:
    "Presupuesto: entrada (sesiones) → consulta (abre la calculadora) → inicio (obtiene un precio o empieza la solicitud) → finalización (solicitud guardada). Contacto: entrada → consulta (abre Contacto o pulsa llamar/WhatsApp) → inicio (empieza el formulario) → finalización (lo envía).",
  abandono:
    "Sesiones que empezaron y no terminaron en esa sesión. Es una estimación: pudo llamar por teléfono, escribir por WhatsApp o volver otro día.",
  ultimaPagina: "Última página observada de la sesión. No es una salida confirmada: el navegador no avisa siempre al cerrarse.",
  procedencia:
    "Cómo entró la sesión: QR (enlace con ?qr=… o utm_medium=qr), campaña (utm_*), buscador, red social, enlace de otra web, interno o directo (sin procedencia: marcadores, apps de correo o mensajería…).",
  operacionesBd:
    "Operaciones registradas por la base de datos para TODOS los visitantes (midan o no): solicitudes de presupuesto de la web y presupuestos web aceptados. Sirven de referencia para saber cuántas conversiones no se ven en las sesiones.",
  calculadora:
    "Precios calculados en la calculadora de la web por servicio, con el importe orientativo medio (IVA incluido). No se guardan medidas ni datos del cliente.",
  excluido:
    "Fuera de las cifras: bots (por su navegador), tráfico interno (marcado con ?ct_interno=1) y pruebas automáticas. Se pueden incluir con el interruptor.",
} as const;

export const NOMBRE_ORIGEN: Record<string, string> = {
  buscador: "Buscador",
  campana: "Campaña",
  qr: "Código QR",
  red_social: "Red social",
  enlace: "Enlace de otra web",
  directo: "Directo",
  interno: "Interno",
  desconocido: "Desconocido",
};

export const NOMBRE_DISPOSITIVO: Record<string, string> = {
  movil: "Móvil",
  tablet: "Tablet",
  escritorio: "Ordenador",
  desconocido: "Desconocido",
};

export const NOMBRE_CONTENIDO: Record<string, string> = {
  servicio: "Servicios",
  trabajos: "Books de trabajos",
  calculadora: "Servicios de la calculadora",
};

export const NOMBRE_FORMULARIO: Record<string, string> = {
  presupuesto: "Solicitud de presupuesto",
  contacto: "Contacto",
  visita: "Visita técnica",
};

export const NOMBRE_CONTACTO: Record<string, string> = {
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  email: "Correo",
  mapa: "Mapa / cómo llegar",
  red_social: "Redes sociales",
};

export const NOMBRE_OPERACION: Record<string, string> = { presupuesto: "Solicitudes de presupuesto", contacto: "Contacto" };

export const DIAS_SEMANA_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

/** % con un decimal; NULL si no hay base. */
export const tasa = (parte: number | null | undefined, total: number | null | undefined): number | null =>
  parte == null || total == null || total <= 0 ? null : Math.round((1000 * parte) / total) / 10;

/** Variación frente al periodo anterior en %, NULL si el anterior es 0 o no hay dato. */
export const variacion = (actual: number | null | undefined, anterior: number | null | undefined): number | null =>
  actual == null || anterior == null || anterior <= 0 ? null : Math.round((1000 * (actual - anterior)) / anterior) / 10;

/** Por debajo de esto, las cifras se enseñan pero se avisa de que la muestra es pequeña. */
export const SESIONES_MINIMAS_FIABLES = 30;

export interface EtapaEmbudo {
  clave: "entrada" | "consulta" | "inicio" | "fin";
  etiqueta: string;
  valor: number;
  /** % sobre la etapa anterior. */
  pasoPct: number | null;
  /** % sobre la entrada. */
  totalPct: number | null;
}

export function etapasEmbudo(e: { entrada: number; consulta: number; inicio: number; fin: number }, operacion: string): EtapaEmbudo[] {
  const etiquetas = operacion === "contacto"
    ? { consulta: "Miran contacto o pulsan llamar/WhatsApp", inicio: "Empiezan el formulario", fin: "Envían el formulario" }
    : { consulta: "Usan la calculadora", inicio: "Obtienen un precio", fin: "Solicitud enviada" };
  const filas: Array<[EtapaEmbudo["clave"], string, number]> = [
    ["entrada", "Sesiones", e.entrada],
    ["consulta", etiquetas.consulta, e.consulta],
    ["inicio", etiquetas.inicio, e.inicio],
    ["fin", etiquetas.fin, e.fin],
  ];
  return filas.map(([clave, etiqueta, valor], i) => ({
    clave, etiqueta, valor,
    pasoPct: i === 0 ? null : tasa(valor, filas[i - 1][2]),
    totalPct: i === 0 ? null : tasa(valor, e.entrada),
  }));
}
