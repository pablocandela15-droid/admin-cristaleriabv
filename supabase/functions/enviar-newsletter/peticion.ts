// ============================================================================
// enviar-newsletter · lectura de la petición (puro)
// ----------------------------------------------------------------------------
//   { accion: "enviar", newsletter: {…diseño…}, clave: uuid }   envío real a todos los activos
//   { accion: "prueba", newsletter: {…diseño…} }                 solo a quien la pide (y a la dirección de pruebas)
//   { accion: "confirmaciones", ids?: uuid[] }                    correos de confirmación a los pendientes
// El diseño va ANIDADO en `newsletter` y la acción es obligatoria (como la
// prueba de la referencia): una petición a medias nunca cae en un envío real.
// `clave` la genera el panel en cada pulsación de «Enviar»: repetir la misma
// petición (doble clic, reintento de red) no vuelve a enviar.
// ============================================================================

import { validarPayload, type DatosNewsletter } from "../_shared/newsletter/plantillas.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Peticion =
  | { accion: "enviar"; datos: DatosNewsletter; clave: string }
  | { accion: "prueba"; datos: DatosNewsletter }
  | { accion: "confirmaciones"; ids: string[] | null };

export type LecturaPeticion = { ok: true; peticion: Peticion } | { ok: false; error: string };

export function leerPeticion(cuerpo: unknown): LecturaPeticion {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { ok: false, error: "Cuerpo de la petición no válido" };
  const c = cuerpo as Record<string, unknown>;
  if (c.accion === "confirmaciones") {
    if (c.ids === undefined || c.ids === null) return { ok: true, peticion: { accion: "confirmaciones", ids: null } };
    if (!Array.isArray(c.ids) || c.ids.length > 100 || !c.ids.every((i) => typeof i === "string" && UUID.test(i))) {
      return { ok: false, error: "Lista de suscriptores no válida" };
    }
    return { ok: true, peticion: { accion: "confirmaciones", ids: c.ids as string[] } };
  }
  if (c.accion !== "enviar" && c.accion !== "prueba") return { ok: false, error: "Acción no válida (enviar | prueba | confirmaciones)" };
  const v = validarPayload(c.newsletter);
  if (!v.ok) return { ok: false, error: v.error };
  if (c.accion === "prueba") return { ok: true, peticion: { accion: "prueba", datos: v.datos } };
  if (typeof c.clave !== "string" || !UUID.test(c.clave)) return { ok: false, error: "Falta la clave del envío" };
  return { ok: true, peticion: { accion: "enviar", datos: v.datos, clave: c.clave.toLowerCase() } };
}

/** El diseño que se guarda en el historial (newsletter_envios.diseno), para volver a abrirlo. */
export function disenoParaHistorial(d: DatosNewsletter): Record<string, unknown> {
  return {
    tipo: d.tipo,
    titulo: d.titulo,
    insignia: d.insignia ?? "",
    preheader: d.preheader ?? "",
    ...(d.bloques?.length ? { bloques: d.bloques } : { mensaje: d.mensaje }),
  };
}
