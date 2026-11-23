// ============================================================================
//  Presupuestos: descargar el PDF en el navegador
// ----------------------------------------------------------------------------
//  Trae el SVG del logotipo (public/marca, mismo origen; una vez por sesión),
//  construye el PDF (./pdf.ts, que carga pdf-lib bajo demanda) y lo descarga
//  como «Presupuesto-P-2026-0001.pdf». Sin logotipo (sin red), el nombre escrito.
// ============================================================================
import { LOGOTIPO } from "@/config/negocio";
import type { DatosPdfPresupuesto } from "./pdf";

let logo: Promise<string | null> | null = null;

/** Texto del SVG del logotipo, o null si no se puede traer (se reintenta la próxima vez). */
export function cargarLogoSvg(): Promise<string | null> {
  logo ??= fetch(LOGOTIPO.horizontal.src)
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null)
    .then((svg) => {
      if (!svg) logo = null;
      return svg;
    });
  return logo;
}

/** Descarga un fichero (también en Safari de iPad, que lo abre para compartir o guardar). */
export function descargarFichero(bytes: Uint8Array, nombre: string, tipo = "application/pdf"): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: tipo }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.rel = "noopener";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Construye y descarga el PDF; devuelve el nombre del fichero. */
export async function descargarPdfPresupuesto(datos: Omit<DatosPdfPresupuesto, "logoSvg">): Promise<string> {
  const [{ construirPdfPresupuesto, nombrePdfPresupuesto }, logoSvg] = await Promise.all([import("./pdf"), cargarLogoSvg()]);
  const bytes = await construirPdfPresupuesto({ ...datos, logoSvg });
  const nombre = nombrePdfPresupuesto(datos.presupuesto.numero);
  descargarFichero(bytes, nombre);
  return nombre;
}
