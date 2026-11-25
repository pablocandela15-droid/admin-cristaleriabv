// ============================================================================
// RRSS-PROGRAMADOR — publica lo programado, termina lo que Meta procesaba y hace el mantenimiento
// ============================================================================
// verify_jwt = false: la llama pg_cron (rrss_disparar) sin JWT. Autenticación:
// x-ocr-secret = OCR_TRABAJOS_SECRET (tiempo constante, falla cerrado) o la
// service role. La lógica está en programador.ts. Secretos: los de Meta (ver
// rrss-conexion) y, opcional, RRSS_DIAS_FICHEROS (30). Ver docs/RRSS.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { esServiceRole } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { ClienteGraph } from "../_shared/rrss/cliente.ts";
import { configMeta } from "../_shared/rrss/config.ts";
import { CORS, json, leerCuerpo } from "../_shared/rrss/http.ts";
import { crearRepositorio } from "../_shared/rrss/repositorio.ts";
import { registro } from "../_shared/rrss/secretos.ts";
import { diasFicheros, ETIQUETA, mantenimiento, pasadaProgramador } from "./programador.ts";

const createClient = clienteConAuditoria(createClientBase, "rrss-programador");

Deno.serve(conAuditoriaDePeticion("rrss-programador", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  // pg_cron con x-ocr-secret (falla cerrado sin el secreto) o la service role.
  const secreto = Deno.env.get("OCR_TRABAJOS_SECRET") ?? "";
  const cabecera = req.headers.get("x-ocr-secret") ?? "";
  const porCron = Boolean(secreto) && Boolean(cabecera) && compararTiempoConstante(cabecera, secreto);
  if (!porCron && !esServiceRole(req)) {
    if (!secreto) registro("error", ETIQUETA, "OCR_TRABAJOS_SECRET no configurado: llamada rechazada (falla cerrado)");
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const cuerpo = await leerCuerpo(req);
  if (cuerpo === null) return json({ ok: false, error: "Cuerpo de la petición no válido" }, 400);
  const accion = cuerpo.accion ?? "programar";
  if (accion !== "programar" && accion !== "mantenimiento") return json({ ok: false, error: "accion no válida (programar | mantenimiento)" }, 400);

  const env = (n: string) => Deno.env.get(n);
  const config = configMeta(env);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const deps = {
    config,
    repo: crearRepositorio(supabase),
    crearCliente: (token: string, limite: number) => new ClienteGraph({ token, versionApi: config.versionApi, limite, registro: (l: string) => registro("info", ETIQUETA, l) }),
    ahora: Date.now,
    diasFicheros: diasFicheros(Deno.env.get("RRSS_DIAS_FICHEROS")),
  };
  if (accion === "mantenimiento") {
    const r = await mantenimiento(deps);
    registro("info", ETIQUETA, `mantenimiento: ${r.ficherosBorrados} ficheros borrados, conexión ${r.conexion?.nivel ?? "sin conectar"}`);
    return json({ ok: r.avisos.length === 0, accion, ...r });
  }
  const r = await pasadaProgramador(deps);
  registro("info", ETIQUETA, `pasada: ${r.procesadas} procesadas`, r.resultados.map((x) => `${x.red}:${x.resultado}`));
  return json({ ok: true, accion, ...r });
}));
