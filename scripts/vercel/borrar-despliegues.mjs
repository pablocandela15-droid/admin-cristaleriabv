// Borra los despliegues de Vercel creados ANTES de una fecha (00:00 hora de
// Madrid) en admin-cristaleriabv (panel) y cristaleriabv (web), para liberar
// almacenamiento. Nunca toca el despliegue que está ahora en producción ni el
// último de staging (la demo) de cada proyecto. Lo que se borra ya no sirve para «Instant Rollback».
//
//   VERCEL_TEAM_ID=team_xxx VERCEL_TOKEN=xxx node scripts/vercel/borrar-despliegues.mjs --antes 2026-10-31            → solo lista
//   VERCEL_TEAM_ID=team_xxx VERCEL_TOKEN=xxx node scripts/vercel/borrar-despliegues.mjs --antes 2026-10-31 --borrar   → borra
//
// VERCEL_TEAM_ID es el id del equipo de Vercel de los dos proyectos (Vercel → Settings → General → Team ID;
// el mismo valor que el secreto SERVICIOS_VERCEL_TEAM_ID de las Edge Functions).
//
// En una sesión en la nube, el token puede ir como secreto de red de
// api.vercel.com (el proxy añade la cabecera): entonces VERCEL_TOKEN puede
// faltar y se manda la petición sin Authorization.
//
// Node 18 o superior. Vercel guarda los borrados 30 días por si hay que recuperarlos.
const TOKEN = process.env.VERCEL_TOKEN;
const BORRAR = process.argv.includes("--borrar");
const iAntes = process.argv.indexOf("--antes");
const ANTES = iAntes > 0 ? process.argv[iAntes + 1] : undefined;
if (!ANTES || !/^\d{4}-\d{2}-\d{2}$/.test(ANTES)) {
  console.error("Indica la fecha: --antes AAAA-MM-DD (se borra lo creado antes de ese día, hora de Madrid)");
  process.exit(2);
}
const EQUIPO = process.env.VERCEL_TEAM_ID;
if (!EQUIPO) {
  console.error("Indica el equipo de Vercel: VERCEL_TEAM_ID=team_… (Vercel → Settings → General → Team ID)");
  process.exit(2);
}
// Medianoche de Madrid (CET/CEST) del día indicado.
const CORTE = (() => {
  for (const desfase of ["+01:00", "+02:00"]) {
    const t = Date.parse(`${ANTES}T00:00:00${desfase}`);
    const h = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(t);
    if (h === "00") return t;
  }
  throw new Error("Fecha no válida");
})();
// Por nombre: la API de Vercel acepta el nombre del proyecto en /v9/projects/<nombre> y devuelve su id.
const PROYECTOS = ["admin-cristaleriabv", "cristaleriabv"];
const api = async (ruta, metodo = "GET") => {
  for (let intento = 0; ; intento++) {
    const res = await fetch(`https://api.vercel.com${ruta}${ruta.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(EQUIPO)}`, {
      method: metodo,
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    if (res.status === 429 && intento < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (intento + 1)));
      continue;
    }
    const cuerpo = await res.json().catch(() => ({}));
    if (res.status === 403 && cuerpo?.error?.missingToken) throw new Error("Falta el token de Vercel (VERCEL_TOKEN o secreto de red de api.vercel.com)");
    if (!res.ok) throw new Error(`${metodo} ${ruta}: ${res.status} ${JSON.stringify(cuerpo).slice(0, 200)}`);
    return cuerpo;
  }
};

let total = 0;
for (const nombre of PROYECTOS) {
  const proyecto = await api(`/v9/projects/${encodeURIComponent(nombre)}`);
  const id = proyecto.id;
  if (!id) throw new Error(`${nombre}: Vercel no devuelve el id del proyecto; no se borra nada`);
  const enProduccion = proyecto.targets?.production?.id;
  if (!enProduccion) throw new Error(`${nombre}: no se sabe cuál es el despliegue de producción; no se borra nada`);
  // La demo: el último despliegue de staging que llegó a READY.
  const recientes = await api(`/v6/deployments?projectId=${id}&state=READY&limit=100`);
  const enDemo = (recientes.deployments ?? []).find((d) => d.meta?.githubCommitRef === "staging")?.uid;
  const protegidos = new Set([enProduccion, enDemo].filter(Boolean));
  const lista = [];
  const vistos = new Set();
  let hasta = CORTE;
  for (;;) {
    const pagina = await api(`/v6/deployments?projectId=${id}&until=${hasta}&limit=100`);
    for (const d of pagina.deployments ?? []) {
      if (d.created >= CORTE) continue;
      if (protegidos.has(d.uid)) continue; // producción y demo actuales: nunca
      if (["BUILDING", "QUEUED", "INITIALIZING"].includes(d.state)) continue;
      if (vistos.has(d.uid)) continue;
      vistos.add(d.uid);
      lista.push(d);
    }
    if (!pagina.pagination?.next) break;
    hasta = pagina.pagination.next;
  }
  console.log(`\n${nombre}: ${lista.length} despliegues anteriores al ${ANTES} (se conservan producción ${enProduccion} y demo ${enDemo ?? "—"})`);
  for (const d of lista) {
    const linea = `  ${new Date(d.created).toISOString().slice(0, 16)}  ${d.target ?? "preview"}  ${d.meta?.githubCommitRef ?? "-"}  ${d.url}`;
    if (!BORRAR) {
      console.log(linea);
      continue;
    }
    await api(`/v13/deployments/${d.uid}`, "DELETE");
    console.log(`${linea}  → BORRADO`);
  }
  total += lista.length;
}
console.log(BORRAR ? `\nBorrados ${total}.` : `\nModo prueba: no se ha borrado nada (${total} en total). Repite con --borrar.`);
