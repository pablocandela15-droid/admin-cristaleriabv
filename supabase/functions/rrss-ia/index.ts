// ============================================================================
// RRSS-IA — textos y hashtags, ideas, campañas y «aprender de lo publicado»
// ============================================================================
// Solo propone (ver ia.ts). JWT de usuario + «Editar» en RRSS. Lo que lee (estilo,
// fechas, métricas, «qué funciona») y escribe (tope diario, campañas) va con el
// JWT del usuario: manda la RLS. Las fotos que ve la IA, con URL firmadas de
// pocos minutos. Secreto: OPENAI_API_KEY (el general). Opcional: RRSS_IA_MODEL.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirPermiso, tokenBearer } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { configModeloFuncion } from "../_shared/modelo-funcion.ts";
import { registrarUso } from "../_shared/registrar-uso-ia.ts";
import { negocioDesdeContenido } from "../_shared/newsletter/negocio.ts";
import { CORS } from "../_shared/rrss/http.ts";
import { errorReserva, FUNCION, manejarIA, MODELO_POR_DEFECTO, type EstiloIA } from "./ia.ts";

const createClient = clienteConAuditoria(createClientBase, "rrss-ia");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const servicio = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(conAuditoriaDePeticion("rrss-ia", createClientBase, (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${tokenBearer(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return manejarIA(req, {
    clave: claveOpenAI("otros"),
    autorizar: (r) => exigirPermiso(r, "rrss", "edit", { crearCliente: createClient, corsHeaders: CORS }),
    modelo: async () => (await configModeloFuncion(FUNCION, (Deno.env.get("RRSS_IA_MODEL") ?? "").trim() || MODELO_POR_DEFECTO, { cliente: servicio })).modelo,
    async reservar(accion, modelo) {
      const { data, error, status } = await comoUsuario.from("rrss_ia_peticiones").insert({ accion, modelo }).select("id").single();
      if (error) throw errorReserva(status ?? 0, `${error.code ?? ""} ${error.message ?? ""}`);
      return (data?.id as number) ?? null;
    },
    async marcar(id, ok) {
      if (id !== null) await comoUsuario.from("rrss_ia_peticiones").update({ ok }).eq("id", id);
    },
    async contexto() {
      const [a, n, qf, g] = await Promise.all([
        comoUsuario.from("rrss_ajustes").select("zona, tono, guia, hashtags_base, ctas, palabras_evitar, emojis").eq("id", 1).maybeSingle(),
        servicio.from("web_contenido").select("valor").eq("clave", "negocio").maybeSingle(),
        comoUsuario.rpc("rrss_que_funciona", { p_dias: 90, p_minimo: 3 }),
        comoUsuario.from("rrss_piezas").select("caption").neq("caption", "").order("created_at", { ascending: false }).limit(15),
      ]);
      const estilo = (a.data ?? {}) as Partial<EstiloIA>;
      const negocio = negocioDesdeContenido(n.error ? null : n.data?.valor, "https://cristaleriabv.vercel.app");
      const municipio = (n.data?.valor as { address?: { city?: string } } | null)?.address?.city ?? null;
      return {
        estilo: {
          zona: estilo.zona ?? "Elche y el Baix Vinalopó", tono: (estilo.tono as EstiloIA["tono"]) ?? "cercano", guia: estilo.guia ?? "",
          hashtags_base: estilo.hashtags_base ?? [], ctas: estilo.ctas ?? [], palabras_evitar: estilo.palabras_evitar ?? [], emojis: estilo.emojis ?? true,
        },
        negocio: { nombre: negocio.nombre, web: negocio.web, municipio: typeof municipio === "string" ? municipio.slice(0, 80) : null },
        queFunciona: qf.error ? null : qf.data,
        ganchosRecientes: ((g.data ?? []) as Array<{ caption: string }>).map((p) => p.caption.split("\n")[0].slice(0, 120)).filter(Boolean),
      };
    },
    async fechasEntre(desde, hasta) {
      const { data } = await comoUsuario.rpc("rrss_fechas_entre", { p_desde: desde, p_hasta: hasta });
      return (data ?? []) as Array<Record<string, unknown>>;
    },
    async publicacionesRecientes() {
      const { data } = await comoUsuario.from("rrss_metricas_publicacion_ultima")
        .select("publicado_at, producto, tipo_medio, caption, alcance, interacciones").eq("red", "instagram")
        .order("publicado_at", { ascending: false }).limit(40);
      return ((data ?? []) as Array<Record<string, unknown>>).map((p) => {
        const alcance = typeof p.alcance === "number" ? p.alcance : null;
        const inter = typeof p.interacciones === "number" ? p.interacciones : null;
        return {
          fecha: typeof p.publicado_at === "string" ? p.publicado_at.slice(0, 10) : null,
          formato: p.producto === "REELS" ? "reel" : p.producto === "STORY" ? "story" : p.tipo_medio === "CAROUSEL_ALBUM" ? "carrusel" : "foto",
          caption: typeof p.caption === "string" ? p.caption.slice(0, 600) : "",
          alcance,
          tasa: alcance && inter !== null ? Math.round((1000 * inter) / alcance) / 10 : null,
        };
      });
    },
    async firmar(rutas) {
      const { data, error } = await servicio.storage.from("rrss").createSignedUrls(rutas, 300);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ signedUrl?: string }>).map((x) => x.signedUrl).filter((u): u is string => Boolean(u));
    },
    async guardarCampana(c) {
      const { data, error } = await comoUsuario.from("rrss_campanas").insert(c).select("id").single();
      if (error) throw new Error(`No se pudo guardar la campaña: ${error.message}`);
      return String(data.id);
    },
    registrar: registrarUso,
  });
}));
