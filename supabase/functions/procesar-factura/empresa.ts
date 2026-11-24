// ============================================================================
//  empresa.ts · Quién es el CLIENTE en las facturas que se leen
// ----------------------------------------------------------------------------
//  En toda factura de proveedor Cristalería Baix Vinalopó es el destinatario:
//  su nombre y su CIF nunca pueden guardarse como los del proveedor (el modelo
//  a veces copia el bloque «Facturar a»). El nombre va fijo; el CIF, en el
//  secreto opcional FACTURAS_CIF_EMPRESA (y en configuracion_facturas.cif_empresa
//  para la base de datos). Sin el secreto, solo se reconoce por el nombre.
//  No lee el entorno al cargarse: los tests no tienen Deno.
// ============================================================================

/** Nombre del cliente tal como se le dice al modelo. */
export const NOMBRE_EMPRESA = "Cristalería Baix Vinalopó";

/** Formas en que aparece el cliente en el papel («CRISTALERIA BAIX VINALOPO, S.L.», «Cristalería BV»…). */
export const NOMBRES_EMPRESA = /\bcristaler[ií]a\s+(baix\s+vinal[oó]p[oó]|b\.?\s?v\.?)(?![a-z])/i;

type LectorEnv = (nombre: string) => string | undefined;

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } })
    .Deno?.env.get(nombre);
}

/** CIF normalizado para comparar: mayúsculas, sin espacios, puntos ni guiones. */
export function normalizarCif(cif: string | null | undefined): string {
  return String(cif ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^ES(?=[A-Z0-9]{9}$)/, "");
}

/** CIF de la empresa (secreto FACTURAS_CIF_EMPRESA), normalizado. "" si no está configurado. */
export function cifEmpresa(env: LectorEnv = envDeDeno): string {
  return normalizarCif(env("FACTURAS_CIF_EMPRESA"));
}
