/**
 * Tarifas de la calculadora de presupuestos.
 *
 * Valores de partida tomados de la web anterior:
 *  - Mampara a medida: fórmula aditiva (200 € + 3 €/cm de ancho + suplementos).
 *  - Resto de categorías: tabla de €/m² y multiplicadores (grosor, tipo de
 *    cristal, cantos, taladros, herrajes) que la web anterior solo aplicaba
 *    a «Otros». Aquí se aplica a cada categoría con su €/m² base.
 *  - Armarios: solo precios de VENTA (los de compra y el margen nunca deben
 *    llegar al navegador).
 *
 * Un multiplicador 1 o un suplemento 0 significa «sin recargo»; los extras a 0 €
 * se muestran al cliente como «se valora en la visita».
 * Cuando Supabase esté configurado, estos valores se sobrescriben con los de la
 * tabla `pricing` (editable desde /admin).
 */
export type FactorTable = Record<string, number>;

export type M2Category = {
  /** € por m² antes de multiplicadores. */
  basePerM2: number;
  /** Multiplicadores por campo → opción. */
  factors: Record<string, FactorTable>;
  /** Suplementos fijos (€ por unidad). */
  extras: Record<string, number>;
};

export type PricingConfig = {
  version: number;
  /** Nota que acompaña siempre al precio. */
  priceNote: string;
  mamparas: {
    base: number;
    perCmWidth: number;
    tallOverCm: number;
    tallSurcharge: number;
    cristal: FactorTable;
    extraclaro: number;
    perfileria: FactorTable;
    acabadoPerfil: FactorTable;
    acabadoCristal: FactorTable;
  };
  domino: M2Category;
  espejos: M2Category;
  cerramientos: M2Category;
  aluminio: M2Category;
  barandillas: M2Category;
  otros: M2Category & { hardware: FactorTable };
  armarios: {
    casacaMl: number;
    tubo4040Ml: number;
    tubo6040Ml: number;
    guiaSuperiorMl: number;
    guiaInferiorMl: number;
    tapeta: number;
    rueda: number;
    tirador: number;
    cristalM2: FactorTable;
    maderaM2: FactorTable;
    acabadoM2: FactorTable;
  };
  entrega: { envio: number; montajeMin: number; montajeMax: number };
};

const ones = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, 1]));

export const DEFAULT_PRICING: PricingConfig = {
  version: 1,
  priceNote: "Precio orientativo, sujeto a confirmación tras la visita técnica.",

  mamparas: {
    base: 200,
    perCmWidth: 3,
    tallOverCm: 200,
    tallSurcharge: 50,
    cristal: { "templado-6mm": 0, "templado-8mm": 0, "templado-10mm": 100 },
    extraclaro: 80,
    perfileria: { "sin-perfil": 0, minima: 0, completa: 60 },
    acabadoPerfil: { cromo: 0, blanco: 0, negro: 40, "oro-cepillado": 40 },
    acabadoCristal: { serigrafia: 0, acido: 0, antical: 30 },
  },

  domino: {
    basePerM2: 85,
    factors: {
      espesor: { "6": 1.2, "8": 1.4, "10": 1.6, "12": 1.8 },
      tipoCristal: { templado: 1.5, laminado: 1.7, extraclaro: 1.5 },
      acabado: ones("transparente", "satinado", "serigrafado"),
    },
    extras: { extraclaro: 80, antical: 30, tirador: 0, freno: 0, caset: 0, varillaMl: 0 },
  },

  espejos: {
    basePerM2: 65,
    factors: {
      espesor: { "4": 1, "5": 1.1, "6": 1.2 },
      canto: { pulido: 1.15, biselado: 1.25 },
      forma: ones("rectangular", "redondo", "ovalado", "irregular"),
    },
    extras: { iluminacion: 0, antivaho: 0 },
  },

  cerramientos: {
    basePerM2: 150,
    factors: {
      // Proporciones de la tabla original: Climalit 2 / templado 1,5 ≈ 1,33; acústico 2,2 / 1,5 ≈ 1,47.
      tipoVidrio: { simple: 1, doble: 1.33, "bajo-emisivo": 1.47 },
      material: ones("aluminio", "pvc", "madera"),
      tipoCerramiento: ones("terraza", "balcon", "porche", "cortina-cristal"),
      acabado: ones("lacado-blanco", "lacado-gris", "lacado-negro", "anodizado", "imitacion-madera"),
    },
    extras: {},
  },

  aluminio: {
    basePerM2: 180,
    factors: {
      vidrio: { simple: 1, doble: 1.33, "bajo-emisivo": 1.47 },
      tipoApertura: ones("corredera", "abatible", "oscilobatiente", "fija"),
      tipoTrabajo: ones("ventana", "puerta", "mosquitera", "persiana"),
      acabado: ones("lacado-blanco", "lacado-gris", "lacado-negro", "anodizado", "imitacion-madera"),
    },
    extras: {},
  },

  barandillas: {
    basePerM2: 200,
    factors: {
      material: ones("acero-inoxidable", "aluminio", "hierro"),
      relleno: ones("cristal", "barrotes", "cable", "chapa"),
      tipoBarandilla: ones("escalera", "balcon", "terraza", "piscina"),
      acabado: ones("pulido", "satinado", "lacado", "negro-mate"),
    },
    extras: {},
  },

  otros: {
    basePerM2: 75,
    factors: {
      grosor: { "4": 1, "6": 1.2, "8": 1.4, "10": 1.6, "12": 1.8 },
      tipoCristal: { float: 1, templado: 1.5, laminado: 1.7, climalit: 2, acustico: 2.2 },
      cantos: { recto: 1, pulido: 1.15, bisel: 1.25 },
    },
    extras: { taladro: 12 },
    hardware: { none: 0, basic: 80, premium: 150 },
  },

  armarios: {
    casacaMl: 5.2,
    tubo4040Ml: 6,
    tubo6040Ml: 7.5,
    guiaSuperiorMl: 4,
    guiaInferiorMl: 4,
    tapeta: 1.2,
    rueda: 2.5,
    tirador: 5,
    cristalM2: {
      "transparente-6": 40,
      "mate-6": 45,
      "bronce-6": 48,
      "transparente-8": 50,
      "mate-8": 55,
    },
    maderaM2: { melamina: 55, mdf: 48, contrachapado: 65, pino: 70, roble: 95 },
    acabadoM2: { normal: 0, pintado: 25, vinilado: 20 },
  },

  entrega: { envio: 50, montajeMin: 100, montajeMax: 300 },
};
