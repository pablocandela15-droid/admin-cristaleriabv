/**
 * Lógica pura de los permisos por sección de la pantalla Usuarios
 * (`src/components/usuarios/permisosSecciones.ts`), compartida por el diálogo
 * «Permisos» (ListaUsuarios), el alta (InvitarUsuario) y los roles
 * preconfigurados (ConfigurarRolesModal).
 *
 * Contexto (2026-10-01): hasta hoy las tres pantallas forzaban `can_edit: false`
 * en cada cambio y al cargar, así que el permiso de EDICIÓN no se podía dar desde
 * el panel y cualquier guardado borraba el que se hubiera puesto por SQL.
 *
 * Hoy el panel solo tiene dos secciones: «Dashboard» («Ver» y «Puede editar», la
 * fila normal) y «Usuarios» (un solo interruptor, «Puede ver»).
 */
import { describe, it, expect } from "vitest";
import {
  AYUDA_EDICION,
  NECESITA_VER,
  SECCIONES_CONFIGURABLES,
  SECCIONES_UN_INTERRUPTOR,
  cambiarEditar,
  cambiarVer,
  interruptorUnico,
  mismosPermisos,
  permisosParaEditar,
  rolAlGuardar,
  rolSegunPermisos,
  seccionesConPermisos,
  sinEdicion,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";

const permiso = (section_key: string, can_view: boolean, can_edit: boolean): PermisoSeccion => ({
  section_key,
  can_view,
  can_edit,
});

const de = (permisos: PermisoSeccion[], clave: string) => permisos.find((p) => p.section_key === clave);

describe("SECCIONES_CONFIGURABLES", () => {
  it("son todas las secciones del panel, «usuarios» incluida (configurable desde el 06/11/2026)", () => {
    expect(SECCIONES_CONFIGURABLES.map((s) => [s.key, s.label])).toEqual([
      ["dashboard", "Dashboard"],
      ["facturas", "Facturas"],
      ["facturas_subida", "Facturas · Subida"],
      ["web_fotos", "Web · Fotos"],
      ["web_tarifas", "Web · Tarifas"],
      ["web_contenido", "Web · Contenido"],
      ["presupuestos", "Presupuestos"],
      ["trafico_web", "Tráfico web"],
      ["newsletter", "Newsletter"],
      ["rrss", "RRSS"],
      ["usuarios", "Usuarios"],
    ]);
  });
});

describe("AYUDA_EDICION", () => {
  it("tiene un texto para cada sección configurable (y ninguno de más)", () => {
    expect(Object.keys(AYUDA_EDICION).sort()).toEqual(SECCIONES_CONFIGURABLES.map((s) => s.key).sort());
    for (const seccion of SECCIONES_CONFIGURABLES) {
      expect(AYUDA_EDICION[seccion.key], seccion.key).toEqual(expect.any(String));
      expect(AYUDA_EDICION[seccion.key].length, seccion.key).toBeGreaterThan(10);
    }
  });

  it("en Dashboard dice que «Editar» no hace nada: con «Ver» se entra", () => {
    expect(AYUDA_EDICION.dashboard).toMatch(/sin efecto/);
    expect(AYUDA_EDICION.dashboard).toMatch(/con «Ver» se entra/);
  });

  it("en Usuarios dice que solo se consulta: gestionar es del super admin", () => {
    expect(AYUDA_EDICION.usuarios).toMatch(/consultar/);
    expect(AYUDA_EDICION.usuarios).toMatch(/solo del super admin/);
  });
});

describe("permisosParaEditar", () => {
  it("conserva el can_edit real guardado (no lo fuerza a false)", () => {
    expect(de(permisosParaEditar([permiso("dashboard", true, true)]), "dashboard")).toEqual(permiso("dashboard", true, true));
    expect(de(permisosParaEditar([permiso("dashboard", true, false)]), "dashboard")).toEqual(permiso("dashboard", true, false));
  });

  it("devuelve todas las secciones configurables; las que faltan, sin ver ni editar", () => {
    const permisos = permisosParaEditar([permiso("dashboard", true, true)]);

    expect(permisos.map((p) => p.section_key)).toEqual(SECCIONES_CONFIGURABLES.map((s) => s.key));
    expect(de(permisos, "usuarios")).toEqual(permiso("usuarios", false, false));
    expect(permisosParaEditar([])).toEqual([
      permiso("dashboard", false, false),
      permiso("facturas", false, false),
      permiso("facturas_subida", false, false),
      permiso("web_fotos", false, false),
      permiso("web_tarifas", false, false),
      permiso("web_contenido", false, false),
      permiso("presupuestos", false, false),
      permiso("trafico_web", false, false),
      permiso("newsletter", false, false),
      permiso("rrss", false, false),
      permiso("usuarios", false, false),
    ]);
  });

  it("editar implica ver (una fila con solo can_edit se muestra con las dos)", () => {
    const permisos = permisosParaEditar([permiso("dashboard", false, true)]);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", true, true));
  });

  it("ignora secciones retiradas (las del panel de restaurante, «trabajadores»…)", () => {
    const permisos = permisosParaEditar([
      permiso("reservas", true, true),
      permiso("facturas_albaranes", true, true),
      permiso("trabajadores", true, true),
    ]);
    expect(permisos.map((p) => p.section_key)).toEqual([
      "dashboard", "facturas", "facturas_subida", "web_fotos", "web_tarifas", "web_contenido", "presupuestos", "trafico_web", "newsletter", "rrss", "usuarios",
    ]);
    expect(permisos.every((p) => !p.can_view && !p.can_edit)).toBe(true);
  });
});

describe("«Usuarios» y «Facturas · Subida»: un solo interruptor (en can_view)", () => {
  it("«Usuarios» («Puede ver») y «Facturas · Subida» («Puede subir»); Dashboard y Facturas llevan «Ver» y «Puede editar»", () => {
    expect(Object.keys(SECCIONES_UN_INTERRUPTOR)).toEqual(["facturas_subida", "usuarios"]);
    expect(interruptorUnico("usuarios")).toBe("Puede ver");
    expect(interruptorUnico("facturas_subida")).toBe("Puede subir");
    expect(interruptorUnico("dashboard")).toBeNull();
    expect(interruptorUnico("facturas")).toBeNull();
  });

  it("Facturas: «Puede editar» cuenta para el rol; «Facturas · Subida» no", () => {
    // Admin si edita en todas las que cuentan (Facturas, las tres de Web, Presupuestos, Tráfico web, Newsletter y RRSS); en alguna, manager.
    expect(rolSegunPermisos(["facturas", "web_fotos", "web_tarifas", "web_contenido", "presupuestos", "trafico_web", "newsletter", "rrss"].map((k) => permiso(k, true, true)))).toBe("admin");
    expect(rolSegunPermisos([permiso("facturas", true, true)])).toBe("manager");
    expect(rolSegunPermisos([permiso("facturas", true, false), permiso("facturas_subida", true, false)])).toBe("staff");
    expect(AYUDA_EDICION.facturas_subida).toMatch(/Cargar/);
  });

  it("lo guardado en can_view o en can_edit (por SQL) es «sí», y se guarda en can_view sin edición", () => {
    expect(de(permisosParaEditar([permiso("usuarios", true, false)]), "usuarios")).toEqual(permiso("usuarios", true, false));
    expect(de(permisosParaEditar([permiso("usuarios", false, true)]), "usuarios")).toEqual(permiso("usuarios", true, false));
    expect(de(permisosParaEditar([permiso("usuarios", true, true)]), "usuarios")).toEqual(permiso("usuarios", true, false));
  });

  it("«Puede editar» no se activa nunca; «Ver» (= «Puede ver») sí, y va por libre del Dashboard", () => {
    let permisos = cambiarVer(permisosParaEditar([]), "usuarios", true);
    permisos = cambiarEditar(permisos, "usuarios", true);
    expect(de(permisos, "usuarios")).toEqual(permiso("usuarios", true, false));
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", false, false));
  });

  it("en «Ver permisos» / «Mi cuenta» sale con su interruptor y su ayuda", () => {
    const filas = seccionesConPermisos({ is_super_admin: false, role: "staff", permissions: [permiso("usuarios", true, false)] } as never);
    expect(filas.find((f) => f.key === "usuarios")).toMatchObject({
      label: "Usuarios", unInterruptor: "Puede ver", ver: true, editar: true, ayuda: `Puede ver: ${AYUDA_EDICION.usuarios}`,
    });
    expect(filas.find((f) => f.key === "dashboard")).toMatchObject({
      ver: false, editar: false, ayuda: `Editar: ${AYUDA_EDICION.dashboard}`,
    });
    expect(filas.find((f) => f.key === "dashboard")?.unInterruptor).toBeUndefined();
    const sa = seccionesConPermisos({ is_super_admin: true, role: "admin", permissions: [] } as never);
    expect(sa.find((f) => f.key === "usuarios")).toMatchObject({ ver: true });
    expect(sa.find((f) => f.key === "dashboard")).toMatchObject({ ver: true, editar: true });
  });
});

describe("NECESITA_VER", () => {
  it("hoy ninguna sección depende de otra: dar «Ver» en una no toca la otra", () => {
    expect(NECESITA_VER).toEqual({});
    const permisos = cambiarVer(permisosParaEditar([]), "usuarios", true);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", false, false));
  });
});

describe("cambiarVer", () => {
  it("al quitar «Ver» se quita también «Puede editar»", () => {
    const permisos = cambiarVer(permisosParaEditar([permiso("dashboard", true, true)]), "dashboard", false);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", false, false));
  });

  it("al dar «Ver» no se concede la edición", () => {
    const permisos = cambiarVer(permisosParaEditar([]), "dashboard", true);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", true, false));
  });

  it("no toca el resto de secciones", () => {
    const antes = permisosParaEditar([permiso("dashboard", true, true), permiso("usuarios", true, false)]);
    const despues = cambiarVer(antes, "dashboard", false);
    expect(de(despues, "usuarios")).toEqual(permiso("usuarios", true, false));
  });
});

describe("cambiarEditar", () => {
  it("concede la edición si la sección tiene «Ver»", () => {
    const permisos = cambiarEditar(permisosParaEditar([permiso("dashboard", true, false)]), "dashboard", true);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", true, true));
  });

  it("retira la edición y deja «Ver» como estaba", () => {
    const permisos = cambiarEditar(permisosParaEditar([permiso("dashboard", true, true)]), "dashboard", false);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", true, false));
  });

  it("no se puede activar sin «Ver»", () => {
    const permisos = cambiarEditar(permisosParaEditar([]), "dashboard", true);
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", false, false));
  });
});

describe("sinEdicion", () => {
  it("quita la edición de todas las secciones sin tocar «Ver»", () => {
    const permisos = sinEdicion(permisosParaEditar([permiso("dashboard", true, true), permiso("usuarios", true, false)]));
    expect(de(permisos, "dashboard")).toEqual(permiso("dashboard", true, false));
    expect(de(permisos, "usuarios")).toEqual(permiso("usuarios", true, false));
  });
});

describe("mismosPermisos", () => {
  it("compara ver Y editar de cada sección configurable", () => {
    const a = permisosParaEditar([permiso("dashboard", true, true)]);
    expect(mismosPermisos(a, permisosParaEditar([permiso("dashboard", true, true)]))).toBe(true);
    expect(mismosPermisos(a, permisosParaEditar([permiso("dashboard", true, false)]))).toBe(false);
    expect(mismosPermisos(a, permisosParaEditar([permiso("dashboard", true, true), permiso("usuarios", true, false)]))).toBe(false);
    expect(mismosPermisos(a, permisosParaEditar([]))).toBe(false);
  });

  it("no distingue lo que no se gestiona aquí: secciones retiradas o «Puede editar» en Usuarios", () => {
    expect(mismosPermisos([permiso("dashboard", true, false), permiso("reservas", true, true)], [permiso("dashboard", true, false)])).toBe(true);
    expect(mismosPermisos([permiso("usuarios", true, true)], [permiso("usuarios", true, false)])).toBe(true);
  });
});

describe("rol que sigue a los permisos (06/11/2026)", () => {
  // Quien puede gestionar Usuarios es admin (la gestión del equipo exige ese rol en el panel). Dashboard no
  // cuenta para el resto de la regla («Editar» no hace nada).
  it("ve todas las secciones → admin (con o sin «Editar» en Dashboard)", () => {
    expect(rolSegunPermisos(SECCIONES_CONFIGURABLES.map((s) => permiso(s.key, true, true)))).toBe("admin");
    expect(rolSegunPermisos([permiso("dashboard", true, false), permiso("usuarios", true, false)])).toBe("admin");
    // «Puede ver» de Usuarios guardado en can_edit (por SQL) cuenta igual.
    expect(rolSegunPermisos([permiso("dashboard", true, false), permiso("usuarios", false, true)])).toBe("admin");
  });

  it("gestiona Usuarios → admin; edita en algo → manager; solo ve (o nada) → staff", () => {
    expect(rolSegunPermisos([permiso("usuarios", true, false)])).toBe("admin");
    expect(rolSegunPermisos([permiso("dashboard", true, true)])).toBe("manager");
    expect(rolSegunPermisos([permiso("dashboard", true, false)])).toBe("staff");
    expect(rolSegunPermisos([permiso("dashboard", true, false), permiso("usuarios", false, false)])).toBe("staff");
    expect(rolSegunPermisos([])).toBe("staff");
  });

  it("las secciones retiradas no cuentan para el rol", () => {
    expect(rolSegunPermisos([permiso("dashboard", true, false), permiso("reservas", true, true)])).toBe("staff");
  });

  it("con un rol preconfigurado elegido, su rol; a mano, el de un preconfigurado igual o el calculado", () => {
    const presets = [{ id: "p1", base_role: "manager" as const, permissions: [permiso("dashboard", true, false)] }];
    expect(rolAlGuardar([permiso("usuarios", true, false)], presets, "p1")).toBe("manager");
    expect(rolAlGuardar([permiso("dashboard", true, false)], presets, null)).toBe("manager");
    expect(rolAlGuardar([permiso("usuarios", true, false)], presets, null)).toBe("admin");
    expect(rolAlGuardar([permiso("dashboard", true, true)], presets, null)).toBe("manager");
    expect(rolAlGuardar([permiso("dashboard", true, false), permiso("usuarios", true, false)], presets, null)).toBe("admin");
    // Un id que ya no existe se ignora: manda lo marcado.
    expect(rolAlGuardar([permiso("dashboard", true, true)], presets, "p-borrado")).toBe("manager");
  });
});

describe("Web y Presupuestos (migración 20261123100000_web_y_presupuestos)", () => {
  it("una sección por pestaña de Web y otra para Presupuestos, con «Ver» y «Puede editar»", () => {
    for (const k of ["web_fotos", "web_tarifas", "web_contenido", "presupuestos"]) {
      expect(interruptorUnico(k), k).toBeNull();
      expect(AYUDA_EDICION[k as keyof typeof AYUDA_EDICION], k).toMatch(/Con solo «Ver»/);
    }
    expect(rolSegunPermisos([permiso("web_tarifas", true, true)])).toBe("manager");
    expect(rolSegunPermisos([permiso("web_fotos", true, false), permiso("presupuestos", true, false)])).toBe("staff");
  });
});

describe("Tráfico web (migración 20261124110000_trafico_web)", () => {
  it("«Ver» lee las visitas y el comportamiento; «Puede editar» cambia los pesos por página", () => {
    expect(interruptorUnico("trafico_web")).toBeNull();
    expect(AYUDA_EDICION.trafico_web).toMatch(/Con solo «Ver»/);
    expect(AYUDA_EDICION.trafico_web).toMatch(/pesos por página/i);
    expect(rolSegunPermisos([permiso("trafico_web", true, true)])).toBe("manager");
    expect(rolSegunPermisos([permiso("trafico_web", true, false)])).toBe("staff");
  });
});

describe("Newsletter (migración 20261124173700_newsletter)", () => {
  it("«Ver» consulta y exporta; «Puede editar» crea, envía, da de alta y de baja y cambia los ajustes", () => {
    expect(interruptorUnico("newsletter")).toBeNull();
    expect(AYUDA_EDICION.newsletter).toMatch(/Con solo «Ver»/);
    expect(AYUDA_EDICION.newsletter).toMatch(/enviar newsletters/);
    expect(rolSegunPermisos([permiso("newsletter", true, true)])).toBe("manager");
    expect(rolSegunPermisos([permiso("newsletter", true, false)])).toBe("staff");
  });
});

describe("RRSS (migración 20261125100000_rrss)", () => {
  it("«Ver» consulta; «Puede editar» publica, programa, conecta la cuenta de Meta y cambia el estilo", () => {
    expect(interruptorUnico("rrss")).toBeNull();
    expect(AYUDA_EDICION.rrss).toMatch(/Con solo «Ver»/);
    expect(AYUDA_EDICION.rrss).toMatch(/publicar y programar en Instagram y Facebook/);
    expect(rolSegunPermisos([permiso("rrss", true, true)])).toBe("manager");
    expect(rolSegunPermisos([permiso("rrss", true, false)])).toBe("staff");
  });
});
