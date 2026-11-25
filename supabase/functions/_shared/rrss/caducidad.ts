// ============================================================================
//  RRSS · caducidad de la conexión con Meta, en llano
// ----------------------------------------------------------------------------
//  Con el botón «Conectar con Facebook» el panel guarda un token de página (no
//  caduca) y el del usuario (60 días); además Meta corta el acceso a los datos a
//  los 90 días si nadie vuelve a conectar. Con un token de usuario del sistema
//  (secretos) no caduca nada. Lo usan el panel (aviso en Conexión) y
//  rrss-programador (aviso en la campana). Código puro, sin Deno.
// ============================================================================

export type NivelCaducidad = "ok" | "aviso" | "caducado" | "sin_dato";

export interface DatosCaducidad {
  /** Caducidad del token que se usa (null = no caduca). */
  tokenCaducaEn: string | null;
  /** Acceso a los datos (90 días desde la última conexión). */
  accesoDatosCaducaEn: string | null;
}

export interface EstadoCaducidad {
  nivel: NivelCaducidad;
  /** Días que quedan para lo primero que caduca (null si nada caduca). */
  dias: number | null;
  /** Fecha (ISO) de lo primero que caduca. */
  fecha: string | null;
  texto: string;
}

/** A partir de cuántos días antes se avisa. */
export const DIAS_AVISO_CADUCIDAD = 14;

const DIA = 86_400_000;

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
}

export function estadoCaducidad(d: DatosCaducidad, ahora: number = Date.now()): EstadoCaducidad {
  const fechas = [d.tokenCaducaEn, d.accesoDatosCaducaEn]
    .filter((f): f is string => typeof f === "string" && Number.isFinite(Date.parse(f)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (fechas.length === 0) return { nivel: "ok", dias: null, fecha: null, texto: "La conexión no caduca." };
  const primera = fechas[0];
  const dias = Math.floor((Date.parse(primera) - ahora) / DIA);
  const queCaduca = primera === d.accesoDatosCaducaEn ? "El acceso de la app a la cuenta" : "El token de la conexión";
  if (Date.parse(primera) <= ahora) {
    return { nivel: "caducado", dias, fecha: primera, texto: `${queCaduca} caducó el ${fechaCorta(primera)}. Pulsa «Renovar conexión».` };
  }
  if (dias <= DIAS_AVISO_CADUCIDAD) {
    const cuando = dias <= 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;
    return { nivel: "aviso", dias, fecha: primera, texto: `${queCaduca} caduca ${cuando} (${fechaCorta(primera)}). Pulsa «Renovar conexión» antes.` };
  }
  return { nivel: "ok", dias, fecha: primera, texto: `${queCaduca} caduca el ${fechaCorta(primera)} (quedan ${dias} días).` };
}
