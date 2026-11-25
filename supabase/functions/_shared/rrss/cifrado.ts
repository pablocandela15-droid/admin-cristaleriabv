// ============================================================================
//  RRSS · cifrado de los tokens de Meta en la base de datos
// ----------------------------------------------------------------------------
//  AES-GCM de 256 bits (WebCrypto, también en Deno). La clave sale de un secreto
//  de las funciones (RRSS_CLAVE_TOKENS o, si no está, META_APP_SECRET) con
//  SHA-256 y una etiqueta: nunca está en la base de datos, así que una copia de
//  la base no basta para leer los tokens. Formato: v1.<iv base64url>.<datos
//  base64url> (lo que admite la columna de rrss_meta_tokens).
//  Si cambia la clave (p. ej. se regenera el secreto de la app), los tokens
//  guardados ya no se pueden leer: el panel pide «Renovar conexión».
// ============================================================================

const ETIQUETA = "cristaleriabv:rrss-tokens:v1:";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(texto: string): Uint8Array {
  const b = texto.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function clave(secreto: string): Promise<CryptoKey> {
  if (!secreto || secreto.length < 8) throw new ErrorCifrado("Falta la clave para cifrar los tokens (META_APP_SECRET o RRSS_CLAVE_TOKENS).");
  const bruto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ETIQUETA + secreto));
  return crypto.subtle.importKey("raw", bruto, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export class ErrorCifrado extends Error {
  override readonly name = "ErrorCifrado";
}

export const FORMATO_CIFRADO = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export async function cifrar(texto: string, secreto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await clave(secreto), new TextEncoder().encode(texto));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(datos))}`;
}

export async function descifrar(cifrado: string, secreto: string): Promise<string> {
  if (!FORMATO_CIFRADO.test(cifrado ?? "")) throw new ErrorCifrado("El token guardado no tiene el formato esperado.");
  const [, iv, datos] = cifrado.split(".");
  try {
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64url(iv) }, await clave(secreto), deB64url(datos));
    return new TextDecoder().decode(claro);
  } catch (e) {
    if (e instanceof ErrorCifrado) throw e;
    throw new ErrorCifrado("No se pueden leer los tokens guardados (¿ha cambiado META_APP_SECRET o RRSS_CLAVE_TOKENS?). Vuelve a conectar.");
  }
}

/** sha256 en hexadecimal (el state del OAuth se guarda así). */
export async function sha256Hex(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cadena aleatoria segura (base64url) para el state del OAuth. */
export function aleatorio(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
