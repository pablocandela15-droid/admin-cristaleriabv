// Web (/web): una pestaña por sección de permisos. «Ver» enseña la pestaña en solo lectura; «Editar» deja cambiar.
// El super admin, todo (useCanAccessSection ya lo da). En la base, cada escritura pide can_edit_section.

export type PestanaWeb = "fotos" | "tarifas" | "contenido";

export interface PermisoSeccionWeb {
  ver: boolean;
  editar: boolean;
}
export type PermisosWeb = Record<PestanaWeb, PermisoSeccionWeb>;

/** Sección de permisos de cada pestaña. */
export const SECCION_PESTANA_WEB = { fotos: "web_fotos", tarifas: "web_tarifas", contenido: "web_contenido" } as const;

export const PESTANAS_WEB: { valor: PestanaWeb; etiqueta: string }[] = [
  { valor: "fotos", etiqueta: "Fotos" },
  { valor: "tarifas", etiqueta: "Tarifas" },
  { valor: "contenido", etiqueta: "Contenido" },
];

/** Las pestañas que se ven (editar implica ver), en su orden. */
export function pestanasWeb(p: PermisosWeb): PestanaWeb[] {
  return PESTANAS_WEB.map((x) => x.valor).filter((v) => p[v].ver || p[v].editar);
}

/** La pestaña pedida si se puede ver; si no, la primera que sí (o null). */
export function pestanaWebPermitida(pedida: string | null | undefined, p: PermisosWeb): PestanaWeb | null {
  const visibles = pestanasWeb(p);
  return (visibles as string[]).includes(pedida ?? "") ? (pedida as PestanaWeb) : (visibles[0] ?? null);
}
