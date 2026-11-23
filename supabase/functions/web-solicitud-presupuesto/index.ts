// web-solicitud-presupuesto: solicitudes de presupuesto de la calculadora de la web (pública, verify_jwt = false).
// La lógica y la validación están en ./solicitud.ts; aquí solo el cliente con el service role. Las escrituras van
// con la cabecera x-audit-source (la auditoría del panel las identifica como «API · service_role ·
// web-solicitud-presupuesto») y sin la IP: solo su huella, para el límite por hora.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { ipCliente } from "../_shared/ip-cliente.ts";
import { manejarSolicitud, type ResultadoRegistro } from "./solicitud.ts";

const FUENTE = "web-solicitud-presupuesto";

Deno.serve((req: Request) => {
  const claveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return manejarSolicitud(req, {
    ip: ipCliente,
    sal: claveServicio,
    async registrar(ipHash, datos, maxHora): Promise<ResultadoRegistro> {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, claveServicio, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            "x-audit-source": FUENTE,
            "x-audit-request-id": crypto.randomUUID(),
            "x-audit-user-agent": req.headers.get("user-agent")?.slice(0, 1024) ?? "",
          },
        },
      });
      const { data, error } = await admin.rpc("web_solicitud_presupuesto_registrar", {
        p_ip_hash: ipHash,
        p_datos: datos,
        p_max_hora: maxHora,
      });
      if (error) throw new Error(error.message);
      const r = data as { ok?: boolean; numero?: string; motivo?: string } | null;
      if (r?.ok && typeof r.numero === "string") return { ok: true, numero: r.numero };
      if (r?.ok === false && r.motivo === "limite") return { ok: false, motivo: "limite" };
      throw new Error("Respuesta inesperada de web_solicitud_presupuesto_registrar");
    },
  });
});
