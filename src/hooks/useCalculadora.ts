// ============================================================================
//  useCalculadora: estado de la calculadora de la web para una categoría
// ----------------------------------------------------------------------------
//  Lo usan «Probar» (Web › Tarifas, con los precios sin guardar) y el gestor de
//  presupuestos. Recibe las categorías YA aplicadas (resolverTarifas) y los
//  precios; guarda los valores de cada categoría por separado (cambiar de
//  categoría y volver no pierde lo escrito) y devuelve el cálculo al momento.
//
//    const { categoria, valores, cambiar, presupuesto, resumen } = useCalculadora(categorias, precios, "mamparas");
//    <CalculadoraCampos categoria={categoria} valores={valores} onCambiar={cambiar} />
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryDef, Quote, Values } from "@/lib/web/pricing/categories";
import type { PricingConfig } from "@/lib/web/pricing/config";
import { calcular, resumenValores, valoresIniciales } from "@/lib/web/calculadora";

export interface EstadoCalculadora<K extends string> {
  /** Id de la categoría elegida. */
  id: K;
  categoria: CategoryDef;
  valores: Values;
  cambiar: (campo: string, valor: Values[string]) => void;
  /** Vuelve a los valores de partida de la categoría. */
  reiniciar: () => void;
  /** Pone unos valores (p. ej. los de una línea de presupuesto para recalcularla). */
  fijarValores: (valores: Values) => void;
  presupuesto: Quote;
  /** «Etiqueta: valor» de lo elegido, una línea por opción. */
  resumen: string;
}

export function useCalculadora<K extends string>(
  categorias: Record<K, CategoryDef>,
  precios: PricingConfig,
  id: K,
  valoresDePartida?: Values,
): EstadoCalculadora<K> {
  const categoria = categorias[id];
  const [porCategoria, setPorCategoria] = useState<Partial<Record<K, Values>>>(() =>
    valoresDePartida ? ({ [id]: valoresDePartida } as Partial<Record<K, Values>>) : {},
  );
  const valores = useMemo(() => porCategoria[id] ?? valoresIniciales(categoria), [porCategoria, id, categoria]);

  // Si el catálogo cambia (p. ej. se oculta una opción en el editor), los valores guardados siguen valiendo:
  // el cálculo de la web ignora las opciones que ya no están.
  useEffect(() => {
    if (valoresDePartida) setPorCategoria((p) => ({ ...p, [id]: valoresDePartida }));
    // Solo al cambiar los valores de partida (otra línea que recalcular).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valoresDePartida]);

  const cambiar = useCallback(
    (campo: string, valor: Values[string]) =>
      setPorCategoria((p) => ({ ...p, [id]: { ...(p[id] ?? valoresIniciales(categoria)), [campo]: valor } })),
    [id, categoria],
  );
  const reiniciar = useCallback(() => setPorCategoria((p) => ({ ...p, [id]: valoresIniciales(categoria) })), [id, categoria]);
  const fijarValores = useCallback((v: Values) => setPorCategoria((p) => ({ ...p, [id]: { ...v } })), [id]);

  const presupuesto = useMemo(() => calcular(categoria, valores, precios), [categoria, valores, precios]);
  const resumen = useMemo(() => resumenValores(categoria, valores), [categoria, valores]);

  return { id, categoria, valores, cambiar, reiniciar, fijarValores, presupuesto, resumen };
}
