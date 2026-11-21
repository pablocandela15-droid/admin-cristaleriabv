import { describe, expect, it } from "vitest";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { avisosParaDashboard, puedeVerAviso, seccionDeAviso, sinLeerPorSeccion, type PermisosAvisos } from "@/lib/dashboard/avisosDashboard";

const n = (id: string, tipo: string, extra: Partial<NotificacionDashboard> = {}): NotificacionDashboard => ({
  id,
  tipo,
  titulo: id,
  mensaje: null,
  referencia_id: null,
  referencia_tipo: null,
  leida: false,
  created_at: "2026-11-10T08:00:00Z",
  ...extra,
});

const SUPER: PermisosAvisos = { superAdmin: true };
const EQUIPO: PermisosAvisos = { superAdmin: false };
const AHORA = Date.parse("2026-11-10T12:00:00Z");

describe("Dashboard › Avisos: cada aviso solo a quien ve su sección", () => {
  it("sección de cada aviso", () => {
    expect(seccionDeAviso(n("1", "ia_modelo_nuevo", { referencia_tipo: "ia_modelos" }))).toBe("super_admin");
    expect(seccionDeAviso(n("2", "ia_modelo_retirado"))).toBe("super_admin");
    expect(seccionDeAviso(n("3", "ia_modelo_sin_precio"))).toBe("super_admin");
    expect(seccionDeAviso(n("4", "peticion_urgente"))).toBe("super_admin");
    expect(seccionDeAviso(n("5", "otro", { referencia_tipo: "peticion" }))).toBe("super_admin");
    expect(seccionDeAviso(n("6", "sistema"))).toBe("general");
    expect(seccionDeAviso(n("8", "subida_precio"))).toBe("facturas");
    expect(seccionDeAviso(n("9", "facturas_subida", { referencia_tipo: "facturas_cargar" }))).toBe("facturas");
    // Los tipos del panel del restaurante (si quedara alguno en la tabla) ya no tienen sección propia.
    expect(seccionDeAviso(n("7", "reserva_nueva"))).toBe("general");
  });

  it("los del Super Admin solo los ve un super admin; los generales, cualquiera", () => {
    expect(puedeVerAviso(n("1", "ia_modelo_retirado"), EQUIPO)).toBe(false);
    expect(puedeVerAviso(n("1", "ia_modelo_retirado"), SUPER)).toBe(true);
    expect(puedeVerAviso(n("2", "peticion_urgente", { referencia_tipo: "peticion" }), EQUIPO)).toBe(false);
    expect(puedeVerAviso(n("2", "peticion_urgente", { referencia_tipo: "peticion" }), SUPER)).toBe(true);
    expect(puedeVerAviso(n("3", "sistema"), EQUIPO)).toBe(true);
    expect(puedeVerAviso(n("3", "sistema"), SUPER)).toBe(true);
    // Los de Facturas, solo con la sección (o super admin).
    expect(puedeVerAviso(n("4", "subida_precio"), EQUIPO)).toBe(false);
    expect(puedeVerAviso(n("4", "subida_precio"), { superAdmin: false, facturas: true })).toBe(true);
    expect(puedeVerAviso(n("4", "subida_precio"), SUPER)).toBe(true);
  });

  it("fuera caducados y los que no van a la campana; sin leer primero y, dentro, del más nuevo al más viejo", () => {
    const lista = [
      n("leida-nueva", "sistema", { leida: true, created_at: "2026-11-10T11:00:00Z" }),
      n("vieja", "sistema", { created_at: "2026-11-09T08:00:00Z" }),
      n("nueva", "sistema", { created_at: "2026-11-10T10:00:00Z" }),
      n("caducada", "sistema", { caduca_en: "2026-11-10T09:00:00Z" }),
      n("pequena", "sistema", { datos: { campana: false } }),
      n("sin-permiso", "peticion_urgente", { referencia_tipo: "peticion" }),
    ];
    expect(avisosParaDashboard(lista, EQUIPO, AHORA).map((a) => a.id)).toEqual(["nueva", "vieja", "leida-nueva"]);
    // El super admin ve también el de la petición (sin leer y más nuevo que «vieja»).
    expect(avisosParaDashboard(lista, SUPER, AHORA).map((a) => a.id)).toEqual(["nueva", "sin-permiso", "vieja", "leida-nueva"]);
  });

  it("sin leer por sección, en orden: primero Super Admin y después el resto del panel", () => {
    const lista = [
      n("1", "sistema"),
      n("2", "ia_modelo_nuevo"),
      n("3", "sistema"),
      n("4", "peticion_urgente"),
      n("5", "sistema", { leida: true }),
    ];
    expect(sinLeerPorSeccion(lista)).toEqual([
      { seccion: "super_admin", n: 2 },
      { seccion: "general", n: 2 },
    ]);
    expect(sinLeerPorSeccion([n("1", "sistema", { leida: true })])).toEqual([]);
  });
});
