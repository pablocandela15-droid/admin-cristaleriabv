// ============================================================================
// RRSS-METRICAS — captura diaria (pg_cron) y «Actualizar ahora» de RRSS › Métricas
// ============================================================================
// verify_jwt = false: el cron llama sin JWT. Autenticación: x-ocr-secret =
// OCR_TRABAJOS_SECRET (tiempo constante, falla cerrado), la service role o un
// usuario con «Editar» en RRSS. La lógica está en metricas.ts y capturar.ts.
// El token necesita instagram_manage_insights. Ver docs/RRSS.md.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { esServiceRole, exigirPermiso } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { ClienteGraph } from "../_shared/rrss/cliente.ts";
import { configMeta } from "../_shared/rrss/config.ts";
import { CORS } from "../_shared/rrss/http.ts";
import { crearRepositorio } from "../_shared/rrss/repositorio.ts";
import { registro } from "../_shared/rrss/secretos.ts";
import { manejarMetricas } from "./metricas.ts";

const createClient = clienteConAuditoria(createClientBase, "rrss-metricas");

Deno.serve(conAuditoriaDePeticion("rrss-metricas", createClientBase, (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const env = (n: string) => Deno.env.get(n);
  const config = configMeta(env);
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return manejarMetricas(req, {
    config,
    repo: crearRepositorio(sb),
    almacen: {
      async guardar(tabla, filas, conflicto) {
        for (let i = 0; i < filas.length; i += 100) {
          const { error } = await sb.from(tabla).upsert(filas.slice(i, i + 100), { onConflict: conflicto });
          if (error) throw new Error(`guardar ${tabla}: ${error.message}`);
        }
      },
      async piezasDe(ids) {
        const { data, error } = await sb.from("rrss_piezas").select("id, media_id").in("media_id", ids);
        if (error) throw new Error(`leer las piezas: ${error.message}`);
        return new Map(((data ?? []) as Array<{ id: string; media_id: string }>).map((p) => [p.media_id, p.id]));
      },
    },
    capturas: {
      async ultimaDelPanel() {
        const { data } = await sb.from("rrss_metricas_capturas").select("inicio").eq("origen", "panel").order("inicio", { ascending: false }).limit(1);
        return data?.[0]?.inicio ?? null;
      },
      async empezar(origen, cuentaId) {
        const { data, error } = await sb.from("rrss_metricas_capturas").insert({ origen, cuenta_id: cuentaId }).select("id").single();
        if (error) registro("warn", "rrss-metricas", "no se pudo apuntar la captura", error.message);
        return (data?.id as number) ?? null;
      },
      async terminar(id, r) {
        if (id === null) return;
        await sb.from("rrss_metricas_capturas").update({
          fin: new Date().toISOString(), ok: r.ok, dias: r.dias ?? 0, publicaciones: r.publicaciones ?? 0,
          error_tipo: r.errorTipo ?? null, error: r.error ? r.error.slice(0, 2000) : null, avisos: (r.avisos ?? []).slice(0, 30),
        }).eq("id", id);
      },
    },
    origenServidor(r) {
      const secreto = Deno.env.get("OCR_TRABAJOS_SECRET") ?? "";
      const cabecera = r.headers.get("x-ocr-secret") ?? "";
      if (secreto && cabecera && compararTiempoConstante(cabecera, secreto)) return "cron";
      return esServiceRole(r) ? "servicio" : null;
    },
    autorizar: (r) => exigirPermiso(r, "rrss", "edit", { crearCliente: createClient, corsHeaders: CORS }),
    crearCliente: (token, limite) => new ClienteGraph({ token, versionApi: config.versionApi, limite }),
    ahora: Date.now,
  });
}));
