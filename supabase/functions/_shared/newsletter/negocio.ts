// ============================================================================
// Datos del negocio para el pie de los correos (RGPD) — código PURO
// ----------------------------------------------------------------------------
// El pie de cada correo dice quién es el responsable y cómo contactar: sale del
// bloque «negocio» de web_contenido (el que se edita en Web › Contenido del
// panel y lee la web), con el nombre del negocio de src/config/negocio.ts como
// respaldo. Aquí no se escriben direcciones, teléfonos ni correos: si el bloque
// no los tiene, el pie lleva solo el nombre y la web.
// ============================================================================

/** El nombre de src/config/negocio.ts (NEGOCIO.nombre). «Baix Vinalopó» nunca se separa de «Cristalería». */
export const NOMBRE_NEGOCIO = "Cristalería Baix Vinalopó";

export interface DatosNegocio {
  nombre: string;
  /** «C/ …, 03330 Crevillente (Alicante)» o null. */
  direccion: string | null;
  telefono: { display: string; tel: string } | null;
  email: string | null;
  /** Web pública (sin barra final). */
  web: string;
}

const cadena = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\r\n\t]+/g, " ").trim();
  return t && t.length <= max ? t : null;
};

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Mezcla el bloque «negocio» de web_contenido (puede faltar o estar a medias) sobre los valores de respaldo. */
export function negocioDesdeContenido(valor: unknown, web: string): DatosNegocio {
  const v = (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {}) as Record<string, unknown>;
  const dir = (v.address && typeof v.address === "object" ? v.address : {}) as Record<string, unknown>;
  const calle = cadena(dir.street, 120);
  const cp = cadena(dir.postalCode, 12);
  const ciudad = cadena(dir.city, 80);
  const provincia = cadena(dir.province, 80);
  const lugar = [cp, ciudad].filter(Boolean).join(" ");
  const direccion = calle || lugar ? [calle, lugar ? `${lugar}${provincia ? ` (${provincia})` : ""}` : null].filter(Boolean).join(", ") : null;
  const telefonos = Array.isArray(v.phones) ? v.phones : [];
  const primero = (telefonos[0] && typeof telefonos[0] === "object" ? telefonos[0] : {}) as Record<string, unknown>;
  const display = cadena(primero.display, 30);
  const tel = cadena(primero.tel, 20);
  const email = cadena(v.email, 254);
  return {
    nombre: cadena(v.name, 80) ?? NOMBRE_NEGOCIO,
    direccion,
    telefono: display && tel && /^\+?[0-9 ]{6,20}$/.test(tel) ? { display, tel: tel.replace(/ /g, "") } : null,
    email: email && EMAIL.test(email) ? email : null,
    web: web.replace(/\/+$/, ""),
  };
}

/** Los mismos datos solo con el nombre y la web (vista previa sin conexión, pruebas). */
export function negocioPorDefecto(web: string): DatosNegocio {
  return negocioDesdeContenido(null, web);
}
