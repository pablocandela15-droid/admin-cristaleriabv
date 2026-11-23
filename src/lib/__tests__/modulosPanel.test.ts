/**
 * Catálogo de módulos del Admin Panel (14/11/2026, «hay muchos módulos que no aparecen en el control del
 * panel»). Si alguien añade una página al panel sin ponerla en `lib/modulosPanel.ts`, falla aquí: así no
 * vuelve a quedar un módulo sin interruptor en Control del Panel.
 */
import { describe, expect, it } from "vitest";
// Texto de App.tsx tal cual (`?raw` de Vite): sin `fs` ni rutas.
import fuenteApp from "../../App.tsx?raw";
// Import de verdad (sin pintar nada): así `npm run test:cambios` (`vitest related`) pasa esta prueba
// cuando cambia App.tsx, que es justo cuando alguien añade una página. Con solo `?raw` no la relaciona.
import App from "@/App";
import {
  GRUPOS_MODULOS,
  MODULOS_MENU,
  MODULOS_PANEL,
  RUTAS_FUERA_DEL_CATALOGO,
  destinoPermitido,
  moduloActivo,
  moduloDeRuta,
  moduloPorClave,
  rutaFueraDelCatalogo,
  tienePermisoModulo,
  valorInterruptor,
} from "@/lib/modulosPanel";
import { OPCIONES_INICIO } from "@/lib/seccionInicio";
import { CARGADORES_SECCION } from "@/lib/precargaSecciones";
import { SECTIONS } from "@/hooks/useUserRole";

/** Todas las `<Route path="…">` de App.tsx. */
const rutasApp = [...fuenteApp.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
/** Las que pintan una página del panel para el equipo (`pagina(…)` o `paginaSinMarco(…)`). */
const paginasEquipo = [...fuenteApp.matchAll(/<Route\s+path="([^"]+)"\s+element=\{pagina(?:SinMarco)?\(/g)].map((m) => m[1]);
const rutasCatalogo = MODULOS_PANEL.flatMap((m) => m.rutas);

describe("catálogo completo: cada ruta de App.tsx está en un módulo o fuera con su motivo", () => {
  it("lee las rutas de App.tsx (si cambia la forma de escribirlas, hay que cambiar esta prueba)", () => {
    expect(App).toBeTypeOf("function");
    expect(rutasApp.length).toBeGreaterThan(10);
    expect(paginasEquipo).toEqual(["/", "/dashboard", "/facturas", "/web", "/usuarios", "/avisos", "/ayuda", "/peticiones"]);
  });

  it.each(rutasApp)("%s", (ruta) => {
    const enCatalogo = rutasCatalogo.includes(ruta);
    const motivo = rutaFueraDelCatalogo(ruta);
    // Mensaje claro para quien añade una página: qué hacer.
    expect(
      enCatalogo || !!motivo,
      `La ruta «${ruta}» de App.tsx no está en el catálogo de módulos (src/lib/modulosPanel.ts). Añádela a las rutas ` +
        "de su módulo (o crea el módulo, con su interruptor en Control del Panel) o, si no es del equipo, a " +
        "RUTAS_FUERA_DEL_CATALOGO con el motivo.",
    ).toBe(true);
    expect(enCatalogo && !!motivo, `«${ruta}» está a la vez en el catálogo y fuera de él`).toBe(false);
  });

  it("toda página del equipo (pagina/paginaSinMarco) es de un módulo, no una excepción", () => {
    for (const ruta of paginasEquipo) expect(rutasCatalogo, ruta).toContain(ruta);
  });

  it("y al revés: ninguna ruta del catálogo ni excepción sobra (todas existen en App.tsx)", () => {
    for (const ruta of rutasCatalogo) expect(rutasApp, `«${ruta}» ya no está en App.tsx`).toContain(ruta);
    for (const ruta of Object.keys(RUTAS_FUERA_DEL_CATALOGO)) expect(rutasApp, ruta).toContain(ruta);
  });

  it("las páginas del Super Admin quedan fuera (solo entra un super admin)", () => {
    const superAdmin = rutasApp.filter((r) => r.startsWith("/super-admin"));
    expect(superAdmin.length).toBeGreaterThan(5);
    for (const ruta of superAdmin) {
      expect(moduloDeRuta(ruta)).toBeUndefined();
      expect(rutaFueraDelCatalogo(ruta)).toMatch(/Solo Super Admin/);
    }
  });

  it("cada sección precargable del menú (CARGADORES_SECCION) es de un módulo", () => {
    for (const ruta of Object.keys(CARGADORES_SECCION)) expect(moduloDeRuta(ruta), ruta).toBeDefined();
  });
});

describe("forma del catálogo", () => {
  it("claves únicas, con nombre, descripción, icono y un grupo que existe", () => {
    const claves = MODULOS_PANEL.map((m) => m.clave);
    expect(new Set(claves).size).toBe(claves.length);
    const grupos = GRUPOS_MODULOS.map((g) => g.id) as string[];
    for (const m of MODULOS_PANEL) {
      expect(m.nombre.trim(), m.clave).not.toBe("");
      expect(m.descripcion.length, m.clave).toBeGreaterThan(15);
      expect(m.icono, m.clave).toBeTruthy();
      expect(grupos, m.clave).toContain(m.grupo);
      if (!m.desactivable) expect(m.motivoSiempreActivo, m.clave).toBeTruthy();
      if (m.enMenu) expect(m.rutas.length, m.clave).toBeGreaterThan(0);
    }
  });

  it("conserva las claves que ya había en admin_feature_toggles (no se renombran) y se pueden apagar", () => {
    for (const clave of ["usuarios", "peticiones"]) {
      expect(moduloPorClave(clave)?.desactivable, clave).toBe(true);
    }
  });

  it("los módulos del restaurante ya no están en el catálogo (Facturas sí, sin albaranes)", () => {
    for (const clave of ["reservas", "gestion_web", "marketing", "rrss", "cheques", "tienda", "albaranes"]) {
      expect(moduloPorClave(clave), clave).toBeUndefined();
    }
  });

  it("si un módulo hereda el interruptor de otro, ese otro existe y se puede apagar", () => {
    for (const m of MODULOS_PANEL.filter((x) => x.heredaDe)) {
      expect(moduloPorClave(m.heredaDe!)?.desactivable, m.clave).toBe(true);
    }
  });

  it("Dashboard, Ayuda, Avisos y Mi cuenta no se pueden apagar", () => {
    expect(MODULOS_PANEL.filter((m) => !m.desactivable).map((m) => m.clave)).toEqual(["dashboard", "ayuda", "avisos", "mi_cuenta"]);
  });

  it("el menú lateral, en el orden de siempre", () => {
    expect(MODULOS_MENU.map((m) => m.nombre)).toEqual(["Dashboard", "Facturas", "Web", "Usuarios", "Nueva petición", "Ayuda"]);
  });

  it("Facturas: se puede apagar y sale con «Ver» en Facturas o con solo «Facturas · Subida»", () => {
    const f = moduloPorClave("facturas")!;
    expect(f).toMatchObject({ rutas: ["/facturas"], desactivable: true, enMenu: true, grupo: "compras" });
    expect(tienePermisoModulo(f, [{ section_key: "facturas_subida", can_view: true }], false)).toBe(true);
    expect(tienePermisoModulo(f, [{ section_key: "dashboard", can_view: true }], false)).toBe(false);
  });

  it("Web: se puede apagar y sale con cualquiera de sus tres secciones (Fotos, Tarifas, Contenido)", () => {
    const w = moduloPorClave("web")!;
    expect(w).toMatchObject({ rutas: ["/web"], desactivable: true, enMenu: true, grupo: "web" });
    for (const s of ["web_fotos", "web_tarifas", "web_contenido"]) {
      expect(tienePermisoModulo(w, [{ section_key: s, can_view: true }], false), s).toBe(true);
    }
    expect(tienePermisoModulo(w, [{ section_key: "presupuestos", can_view: true }], false)).toBe(false);
  });

  it("los permisos de cada módulo existen", () => {
    const secciones = SECTIONS.map((s) => s.key) as string[];
    for (const m of MODULOS_PANEL) for (const s of m.secciones ?? []) expect(secciones, `${m.clave}: ${s}`).toContain(s);
  });

  it("las opciones de «Al iniciar sesión, abrir» son entradas del menú con los mismos permisos", () => {
    for (const o of OPCIONES_INICIO) {
      const m = moduloDeRuta(o.ruta);
      expect(m?.enMenu, o.ruta).toBe(true);
      expect([...(o.secciones ?? [])].sort(), o.ruta).toEqual([...(m?.secciones ?? [])].sort());
      expect(!!o.soloConPermiso, o.ruta).toBe(!!m?.soloConPermiso);
    }
  });
});

describe("moduloDeRuta", () => {
  it.each([
    ["/", "dashboard"],
    ["/dashboard", "dashboard"],
    ["/dashboard/", "dashboard"],
    ["/usuarios", "usuarios"],
    ["/usuarios/", "usuarios"],
    ["/facturas", "facturas"],
    ["/web", "web"],
    ["/peticiones", "peticiones"],
    ["/avisos", "avisos"],
    ["/ayuda", "ayuda"],
  ])("%s → %s", (ruta, clave) => {
    expect(moduloDeRuta(ruta)?.clave).toBe(clave);
  });

  it("lo que no es del equipo, ninguno", () => {
    for (const ruta of ["/super-admin", "/super-admin/tickets", "/auth", "/no-existe", "/usuarios/otra", "/reservas", "/albaranes"]) {
      expect(moduloDeRuta(ruta), ruta).toBeUndefined();
    }
  });
});

describe("valorInterruptor (sin fila = activado)", () => {
  it("con fila manda la fila; sin fila, activado", () => {
    expect(valorInterruptor("usuarios", [{ section_key: "usuarios", enabled: false }])).toBe(false);
    expect(valorInterruptor("usuarios", [{ section_key: "usuarios", enabled: true }])).toBe(true);
    expect(valorInterruptor("usuarios", [])).toBe(true);
    expect(valorInterruptor("peticiones", [{ section_key: "usuarios", enabled: false }])).toBe(true);
    expect(valorInterruptor("clave_desconocida", [])).toBe(true);
    // Una fila vieja de un módulo que ya no existe (p. ej. «reservas») no afecta a nadie.
    expect(valorInterruptor("peticiones", [{ section_key: "reservas", enabled: false }])).toBe(true);
  });

  it("moduloActivo: los que no se pueden apagar, siempre activos aunque haya una fila", () => {
    const apagado = () => false;
    expect(moduloActivo(moduloPorClave("dashboard")!, apagado)).toBe(true);
    expect(moduloActivo(moduloPorClave("ayuda")!, apagado)).toBe(true);
    expect(moduloActivo(moduloPorClave("avisos")!, apagado)).toBe(true);
    expect(moduloActivo(moduloPorClave("usuarios")!, apagado)).toBe(false);
    expect(moduloActivo(moduloPorClave("peticiones")!, apagado)).toBe(false);
    expect(moduloActivo(moduloPorClave("usuarios")!, () => true)).toBe(true);
  });
});

describe("permisos y destino al rechazar", () => {
  const ver = (...s: string[]) => s.map((section_key) => ({ section_key, can_view: true }));
  const todoActivo = () => true;
  const apagados = (...claves: string[]) => (c: string) => !claves.includes(c);

  it("tienePermisoModulo: sin secciones lo ve todo el mundo; el super admin todo salvo «solo con permiso»", () => {
    const usuarios = moduloPorClave("usuarios")!;
    expect(tienePermisoModulo(moduloPorClave("peticiones")!, [], false)).toBe(true);
    expect(tienePermisoModulo(moduloPorClave("ayuda")!, [], false)).toBe(true);
    expect(tienePermisoModulo(usuarios, ver("usuarios"), false)).toBe(true);
    expect(tienePermisoModulo(usuarios, ver("dashboard"), false)).toBe(false);
    expect(tienePermisoModulo(usuarios, [{ section_key: "usuarios", can_view: false }], false)).toBe(false);
    expect(tienePermisoModulo(usuarios, [], true)).toBe(true);
    // «Solo con permiso» (ningún módulo lo usa hoy): el super admin necesita el permiso guardado.
    const soloConPermiso = { ...usuarios, soloConPermiso: true };
    expect(tienePermisoModulo(soloConPermiso, [], true)).toBe(false);
    expect(tienePermisoModulo(soloConPermiso, ver("usuarios"), true)).toBe(true);
  });

  it("primero el Dashboard si lo puede ver; si no, la primera sección del menú que pueda ver y esté activada", () => {
    expect(destinoPermitido(ver("dashboard", "usuarios"), todoActivo, "/usuarios")).toBe("/dashboard");
    expect(destinoPermitido(ver("dashboard", "usuarios"), todoActivo, "/peticiones")).toBe("/dashboard");
    expect(destinoPermitido(ver("usuarios"), todoActivo, "/dashboard")).toBe("/usuarios");
  });

  it("no manda al módulo de la ruta actual ni a uno apagado (sin bucles): si no queda nada, Ayuda", () => {
    expect(destinoPermitido(ver("usuarios"), apagados("usuarios"), "/dashboard")).toBe("/ayuda");
    expect(destinoPermitido(ver("usuarios"), todoActivo, "/usuarios")).toBe("/ayuda");
    expect(destinoPermitido(ver("dashboard"), todoActivo, "/dashboard")).toBe("/ayuda");
    expect(destinoPermitido([], todoActivo, "/peticiones")).toBe("/ayuda");
  });
});
