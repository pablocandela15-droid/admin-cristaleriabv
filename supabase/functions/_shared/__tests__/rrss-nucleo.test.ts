// RRSS · lógica pura compartida: validación de piezas (espejo de rrss_pieza_problemas), caducidad de la conexión,
// configuración (paneles permitidos, diálogo de Facebook), saneado de secretos, cifrado de tokens, errores de Meta y
// resumen de métricas.
import { afterEach, describe, expect, it } from "vitest";
import { contarTexto, hashtagsDe, problemasPieza } from "../rrss/validacion";
import { estadoCaducidad } from "../rrss/caducidad";
import { configMeta, faltaParaConectar, panelPermitido, redirectUri, urlDialogo, usaSecretos } from "../rrss/config";
import { enmascarar, olvidarSecretos, registrarSecreto, sanear, sanearProfundo } from "../rrss/secretos";
import { aleatorio, cifrar, descifrar, ErrorCifrado, sha256Hex } from "../rrss/cifrado";
import { clasificarError, estadoHttpDeError, ErrorMeta, mapearErrorGraph, tipoDesdeTextoEstado } from "../rrss/errores";
import { resumirPeriodo, serieDiaria, sumarDias, variacion } from "../rrss/resumen";
import { formatoAdmitido, proporcionDeFormato } from "../rrss/formatos";

const img = { tipo: "imagen" as const };
const vid = (duracion_s = 20) => ({ tipo: "video" as const, duracion_s });

describe("problemasPieza (mismo criterio que rrss_pieza_problemas)", () => {
  const base = { red: "instagram" as const, formato: "foto" as const, caption: "Mampara en Elche #mamparas" };
  it("una foto con una imagen está lista", () => {
    expect(problemasPieza(base, [img])).toEqual([]);
  });
  it("cada formato pide lo suyo", () => {
    expect(problemasPieza(base, [])).toEqual(["Una foto necesita exactamente una imagen"]);
    expect(problemasPieza({ ...base, formato: "carrusel" }, [img])).toEqual(["Un carrusel lleva de 2 a 10 fotos o vídeos"]);
    expect(problemasPieza({ ...base, formato: "carrusel" }, Array(11).fill(img))).toEqual(["Un carrusel lleva de 2 a 10 fotos o vídeos"]);
    expect(problemasPieza({ ...base, formato: "carrusel" }, [img, vid()])).toEqual([]);
    expect(problemasPieza({ ...base, formato: "reel" }, [img])).toEqual(["Un reel necesita exactamente un vídeo"]);
    expect(problemasPieza({ ...base, formato: "story", caption: "" }, [img, img])).toEqual(["Una historia lleva una sola foto o un solo vídeo"]);
  });
  it("Facebook: sin historias, varias fotos sin vídeo y con texto", () => {
    expect(problemasPieza({ ...base, red: "facebook", formato: "story" }, [img])).toContain("Facebook no admite historias desde el panel");
    expect(problemasPieza({ ...base, red: "facebook", formato: "carrusel" }, [img, vid()])).toEqual(["En Facebook, una publicación de varias fotos no admite vídeos"]);
    expect(problemasPieza({ ...base, red: "facebook", caption: "  " }, [img])).toEqual(["En Facebook hace falta un texto"]);
  });
  it("límites de texto de Instagram (hashtags, menciones, 2200 caracteres)", () => {
    const hashtags = Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ");
    expect(problemasPieza({ ...base, caption: hashtags }, [img])).toEqual(["Instagram admite como mucho 30 hashtags"]);
    expect(problemasPieza({ ...base, red: "facebook", caption: hashtags }, [img])).toEqual([]);
    const menciones = Array.from({ length: 21 }, (_, i) => `@cuenta${i}`).join(" ");
    expect(problemasPieza({ ...base, caption: menciones }, [img])).toEqual(["Instagram admite como mucho 20 menciones"]);
    expect(problemasPieza({ ...base, caption: "x".repeat(2201) }, [img])).toEqual(["El texto pasa de 2200 caracteres"]);
  });
  it("duración de los vídeos según el formato", () => {
    expect(problemasPieza({ ...base, formato: "reel" }, [vid(2)])).toEqual(["Un vídeo dura menos de 3 segundos"]);
    expect(problemasPieza({ ...base, formato: "story", caption: "" }, [vid(90)])).toEqual(["Un vídeo pasa de 60 segundos"]);
    expect(problemasPieza({ ...base, formato: "reel" }, [vid(16 * 60)])).toEqual(["Un vídeo pasa de 15 minutos"]);
  });
  it("ficheros ya borrados", () => {
    expect(problemasPieza({ ...base, medios_borrados_at: "2026-11-01T00:00:00Z" }, [img])).toEqual(["Sus ficheros ya se borraron del panel"]);
  });
  it("contarTexto cuenta como Instagram (emojis = 1 carácter) y no confunde correos ni &#", () => {
    expect(contarTexto("Hola 👋 #mamparas #elche @cristaleria correo@example.com &#38;")).toEqual({ caracteres: 61, hashtags: 2, menciones: 1 });
    expect(hashtagsDe("#Mamparas en #elche y #mamparas otra vez")).toEqual(["#mamparas", "#elche"]);
  });
  it("formatos admitidos y recorte", () => {
    expect(formatoAdmitido("facebook", "story")).toBe(false);
    expect(proporcionDeFormato("story", "4:5")).toBe("9:16");
    expect(proporcionDeFormato("foto", "9:16")).toBe("4:5");
    expect(proporcionDeFormato("carrusel", "1:1")).toBe("1:1");
  });
});

describe("estadoCaducidad", () => {
  const ahora = Date.parse("2026-11-25T10:00:00Z");
  it("sin fechas, no caduca (token de usuario del sistema o de página)", () => {
    expect(estadoCaducidad({ tokenCaducaEn: null, accesoDatosCaducaEn: null }, ahora)).toMatchObject({ nivel: "ok", dias: null });
  });
  it("avisa a 14 días o menos de lo primero que caduca", () => {
    const e = estadoCaducidad({ tokenCaducaEn: null, accesoDatosCaducaEn: "2026-12-05T10:00:00Z" }, ahora);
    expect(e).toMatchObject({ nivel: "aviso", dias: 10 });
    expect(e.texto).toMatch(/acceso de la app.*caduca en 10 días.*Renovar conexión/);
  });
  it("caducado", () => {
    expect(estadoCaducidad({ tokenCaducaEn: "2026-11-20T00:00:00Z", accesoDatosCaducaEn: "2027-01-01T00:00:00Z" }, ahora)).toMatchObject({ nivel: "caducado" });
  });
  it("lejos, ok con los días que quedan", () => {
    expect(estadoCaducidad({ tokenCaducaEn: null, accesoDatosCaducaEn: "2027-02-01T10:00:00Z" }, ahora)).toMatchObject({ nivel: "ok", dias: 68 });
  });
});

describe("configuración", () => {
  const env = (vars: Record<string, string>) => (n: string) => vars[n];
  it("qué falta para conectar (nombres, nunca valores)", () => {
    expect(faltaParaConectar(configMeta(env({ SUPABASE_URL: "https://x.supabase.co" })))).toEqual(["META_APP_ID", "META_APP_SECRET"]);
    expect(faltaParaConectar(configMeta(env({ SUPABASE_URL: "https://x.supabase.co", META_APP_ID: "1", META_APP_SECRET: "s" })))).toEqual([]);
  });
  it("token de usuario del sistema solo con IG_ACCESS_TOKEN e IG_USER_ID numérico", () => {
    expect(usaSecretos(configMeta(env({ IG_ACCESS_TOKEN: "t" })))).toBe(false);
    expect(usaSecretos(configMeta(env({ IG_ACCESS_TOKEN: "t", IG_USER_ID: "1784" })))).toBe(true);
  });
  it("URL de redirección y diálogo (permisos o config_id)", () => {
    const c = configMeta(env({ SUPABASE_URL: "https://gorekooabfhqudeshtgq.supabase.co/", META_APP_ID: "123" }));
    expect(redirectUri(c)).toBe("https://gorekooabfhqudeshtgq.supabase.co/functions/v1/rrss-oauth");
    const u = new URL(urlDialogo(c, "estado"));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
    expect(u.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(u.searchParams.get("state")).toBe("estado");
    const conConfig = new URL(urlDialogo(configMeta(env({ SUPABASE_URL: "https://x.supabase.co", META_APP_ID: "1", META_LOGIN_CONFIG_ID: "999" })), "s"));
    expect(conConfig.searchParams.get("config_id")).toBe("999");
    expect(conConfig.searchParams.get("scope")).toBeNull();
  });
  it("versión de la API: solo vNN.N", () => {
    expect(configMeta(env({ META_API_VERSION: "v27.0" })).versionApi).toBe("v27.0");
    expect(configMeta(env({ META_API_VERSION: "latest" })).versionApi).toBe("v26.0");
  });
  it("paneles a los que puede volver el OAuth: producción, previews del proyecto, localhost y PANEL_URL(_DEMO)", () => {
    const e = env({ PANEL_URL_DEMO: "https://demo-panel.example.com" });
    expect(panelPermitido("https://admin-cristaleriabv.vercel.app/rrss", e)).toBe("https://admin-cristaleriabv.vercel.app");
    expect(panelPermitido("https://admin-cristaleriabv-git-staging-pablo1505.vercel.app", e)).toBe("https://admin-cristaleriabv-git-staging-pablo1505.vercel.app");
    expect(panelPermitido("http://localhost:8080", e)).toBe("http://localhost:8080");
    expect(panelPermitido("https://demo-panel.example.com", e)).toBe("https://demo-panel.example.com");
    for (const malo of ["https://admin-cristaleriabv-evil.vercel.app", "https://evil.example.com", "javascript:alert(1)", "https://admin-cristaleriabv.vercel.app.evil.com", null]) {
      expect(panelPermitido(malo, e), String(malo)).toBeNull();
    }
  });
});

describe("saneado de secretos", () => {
  afterEach(() => olvidarSecretos());
  it("tapa tokens registrados, tokens de Meta sueltos, JWT, URL firmadas y tokens cifrados", () => {
    registrarSecreto("secreto-de-la-app-123");
    const texto = "app secreto-de-la-app-123 EAABsbCS1iHgBAKZBZCexample1234567890abc https://x.supabase.co/storage/v1/object/sign/rrss/a.jpg?token=eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqrst v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB code=AQDabc";
    const s = sanear(texto);
    expect(s).not.toMatch(/secreto-de-la-app|EAAB|eyJ|BBBBBBBB|AQDabc/);
    expect(sanearProfundo({ a: [{ token: "EAABsbCS1iHgBAKZBZCexample1234567890abc" }] })).toEqual({ a: [{ token: "[OCULTO]" }] });
    expect(enmascarar("EAABsbCS1iHgBAKZBZC1234")).toBe("…1234");
  });
});

describe("cifrado de tokens", () => {
  it("cifra y descifra con la clave de los secretos; con otra clave no se lee", async () => {
    const c = await cifrar("EAAB-token-de-pagina", "clave-larga-de-prueba");
    expect(c).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(c).not.toContain("EAAB");
    expect(await descifrar(c, "clave-larga-de-prueba")).toBe("EAAB-token-de-pagina");
    await expect(descifrar(c, "otra-clave-distinta")).rejects.toBeInstanceOf(ErrorCifrado);
    expect(await cifrar("EAAB-token-de-pagina", "clave-larga-de-prueba")).not.toBe(c);
  });
  it("sin clave no cifra", async () => {
    await expect(cifrar("x", "")).rejects.toBeInstanceOf(ErrorCifrado);
  });
  it("state aleatorio y su sha256", async () => {
    const s = aleatorio(32);
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("errores de Meta", () => {
  it("clasifica los códigos de la Graph API", () => {
    expect(clasificarError(190, 463, "", 400)).toBe("token");
    expect(clasificarError(200, null, "API access blocked.", 400)).toBe("app_bloqueada");
    expect(clasificarError(10, null, "x", 400)).toBe("permisos");
    expect(clasificarError(null, 2207042, "", 400)).toBe("limite_publicacion");
    expect(clasificarError(4, null, "", 400)).toBe("limite_llamadas");
    expect(clasificarError(null, null, "", 503)).toBe("transitorio");
    expect(tipoDesdeTextoEstado("Error 2207052: no se pudo descargar")).toBe("url_no_descargable");
  });
  it("mapea la respuesta, sanea lo que dice Meta y elige el código HTTP", () => {
    const e = mapearErrorGraph({ estadoHttp: 400, cuerpo: { error: { message: "Invalid OAuth access_token=EAABabcdefghijklmnopqrstuvwxyz", code: 190, error_subcode: 460 } } });
    expect(e).toBeInstanceOf(ErrorMeta);
    expect(e.tipo).toBe("token");
    expect(e.message).toMatch(/se cambió la contraseña/);
    expect(e.message).not.toContain("EAAB");
    expect(e.comoArreglarlo).toMatch(/Renovar conexión/);
    expect(estadoHttpDeError(e)).toBe(502);
    expect(estadoHttpDeError(new ErrorMeta({ tipo: "limite_publicacion" }))).toBe(429);
    expect(estadoHttpDeError(new ErrorMeta({ tipo: "sin_conexion" }))).toBe(503);
  });
});

describe("resumen de métricas", () => {
  const filas = Array.from({ length: 56 }, (_, i) => ({
    fecha: sumarDias("2026-11-24", -i), seguidores: i === 0 ? 1200 : i === 28 ? 1100 : null, alcance: i < 28 ? 200 : 100,
    visualizaciones: 300, visitas_perfil: null, cuentas_interaccion: 10, interacciones: i < 28 ? 20 : 10,
  }));
  it("28 días frente a los 28 anteriores", () => {
    const r = resumirPeriodo(filas, "2026-11-24", 28);
    expect(r.metricas.alcance).toEqual({ actual: 5600, anterior: 2800, variacion: 100 });
    expect(r.metricas.seguidores).toMatchObject({ actual: 1200, anterior: 1100, cambio: 100 });
    expect(r.diasConDatos).toBe(28);
    expect(variacion(10, 0)).toBeNull();
  });
  it("serie diaria con huecos a null", () => {
    const s = serieDiaria(filas.slice(0, 3), "2026-11-26", 5);
    expect(s.map((p) => p.alcance)).toEqual([200, 200, 200, null, null]);
  });
});
