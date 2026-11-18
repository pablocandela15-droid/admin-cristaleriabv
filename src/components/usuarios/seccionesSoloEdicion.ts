/**
 * Secciones en las que «Ver» no sirve por sí solo: sin «Puede editar» no se entra (06/11/2026).
 *
 * En Usuarios esas filas solo ofrecen el interruptor de «Puede editar», que activa los dos a la vez
 * (editar implica ver), y al quitarlo se quitan los dos. Los visores de permisos la enseñan igual:
 * «Ver» = «Editar». Hoy no hay ninguna; si una sección nueva lo necesita, se añade aquí.
 */
export const SECCIONES_SOLO_EDICION: ReadonlySet<string> = new Set<string>([]);

/** ¿En esta sección «Ver» va con «Puede editar» (no hay interruptor propio de «Ver»)? */
export const esSeccionSoloEdicion = (sectionKey: string): boolean => SECCIONES_SOLO_EDICION.has(sectionKey);
