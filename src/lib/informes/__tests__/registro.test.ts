import { describe, expect, it, vi } from "vitest";
import { SECTIONS } from "@/hooks/useUserRole";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { INFORMES, SECCIONES_INFORME, buscarInforme, informesPorSeccion, puedeVerInforme, type DefinicionInforme } from "../registro";

const sinPermisos = { esSuperAdmin: false, permisos: [] };
const permiso = (section_key: string, can_view: boolean, can_edit = false) => ({ section_key, can_view, can_edit });

// Un informe de sección inventado: el registro de hoy solo tiene informes del Super Admin,
// pero la regla de permisos por sección (como `useCanAccessSection`) tiene que seguir valiendo.
const informeDeSeccion = (nivel: "view" | "edit"): DefinicionInforme => ({
  ...INFORMES[0],
  id: `usuarios-${nivel}`,
  permiso: { tipo: "seccion", seccion: "usuarios", nivel },
});

describe("registro de informes", () => {
  it("ids únicos y con forma de URL; cada sección y cada permiso existen", () => {
    const ids = INFORMES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INFORMES) {
      expect(i.id).toMatch(/^[a-z0-9-]+$/);
      expect(SECCIONES_INFORME.some((s) => s.id === i.seccion)).toBe(true);
      if (i.permiso.tipo === "seccion") expect(SECTIONS.some((s) => s.key === (i.permiso as { seccion: string }).seccion)).toBe(true);
      expect(i.formatos.length).toBeGreaterThan(0);
    }
  });

  it("están los informes del panel: costes de Servicios y auditoría, cada uno en su sección", () => {
    expect(INFORMES.map((i) => [i.id, i.seccion])).toEqual([
      ["servicios-mensual", "servicios"],
      ["auditoria-mensual", "auditoria"],
    ]);
    expect(SECCIONES_INFORME.map((s) => s.id)).toEqual(["servicios", "auditoria"]);
  });

  it("ya no queda ningún informe del restaurante (tráfico web, RRSS, facturas, cheques, carta…)", () => {
    const ids = INFORMES.map((i) => i.id).join(" ");
    expect(ids).not.toMatch(/trafico|rrss|facturas|cheques|carta|vino/);
  });

  it("cada sección del registro tiene al menos un informe (no salen grupos vacíos)", () => {
    for (const s of SECCIONES_INFORME) expect(INFORMES.some((i) => i.seccion === s.id)).toBe(true);
  });

  it("un super admin los ve todos, agrupados en el orden de las secciones", () => {
    const grupos = informesPorSeccion({ esSuperAdmin: true, permisos: [] });
    expect(grupos.flatMap((g) => g.informes)).toHaveLength(INFORMES.length);
    expect(grupos.map((g) => g.seccion.titulo)).toEqual(["Servicios", "Seguridad"]);
  });

  it("los informes del Super Admin no salen con ningún permiso de sección", () => {
    expect(informesPorSeccion(sinPermisos)).toEqual([]);
    const todo = { esSuperAdmin: false, permisos: SECTIONS.map((s) => permiso(s.key, true, true)) };
    expect(informesPorSeccion(todo)).toEqual([]);
    for (const i of INFORMES) expect(puedeVerInforme(i, todo)).toBe(false);
  });

  it("un informe de sección sale a quien tiene permiso; «Editar» implica «Ver»", () => {
    const ver = informeDeSeccion("view");
    const editar = informeDeSeccion("edit");
    expect(puedeVerInforme(ver, sinPermisos)).toBe(false);
    expect(puedeVerInforme(ver, { esSuperAdmin: false, permisos: [permiso("usuarios", true)] })).toBe(true);
    expect(puedeVerInforme(ver, { esSuperAdmin: false, permisos: [permiso("usuarios", false, true)] })).toBe(true);
    expect(puedeVerInforme(ver, { esSuperAdmin: false, permisos: [permiso("dashboard", true, true)] })).toBe(false);
    expect(puedeVerInforme(editar, { esSuperAdmin: false, permisos: [permiso("usuarios", true)] })).toBe(false);
    expect(puedeVerInforme(editar, { esSuperAdmin: false, permisos: [permiso("usuarios", true, true)] })).toBe(true);
    expect(puedeVerInforme(editar, { esSuperAdmin: true, permisos: [] })).toBe(true);
    // Con la lista dada, se agrupa en su sección.
    const grupos = informesPorSeccion({ esSuperAdmin: false, permisos: [permiso("usuarios", true)] }, [...INFORMES, ver, editar]);
    expect(grupos.flatMap((g) => g.informes.map((i) => i.id))).toEqual(["usuarios-view"]);
  });

  it("buscarInforme solo encuentra los de la lista dada", () => {
    const lista: DefinicionInforme[] = [INFORMES[0]];
    expect(buscarInforme(INFORMES[0].id, lista)).toBe(INFORMES[0]);
    expect(buscarInforme("auditoria-mensual", lista)).toBeNull();
    expect(buscarInforme("auditoria-mensual")).toBe(INFORMES[1]);
    expect(buscarInforme("trafico-web-mensual")).toBeNull();
    expect(buscarInforme(null)).toBeNull();
  });
});
