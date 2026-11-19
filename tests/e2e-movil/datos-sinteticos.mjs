// Datos 100 % sintéticos (nombres «SIM …», correos @sim.cristaleriabv.test) para las pruebas e2e móviles.
// Pensados para provocar los casos difíciles del móvil: textos largos, cifras de varias cifras y listas largas.
// Solo las tablas que usa el panel (usuarios y permisos, peticiones, avisos, auditoría, servicios y costes de IA).
import { USER_ID, EMAIL } from "./supabase-falso.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dia = (delta) => { const d = new Date(); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const haceHoras = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahora = new Date().toISOString();

const NOMBRES = ["SIM María del Carmen Fernández de la Vega Álvarez", "SIM José Luis Rodríguez", "SIM Ana", "SIM Pedro Sánchez Gómez de las Heras y Mendoza", "SIM Lucía Ortega", "SIM Marta Díaz"];

// Nueva petición / Tickets: estados, prioridades y módulos distintos, títulos largos y un análisis de la IA.
const ANALISIS = {
  resumen: "Que la lista de usuarios deje buscar por el nombre del montador además de por el correo.",
  tipo: "mejora",
  tarea_propuesta: "Añadir a Usuarios un buscador que mire el nombre visible y el correo, sin distinguir mayúsculas ni tildes.",
  pasos: ["Añadir el campo de búsqueda encima de la lista", "Filtrar por nombre visible y correo", "Probar en móvil con nombres largos"],
  modulos_afectados: ["Usuarios y permisos"],
  repo: "panel",
  riesgo: { nivel: "bajo", motivo: "Solo cambia cómo se filtra una lista; no toca datos." },
  toca_bd: false,
  criterios_aceptacion: ["Al escribir «montador» salen solo los usuarios con ese nombre", "En el móvil el buscador cabe sin desbordar"],
  preguntas: ["¿Hace falta buscar también por teléfono?"],
  prompt_ia: "## Contexto\nPanel de Cristalería BV (pablocandela15-droid/admin-cristaleriabv).\n\n## Reglas del repositorio (obligatorias)\n- PR a staging",
};
const peticion = (n, x) => ({
  id: uuid(800 + n), creado_por: USER_ID, creado_por_nombre: NOMBRES[n % NOMBRES.length], creado_por_email: EMAIL,
  prioridad: "normal", modulo: "otro", captura_path: null, ruta: "/dashboard", dispositivo: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  estado: "nueva", motivo_descarte: null, estado_cambiado_por: null, estado_cambiado_en: null,
  analisis: null, analisis_estado: "pendiente", analisis_error: null, analisis_modelo: null, analisis_intentos: 0, analisis_pedido_en: null, analizado_en: null,
  linear_id: null, linear_url: null, created_at: haceHoras(n * 7), updated_at: haceHoras(n * 7), ...x,
});
function peticiones() {
  return [
    peticion(1, { titulo: "SIM No puedo entrar desde la tablet del taller después de cambiar la contraseña esta mañana", prioridad: "urgente", modulo: "cuenta", descripcion: "Me dice que la sesión ha caducado cada vez que pulso Entrar. En el móvil sí funciona." }),
    peticion(2, { titulo: "SIM Buscar usuarios por nombre del montador", modulo: "usuarios", ruta: "/usuarios", estado: "en_analisis", descripcion: "Somos muchos en la lista y cuesta encontrar a cada montador de mamparas.", analisis: ANALISIS, analisis_estado: "hecho", analisis_modelo: "gpt-4.1-mini", analisis_intentos: 1, analizado_en: haceHoras(13) }),
    peticion(3, { titulo: "SIM El aviso de la campana no se marca como leído", prioridad: "alta", modulo: "avisos", ruta: "/avisos", estado: "aceptada", descripcion: "Lo abro, vuelvo al Dashboard y sigue saliendo el número 1 en la campana." }),
    peticion(4, { titulo: "SIM ¿Dónde se cambia el nombre que sale arriba del menú?", prioridad: "baja", modulo: "ayuda", ruta: "/ayuda", estado: "hecha", descripcion: "Duda: quiero que salga mi nombre completo en vez del correo." }),
    peticion(5, { titulo: "SIM Poner en la web la galería de espejos a medida y ventanas de PVC", modulo: "web", ruta: null, estado: "descartada", motivo_descarte: "Es de la web pública: va por otra petición.", descripcion: "Fotos de los últimos trabajos de cerramientos y vidrio templado." }),
    peticion(6, { titulo: "SIM El análisis de la IA no terminó", modulo: "dashboard", analisis_estado: "error", analisis_error: "La IA no respondió a tiempo.", analisis_intentos: 2, descripcion: "Texto de prueba para el estado de error del análisis." }),
  ];
}

export function tablas() {
  const permisos = ["dashboard", "usuarios"].map((s, i) => ({ id: uuid(300 + i), user_id: USER_ID, section_key: s, can_view: true, can_edit: true }));
  return {
    super_admins: [{ id: uuid(1), user_id: USER_ID, email: EMAIL, created_at: ahora }],
    user_roles: [{ id: uuid(2), user_id: USER_ID, role: "admin", created_at: ahora }],
    user_permissions: permisos,
    user_role_presets: [],
    user_access_status: [],
    admin_feature_toggles: [],
    notificaciones_dashboard: [
      { id: uuid(400), tipo: "peticion_urgente", titulo: "SIM Petición urgente: no puedo entrar desde la tablet del taller", mensaje: "SIM José Luis Rodríguez ha enviado una petición urgente.", referencia_id: uuid(801), referencia_tipo: "peticion", leida: false, created_at: haceHoras(1), origen: null, prioridad: "alta", clave: null, caduca_en: null, datos: null },
      { id: uuid(401), tipo: "sistema", titulo: "SIM Copia de seguridad de la base de datos hecha", mensaje: "Sin incidencias.", referencia_id: null, referencia_tipo: null, leida: true, created_at: haceHoras(20), origen: null, prioridad: "normal", clave: null, caduca_en: null, datos: null },
    ],
    peticiones: peticiones(),
    audit_log: [], audit_log_visible: [],
    avisos_telegram_config: [], avisos_telegram_envios: [],
    ia_funciones: [], ia_coste_estimado: [], ia_modelo_funcion: [], costes_fijos: [],
    servicios_contratados: serviciosContratados(),
    servicios_config: [{ id: true, eur_por_usd: 0.9, actualizado_en: ahora }],
    servicios_costes_mes: [],
    tipo_cambio_usd_eur: [{ fecha: "2026-10-26", eur_por_usd: 0.893815, fuente: "bce" }],
  };
}

// Super Admin › Servicios: proveedores con textos largos, consumo en los tres colores del semáforo, coste en
// euros y en dólares, renovaciones, uno sin lectura automática y uno que no se usa.
const FUENTE = "https://vercel.com/docs/plans/hobby";
const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
function serviciosContratados() {
  const s = (proveedor, nombre, extra) => ({ proveedor, nombre, plan: "Free", precio_mensual: 0, precio_anual: null, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null, panel_url: `https://${proveedor}.sim.cristaleriabv.test/panel`, limites: {}, notas: null, actualizado_en: ahora, categoria: "otros", orden: 100, activo: true, por_confirmar: false, fuente_precio: `https://${proveedor}.sim.cristaleriabv.test/precios`, ...extra });
  return [
    s("vercel", "Vercel", { plan: "Hobby", cuenta: "Equipo «SIM Cristalería BV» (sim-equipo, team_sim000000000000000000) · proyectos cristaleriabv y admin-cristaleriabv", limites: {
      peticiones_cdn: { orden: 1, etiqueta: "Visitas a las webs (peticiones al CDN)", limite: 1000000, unidad: "peticiones", periodo: "últimos 30 días", fuente: FUENTE },
      transferencia_rapida: { orden: 2, etiqueta: "Datos servidos a los visitantes (Fast Data Transfer)", limite: 100, unidad: "GB", periodo: "últimos 30 días", fuente: FUENTE },
      despliegues_24h: { orden: 7, etiqueta: "Publicaciones (despliegues)", limite: 100, unidad: "despliegues", periodo: "últimas 24 h", fuente: FUENTE },
    }, notas: "Plan gratuito. Si se pasa de un límite, Vercel pausa ese recurso hasta que pasen 30 días." }),
    s("supabase", "Supabase", { cuenta: "Organización «SIM Cristalería BV» · proyectos cristaleriabv-prod (simprod00000000000000) y cristaleriabv-demo (simdemo00000000000000)", limites: {
      bd_tamano: { orden: 1, etiqueta: "Tamaño de la base de datos", limite: 500, unidad: "MB", periodo: "ahora" },
      almacenamiento: { orden: 2, etiqueta: "Fotos y archivos guardados (Storage)", limite: 1, unidad: "GB", periodo: "ahora" },
      egreso: { orden: 5, etiqueta: "Datos servidos (egress)", limite: 5, unidad: "GB", periodo: "mes en curso", nota: "Supabase no da este dato por API en el plan Free: míralo en su panel (Usage)." },
    } }),
    s("github", "GitHub", { cuenta: "Cuenta oficiososia · repositorios cristaleriabv y admin-cristaleriabv", limites: { actions_computo: { orden: 1, etiqueta: "Pruebas automáticas (GitHub Actions)", limite: 12, unidad: "USD", periodo: "mes en curso" } } }),
    s("resend", "Resend", { plan: "Free (por confirmar)", limites: { correos_mes: { orden: 1, etiqueta: "Correos enviados este mes", limite: 3000, unidad: "correos", periodo: "mes en curso" }, correos_hoy: { orden: 2, etiqueta: "Correos enviados hoy", limite: 100, unidad: "correos", periodo: "hoy (UTC)" } } }),
    s("stripe", "Stripe", { plan: "Sin cuota (comisión por cobro)", precio_mensual: null, moneda: "EUR", ciclo: "por_uso", cuenta: "Cuenta en MODO PRUEBA (todavía no cobra de verdad)", categoria: "pagos", orden: 50 }),
    s("openai", "OpenAI", { plan: "Pago por uso", precio_mensual: null, ciclo: "por_uso", categoria: "ia", orden: 60, limites: { gasto_ia_mes: { orden: 1, etiqueta: "Gasto de IA este mes", unidad: "EUR", periodo: "mes en curso", limite_desde: "Tope de gasto de IA de Super Admin › Servicios › Costes" } } }),
    s("hostinger", "Hostinger", { plan: "Premium Web Hosting con un nombre de plan larguísimo", precio_mensual: null, precio_anual: 95.88, moneda: "EUR", ciclo: "anual", categoria: "dominio", orden: 95, por_confirmar: true }),
    s("correo", "Correo del dominio (buzones de la cristalería)", { plan: "Por confirmar", precio_mensual: null, moneda: "EUR", ciclo: "anual", categoria: "dominio", orden: 96, por_confirmar: true, renovacion: enDias(12),
      cuenta: "Dominio sim-cristaleriabv.es: DNS ns1–ns3.sim-proveedor.test, correo mx1–mx3.sim-proveedor.test y buzones de presupuestos y taller" }),
    s("twilio", "Twilio (SMS)", { plan: "Pago por uso", precio_mensual: null, ciclo: "por_uso", categoria: "otros", orden: 70, activo: false, notas: "Hoy no se usa: se dio de alta para avisos por SMS y no se llegó a activar." }),
  ].map((x, i) => ({ ...x, orden: x.orden === 100 ? (i + 1) * 10 : x.orden }));
}
const lecturasServicios = () => [
  { proveedor: "vercel", tomado_en: ahora, metricas: {}, error: "falta_secreto", secreto: "SERVICIOS_VERCEL_TOKEN", detalles: { secreto: "SERVICIOS_VERCEL_TOKEN" } },
  { proveedor: "supabase", tomado_en: ahora, error: null, desde_cache: true, metricas: {
    bd_tamano: { etiqueta: "Tamaño de la base de datos", valor: 460 * 1024 ** 2, unidad: "bytes" },
    almacenamiento: { etiqueta: "Fotos y archivos guardados (Storage)", valor: 0.75 * 1024 ** 3, unidad: "bytes", nota: "501 archivos en este proyecto." },
    usuarios_activos_mes: { etiqueta: "Usuarios activos este mes", valor: 2, unidad: "usuarios", periodo: "mes en curso" },
  }, detalles: { secreto_opcional: "SERVICIOS_SUPABASE_TOKEN", avisos: ["Sin SERVICIOS_SUPABASE_TOKEN no salen las peticiones a la API ni las ejecuciones de funciones."] } },
  { proveedor: "github", tomado_en: ahora, metricas: {}, error: "falta_secreto", secreto: "SERVICIOS_GITHUB_TOKEN", detalles: { secreto: "SERVICIOS_GITHUB_TOKEN" } },
  { proveedor: "resend", tomado_en: ahora, metricas: { correos_mes: { valor: 2985, unidad: "correos" }, correos_hoy: { valor: 12, unidad: "correos" } }, error: "falta_secreto", secreto: "RESEND_API_KEY", detalles: { secreto: "RESEND_API_KEY" } },
  { proveedor: "stripe", tomado_en: ahora, metricas: { cobros_mes: { etiqueta: "Cobros este mes", valor: 123, unidad: "cobros" }, importe_cobrado_mes: { etiqueta: "Importe cobrado este mes", valor: 12345.67, unidad: "EUR" } }, error: null, detalles: { modo: "prueba", moneda: "EUR" },
    coste_variable: { importe: 185.19, moneda: "EUR", periodo: "mes en curso", origen: "bd" } },
  { proveedor: "openai", tomado_en: ahora, error: null, detalles: { avisos: ["OpenAI no ha publicado costes reales desde el 22/10/2026: revisa OPENAI_ADMIN_KEY y la sincronización de Super Admin › Costes."] },
    metricas: { gasto_ia_mes: { etiqueta: "Gasto de IA este mes", valor: 7.4, unidad: "EUR", limite: 8, unidad_limite: "EUR", periodo: "mes en curso" }, gasto_real_usd: { etiqueta: "Ya facturado por OpenAI", valor: 7.9, unidad: "USD", periodo: "mes en curso" } },
    coste_variable: { importe: 8.22, moneda: "USD", periodo: "mes en curso", origen: "estimado" } },
  { proveedor: "hostinger", tomado_en: ahora, error: null, metricas: { suscripciones_activas: { etiqueta: "Suscripciones activas", valor: 2, unidad: "suscripciones" } },
    detalles: { plan_detectado: "Premium Web Hosting, .es Domain", coste_mensual_detectado: { importe: 8.99, moneda: "EUR" },
      dominios: [{ dominio: "sim-cristaleriabv.es", estado: "active", caduca: `${enDias(73)}T10:00:00Z` }, { dominio: "un-dominio-con-un-nombre-muy-largo-de-verdad.es", estado: "active", caduca: `${enDias(300)}T10:00:00Z` }] } },
];

const hoyISO = dia(0);
export const rpcSinteticas = {
  servicios_uso_ultimas: () => lecturasServicios(),
  version_auditoria_panel: () => 2,
  registrar_acceso_panel: () => null,
  listar_tablas_auditoria_panel: () => [{ tabla: "peticiones" }, { tabla: "user_permissions" }],
  // Servicios › Costes: lo real de OpenAI (un solo proceso en este panel) con importes de varias cifras.
  gasto_ia_real_resumen: () => [{ proceso: "otros", usd_real: 8.9, ultimo_dia_real: hoyISO, usd_estimado_hoy: 0.3 }, { reparto: "por_clave" }],
  tipo_cambio_usd_eur_actual: () => [{ eur_por_usd: 0.86, fecha: hoyISO, fuente: "bce" }],
  ia_coste_mes: () => [{ mes: hoyISO.slice(0, 7), coste_acumulado_usd: 9.46, dias_con_dato: 2, dias_mes: 30, dias_restantes: 28, estimado_ia_usd_mes: 273.8, fijos_eur_mes: null, fijos_sin_verificar: 8, peticiones: 480, proy_lineal_usd: 140, proy_media7_usd: 273.8 }],
  ia_coste_serie: () => [], ia_coste_por_funcion: () => [], ia_coste_por_modelo: () => [], ia_funciones_sin_registro: () => [],
};
export const funcionesSinteticas = {
  "servicios-uso": () => ({ lecturas: lecturasServicios(), sin_lector: ["correo"], generado_en: ahora }),
  "list-users": () => ({ users: [{ id: USER_ID, email: EMAIL, display_name: "SIM Usuario e2e", created_at: ahora, access_blocked: false }] }),
};
