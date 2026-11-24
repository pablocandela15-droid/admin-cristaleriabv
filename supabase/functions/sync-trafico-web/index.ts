// ============================================================================
// SYNC-TRAFICO-WEB — Edge Function (Tráfico web)
// ============================================================================
// Copia cada noche las visitas de la web de la cristalería (proyecto
// `cristaleriabv` de Vercel) desde Vercel Web Analytics a trafico_web_diario /
// trafico_web_desglose. La llama pg_cron a las 03:30 UTC (trafico_web_disparar,
// migración 20261124110000_trafico_web.sql) con la cabecera x-ocr-secret leída
// de Vault (ocr_trabajos_secret, el secreto de todas las tareas del panel).
//
//   POST /functions/v1/sync-trafico-web   body ignorado
//     200 todo OK · 207 un proyecto falló · 502 fallaron todos
//     401 cabecera ausente/incorrecta · 500 falta OCR_TRABAJOS_SECRET (fail closed)
//     503 falta VERCEL_ANALYTICS_TOKEN (lo apunta en trafico_web_sync_estado y la pantalla lo dice)
//     405 método distinto de POST
//
// verify_jwt = false (config.toml): la llama pg_net sin usuario. La
// autenticación real es x-ocr-secret == OCR_TRABAJOS_SECRET, comparada en
// tiempo constante y FALLANDO CERRADO si falta.
//
// Secretos (Deno.env):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (los pone la plataforma)
//   OCR_TRABAJOS_SECRET      el de las tareas (mismo valor que Vault ocr_trabajos_secret)
//   VERCEL_ANALYTICS_TOKEN   token PERSONAL de Vercel con acceso al equipo de la web. Nunca sale al cliente.
//   VERCEL_ANALYTICS_PROJECT opcional: id (prj_…) o nombre del proyecto (por defecto cristaleriabv)
//   VERCEL_ANALYTICS_TEAM    opcional: id (team_…) o slug del equipo (por defecto pablo1505; si no, SERVICIOS_VERCEL_TEAM_ID)
//
// Lógica en sync.ts (rango, fusión, estado, aviso) y contrato de la API en
// vercel.ts. Puesta en marcha: docs/TRAFICO-WEB.md.
// ============================================================================

import { createClient as createClientBase, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { crearClienteVercel } from "./vercel.ts";
import {
  PRIMER_DIA,
  procesarPeticion,
  proyectosDeEnv,
  TITULO_AVISO_PREFIJO,
  type FilaDesglose,
  type FilaDiario,
  type Repositorio,
} from "./sync.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "sync-trafico-web");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("OCR_TRABAJOS_SECRET") ?? "";
const VERCEL_TOKEN = Deno.env.get("VERCEL_ANALYTICS_TOKEN") ?? "";
const VERCEL_EQUIPO = Deno.env.get("VERCEL_ANALYTICS_TEAM")?.trim() || Deno.env.get("SERVICIOS_VERCEL_TEAM_ID")?.trim() || undefined;
const PROYECTOS = proyectosDeEnv((n) => Deno.env.get(n));

const TAMANO_LOTE_UPSERT = 500;

function crearRepositorio(supabase: SupabaseClient): Repositorio {
  async function upsertEnLotes(tabla: string, filas: unknown[], onConflict: string) {
    for (let i = 0; i < filas.length; i += TAMANO_LOTE_UPSERT) {
      const { error } = await supabase
        .from(tabla)
        .upsert(filas.slice(i, i + TAMANO_LOTE_UPSERT), { onConflict });
      if (error) throw new Error(`upsert ${tabla}: ${error.message}`);
    }
  }

  return {
    async leerEstado(proyecto) {
      const { data, error } = await supabase
        .from("trafico_web_sync_estado")
        .select("ultimo_ok_en, fallos_consecutivos, datos_desde")
        .eq("proyecto", proyecto)
        .maybeSingle();
      if (error) throw new Error(`leer trafico_web_sync_estado: ${error.message}`);
      return data
        ? {
            ultimo_ok_en: (data.ultimo_ok_en as string | null) ?? null,
            fallos_consecutivos: Number(data.fallos_consecutivos) || 0,
            datos_desde: (data.datos_desde as string | null) ?? null,
          }
        : null;
    },
    upsertDiario: (filas: FilaDiario[]) => upsertEnLotes("trafico_web_diario", filas, "fecha,proyecto,ruta"),
    upsertDesglose: (filas: FilaDesglose[]) =>
      upsertEnLotes("trafico_web_desglose", filas, "fecha,proyecto,dimension,valor"),
    async guardarEstado(fila) {
      // En fallo no se manda ultimo_ok_en ni dias_ultimo_sync: el upsert solo
      // toca las columnas presentes y conserva el último éxito.
      const { error } = await supabase.from("trafico_web_sync_estado").upsert(fila, { onConflict: "proyecto" });
      if (error) throw new Error(`guardar trafico_web_sync_estado: ${error.message}`);
    },
    async existeAvisoDesde(desdeIso) {
      const { data, error } = await supabase
        .from("notificaciones_dashboard")
        .select("id")
        .eq("tipo", "sistema")
        .like("titulo", `${TITULO_AVISO_PREFIJO}%`)
        .gte("created_at", desdeIso)
        .limit(1);
      if (error) throw new Error(`leer notificaciones_dashboard: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
    async crearAviso({ titulo, mensaje }) {
      const { error } = await supabase.from("notificaciones_dashboard").insert({
        tipo: "sistema",
        origen: null, // el CHECK de origen admite NULL; no se toca el constraint
        prioridad: "normal",
        titulo,
        mensaje,
      });
      if (error) throw new Error(`insertar notificaciones_dashboard: ${error.message}`);
    },
  };
}

Deno.serve(conAuditoriaDePeticion("sync-trafico-web", createClientBase, (req) =>
  procesarPeticion(req, {
    secreto: CRON_SECRET,
    token: VERCEL_TOKEN,
    proyectos: PROYECTOS,
    crearDependencias: (token) => ({
      vercel: crearClienteVercel({ token, teamId: VERCEL_EQUIPO }),
      repo: crearRepositorio(createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })),
      ahora: () => new Date(),
      log: (m) => console.log(m),
      primerDia: PRIMER_DIA,
    }),
  }).catch((e) => {
    console.error("[sync-trafico-web] error no controlado:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }))
);
