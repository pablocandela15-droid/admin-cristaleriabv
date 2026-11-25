import { AlertTriangle, Bot, FileText, Info, MessageSquareWarning, Receipt, TrendingUp } from "lucide-react";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";

/** Adónde lleva un aviso (null = no tiene origen al que ir). Lo comparten la campana y la página «Avisos». */
export function rutaDeAviso(
  n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo"> & { referencia_id?: string | null; datos?: NotificacionDashboard["datos"] },
): string | null {
  // Modelos de OpenAI nuevos, retirados o sin precio: solo super admin.
  if (n.referencia_tipo === "ia_modelos") return "/super-admin/servicios?tab=modelos";
  // Petición urgente de un usuario: su ticket en Super Admin (solo lo ve el super admin).
  if (n.referencia_tipo === "peticion") {
    return n.referencia_id ? `/super-admin/tickets?ticket=${encodeURIComponent(n.referencia_id)}` : "/super-admin/tickets";
  }
  // Solicitud de presupuesto desde la calculadora de la web: el presupuesto en Presupuestos (o la lista de solicitudes).
  if (n.referencia_tipo === "presupuesto") {
    return n.referencia_id ? `/presupuestos?id=${encodeURIComponent(n.referencia_id)}` : "/presupuestos?estado=solicitud";
  }
  // Aviso con enlace propio del panel (p. ej. uno creado a mano o por un cron nuevo).
  const enlace = n.datos?.enlace;
  if (typeof enlace === "string" && enlace.startsWith("/")) return enlace;
  return null;
}

export type FiltroAvisos = "todos" | "sin_leer";

export const FILTROS_AVISOS: { valor: FiltroAvisos; etiqueta: string }[] = [
  // «Sin revisar» primero y por defecto (12/11/2026), con el mismo nombre que en el resto del panel.
  { valor: "sin_leer", etiqueta: "Sin revisar" },
  { valor: "todos", etiqueta: "Todos" },
];

/** Etiqueta del día: «Hoy», «Ayer» o fecha larga. `ahora` inyectable para pruebas. */
export function etiquetaDia(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso);
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((inicio(ahora) - inicio(d)) / 86_400_000);
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

/** Agrupa (respetando el orden recibido) por día local. */
export function agruparPorDia(
  items: NotificacionDashboard[],
  ahora: Date = new Date(),
): { etiqueta: string; items: NotificacionDashboard[] }[] {
  const grupos: { clave: string; etiqueta: string; items: NotificacionDashboard[] }[] = [];
  for (const n of items) {
    const d = new Date(n.created_at);
    const clave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.items.push(n);
    else grupos.push({ clave, etiqueta: etiquetaDia(n.created_at, ahora), items: [n] });
  }
  return grupos.map(({ etiqueta, items: its }) => ({ etiqueta, items: its }));
}

export function horaAviso(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export const TIPO_ICON: Record<string, typeof AlertTriangle> = {
  // Centro de modelos de IA (cron diario ia-modelos-openai).
  ia_modelo_nuevo: Bot,
  ia_modelo_retirado: AlertTriangle,
  ia_modelo_sin_precio: Bot,
  // Petición urgente de un usuario del panel: solo super admin.
  peticion_urgente: MessageSquareWarning,
  sistema: Info,
  // Facturas: fin de una tanda de subida (ColaSubidaProvider) y compras más caras que su referencia.
  facturas_subida: Receipt,
  subida_precio: TrendingUp,
  // Solicitud de presupuesto desde la calculadora de la web (web-solicitud-presupuesto): solo quien ve Presupuestos.
  presupuesto_solicitud: FileText,
  // RRSS: la conexión con Meta caduca pronto o ya no vale, y lo programado que no se pudo publicar (rrss-programador).
  rrss_conexion: AlertTriangle,
  rrss_publicacion_error: AlertTriangle,
};

/** Avisos con caducidad ya pasada: no se enseñan. `ahora` inyectable para pruebas. */
export function avisoCaducado(n: Pick<NotificacionDashboard, "caduca_en">, ahora: number = Date.now()): boolean {
  if (!n.caduca_en) return false;
  const t = Date.parse(n.caduca_en);
  return Number.isFinite(t) && t <= ahora;
}

/** Tipos de aviso que se pueden mandar al momento por Telegram (Super Admin › Servicios › Configurar). */
// Los avisos de modelos de IA (ia_modelo_*) no se ofrecen: son para quien mantiene el panel, salen en la
// campana y avisos-telegram los descarta siempre (`tipoExcluido`), también del resumen diario.
export const TIPOS_AVISO_TELEGRAM: { tipo: string; etiqueta: string }[] = [
  { tipo: "peticion_urgente", etiqueta: "Peticiones urgentes" },
  { tipo: "sistema", etiqueta: "Avisos del sistema" },
];
