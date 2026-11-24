import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ProductoFactura {
  id: number;
  producto_nombre: string;
  precio: number;
  cantidad?: number;
  unidad?: string | null;
  /**
   * Piezas de una línea facturada por superficie o longitud
   * (`productos_factura.bultos`): «4 ud · 3,2 m²». En ese caso `cantidad` son
   * los m² (o los metros) y `precio_unitario` es por m² (o por metro).
   * null/ausente si la línea va por unidades.
   */
  bultos?: number | null;
  proveedor: string | null;
  precio_unitario?: number;
  /**
   * Categoría del producto canónico de la línea (Compras › Productos).
   * null/ausente = sin clasificar. Solo lectura aquí: se cambia en Productos.
   */
  categoria?: { nombre: string; ruta: string } | null;
  /** Nombre del producto canónico (productos_catalogo) si la línea lo tiene. */
  producto_canonico?: string | null;
  /** Id del producto canónico: enlaza la línea con su ficha en Compras › Productos. */
  producto_id?: number | null;
  /**
   * Lo que VALE lo recibido aunque venga con descuento o regalado: cantidad ×
   * precio antes de descuento, y si es un cálculo con el precio de otras
   * facturas del proveedor (`importe_bruto_estimado`).
   */
  descuento_pct?: number | null;
  importe_bruto?: number | null;
  importe_bruto_estimado?: boolean;
  /**
   * Precio de referencia de la línea: media del precio unitario de las DEMÁS
   * líneas con el mismo nombre y del mismo proveedor (lo calcula
   * `documento_compras()`). null = sin con qué comparar; ausente = no se ha
   * calculado.
   */
  media_referencia?: number | null;
}

/** Una anomalia de importes detectada por `procesar-factura` al cargar el documento. */
export interface AlertaValidacion {
  codigo: string;
  severidad: "alta" | "media" | string;
  mensaje: string;
  detalle?: Record<string, unknown>;
}

export interface Factura {
  id: number;
  numero_documento: string;
  proveedor: string | null;
  /**
   * `facturas.proveedor_normalizado`: minúsculas, sin acentos ni sufijo legal:
   * el nombre CANÓNICO del proveedor asignado (lo mantiene un trigger). Es lo
   * que permite saber que "Vidrios del Vinalopó, S.L." y "VIDRIOS DEL VINALOPO
   * SL" son el mismo proveedor. Opcional para no romper los mocks que no la traen.
   */
  proveedor_normalizado?: string | null;
  cif: string | null;
  fecha: string;
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  /**
   * De donde sale `total`:
   *   'leido'    — lo extrajo el modelo del documento (lo pone el papel).
   *   'deducido' — NO lo pone el papel: lo calculo `procesar-factura` con
   *                aritmetica exacta (subtotal + IVA, o la suma de las
   *                lineas) porque el bloque de totales no se veia en la
   *                imagen (p. ej. una foto con el pie fuera del encuadre).
   *   null       — el documento no tiene total.
   * Un total deducido por suma de lineas es la BASE de esas lineas: si el
   * original llevaba IVA que no se ve, el importe real es mayor. Por eso hay
   * que poder distinguirlo en pantalla de uno leido.
   */
  total_origen: "leido" | "deducido" | null;
  observaciones: string | null;
  productos: ProductoFactura[];
  /** Ruta del original en el bucket privado `facturas-originales` (originales/AAAA/MM/…). */
  archivo_path: string | null;
  /** Avisos de cordura de importes. Array vacio = sin anomalias. */
  alertas: AlertaValidacion[];
  procesado_en: string | null;
  created_at: string | null;
  verificada: boolean;
  /**
   * Quién la dio por revisada: 'auto' = cuadra todo y el proveedor es
   * conocido, no la ha mirado nadie; 'manual' = una persona. null = sin revisar.
   */
  verificacion_origen?: "auto" | "manual" | null;
  /**
   * Retención de IRPF: alquileres, gestoría,
   * profesionales. Mismo signo que la base; null = sin retención. `total` ya
   * la descuenta (total = subtotal + iva − retencion_irpf: lo que se paga).
   */
  retencion_irpf?: number | null;
  /** Porcentaje de esa retención (19, 15…); null si no se sabe. */
  retencion_irpf_pct?: number | null;
}

/** La ficha de `documento_compras(id)` como `Factura`. */
export function aFacturaDetalle(doc: Record<string, unknown>): Factura {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const lineas = Array.isArray(doc.productos) ? (doc.productos as Record<string, unknown>[]) : [];
  return {
    id: Number(doc.id),
    numero_documento: String(doc.numero_documento ?? ""),
    proveedor: (doc.proveedor as string | null) ?? null,
    proveedor_normalizado: (doc.proveedor_normalizado as string | null) ?? null,
    cif: (doc.cif as string | null) ?? null,
    fecha: String(doc.fecha ?? ""),
    subtotal: n(doc.subtotal),
    iva: n(doc.iva),
    total: n(doc.total),
    total_origen: doc.total_origen === "leido" || doc.total_origen === "deducido" ? doc.total_origen : null,
    retencion_irpf: n(doc.retencion_irpf) || null,
    retencion_irpf_pct: n(doc.retencion_irpf_pct) || null,
    observaciones: (doc.observaciones as string | null) ?? null,
    productos: lineas.map((p) => {
      const precioUnitario = Number(p.precio_unitario) || 0;
      const cantidad = Number(p.cantidad) || 0;
      const categoria = p.categoria as { nombre?: unknown; ruta?: unknown } | null;
      return {
        id: Number(p.id),
        producto_nombre: String(p.nombre ?? ""),
        // El importe IMPRESO (0 en un regalo); solo si no hay importe se calcula.
        precio: p.total != null && p.total !== "" ? Number(p.total) : precioUnitario * cantidad,
        cantidad,
        unidad: (p.unidad as string | null) ?? null,
        bultos: n(p.bultos),
        proveedor: null,
        precio_unitario: precioUnitario,
        categoria: categoria && typeof categoria.nombre === "string" ? { nombre: categoria.nombre, ruta: String(categoria.ruta ?? categoria.nombre) } : null,
        producto_canonico: (p.producto_canonico as string | null) ?? null,
        producto_id: p.producto_id != null ? Number(p.producto_id) : null,
        descuento_pct: n(p.descuento_pct),
        importe_bruto: n(p.importe_bruto),
        importe_bruto_estimado: p.importe_bruto_estimado === true,
        media_referencia: n(p.media_referencia),
      };
    }),
    archivo_path: (doc.archivo_path as string | null) ?? null,
    alertas: Array.isArray(doc.alertas_validacion) ? (doc.alertas_validacion as AlertaValidacion[]) : [],
    procesado_en: (doc.procesado_en as string | null) ?? null,
    created_at: (doc.created_at as string | null) ?? null,
    verificada: doc.verificada === true,
    verificacion_origen: doc.verificacion_origen === "auto" || doc.verificacion_origen === "manual" ? doc.verificacion_origen : null,
  };
}

// ─── Qué se refresca tras un cambio ─────────────────────────────────────────
// Además de ['facturas'] (lista, fichas y búsquedas de Compras), lo que se calcula con las líneas o los importes: el catálogo y sus líneas
// (['productos']), las gráficas y fichas de Compras (['compras']) y la lista
// de proveedores con sus importes (['proveedores']).
const CLAVE_LISTA = ["facturas", "lista"] as const;

/** Productos, gráficas/fichas de Compras y proveedores. */
export function invalidarDerivadosCompras(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["productos"] });
  qc.invalidateQueries({ queryKey: ["compras"] });
  qc.invalidateQueries({ queryKey: ["proveedores"] });
}

/** Tras cambiar la cabecera de un documento (o subir uno): todo. */
export function invalidarTrasDocumento(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["facturas"] });
  invalidarDerivadosCompras(qc);
}

/**
 * Tras crear o editar una LÍNEA: su ficha, las búsquedas y lo derivado, pero
 * NO se vuelve a bajar la lista entera (≈ 0,5 MB): su cabecera se corrige en
 * la caché (`n_lineas`) y la lista queda marcada como vieja para la próxima
 * vez. Sin la lista en caché, se invalida todo ['facturas'].
 */
export function refrescarTrasLinea(qc: QueryClient, facturaId: number | null | undefined, lineasNuevas = 0) {
  type Lista = { cabeceras: { id: number; n_lineas: number }[] } | undefined;
  const lista = qc.getQueryData<Lista>(CLAVE_LISTA);
  if (!lista) {
    qc.invalidateQueries({ queryKey: ["facturas"] });
  } else {
    qc.invalidateQueries({ queryKey: ["facturas"], predicate: (q) => q.queryKey[1] !== "lista" });
    qc.invalidateQueries({ queryKey: CLAVE_LISTA, refetchType: "none" });
    if (lineasNuevas !== 0 && facturaId != null) {
      qc.setQueryData<Lista>(CLAVE_LISTA, (prev) =>
        prev
          ? { ...prev, cabeceras: prev.cabeceras.map((c) => (c.id === facturaId ? { ...c, n_lineas: c.n_lineas + lineasNuevas } : c)) }
          : prev,
      );
    }
  }
  invalidarDerivadosCompras(qc);
}

export const useUpdateFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Factura> & { id: number }) => {
      // Filtrar los campos que van a 'facturas'
      const dataToUpdate = {
        proveedor: updates.proveedor,
        cif: updates.cif,
        numero_documento: updates.numero_documento,
        fecha: updates.fecha,
        subtotal: updates.subtotal,
        iva: updates.iva,
        total: updates.total,
        // Si un humano guarda el total desde el panel, ese importe deja de
        // ser deducido: lo ha puesto una persona con el documento delante.
        // Sin esto, una factura corregida a mano seguiria luciendo el
        // distintivo de "calculado, no leido" para siempre.
        // El rastro NO se pierde: el aviso `total_deducido` sigue en
        // `alertas_validacion`, que esta pantalla no toca.
        ...(updates.total !== undefined
          ? { total_origen: updates.total === null ? null : ("leido" as const) }
          : {}),
        observaciones: updates.observaciones,
        verificada: updates.verificada,
      };

      // Remover undefined
      Object.keys(dataToUpdate).forEach(key => {
        if (dataToUpdate[key as keyof typeof dataToUpdate] === undefined) {
          delete dataToUpdate[key as keyof typeof dataToUpdate];
        }
      });

      const { data, error } = await supabase
        .from('facturas')
        .update(dataToUpdate)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidarTrasDocumento(queryClient);
      toast.success("Documento actualizado correctamente");
    },
    onError: (error) => {
      console.error("Error al actualizar la factura:", error);
      toast.error("Error al actualizar el documento");
    }
  });
};

/** Añade a mano una línea a un documento (la IA no la detectó). */
export const useCrearProductoFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      factura_id,
      producto_nombre,
      cantidad,
      unidad,
      precio_unitario,
      precio,
    }: {
      factura_id: number;
      producto_nombre: string;
      cantidad?: number;
      unidad?: string;
      precio_unitario?: number;
      precio?: number;
    }) => {
      const fila = {
        factura_id,
        nombre: producto_nombre.trim(),
        cantidad,
        unidad,
        precio_unitario,
        total: precio,
      };
      Object.keys(fila).forEach((key) => {
        if (fila[key as keyof typeof fila] === undefined) delete fila[key as keyof typeof fila];
      });

      const { data, error } = await supabase
        .from('productos_factura')
        .insert(fila as typeof fila & { nombre: string; factura_id: number })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      refrescarTrasLinea(queryClient, vars.factura_id, 1);
      toast.success("Línea añadida");
    },
    onError: (error) => {
      console.error("Error creando producto_factura:", error);
      toast.error("No se ha podido añadir la línea");
    }
  });
};

export const useUpdateProductoFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProductoFactura> & { id: number }) => {
      const dataToUpdate = {
        nombre: updates.producto_nombre,
        precio_unitario: updates.precio_unitario,
        cantidad: updates.cantidad,
        unidad: updates.unidad,
        total: updates.precio,
      };

      // Remover undefined
      Object.keys(dataToUpdate).forEach(key => {
        if (dataToUpdate[key as keyof typeof dataToUpdate] === undefined) {
          delete dataToUpdate[key as keyof typeof dataToUpdate];
        }
      });

      const { data, error } = await supabase
        .from('productos_factura')
        .update(dataToUpdate)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      refrescarTrasLinea(queryClient, (data as { factura_id?: number } | null)?.factura_id ?? null);
      toast.success("Línea de producto actualizada");
    },
    onError: (error) => {
      console.error("Error updating producto_factura:", error);
      toast.error("Error al actualizar el producto");
    }
  });
};
