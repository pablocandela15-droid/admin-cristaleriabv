import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "@/hooks/useAuditLog";
import {
  camposLegibles,
  camposArchivoLegibles,
  puedeRevertir,
  resumenEntrada,
  tipoEvento,
  valorLegible,
} from "../auditoria";
const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: "event",
  created_at: "2026-10-12T15:00:00Z",
  actor_user_id: "admin",
  actor_email: "admin@test.local",
  accion: "actualizar",
  tabla: "peticiones",
  registro_id: "ticket",
  detalles: null,
  user_agent: null,
  ...overrides,
});
describe("auditoría legible", () => {
  it("identifica y explica un cambio de estado de un ticket", () => {
    const e = entry({
      detalles: {
        antes: { titulo: "No carga el presupuesto de mamparas", estado: "nueva" },
        despues: { titulo: "No carga el presupuesto de mamparas", estado: "en_analisis" },
      },
    });
    expect(resumenEntrada(e)).toBe(
      "Ha cambiado el estado del ticket «No carga el presupuesto de mamparas»: Recibida → En análisis",
    );
    expect(tipoEvento(e)).toBe("actualizar");
    expect(valorLegible("precio_mensual", 9.5)).toMatch(/9,50/);
    expect(valorLegible("activo", false)).toBe("No");
  });
  it("oculta identificadores y secretos del resumen", () => {
    expect(
      camposLegibles({
        id: "id",
        nombre: "Supabase",
        password: "secret",
        api_key: "secret",
        updated_at: "now",
      }),
    ).toEqual([{ campo: "nombre", etiqueta: "Nombre", valor: "Supabase" }]);
  });
  it("describe altas, cambios y bajas de cualquier tabla con su nombre legible", () => {
    expect(resumenEntrada(entry({ tabla: "costes_fijos", accion: "crear", detalles: { despues: { concepto: "Hosting del panel", eur_mes: 20 } } }))).toBe("Ha creado un nuevo coste fijo «Hosting del panel»");
    expect(resumenEntrada(entry({ tabla: "servicios_contratados", detalles: { antes: { nombre: "Supabase", plan: "Free" }, despues: { nombre: "Supabase", plan: "Pro" } } }))).toBe("Ha modificado el servicio contratado «Supabase»: Plan");
    expect(resumenEntrada(entry({ tabla: "oficiososia_facturas", accion: "eliminar", detalles: { antes: { numero: "F-2026-014" } } }))).toBe("Ha eliminado la factura emitida «F-2026-014»");
    expect(resumenEntrada(entry({ tabla: "user_role_presets", accion: "crear", detalles: { despues: { name: "Encargado de taller" } } }))).toBe("Ha creado una nueva plantilla de permisos «Encargado de taller»");
    // Una tabla nueva sin nombre propio se describe con su nombre SQL legible.
    expect(resumenEntrada(entry({ tabla: "registro_externo", accion: "crear" }))).toBe("Ha creado un nuevo registro externo");
  });
  it("distingue reversiones y solo ofrece restaurar lo que admite el servidor", () => {
    const reversion = entry({
      accion: "ejecutar",
      tabla: "user_permissions",
      detalles: { tipo_evento: "reversion", evento_original_id: "otro-evento" },
    });
    expect(tipoEvento(reversion)).toBe("reversion");
    expect(resumenEntrada(reversion)).toBe("Ha revertido un cambio de auditoría");
    expect(puedeRevertir(reversion)).toBe(false);
    expect(
      puedeRevertir(
        entry({
          tabla: "user_role_presets",
          detalles: { antes: { name: "A" }, despues: { name: "B" } },
        }),
      ),
    ).toBe(true);
    // Los tickets se gestionan desde Tickets: el servidor no los restaura.
    expect(
      puedeRevertir(
        entry({
          detalles: { antes: { estado: "nueva" }, despues: { estado: "descartada" } },
        }),
      ),
    ).toBe(false);
    expect(
      puedeRevertir(
        entry({
          tabla: "user_role_presets",
          detalles: { antes: { secret: "[oculto]" }, despues: { name: "B" } },
        }),
      ),
    ).toBe(false);
  });
  it("prefiere el tipo de evento que ya calcula la vista", () => {
    expect(tipoEvento(entry({ accion: "ejecutar", tipo_evento: "cambio_contrasena" }))).toBe("cambio_contrasena");
    expect(tipoEvento(entry({ tabla: "user_permissions" }))).toBe("cambiar_permisos");
    expect(tipoEvento(entry({ tabla: "super_admins" }))).toBe("cambiar_roles");
  });
});

describe("acciones comprensibles sin leer el JSON", () => {
  const archivo = {
    id: "archivo-id",
    name: "usuario-id/captura-id.png",
    bucket_id: "peticiones",
    owner_id: "usuario-id",
    version: "version-id",
    metadata: { size: 21578, mimetype: "image/png", eTag: "huella", cacheControl: "max-age=3600" },
  };
  it("explica el INSERT de la captura de un ticket y aparta metadatos del detalle legible", () => {
    const e = entry({ tabla: "storage.objects", accion: "crear", detalles: { despues: archivo, operacion_sql: "INSERT", request_id: null } });
    expect(resumenEntrada(e)).toBe("Ha subido una captura de un ticket: captura-id.png");
    expect(camposArchivoLegibles(e)).toEqual([
      { campo: "archivo", etiqueta: "Archivo", valor: "captura-id.png" },
      { campo: "uso", etiqueta: "Uso", valor: "Captura de pantalla adjunta a un ticket" },
      { campo: "tipo", etiqueta: "Tipo", valor: "Imagen PNG" },
      { campo: "tamano", etiqueta: "Tamaño", valor: "21,1 KB" },
    ]);
    expect(e.detalles?.despues).toEqual(archivo);
    expect(puedeRevertir(e)).toBe(false);
  });
  it.each([
    ["eliminar", "Ha eliminado una captura de un ticket: captura-id.png"],
    ["actualizar", "Ha actualizado una captura de un ticket: captura-id.png"],
  ] as const)("explica archivos al %s", (accion, resumen) => {
    expect(resumenEntrada(entry({ tabla: "storage.objects", accion, detalles: { antes: archivo } }))).toBe(resumen);
  });
  it("nombra imágenes y archivos de otros almacenes sin inventar un uso", () => {
    const imagen = entry({ tabla: "storage.objects", accion: "crear", detalles: { despues: { name: "otros/logo.webp", bucket_id: "publico", metadata: { mimetype: "image/webp" } } } });
    expect(resumenEntrada(imagen)).toBe("Ha subido una imagen: logo.webp");
    expect(camposArchivoLegibles(imagen).map((c) => c.campo)).toEqual(["archivo", "tipo"]);
    expect(resumenEntrada(entry({ tabla: "storage.objects", accion: "eliminar", detalles: { antes: { name: "docs/tarifa-ventanas.pdf", metadata: { mimetype: "application/pdf" } } } }))).toBe("Ha eliminado un archivo: tarifa-ventanas.pdf");
  });
  it("distingue renombrar de mover sin exponer las rutas internas", () => {
    expect(resumenEntrada(entry({ tabla: "storage.objects", detalles: { antes: archivo, despues: { ...archivo, name: "usuario-id/captura-2.png" } } }))).toBe("Ha renombrado el archivo «captura-id.png» a «captura-2.png»");
    expect(resumenEntrada(entry({ tabla: "storage.objects", detalles: { antes: archivo, despues: { ...archivo, name: "otro-usuario/captura-id.png" } } }))).toBe("Ha movido el archivo «captura-id.png»");
  });
  it("traduce los estados de los tickets y el bloqueo por la marca de acceso", () => {
    expect(resumenEntrada(entry({ detalles: { antes: { titulo: "Añadir campo de medidas", estado: "aceptada" }, despues: { titulo: "Añadir campo de medidas", estado: "hecha" } } }))).toBe("Ha cambiado el estado del ticket «Añadir campo de medidas»: Aceptada → Hecha");
    expect(resumenEntrada(entry({ tabla: "user_access_status", accion: "crear", detalles: { despues: { user_id: "u1", access_blocked: true } } }))).toBe("Ha bloqueado el acceso de un usuario al panel");
    expect(resumenEntrada(entry({ tabla: "user_access_status", detalles: { antes: { user_id: "u1", access_blocked: true }, despues: { user_id: "u1", access_blocked: false } } }))).toBe("Ha desbloqueado el acceso de un usuario al panel");
  });
  it.each([
    ["nueva", "Recibida"],
    ["en_analisis", "En análisis"],
    ["aceptada", "Aceptada"],
    ["hecha", "Hecha"],
    ["descartada", "Descartada"],
    ["fallida", "Fallida"],
    ["estado_nuevo", "estado nuevo"],
  ])("muestra el estado %s como «%s»", (estado, visible) => {
    expect(valorLegible("estado", estado)).toBe(visible);
  });
  it("no afirma que una acción fallida se completó", () => {
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "admin-update-user-password", resultado: "fallida" } }))).toBe("No se ha podido cambiar la contraseña de un usuario");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "analizar-peticion/analizar", resultado: "completada" } }))).toBe("Ha solicitado analizar un ticket con la IA");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "avisos-telegram", resultado: "parcial" } }))).toBe("Ha solicitado enviar avisos por Telegram; resultado parcial");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "cambiar-mi-contrasena", resultado: "fallida", motivo: "contrasena_actual_incorrecta" } }))).toBe("No se ha podido cambiar su propia contraseña");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "cambiar-mi-contrasena", resultado: "completada" } }))).toBe("Ha solicitado cambiar su propia contraseña");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "funcion-retirada", resultado: "fallida" } }))).toBe("No se ha podido completar una acción del servidor");
    expect(resumenEntrada(entry({ accion: "ejecutar", tabla: "acciones_servidor", detalles: { operacion: "funcion-retirada" } }))).toBe("Ha realizado una acción del servidor");
  });
  it("explica configuraciones, permisos y bajas de superadmin", () => {
    expect(resumenEntrada(entry({ tabla: "oficiososia_facturacion_config" }))).toBe("Ha modificado la configuración de la emisión de facturas");
    expect(resumenEntrada(entry({ tabla: "servicios_config", detalles: { antes: { eur_por_usd: 0.92 }, despues: { eur_por_usd: 0.95 } } }))).toBe("Ha modificado la configuración de Servicios: Euros por dólar");
    expect(resumenEntrada(entry({ tabla: "super_admins", detalles: { operacion_asignacion: "retirar", antes: { email: "staff@example.com" } } }))).toBe("Ha retirado el acceso de superadmin a «staff@example.com»");
    expect(resumenEntrada(entry({ tabla: "user_permissions", detalles: { operacion_permiso: "conceder", despues: { section_key: "peticiones" } } }))).toBe("Ha concedido permisos en Peticiones");
    expect(resumenEntrada(entry({ tabla: "user_roles", detalles: { operacion_asignacion: "asignar", despues: { role: "manager" } } }))).toBe("Ha asignado un rol de usuario: Manager");
    expect(resumenEntrada(entry({ tabla: "admin_feature_toggles", detalles: { despues: { section_key: "usuarios", label: "Usuarios", enabled: false } } }))).toBe("Ha desactivado una sección del panel: Usuarios");
    expect(resumenEntrada(entry({ accion: "crear", detalles: { despues: { titulo: "Error al subir la foto de una ventana" } } }))).toBe("Ha creado un nuevo ticket «Error al subir la foto de una ventana»");
  });
  it("conserva frases breves para títulos largos o sin texto", () => {
    const resumen = resumenEntrada(entry({ accion: "crear", detalles: { despues: { titulo: "mampara ".repeat(30) } } }));
    expect(resumen).toContain("…»");
    expect(resumen.length).toBeLessThan(140);
    expect(resumenEntrada(entry({ accion: "crear" }))).toBe("Ha creado un nuevo ticket");
  });
  it("nombra modelos de IA, copias de cierre y registros de credenciales sin afirmar crear una clave externa", () => {
    expect(resumenEntrada(entry({ tabla: "ia_modelo_funcion", detalles: { antes: { funcion: "analizar-peticion", modelo: "modelo-a" }, despues: { funcion: "analizar-peticion", modelo: "modelo-b" } } }))).toBe("Ha modificado el modelo de IA de una función: Modelo");
    expect(resumenEntrada(entry({ tabla: "servicios_contratados_copia_cierre", accion: "crear", detalles: { despues: { proveedor: "vercel" } } }))).toBe("Ha creado una nueva copia de cierre de un servicio");
    expect(resumenEntrada(entry({ tabla: "openai_claves", accion: "crear", detalles: { despues: { nombre: "Análisis de tickets", api_key_id: "[oculto]" } } }))).toBe("Ha creado un nuevo registro de credencial de IA «Análisis de tickets»");
  });
  it("prioriza el resultado proporcionado por la vista de auditoría", () => {
    expect(resumenEntrada(entry({ accion: "ejecutar", resultado: "fallida", detalles: { operacion: "admin-update-user-password", resultado: "completada" } }))).toBe("No se ha podido cambiar la contraseña de un usuario");
  });
});

it.each([true, false])(
  "explica el bloqueo y desbloqueo de un usuario (%s)",
  (blocked) => {
    const e = entry({
      tabla: "auth.users",
      detalles: {
        antes: {
          email: "persona@staff.local",
          banned_until: blocked ? null : "2126-10-13T08:00:00Z",
        },
        despues: {
          email: "persona@staff.local",
          banned_until: blocked ? "2126-10-13T08:00:00Z" : null,
        },
      },
    });
    expect(tipoEvento(e)).toBe(
      blocked ? "bloquear_acceso" : "desbloquear_acceso",
    );
    expect(resumenEntrada(e)).toBe(
      `Ha ${blocked ? "bloqueado" : "desbloqueado"} el acceso de «persona@staff.local»`,
    );
    expect(puedeRevertir(e)).toBe(false);
  },
);

it("explica el cambio de contraseña sin exponerla", () => {
  const e = entry({
    tabla: "auth.users",
    detalles: {
      credenciales_actualizadas: true,
      antes: { email: "persona@staff.local" },
      despues: { email: "persona@staff.local" },
    },
  });
  expect(tipoEvento(e)).toBe("cambiar_credenciales");
  expect(resumenEntrada(e)).toBe("Ha cambiado la contraseña de «persona@staff.local»");
});
