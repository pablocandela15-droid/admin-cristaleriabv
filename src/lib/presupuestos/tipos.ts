// ============================================================================
//  Presupuestos: tipos de las filas (migración 20261123100000_web_y_presupuestos)
// ----------------------------------------------------------------------------
//  `presupuestos` (cabecera) y `presupuesto_lineas`. La base pone el número
//  (P-AAAA-NNNN), el importe de cada línea (columna generada) y los totales
//  (subtotal y total con descuento e IVA): el panel los enseña calculados al
//  momento (./totales.ts) y se fía de lo guardado.
// ============================================================================
import type { Values } from "@/lib/web/pricing/categories";

export type EstadoPresupuesto = "solicitud" | "borrador" | "enviado" | "aceptado" | "rechazado";
export type OrigenPresupuesto = "panel" | "web";

export interface Presupuesto {
  id: string;
  numero: string;
  estado: EstadoPresupuesto;
  origen: OrigenPresupuesto;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_email: string | null;
  cliente_direccion: string | null;
  cliente_poblacion: string | null;
  /** Lo que escribió el cliente en la web (solicitudes). */
  notas_cliente: string | null;
  notas_internas: string | null;
  condiciones: string | null;
  /** AAAA-MM-DD */
  fecha: string;
  validez_dias: number;
  descuento_pct: number;
  iva_pct: number;
  /** Los mantiene la base. */
  subtotal: number;
  total: number;
  enviado_en: string | null;
  respondido_en: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface LineaPresupuesto {
  id: string;
  presupuesto_id: string;
  orden: number;
  /** Id de categoría de la calculadora; null = línea manual. */
  categoria: string | null;
  /** Lo que se rellenó en la calculadora (para recalcular). */
  valores: Values | null;
  descripcion: string;
  detalle: string | null;
  cantidad: number;
  precio_unitario: number;
  /** cantidad × precio_unitario (columna generada). */
  importe: number;
  /** Lo que dio la calculadora al añadirla (referencia). */
  precio_calculado: number | null;
  creado_en: string;
}

export interface PresupuestoConLineas extends Presupuesto {
  lineas: LineaPresupuesto[];
}

/** Una línea por guardar (sin id ni presupuesto). */
export interface LineaNueva {
  categoria: string | null;
  valores: Values | null;
  descripcion: string;
  detalle: string | null;
  cantidad: number;
  precio_unitario: number;
  precio_calculado: number | null;
}

/** Lo que se puede cambiar de la cabecera desde el editor. */
export type CabeceraEditable = Pick<
  Presupuesto,
  | "cliente_nombre"
  | "cliente_telefono"
  | "cliente_email"
  | "cliente_direccion"
  | "cliente_poblacion"
  | "notas_internas"
  | "condiciones"
  | "fecha"
  | "validez_dias"
  | "descuento_pct"
  | "iva_pct"
>;

export type CambiosLinea = Partial<Pick<LineaPresupuesto, "descripcion" | "detalle" | "cantidad" | "precio_unitario" | "valores" | "categoria" | "precio_calculado" | "orden">>;
