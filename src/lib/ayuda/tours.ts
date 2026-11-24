// ---------------------------------------------------------------------------
// Tours guiados del panel (driver.js), uno por sección.
//
// Cada paso apunta a un elemento marcado con `data-tour="<id>"` en la pantalla
// real. Si el paso dice `pestana` (el `data-tour` del botón de una pestaña, o
// la cadena pestaña › subpestaña), el tour la abre antes de enseñarlo (solo cambia de pestaña: nunca
// rellena ni guarda nada) y espera a que el elemento aparezca. Si aun así no
// está a la vista (pantalla estrecha, sin permiso, sin datos):
//   · paso `opcional`: se salta;
//   · paso normal: se enseña igual, centrado y sin resaltar nada.
// Al terminar o cerrar el tour se vuelve a la pestaña en la que estabas.
//
// Para añadir una sección: un id en `SeccionAyuda`, sus pasos en `TOURS`, los
// `data-tour` en sus componentes y un <BotonAyuda seccion="..." /> en su
// cabecera. Su ficha del Centro de Ayuda va en `centroAyuda.ts`.
// Texto: para el dueño y el personal; llano, de tú, sin palabras técnicas.
// ---------------------------------------------------------------------------

export type SeccionAyuda = "facturas" | "peticiones" | "presupuestos" | "trafico_web" | "usuarios";

export type LadoPaso = "top" | "right" | "bottom" | "left";

export interface PasoTour {
  /** Valor de `data-tour` del elemento a resaltar. Sin él, el paso sale centrado. */
  elemento?: string;
  /**
   * `data-tour` del botón de la pestaña que hay que abrir antes de este paso.
   * Si es una subpestaña, la cadena desde la pestaña de fuera, en orden
   * (p. ej. `[Usuarios, Roles]`): así se llega también yendo hacia atrás.
   */
  pestana?: string | string[];
  /**
   * `data-tour` de un botón desplegable (con `aria-expanded`) que hay que
   * desplegar para que el elemento se vea. Solo despliega: nunca envía nada.
   */
  abrir?: string;
  titulo: string;
  texto: string;
  /** Si el elemento no está a la vista, el paso se salta en vez de salir centrado. */
  opcional?: boolean;
  lado?: LadoPaso;
}

/** Marca del botón «?» de cada cabecera (lo pone `BotonAyuda`). */
export const TOUR_BOTON_AYUDA = "boton-ayuda";

const PASO_FINAL: PasoTour = {
  elemento: TOUR_BOTON_AYUDA,
  titulo: "¿Quieres repasarlo?",
  texto:
    "Pulsa este botón «?» siempre que quieras volver a ver este recorrido. En «Ayuda», en el menú de la izquierda, tienes además las preguntas más frecuentes.",
  lado: "bottom",
};

const P_NUEVA = "peticiones-pestana-nueva";
const P_MIAS = "peticiones-pestana-mias";
const F_COMPRAS = "facturas-pestana-compras";
const F_CARGAR = "facturas-pestana-cargar";

export const TOURS: Record<SeccionAyuda, PasoTour[]> = {
  facturas: [
    {
      titulo: "Facturas",
      texto:
        "Aquí guardas las facturas de los proveedores: vidrio, perfiles, herrajes, siliconas… Les haces una foto o subes el PDF, la aplicación las lee sola y luego puedes buscar qué compraste, a quién y a qué precio. Te lo enseñamos en un momento: el recorrido abre cada pestaña solo.",
    },
    {
      elemento: F_COMPRAS,
      pestana: F_COMPRAS,
      titulo: "1. Compras",
      texto: "En «Compras» está todo lo que se ha leído: las facturas, los productos y los proveedores. Es la pestaña que más vas a usar.",
      lado: "bottom",
    },
    {
      elemento: "facturas-buscar",
      pestana: F_COMPRAS,
      titulo: "Un solo buscador",
      texto:
        "Escribe un producto («templado 8»), un proveedor o un número de factura. Busca también dentro de las líneas de cada factura.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-modos",
      pestana: F_COMPRAS,
      titulo: "Documentos, productos y proveedores",
      texto:
        "«Documentos» enseña las facturas por meses. «Productos», lo que compras, cuánto gastas por categoría, qué ha subido de precio y cómo ha cambiado cada precio. «Proveedores», de más a menos gasto: toca uno y se despliega con sus datos y sus facturas. El número dice cuántos resultados hay.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-periodo",
      pestana: F_COMPRAS,
      titulo: "Periodo",
      texto: "Elige este mes, el anterior, el trimestre o el año. Las sumas de la lista y de los proveedores cambian con él.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-filtros",
      pestana: F_COMPRAS,
      titulo: "Filtros",
      texto: "Toca un filtro para ver solo una parte: los abonos, las que tienen avisos o las que nadie ha revisado todavía.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-lista",
      pestana: F_COMPRAS,
      titulo: "La lista",
      texto:
        "Cada fila es una factura: fecha, proveedor, número, avisos e importe con IVA. Toca una para abrirla con su original al lado; el icono de la derecha abre solo el original.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: F_CARGAR,
      pestana: F_CARGAR,
      titulo: "2. Cargar",
      texto:
        "En «Cargar» subes las facturas. La aplicación lee sola el proveedor, la fecha, las líneas, los precios (por m², por metro o por unidad) y el IVA. Tarda unos segundos y puedes seguir trabajando mientras: te avisa al terminar.",
      lado: "bottom",
    },
    {
      elemento: "facturas-cargar-botones",
      pestana: F_CARGAR,
      titulo: "Foto o archivo",
      texto:
        "Con «Hacer foto» abres la cámara; con el otro botón eliges PDF o fotos (varias a la vez, también las páginas de una misma factura). Si ya estaba subida, te lo dice y puedes sustituirla o añadirle la página.",
      opcional: true,
      lado: "bottom",
    },
    PASO_FINAL,
  ],
  peticiones: [
    {
      titulo: "Peticiones",
      texto:
        "Aquí cuentas cualquier cosa del panel: algo que no funciona, algo que te falta o una duda. Lo revisamos y te contestamos aquí mismo. Te lo enseñamos en un momento: el recorrido abre cada pestaña solo.",
    },
    {
      elemento: P_NUEVA,
      pestana: P_NUEVA,
      titulo: "1. Nueva petición",
      texto: "En «Nueva petición» escribes lo que pasa. Cuanto más claro, antes lo arreglamos.",
      lado: "bottom",
    },
    {
      elemento: "peticiones-titulo",
      pestana: P_NUEVA,
      titulo: "Título y descripción",
      texto:
        "Un título corto («No puedo cambiar la contraseña») y, en la descripción, qué estabas haciendo, qué esperabas y qué ha pasado.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "peticiones-prioridad",
      pestana: P_NUEVA,
      titulo: "Prioridad",
      texto:
        "Marca «Urgente» solo si no puedes trabajar: avisa al momento a quien lo gestiona. Para lo demás, «Normal» va bien.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "peticiones-enviar",
      pestana: P_NUEVA,
      titulo: "Enviar",
      texto: "Puedes añadir una captura de pantalla. Al enviar, la petición pasa a «Mis peticiones».",
      opcional: true,
      lado: "top",
    },
    {
      elemento: P_MIAS,
      pestana: P_MIAS,
      titulo: "2. Mis peticiones",
      texto:
        "Aquí ves todas las que has enviado y en qué estado están: recibida, en curso, resuelta o descartada (con el motivo). El número indica cuántas siguen abiertas.",
      lado: "bottom",
    },
    PASO_FINAL,
  ],
  usuarios: [
    {
      titulo: "Usuarios",
      texto: "Aquí ves quién tiene acceso al panel y qué puede ver o cambiar cada persona.",
    },
    {
      elemento: "usuarios-resumen",
      titulo: "Resumen",
      texto: "Cuántos usuarios hay y cuántos tienen el acceso activo o bloqueado.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "usuarios-lista",
      titulo: "La lista",
      texto:
        "Cada fila es una persona: su nombre, su tipo de usuario y sus accesos. Con «Permisos» ves sección a sección qué puede ver («Ver») y qué puede cambiar («Editar»).",
      opcional: true,
      lado: "top",
    },
    PASO_FINAL,
  ],
  presupuestos: [
    {
      titulo: "Presupuestos",
      texto:
        "Aquí preparas los presupuestos de los clientes con la misma calculadora de la web y las tarifas que tengas puestas en Web › Tarifas. También llegan aquí, solas, las solicitudes que mandan los clientes desde la calculadora de la web.",
    },
    {
      elemento: "presupuestos-nuevo",
      titulo: "Nuevo presupuesto",
      texto: "Pon el nombre del cliente (y, si lo tienes, su teléfono) y se abre con su número, listo para añadir líneas.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "presupuestos-filtros",
      titulo: "Por estado",
      texto:
        "«Solicitudes» son las que han llegado de la web y nadie ha atendido todavía: el número te dice cuántas hay. Después van «Borradores», «Enviados», «Aceptados» y «Rechazados». Un enviado cuya validez ya ha pasado sale como «Caducado».",
      lado: "bottom",
    },
    {
      elemento: "presupuestos-buscar",
      titulo: "Buscar",
      texto: "Escribe el número, el nombre del cliente o su teléfono (con o sin espacios).",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "presupuestos-lista",
      titulo: "La lista",
      texto:
        "Toca uno para abrirlo. En las solicitudes ves lo que escribió el cliente y el precio que le dio la web; con «Convertir en borrador» lo coges para trabajarlo.",
      opcional: true,
      lado: "top",
    },
    {
      titulo: "Dentro de un presupuesto",
      texto:
        "«Añadir desde calculadora» rellena una línea con las medidas y opciones y su precio (el de la calculadora lleva el IVA incluido; la línea va sin IVA); «Línea manual», lo que no sale en la calculadora. Cambia cantidades y precios en la misma línea, ordénalas arrastrando y pon descuento e IVA en los totales. Luego descárgalo en PDF o envíalo por WhatsApp o correo y márcalo como enviado.",
    },
    PASO_FINAL,
  ],
  trafico_web: [
    {
      titulo: "Tráfico web",
      texto:
        "Aquí ves cuánta gente entra en la web de la cristalería y qué hace: cuántas visitas hay cada día, qué páginas miran, de dónde vienen y cuántos usan la calculadora, piden presupuesto o te escriben por WhatsApp. Las cifras se ponen al día cada noche.",
    },
    {
      elemento: "trafico-filtros",
      titulo: "El periodo",
      texto: "Elige si quieres ver los últimos 30, 90, 180 o 365 días. Todo lo de la página (cifras, gráfica, páginas y comportamiento) cambia a ese periodo.",
      lado: "bottom",
    },
    {
      elemento: "trafico-kpis",
      titulo: "Las cifras",
      texto:
        "Las visitas y los visitantes del periodo, comparados con el periodo anterior, y hacia dónde va la tendencia. Si todavía hay pocos días, lo avisa: con más datos las cifras son más fiables.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "trafico-grafica",
      titulo: "Día a día",
      texto:
        "La gráfica enseña las visitas de cada día y marca los días raros (muchas más o muchas menos visitas de lo normal para ese día de la semana). Debajo tienes las páginas más vistas y de dónde llegan los visitantes.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "trafico-comportamiento",
      titulo: "Qué hacen los visitantes",
      texto:
        "Cuántos han usado la calculadora, cuántos han pedido presupuesto, cuántos han pulsado WhatsApp o el teléfono y qué trabajos y servicios miran más. La web no usa cookies ni guarda quién eres: solo cuenta lo que pasa.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "trafico-pesos",
      titulo: "Pesos por página",
      texto:
        "Sirve para estimar cuánta transferencia gasta la web al mes (el plan gratuito de Vercel tiene un límite). Si no sabes qué poner, déjalo como está.",
      opcional: true,
      lado: "bottom",
    },
    PASO_FINAL,
  ],
};

export const selectorTour = (id: string): string => `[data-tour="${id}"]`;

/** Pestañas que hay que abrir, en orden, antes de un paso (de fuera a dentro). */
export const cadenaPestanas = (paso: PasoTour): string[] =>
  paso.pestana === undefined ? [] : Array.isArray(paso.pestana) ? paso.pestana : [paso.pestana];

/** Botones de pestaña principales (las de fuera) distintos que usa un tour, en orden. */
export const pestanasDelTour = (pasos: PasoTour[]): string[] =>
  Array.from(new Set(pasos.map((p) => cadenaPestanas(p)[0]).filter((p): p is string => Boolean(p))));

/**
 * Espera (sondeando) a que `buscar()` devuelva algo, como mucho `maxMs`.
 * Devuelve lo encontrado o null si no aparece a tiempo.
 */
export function esperarA<E>(buscar: () => E | null, maxMs: number, cadaMs = 50): Promise<E | null> {
  return new Promise((resolver) => {
    const inicio = Date.now();
    const mirar = () => {
      const encontrado = buscar();
      if (encontrado) return resolver(encontrado);
      if (Date.now() - inicio >= maxMs) return resolver(null);
      window.setTimeout(mirar, cadaMs);
    };
    mirar();
  });
}

/** Clave de localStorage: «ya ha visto el tour» por sección y usuario. */
export const claveTourVisto = (seccion: SeccionAyuda, usuarioId?: string | null): string =>
  `ayuda:tour-visto:${seccion}:${usuarioId ?? "anonimo"}`;

/** Estado que se pasa al navegar (`navigate(ruta, { state })`) para lanzar el tour al llegar. */
export interface EstadoLanzarTour {
  lanzarTour: SeccionAyuda;
}

export const esEstadoLanzarTour = (estado: unknown): estado is EstadoLanzarTour =>
  typeof estado === "object" &&
  estado !== null &&
  typeof (estado as { lanzarTour?: unknown }).lanzarTour === "string" &&
  (estado as { lanzarTour: string }).lanzarTour in TOURS;

// Cambio de pestaña hecho por el tour (no por el usuario). Las pantallas que
// guardan la pestaña en la URL lo miran para no apilar historial: si no, al
// acabar el tour «Atrás» recorre todas las pestañas que enseñó.
let pestanaPorTour = false;

/** Ejecuta `cambiar` marcándolo como cambio de pestaña del tour (Radix avisa en el mismo `mousedown`). */
export function cambiarPestanaComoTour(cambiar: () => void): void {
  pestanaPorTour = true;
  try {
    cambiar();
  } finally {
    pestanaPorTour = false;
  }
}

/** ¿El cambio de pestaña en curso lo está haciendo el tour? */
export const esCambioDePestanaDelTour = (): boolean => pestanaPorTour;
