// Capturas de Super Admin › Informes con el Supabase falso de esta carpeta: nada sale a Supabase ni a Internet.
// Datos sintéticos: el resumen mensual de auditoría (RPC informe_auditoria_mensual) con varias personas, horas y acciones
// delicadas, y los costes del mes de Servicios (servicios de datos-sinteticos.mjs y la IA por función).
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/informes.capturas.mjs [carpeta-de-capturas]
//
// Saca móvil (375×812) y escritorio (1280×800): la lista, el informe mensual de auditoría y el de costes; avisa si algo
// se desborda en horizontal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-informes";

const PERSONAS = [
  ["SIM María del Carmen Fernández de la Vega Álvarez", 182, 19], ["SIM José Luis Rodríguez (taller)", 96, 14], ["SIM Ana (presupuestos)", 41, 9],
  ["SIM Pedro Sánchez Gómez de las Heras y Mendoza", 12, 3], ["SIM Lucía Ortega", 4, 1],
];
const auditoria = ({ p_mes }) => {
  const dias = Array.from({ length: 28 }, (_, i) => `${p_mes}-${String(i + 1).padStart(2, "0")}`);
  const cuando = (d, h) => `${p_mes}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:15:00Z`;
  return {
    usuarios: PERSONAS.map(([quien, acciones, dias], i) => ({
      quien, acciones, dias, ultima: cuando(20 - i, 9 + i), borrados: i === 0 ? 3 : 0, precios: 0,
      secciones: [{ tabla: "peticiones", n: Math.ceil(acciones / 2) }, { tabla: "user_permissions", n: Math.floor(acciones / 3) }, { tabla: "notificaciones_dashboard", n: 2 }].slice(0, 3 - (i % 3)),
    })),
    por_dia: dias.map((dia, i) => ({ dia, n: i % 7 >= 5 ? 0 : 6 + ((i * 5) % 13) })),
    por_hora: [8, 9, 10, 11, 12, 13, 16, 17, 18].map((hora, i) => ({ hora, n: 10 + ((i * 7) % 25) })),
    delicadas_total: 4,
    delicadas: [
      { created_at: cuando(3, 9), actor_label: PERSONAS[0][0], accion: "DELETE", tabla: "peticiones", tipo_evento: "cambio", det: { antes: { nombre: "SIM Petición repetida sobre espejos a medida" } } },
      { created_at: cuando(5, 10), actor_label: PERSONAS[0][0], accion: "UPDATE", tabla: "user_permissions", tipo_evento: "cambio", det: { antes: { section_key: "usuarios", can_edit: "false" }, despues: { section_key: "usuarios", can_edit: "true" } } },
      { created_at: cuando(11, 12), actor_label: PERSONAS[1][0], accion: "UPDATE", tabla: "user_roles", tipo_evento: "cambio", det: { antes: { role: "user" }, despues: { role: "admin" } } },
      { created_at: cuando(18, 17), actor_label: PERSONAS[0][0], accion: "DELETE", tabla: "notificaciones_dashboard", tipo_evento: "cambio", det: {} },
    ],
    sistema: [
      { actor_label: "sistema:pg_cron", tabla: "notificaciones_dashboard", accion: "INSERT", n: 42 },
      { actor_label: "funcion:analizar-peticion", tabla: "peticiones", accion: "UPDATE", n: 18 },
    ],
    sistema_total: 60,
    accesos_fallidos: 2,
  };
};
const uso = (importe, moneda = "USD") => ({ importe, moneda, periodo: "mes en curso", origen: "api" });
const resumenMes = () => [
  { proveedor: "openai", lecturas: 300, coste_variable: uso(12.4) }, { proveedor: "stripe", lecturas: 300, coste_variable: uso(2.1, "EUR") },
  { proveedor: "correo", lecturas: 0, manual_importe: 14.99, manual_moneda: "EUR", manual_nota: "SIM Factura dominio 2026-118" },
];
const filaIa = (funcion, que_hace, accion, unidad, orden, llamadas, usos, coste, mediana) => ({
  funcion, que_hace, accion, unidad, orden, llamadas, usos, usos_con_coste: usos, coste_usd: coste, filas_sin_tarifa: 0, modelos_sin_tarifa: [],
  mediana_usd: mediana, media_usd: mediana, servidor_propio: false,
});
const costePorUso = () => [
  filaIa("analizar-peticion", "Analiza una petición de mejora del panel y propone cómo hacerla.", "Analizar una petición de mejora", "petición", 97, 64, 58, 0.412, 0.0068),
  filaIa("ia-modelos-openai", "Prueba los modelos de IA (botón «Probar» de Servicios › Modelos).", "Probar un modelo", "prueba", 98, 12, 12, 0.019, 0.0015),
];
const rpc = { ...rpcSinteticas, informe_auditoria_mensual: auditoria, servicios_resumen_mes: resumenMes, ia_coste_por_uso: costePorUso };

const VISTAS = [
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
];
const PANTALLAS = [
  { nombre: "lista", ruta: "/super-admin/informes", espera: "nav[aria-label='Informes disponibles']" },
  { nombre: "auditoria-mensual", ruta: "/super-admin/informes?informe=auditoria-mensual", espera: "[data-testid='diapositiva-2']" },
  { nombre: "servicios-mensual", ruta: "/super-admin/informes?informe=servicios-mensual", espera: "[data-testid='diapositiva-2']" },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
  for (const p of PANTALLAS) {
    const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc, funciones: funcionesSinteticas });
    const page = await context.newPage();
    await page.goto(`${BASE}${p.ruta}`);
    await page.locator(p.espera).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(900);
    const base = path.join(SALIDA, `${v.nombre}-${p.nombre}`);
    await page.screenshot({ path: `${base}.png` });
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (ancho > visible) console.log(`${v.nombre} ${p.nombre}: la página se desborda en horizontal (${ancho} px de ${visible})`);
    if (sinMock.size) console.log(`${v.nombre} ${p.nombre}: sin mock →`, [...sinMock].join(", "));
    await context.close();
  }
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
