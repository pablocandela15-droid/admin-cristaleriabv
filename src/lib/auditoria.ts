import type { AuditLogEntry } from "@/hooks/useAuditLog";

/**
 * Tablas que se pueden restaurar desde la auditoría: la misma lista que acepta
 * `revertir_cambio_auditoria` en el SQL. Si cambia allí, cámbiala aquí; si no,
 * el botón «Revertir» aparecería en cambios que el servidor va a rechazar.
 */
export const TABLAS_REVERSIBLES = [
  "oficiososia_borradores",
  "user_permissions",
  "user_roles",
  "admin_feature_toggles",
  "user_role_presets",
];

/** Cómo se nombra en las frases un registro de cada tabla («el ticket», «la plantilla de permisos»…). */
const ENTIDADES: Record<string, string> = {
  peticiones: "ticket",
  user_permissions: "permiso",
  user_roles: "rol de usuario",
  user_role_presets: "plantilla de permisos",
  user_access_status: "estado de acceso de un usuario",
  "auth.users": "usuario",
  "storage.objects": "archivo",
  web_linear_prueba: "envío de prueba a Linear",
  peso_paginas: "peso por página de Tráfico web",
  fallos_internos: "fallo interno",
  costes_fijos: "coste fijo",
  servicios_contratados: "servicio contratado",
  servicios_costes_mes: "coste mensual de un servicio",
  servicios_contratados_copia_cierre: "copia de cierre de un servicio",
  tipo_cambio_usd_eur: "tipo de cambio USD/EUR",
  ia_funciones: "función de IA",
  ia_coste_estimado: "estimación de coste de IA",
  ia_precios: "precio de un modelo de IA",
  ia_modelos_disponibles: "modelo de IA disponible",
  ia_modelo_funcion: "modelo de IA de una función",
  ia_modelo_funcion_historial: "cambio de modelo de IA",
  openai_claves: "registro de credencial de IA",
  openai_proyectos: "proyecto de OpenAI",
  oficiososia_facturas: "factura emitida",
  oficiososia_borradores: "borrador de factura",
};
/** Tablas de configuración (una fila): «Ha modificado la configuración de …». */
const CONFIGURACIONES: Record<string, string> = {
  oficiososia_facturacion_config: "la emisión de facturas",
  servicios_config: "Servicios",
  avisos_telegram_config: "los avisos por Telegram",
  web_logs_config: "Logs web (Linear, fuentes y avisos)",
};
const CAMPOS: Record<string, string> = {
  nombre: "Nombre",
  name: "Nombre",
  titulo: "Título",
  descripcion: "Descripción",
  categoria: "Categoría",
  concepto: "Concepto",
  proveedor: "Proveedor",
  plan: "Plan",
  precio_mensual: "Precio mensual",
  importe: "Importe",
  moneda: "Moneda",
  notas: "Notas",
  orden: "Orden",
  activo: "Activo",
  enabled: "Activado",
  fecha: "Fecha",
  estado: "Estado",
  status: "Estado",
  prioridad: "Prioridad",
  modulo: "Módulo",
  motivo: "Motivo",
  motivo_descarte: "Motivo del descarte",
  numero: "Número",
  codigo: "Código",
  section_key: "Sección",
  feature_key: "Sección del panel",
  can_view: "Puede ver",
  can_edit: "Puede editar",
  can_delete: "Puede eliminar",
  can_create: "Puede crear",
  role: "Rol",
  user_id: "Usuario",
  email: "Correo",
  session_id: "Sesión",
  banned_until: "Bloqueado hasta",
  acceso_bloqueado: "Acceso bloqueado",
  access_blocked: "Acceso bloqueado",
  cantidad: "Cantidad",
  unidad: "Unidad",
  bucket_id: "Almacén de archivos",
  subject: "Asunto",
  destinatario: "Destinatario",
  eur_por_usd: "Euros por dólar",
  tope_ia_mes_eur: "Tope mensual de IA",
};
const OMITIDOS = new Set([
  "id",
  "created_at",
  "updated_at",
  "actualizado_en",
  "modified_at",
  "request_id",
  "updated_by",
  "embedding",
]);
export function etiquetaCampo(campo: string): string {
  return (
    CAMPOS[campo] ??
    campo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
export function valorLegible(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "")
    return "Sin indicar";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (
    typeof valor === "number" &&
    /(_eur|precio|importe|total|coste)/.test(campo)
  )
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
    }).format(valor);
  if (Array.isArray(valor))
    return valor.length
      ? valor.map((v) => valorLegible(campo, v)).join(", ")
      : "Ninguno";
  if (typeof valor === "object")
    return Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => `${etiquetaCampo(k)}: ${valorLegible(k, v)}`)
      .join(" · ");
  const texto = String(valor);
  if (campo === "role" || campo === "rol") {
    const roles: Record<string, string> = { admin: "Administrador", manager: "Manager", staff: "Personal", user: "Usuario" };
    return roles[texto] ?? texto;
  }
  if (campo === "estado" || campo === "status") {
    const estados: Record<string, string> = {
      // Tickets (peticiones.estado), con los nombres que ve quien los envía.
      nueva: "Recibida",
      en_analisis: "En análisis",
      aceptada: "Aceptada",
      hecha: "Hecha",
      descartada: "Descartada",
      pendiente: "Pendiente",
      cancelada: "Cancelada",
      completada: "Completada",
      completado: "Completado",
      fallida: "Fallida",
      fallido: "Fallido",
      pending: "Pendiente",
      processing: "En proceso",
      completed: "Completado",
      failed: "Fallido",
      cancelled: "Cancelado",
    };
    return estados[texto] ?? texto.replace(/_/g, " ");
  }
  if (
    /^(\d{4}-\d{2}-\d{2})(T|$)/.test(texto) &&
    /(fecha|_at$|_en$|banned_until)/.test(campo)
  ) {
    const fecha = new Date(texto.length === 10 ? `${texto}T12:00:00` : texto);
    if (!Number.isNaN(fecha.getTime()))
      return fecha.toLocaleString(
        "es-ES",
        texto.length === 10
          ? { dateStyle: "medium" }
          : { dateStyle: "medium", timeStyle: "short" },
      );
  }
  return texto;
}
function filaObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}
function textoCorto(valor: unknown, limite = 100): string {
  const texto = typeof valor === "string" || typeof valor === "number"
    ? String(valor).replace(/\s+/g, " ").trim()
    : "";
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}
function nombreArchivo(fila: Record<string, unknown>): string {
  return textoCorto(String(fila.name ?? "").split("/").pop());
}
/** Qué es el archivo, ya con su artículo: «una captura de un ticket», «una imagen» o «un archivo». */
function claseArchivo(fila: Record<string, unknown>): string {
  if (fila.bucket_id === "peticiones") return "una captura de un ticket";
  const metadata = filaObjeto(fila.metadata);
  return String(metadata.mimetype ?? "").startsWith("image/") ? "una imagen" : "un archivo";
}
/** Información útil del archivo; rutas, propietarios y versiones quedan en el JSON técnico. */
export function camposArchivoLegibles(entrada: AuditLogEntry) {
  const d = entrada.detalles ?? {};
  const fila = filaObjeto(d.despues ?? d.antes);
  const metadata = filaObjeto(fila.metadata);
  const bytes = Number(metadata.size ?? metadata.contentLength);
  const campos = [{ campo: "archivo", etiqueta: "Archivo", valor: nombreArchivo(fila) || "Sin nombre registrado" }];
  if (fila.bucket_id === "peticiones")
    campos.push({ campo: "uso", etiqueta: "Uso", valor: "Captura de pantalla adjunta a un ticket" });
  if (typeof metadata.mimetype === "string") {
    const tipos: Record<string, string> = { "image/jpeg": "Imagen JPEG", "image/png": "Imagen PNG", "image/webp": "Imagen WebP", "application/pdf": "Documento PDF" };
    campos.push({ campo: "tipo", etiqueta: "Tipo", valor: tipos[metadata.mimetype] ?? metadata.mimetype });
  }
  if (Number.isFinite(bytes) && bytes >= 0)
    campos.push({ campo: "tamano", etiqueta: "Tamaño", valor: bytes < 1024 ? `${bytes} bytes` : `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} ${bytes < 1048576 ? "KB" : "MB"}` });
  return campos;
}
export function camposLegibles(fila: unknown) {
  if (!fila || typeof fila !== "object" || Array.isArray(fila)) return [];
  return Object.entries(fila)
    .filter(
      ([k, v]) =>
        !OMITIDOS.has(k) &&
        !/(password|secret|token|api_?key|base64|authorization)/i.test(k) &&
        v !== "[oculto]",
    )
    .map(([campo, valor]) => ({
      campo,
      etiqueta: etiquetaCampo(campo),
      valor: valorLegible(campo, valor),
    }));
}
/**
 * Tipo de evento de una fila. La vista `audit_log_visible` ya lo calcula
 * (`tipo_evento`); esto es el respaldo para filas leídas sin esa columna.
 */
export function tipoEvento(entrada: AuditLogEntry): string {
  if (entrada.tipo_evento) return entrada.tipo_evento;
  const d = entrada.detalles ?? {};
  if (entrada.accion === "ejecutar" && d.tipo_evento)
    return String(d.tipo_evento);
  if (entrada.tabla === "user_permissions") return "cambiar_permisos";
  if (entrada.tabla === "user_roles" || entrada.tabla === "super_admins")
    return "cambiar_roles";
  if (d.credenciales_actualizadas) return "cambiar_credenciales";
  const antes = d.antes as Record<string, unknown> | undefined;
  const despues = d.despues as Record<string, unknown> | undefined;
  if (
    entrada.accion === "actualizar" &&
    entrada.tabla === "auth.users" &&
    antes &&
    despues &&
    antes.banned_until !== despues.banned_until
  )
    return despues.banned_until &&
      new Date(String(despues.banned_until)).getTime() >
        new Date(entrada.created_at).getTime()
      ? "bloquear_acceso"
      : "desbloquear_acceso";
  return entrada.accion;
}
export function resumenEntrada(entrada: AuditLogEntry): string {
  const d = entrada.detalles ?? {};
  const evento = tipoEvento(entrada);
  const fila = filaObjeto(d.despues ?? d.antes);
  const antes = filaObjeto(d.antes);
  const despues = filaObjeto(d.despues);
  if (evento === "reversion")
    return "Ha revertido un cambio de auditoría";
  if (evento === "bloquear_acceso" || evento === "desbloquear_acceso") {
    return `Ha ${evento === "bloquear_acceso" ? "bloqueado" : "desbloqueado"} el acceso de ${fila.email ? `«${String(fila.email)}»` : "un usuario"}`;
  }
  if (d.credenciales_actualizadas)
    return `Ha cambiado la contraseña de ${fila.email ? `«${textoCorto(fila.email)}»` : "un usuario"}`;
  if (entrada.tabla === "user_permissions")
    return `Ha ${d.operacion_permiso === "retirar" ? "retirado" : d.operacion_permiso === "conceder" ? "concedido" : "modificado"} permisos${fila.section_key ? ` en ${etiquetaCampo(String(fila.section_key))}` : " de acceso"}`;
  if (entrada.tabla === "super_admins")
    return `Ha ${d.operacion_asignacion === "retirar" || d.operacion_sql === "DELETE" ? "retirado" : d.operacion_asignacion === "asignar" || d.operacion_sql === "INSERT" ? "concedido" : "modificado"} el acceso de superadmin${fila.email ? ` a «${textoCorto(fila.email)}»` : " a un usuario"}`;
  if (entrada.tabla === "user_roles")
    return `Ha ${d.operacion_asignacion === "retirar" ? "retirado" : d.operacion_asignacion === "asignar" ? "asignado" : "modificado"} un rol de usuario${fila.role ? `: ${valorLegible("role", fila.role)}` : ""}`;
  // Marca que cierra al momento las pantallas abiertas de un usuario bloqueado.
  if (
    entrada.tabla === "user_access_status" &&
    entrada.accion !== "eliminar" &&
    typeof despues.access_blocked === "boolean" &&
    antes.access_blocked !== despues.access_blocked
  )
    return `Ha ${despues.access_blocked ? "bloqueado" : "desbloqueado"} el acceso de un usuario al panel`;
  if (entrada.tabla === "storage.objects") {
    const archivo = nombreArchivo(fila);
    const clase = claseArchivo(fila);
    if (entrada.accion === "crear") return `Ha subido ${clase}${archivo ? `: ${archivo}` : ""}`;
    if (entrada.accion === "eliminar") return `Ha eliminado ${clase}${archivo ? `: ${archivo}` : ""}`;
    if (antes.name && despues.name && antes.name !== despues.name) {
      const anterior = nombreArchivo(antes);
      return anterior !== archivo
        ? `Ha renombrado el archivo «${anterior}» a «${archivo}»`
        : `Ha movido el archivo «${archivo}»`;
    }
    return `Ha actualizado ${clase}${archivo ? `: ${archivo}` : ""}`;
  }
  if (entrada.accion === "ejecutar") {
    // Edge Functions del panel (supabase/functions), por su nombre.
    const operaciones: Record<string, string> = {
      "admin-create-user": "crear un usuario",
      "admin-delete-user": "eliminar un usuario",
      "admin-set-super-admin": "cambiar el acceso de superadmin",
      "admin-update-user-password": "cambiar la contraseña de un usuario",
      "admin-set-user-access": "cambiar el acceso de un usuario",
      "cambiar-mi-contrasena": "cambiar su propia contraseña",
      "list-users": "consultar la lista de usuarios",
      "panel-auth": "validar el acceso al panel",
      "auditoria-revertir": "revertir un cambio de auditoría",
      "analizar-peticion": "analizar un ticket con la IA",
      "avisos-telegram": "enviar avisos por Telegram",
      "control-excel": "consultar o editar el Excel de control",
      "ia-modelos-openai": "gestionar los modelos de IA",
      "servicios-uso": "consultar el consumo de los servicios",
      "sincronizar-costes-openai": "sincronizar costes de IA",
      "leer-metricas": "consultar las métricas del panel",
      "registrar-metrica": "registrar una métrica del panel",
    };
    const operacion = String(d.operacion ?? d.origen ?? "").split("/")[0];
    const descripcion = operaciones[operacion];
    const resultado = entrada.resultado ?? d.resultado;
    if (resultado === "fallida") return `No se ha podido ${descripcion ?? "completar una acción del servidor"}`;
    if (resultado === "parcial") return `Ha solicitado ${descripcion ?? "una acción del servidor"}; resultado parcial`;
    return descripcion ? `Ha solicitado ${descripcion}` : "Ha realizado una acción del servidor";
  }
  const accesos: Record<string, string> = {
    login: "Ha iniciado sesión",
    logout: "Ha cerrado sesión",
    acceso: "Ha accedido con una sesión abierta",
    acceso_denegado: "Ha intentado acceder sin permiso",
    login_fallido: "Ha intentado iniciar sesión sin éxito",
    intento_login: "Ha iniciado un intento de acceso",
  };
  if (accesos[entrada.accion]) return accesos[entrada.accion];
  const nombre =
    fila.nombre ?? fila.titulo ?? fila.concepto ?? fila.name ?? fila.numero ?? fila.email;
  const entidad = ENTIDADES[entrada.tabla ?? ""] ?? etiquetaCampo(entrada.tabla ?? "registro").toLocaleLowerCase("es");
  const modificados = Object.keys({ ...antes, ...despues }).filter(c => !OMITIDOS.has(c) && !/(password|secret|token|api_?key|authorization)/i.test(c) && JSON.stringify(antes[c]) !== JSON.stringify(despues[c]));
  const camposModificados = modificados.slice(0, 3).map(etiquetaCampo).join(", ");
  const detalleModificacion = camposModificados ? `: ${camposModificados}${modificados.length > 3 ? ` y ${modificados.length - 3} campos más` : ""}` : "";
  const configuracion = CONFIGURACIONES[entrada.tabla ?? ""];
  if (configuracion)
    return `Ha ${entrada.accion === "eliminar" ? "eliminado" : entrada.accion === "crear" ? "guardado" : "modificado"} la configuración de ${configuracion}${entrada.accion === "actualizar" ? detalleModificacion : ""}`;
  if (entrada.tabla === "admin_feature_toggles")
    return `Ha ${entrada.accion === "eliminar" ? "eliminado la configuración de" : despues.enabled === true ? "activado" : despues.enabled === false ? "desactivado" : "modificado"} una sección del panel${fila.label || fila.section_key ? `: ${textoCorto(fila.label ?? etiquetaCampo(String(fila.section_key)))}` : ""}`;
  const verbo =
    entrada.accion === "crear"
      ? "creado"
      : entrada.accion === "eliminar"
        ? "eliminado"
        : "modificado";
  const femenina = /^(factura|plantilla|copia|función|estimación)/.test(entidad);
  const articulo =
    entrada.accion === "crear"
      ? femenina
        ? "una nueva"
        : "un nuevo"
      : femenina
        ? "la"
        : "el";
  const objetivo = `${femenina ? "la" : "el"} ${entidad}${nombre ? ` «${textoCorto(nombre)}»` : ""}`;
  const referencia = femenina ? `de ${objetivo}` : `del ${objetivo.slice(3)}`;
  if (entrada.accion === "actualizar") {
    if (antes.estado !== despues.estado && ("estado" in antes || "estado" in despues))
      return `Ha cambiado el estado ${referencia}: ${valorLegible("estado", antes.estado)} → ${valorLegible("estado", despues.estado)}`;
    if (modificados.length > 0)
      return `Ha modificado ${objetivo}${detalleModificacion}`;
  }
  return `Ha ${verbo} ${articulo} ${entidad}${nombre ? ` «${textoCorto(nombre)}»` : ""}`;
}
export function puedeRevertir(entrada: AuditLogEntry): boolean {
  return (
    TABLAS_REVERSIBLES.includes(entrada.tabla ?? "") &&
    ["crear", "actualizar", "eliminar"].includes(entrada.accion) &&
    Boolean(entrada.detalles?.antes || entrada.detalles?.despues) &&
    !JSON.stringify(entrada.detalles).includes("[oculto]")
  );
}
export const ACCIONES_ESPECIFICAS = [
  ["cambiar_permisos", "Cambiar permisos"],
  ["cambiar_roles", "Cambiar roles"],
  ["cambiar_credenciales", "Cambiar credenciales"],
  ["cambio_contrasena", "Cambiar su propia contraseña"],
  ["bloquear_acceso", "Bloquear acceso de usuario"],
  ["desbloquear_acceso", "Desbloquear acceso de usuario"],
  ["reversion", "Revertir un cambio"],
] as const;
