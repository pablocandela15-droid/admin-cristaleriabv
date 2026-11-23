// ============================================================================
//  Presupuestos: enviar por WhatsApp o por correo (sin React)
// ----------------------------------------------------------------------------
//  WhatsApp: wa.me al móvil del cliente con un texto corto (número, total y
//  validez). Correo: mailto con asunto y cuerpo; el PDF NO va adjunto (un
//  enlace mailto no puede adjuntar nada): se descarga y se adjunta a mano.
// ============================================================================
import { fechaCorta, validoHasta } from "./estados";
import { eurosCentimos } from "./totales";
import type { Presupuesto } from "./tipos";

type DatosEnvio = Pick<Presupuesto, "numero" | "cliente_nombre" | "fecha" | "validez_dias"> & { total: number; iva_pct?: number };

/** «1.234,50 € (IVA incluido)»; sin IVA, solo el importe. */
const totalConIva = (p: DatosEnvio) => `${eurosCentimos(p.total)}${(p.iva_pct ?? 21) > 0 ? " (IVA incluido)" : ""}`;

/**
 * Teléfono para wa.me (solo cifras, con prefijo de país): «650 06 63 23» → «34650066323», «+33 6 12…» → «336…».
 * null si no parece un teléfono.
 */
export function telefonoWhatsApp(telefono: string | null | undefined): string | null {
  const t = String(telefono ?? "").trim();
  let cifras = t.replace(/\D/g, "");
  if (!cifras) return null;
  if (t.startsWith("+")) {
    // ya trae el prefijo
  } else if (cifras.startsWith("00")) cifras = cifras.slice(2);
  else if (cifras.length === 9) cifras = `34${cifras}`;
  return cifras.length >= 8 && cifras.length <= 15 ? cifras : null;
}

/** Nombre de pila para el saludo («Juan» de «Juan Pérez»). */
const nombreDePila = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? "";

export function textoWhatsApp(p: DatosEnvio, negocio: string): string {
  const pila = nombreDePila(p.cliente_nombre);
  return [
    `Hola${pila ? `, ${pila}` : ""}. Te enviamos el presupuesto ${p.numero} de ${negocio}.`,
    `Total: ${totalConIva(p)}.`,
    `Válido hasta el ${fechaCorta(validoHasta(p))}.`,
    "Cualquier duda, aquí estamos.",
  ].join("\n");
}

/** Enlace de WhatsApp, o null si el cliente no tiene un teléfono válido. */
export function enlaceWhatsApp(p: DatosEnvio & Pick<Presupuesto, "cliente_telefono">, negocio: string): string | null {
  const tel = telefonoWhatsApp(p.cliente_telefono);
  return tel ? `https://wa.me/${tel}?text=${encodeURIComponent(textoWhatsApp(p, negocio))}` : null;
}

export function asuntoEmail(p: Pick<Presupuesto, "numero">, negocio: string): string {
  return `Presupuesto ${p.numero} · ${negocio}`;
}

export function cuerpoEmail(p: DatosEnvio, negocio: string, nombrePdf: string): string {
  const pila = nombreDePila(p.cliente_nombre);
  return [
    `Hola${pila ? `, ${pila}` : ""}:`,
    "",
    `Te adjuntamos el presupuesto ${p.numero} (${nombrePdf}).`,
    `Total: ${totalConIva(p)}. Válido hasta el ${fechaCorta(validoHasta(p))}.`,
    "",
    "Si te parece bien, contesta a este correo y te llamamos para concretar la instalación.",
    "",
    "Un saludo,",
    negocio,
  ].join("\n");
}

/** mailto con asunto y cuerpo (sin correo del cliente, se abre igual para escribirlo). */
export function enlaceEmail(p: DatosEnvio & Pick<Presupuesto, "cliente_email">, negocio: string, nombrePdf: string): string {
  const para = String(p.cliente_email ?? "").trim();
  const query = `subject=${encodeURIComponent(asuntoEmail(p, negocio))}&body=${encodeURIComponent(cuerpoEmail(p, negocio, nombrePdf))}`;
  return `mailto:${encodeURIComponent(para).replace(/%40/g, "@")}?${query}`;
}
