// ============================================================================
// Suscriptores del newsletter — textos, filtros y CSV para el panel (puro)
// ----------------------------------------------------------------------------
// Portado del panel de referencia (lib/newsletter/bajas.ts) y ampliado con los
// estados del doble opt-in (pendiente → activo → baja), la búsqueda, los
// filtros y la importación y exportación en CSV.
//   · origen_baja lo escribe SIEMPRE el sistema: newsletter-baja (enlace_email,
//     cabecera_one_click), resend-webhook (queja_spam, rebote_permanente,
//     suprimido_resend, resend_baja_nativa) o la baja del panel (panel_manual).
//   · Un pendiente no recibe nada hasta que pulsa el enlace del correo de
//     confirmación; el panel no puede activarlo (lo impide la base de datos).
// ============================================================================

export type EstadoSuscriptor = "pendiente" | "activo" | "baja";
export type OrigenAlta = "web_formulario" | "web_presupuesto" | "panel_manual" | "importacion";

export interface SuscriptorNewsletter {
  id: string;
  email: string;
  nombre: string | null;
  estado: EstadoSuscriptor;
  origen_alta: OrigenAlta | string;
  consentimiento_at: string;
  consentimiento_detalle: string | null;
  fecha_verificacion_email: string | null;
  confirmaciones_enviadas: number;
  confirmacion_enviada_at: string | null;
  fecha_baja: string | null;
  origen_baja: string | null;
  created_at: string;
}

export const COLUMNAS_SUSCRIPTOR =
  "id, email, nombre, estado, origen_alta, consentimiento_at, consentimiento_detalle, fecha_verificacion_email, confirmaciones_enviadas, confirmacion_enviada_at, fecha_baja, origen_baja, created_at";

export const ETIQUETA_ESTADO: Record<EstadoSuscriptor, string> = {
  activo: "Activo",
  pendiente: "Pendiente de confirmar",
  baja: "De baja",
};

const ETIQUETAS_ORIGEN_ALTA: Record<OrigenAlta, string> = {
  web_formulario: "Formulario de la web",
  web_presupuesto: "Solicitud de presupuesto",
  panel_manual: "Añadido desde el panel",
  importacion: "Importado (CSV)",
};

export function etiquetaOrigenAlta(origen: string | null | undefined): string {
  if (!origen) return "";
  return ETIQUETAS_ORIGEN_ALTA[origen as OrigenAlta] ?? "Otro origen";
}

const ETIQUETAS_ORIGEN_BAJA: Record<string, string> = {
  enlace_email: "Se dio de baja desde el email",
  cabecera_one_click: "Pulsó «Cancelar suscripción» en su correo",
  panel_manual: "Dado de baja desde el panel",
  queja_spam: "Marcó el correo como spam",
  rebote_permanente: "Email inexistente o rechazado",
  suprimido_resend: "Email rechazado por el servicio de envío",
  resend_baja_nativa: "Se dio de baja desde la página de baja del correo",
};

export function etiquetaOrigenBaja(origen: string | null | undefined): string {
  if (!origen) return "Motivo no registrado";
  return ETIQUETAS_ORIGEN_BAJA[origen] ?? "Otro motivo";
}

/** Las que se producen sin que la persona pulse nada: el panel las marca distinto. */
export function esBajaPorEntrega(origen: string | null | undefined): boolean {
  return origen === "queja_spam" || origen === "rebote_permanente" || origen === "suprimido_resend";
}

export function formatearFecha(fecha: string | null | undefined): string {
  if (!fecha) return "—";
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" });
}

export interface Recuento {
  activos: number;
  pendientes: number;
  bajas: number;
  total: number;
}

export function contar(filas: readonly SuscriptorNewsletter[]): Recuento {
  const r: Recuento = { activos: 0, pendientes: 0, bajas: 0, total: filas.length };
  for (const f of filas) {
    if (f.estado === "activo") r.activos++;
    else if (f.estado === "pendiente") r.pendientes++;
    else r.bajas++;
  }
  return r;
}

export type FiltroEstado = EstadoSuscriptor | "todos";
export type FiltroOrigen = OrigenAlta | "todos";

/** Búsqueda por email o nombre (sin tildes ni mayúsculas) y filtros por estado y origen. Más recientes primero. */
export function filtrarSuscriptores(
  filas: readonly SuscriptorNewsletter[],
  f: { texto?: string; estado?: FiltroEstado; origen?: FiltroOrigen },
): SuscriptorNewsletter[] {
  const quitar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = quitar((f.texto ?? "").trim());
  return filas
    .filter((s) => (f.estado && f.estado !== "todos" ? s.estado === f.estado : true))
    .filter((s) => (f.origen && f.origen !== "todos" ? s.origen_alta === f.origen : true))
    .filter((s) => !q || quitar(`${s.email} ${s.nombre ?? ""}`).includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** ¿Se le puede mandar (otra) confirmación desde el panel? (la base de datos lo vuelve a comprobar) */
export function puedeReenviarConfirmacion(s: SuscriptorNewsletter, ahora: number = Date.now()): boolean {
  if (s.estado !== "pendiente" || s.confirmaciones_enviadas >= 5) return false;
  if (!s.confirmacion_enviada_at) return true;
  return ahora - new Date(s.confirmacion_enviada_at).getTime() >= 24 * 60 * 60 * 1000;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Un campo CSV: entre comillas si hace falta y sin fórmulas (CSV injection: «=», «+», «-», «@» al principio). */
export function campoCsv(v: string | null | undefined): string {
  let t = v ?? "";
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\n\r,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Exportación (punto y coma, como abre Excel en España; con BOM para las tildes). */
export function exportarCsv(filas: readonly SuscriptorNewsletter[]): string {
  const cabecera = ["email", "nombre", "estado", "origen", "consentimiento", "detalle del consentimiento", "confirmado", "baja", "motivo de la baja"];
  const lineas = filas.map((s) =>
    [s.email, s.nombre, ETIQUETA_ESTADO[s.estado] ?? s.estado, etiquetaOrigenAlta(s.origen_alta), s.consentimiento_at, s.consentimiento_detalle,
      s.fecha_verificacion_email, s.fecha_baja, s.origen_baja ? etiquetaOrigenBaja(s.origen_baja) : ""]
      .map(campoCsv)
      .join(";"),
  );
  return `\uFEFF${[cabecera.join(";"), ...lineas].join("\r\n")}\r\n`;
}

/** Separa una línea CSV (comillas dobles, «;» o «,»). */
function partirLinea(linea: string, sep: string): string[] {
  const out: string[] = [];
  let actual = "";
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') comillas = false;
      else actual += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      out.push(actual);
      actual = "";
    } else actual += c;
  }
  out.push(actual);
  return out.map((v) => v.trim());
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export interface FilaImportada {
  email: string;
  nombre: string | null;
}

export interface LecturaCsv {
  filas: FilaImportada[];
  /** Líneas con un email que no vale (número de línea, empezando en 1). */
  invalidas: number[];
  duplicadas: number;
}

/**
 * Lee un CSV con una columna de email (y opcionalmente nombre). Admite cabecera («email», «correo», «nombre») o, sin
 * ella, el email en la primera columna. Quita duplicados y como mucho 2000 filas (lo que acepta la base de datos).
 */
export function leerCsv(texto: string, maximo = 2000): LecturaCsv {
  const lineas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return { filas: [], invalidas: [], duplicadas: 0 };
  const sep = (lineas[0].match(/;/g)?.length ?? 0) >= (lineas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const primera = partirLinea(lineas[0], sep).map((c) => c.toLowerCase());
  let colEmail = primera.findIndex((c) => /^(e-?mail|correo( electr[oó]nico)?)$/.test(c));
  let colNombre = primera.findIndex((c) => /^(nombre|name)$/.test(c));
  let inicio = 1;
  if (colEmail < 0) {
    colEmail = 0;
    colNombre = primera.length > 1 && !EMAIL.test(primera[1]) ? 1 : -1;
    inicio = 0;
  }
  const vistos = new Set<string>();
  const filas: FilaImportada[] = [];
  const invalidas: number[] = [];
  let duplicadas = 0;
  for (let i = inicio; i < lineas.length && filas.length < maximo; i++) {
    const celdas = partirLinea(lineas[i], sep);
    const email = (celdas[colEmail] ?? "").trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL.test(email)) {
      invalidas.push(i + 1);
      continue;
    }
    if (vistos.has(email)) {
      duplicadas++;
      continue;
    }
    vistos.add(email);
    const nombre = colNombre >= 0 ? (celdas[colNombre] ?? "").replace(/\s+/g, " ").trim().slice(0, 120) : "";
    filas.push({ email, nombre: nombre || null });
  }
  return { filas, invalidas, duplicadas };
}
