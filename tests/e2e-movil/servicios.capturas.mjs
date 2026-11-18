// Capturas de Super Admin › Servicios (Estado y Costes) con el Supabase falso de esta carpeta: nada sale a Supabase ni
// a Internet. Datos sintéticos: los servicios de datos-sinteticos.mjs más Google Drive (con lectura automática; guarda
// el Excel de control), costes de los últimos meses (uno metido a mano) y un servicio sin coste. También «para qué», plan
// siguiente y límites del plan con su página (Planes gratis) y la IA por función (`ia_coste_por_uso`: las dos
// funciones de IA del panel, con cifras inventadas).
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/servicios.capturas.mjs [carpeta-de-capturas]
//
// Saca móvil (375×812) y escritorio (1280×800) de cada pestaña, la página entera, y avisa si algo se desborda en
// horizontal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-servicios";
const ahora = new Date().toISOString();

const mes = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10); };
const extra = (proveedor, nombre, x) => ({
  proveedor, nombre, plan: "Free", precio_mensual: 0, precio_anual: null, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null,
  panel_url: `https://${proveedor}.sim.test/`, limites: {}, notas: null, actualizado_en: ahora, categoria: "otros", orden: 100, activo: true,
  por_confirmar: false, fuente_precio: null, ...x,
});
const FUENTE_SB = "https://supabase.com/docs/guides/platform/billing-on-supabase";
const PARA_QUE = {
  vercel: "Publica la web de la cristalería y este panel.",
  supabase: "La base de datos: usuarios, permisos, peticiones, avisos y auditoría del panel.",
  github: "Guarda el código de la web y del panel y pasa las pruebas automáticas.",
  resend: "Manda los correos del panel.",
  stripe: "Cobros con tarjeta (en modo prueba).",
  openai: "La inteligencia artificial: analizar las peticiones del equipo y probar modelos.",
  correo: "El dominio de la cristalería y sus buzones de correo.",
};
const conPlan = (s) => {
  const x = { ...s, para_que: PARA_QUE[s.proveedor] ?? null };
  if (s.proveedor === "supabase") {
    Object.assign(x, { plan_siguiente: "Pro", precio_siguiente: 25, si_se_pasa: "Supabase puede limitar el proyecto hasta el mes siguiente o hasta pasar al plan Pro." });
    x.limites = {
      ...s.limites,
      bd_tamano: { ...s.limites.bd_tamano, fuente: FUENTE_SB, si_se_pasa: "La base de datos pasa a solo lectura: no se podrían guardar peticiones, usuarios ni cambios hasta liberar espacio o pasar al plan Pro." },
      almacenamiento: { ...s.limites.almacenamiento, fuente: FUENTE_SB },
      egreso: { ...s.limites.egreso, fuente: FUENTE_SB },
    };
  }
  if (s.proveedor === "resend") {
    Object.assign(x, { plan_siguiente: "Pro", precio_siguiente: 20 });
    x.limites = Object.fromEntries(Object.entries(s.limites).map(([k, l]) => [k, { ...l, fuente: "https://resend.com/docs/knowledge-base/account-quotas-and-limits" }]));
  }
  if (s.proveedor === "vercel") Object.assign(x, { plan_siguiente: "Pro", precio_siguiente: 20, si_se_pasa: "Vercel pausa lo que se pase (la web o el panel) hasta que pasen 30 días." });
  return x;
};
function datos() {
  const t = tablas();
  t.servicios_contratados = [
    ...t.servicios_contratados.map(conPlan),
    extra("google_drive", "Google Drive (Excel de control)", { plan: "Gratis, 15 GB", moneda: "EUR", categoria: "archivos", orden: 90, limites: { almacenamiento: { orden: 1, etiqueta: "Espacio de la cuenta de Google", limite: 15, unidad: "GB", periodo: "ahora" } } }),
  ];
  return t;
}
const lecturas = () => [
  ...funcionesSinteticas["servicios-uso"]().lecturas.map((l) => (l.proveedor === "supabase"
    ? { ...l, metricas: { ...l.metricas, bd_crecimiento: { etiqueta: "Crecimiento de la base de datos", valor: 6 * 1024 ** 2, unidad: "bytes", periodo: "últimos 7 días", nota: "+6 MB en 7 días." } } }
    : l)),
  { proveedor: "google_drive", tomado_en: ahora, error: null, detalles: { plan_detectado: "15 GB de espacio" }, metricas: {
    almacenamiento: { orden: 1, etiqueta: "Espacio de la cuenta de Google", valor: 9.6 * 1024 ** 3, unidad: "bytes", limite: 15, unidad_limite: "GB", periodo: "ahora" },
    en_drive: { orden: 2, etiqueta: "De ello, en Drive", valor: 2.1 * 1024 ** 3, unidad: "bytes", periodo: "ahora" },
  } },
];
const resumenMes = ({ p_mes }) => {
  const uso = (importe, moneda = "USD") => ({ importe, moneda, periodo: "mes en curso", origen: "api" });
  if (p_mes === mes(0)) return [
    { proveedor: "openai", lecturas: 40, coste_variable: uso(3.1) }, { proveedor: "stripe", lecturas: 40, coste_variable: uso(0.55, "EUR") },
    { proveedor: "google_drive", lecturas: 40, coste_variable: uso(0) },
  ];
  if (p_mes === mes(1)) return [
    { proveedor: "openai", lecturas: 300, coste_variable: uso(12.4) }, { proveedor: "stripe", lecturas: 300, coste_variable: uso(2.1, "EUR") },
    { proveedor: "google_drive", lecturas: 300, coste_variable: null },
    { proveedor: "correo", lecturas: 0, manual_importe: 14.99, manual_moneda: "EUR", manual_nota: "SIM Factura dominio 2026-118" },
  ];
  if (p_mes === mes(2)) return [
    { proveedor: "openai", lecturas: 280, coste_variable: uso(9.8) }, { proveedor: "stripe", lecturas: 280, coste_variable: uso(1.4, "EUR") },
  ];
  return [];
};
const filaIa = (funcion, que_hace, accion, unidad, orden, llamadas, usos, coste, mediana, extra = {}) => ({
  funcion, que_hace, accion, unidad, orden, llamadas, usos, usos_con_coste: usos, coste_usd: coste, filas_sin_tarifa: 0, modelos_sin_tarifa: [],
  mediana_usd: mediana, media_usd: mediana, servidor_propio: false, ...extra,
});
const costePorUso = ({ p_desde }) => p_desde !== mes(0) ? [] : [
  filaIa("analizar-peticion", "Analiza una petición de mejora del panel y propone cómo hacerla.", "Analizar una petición de mejora", "petición", 97, 64, 58, 0.412, 0.0068,
    { usos_con_coste: 52, filas_sin_tarifa: 6, modelos_sin_tarifa: ["gpt-6.1-terra"] }),
  filaIa("ia-modelos-openai", "Prueba los modelos de IA (botón «Probar» de Servicios › Modelos).", "Probar un modelo", "prueba", 98, 12, 12, 0.019, 0.0015),
];
const rpc = { ...rpcSinteticas, servicios_resumen_mes: resumenMes, ia_coste_por_uso: costePorUso };
const funciones = { ...funcionesSinteticas, "servicios-uso": () => ({ lecturas: lecturas(), sin_lector: ["correo"], generado_en: ahora }) };

const VISTAS = [
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
];
const PESTANAS = [
  { tab: "estado", espera: "[data-testid='estado-general']" },
  { tab: "costes", espera: "#costes-faltantes" },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
  for (const p of PESTANAS) {
    const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc, funciones });
    const page = await context.newPage();
    await page.goto(`${BASE}/super-admin/servicios${p.tab === "estado" ? "" : `?tab=${p.tab}`}`);
    await page.locator(p.espera).first().waitFor({ timeout: 20_000 }).catch(() => console.log(`${v.nombre}/${p.tab}: no apareció ${p.espera}`));
    await page.waitForTimeout(1200);
    const base = path.join(SALIDA, `${p.tab}-${v.nombre}`);
    await page.screenshot({ path: `${base}-vista.png` });
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (ancho > visible) console.log(`${v.nombre}/${p.tab}: la página se desborda en horizontal (${ancho} px de ${visible})`);
    // Página entera: se quita el alto fijo y el scroll propio de la pestaña.
    await page.evaluate(() => {
      const raiz = document.querySelector("[data-testid='servicios']");
      if (!raiz) return;
      raiz.style.height = "auto";
      raiz.querySelectorAll(".overflow-y-auto").forEach((n) => Object.assign(n.style, { overflow: "visible", flex: "none" }));
      for (let n = raiz.parentElement; n && n !== document.body; n = n.parentElement) Object.assign(n.style, { height: "auto", maxHeight: "none", overflowY: "visible" });
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${base}-entera.png`, fullPage: true });
    if (sinMock.size) console.log(`${v.nombre}/${p.tab}: sin mock →`, [...sinMock].join(", "));
    await context.close();
  }
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
