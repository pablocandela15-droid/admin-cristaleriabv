import type { SeccionAyuda } from "./tours";

// ---------------------------------------------------------------------------
// Contenido del Centro de Ayuda (/ayuda): una ficha por sección del panel.
// Para el dueño y el personal: llano, de tú, sin palabras técnicas.
// Los pasos van en bloques con título (`grupos`), de principio a fin; la
// numeración sigue de un bloque al siguiente.
// `videoUrl` (opcional): vídeo corto de la sección. Puede ser un archivo propio
// (`/ayuda/videos/<seccion>.mp4`, en `public/`; se generan con
// `scripts/videos-ayuda/`) o un enlace de inserción (YouTube «embed», Vimeo,
// Loom…). Si no hay, no se enseña nada.
// ---------------------------------------------------------------------------

export interface PreguntaFrecuente {
  pregunta: string;
  respuesta: string;
}

/** Un bloque de pasos con su título («1. Subir», «2. Revisar»…). */
export interface GrupoPasos {
  titulo: string;
  pasos: string[];
}

export interface FichaAyuda {
  seccion: SeccionAyuda;
  titulo: string;
  /** Ruta de la sección (a la que lleva «Ver tour»). */
  ruta: string;
  /** Qué es, en una o dos frases. */
  queEs: string;
  /** Cómo se usa, paso a paso, en bloques. */
  grupos: GrupoPasos[];
  preguntas: PreguntaFrecuente[];
  videoUrl?: string;
}

/** Todos los pasos de una ficha, en orden (sin los títulos de bloque). */
export const pasosDeFicha = (ficha: FichaAyuda): string[] => ficha.grupos.flatMap((g) => g.pasos);

export const FICHAS_AYUDA: FichaAyuda[] = [
  {
    seccion: "peticiones",
    titulo: "Nueva petición",
    ruta: "/peticiones",
    queEs:
      "Aquí cuentas cualquier cosa del panel: algo que no funciona, algo que te falta o una duda. Lo revisamos y te contestamos aquí mismo, en «Mis peticiones».",
    grupos: [
      {
        titulo: "Enviar una petición",
        pasos: [
          "Entra en «Nueva petición» (menú de la izquierda). Si llegas desde otra sección, el módulo afectado ya viene puesto.",
          "Escribe un título corto y, en la descripción, qué estabas haciendo, qué esperabas que pasara y qué ha pasado.",
          "Elige la prioridad. «Urgente» avisa al momento: úsala solo si no puedes trabajar.",
          "Si ayuda, añade una captura de pantalla y pulsa «Enviar petición».",
        ],
      },
      {
        titulo: "Seguir cómo va",
        pasos: [
          "En «Mis peticiones» ves todas las que has enviado, de la más nueva a la más vieja, con su estado: recibida, en curso, resuelta o descartada.",
          "Si se descarta, verás el motivo. Si sigue pasando, envía otra con más detalle.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "¿Quién ve mis peticiones?",
        respuesta: "Tú y el equipo que mantiene el panel. El resto de usuarios no las ve.",
      },
      {
        pregunta: "¿Cuántas puedo enviar?",
        respuesta: "Hasta 20 al día. Si tienes muchas cosas, júntalas en una sola petición.",
      },
      {
        pregunta: "No veo alguna sección, ¿es un error?",
        respuesta: "Cada persona ve solo las partes que tiene permitidas. Si necesitas otra, pídesela al encargado.",
      },
    ],
  },
  {
    seccion: "usuarios",
    titulo: "Usuarios",
    ruta: "/usuarios",
    queEs: "Aquí ves quién tiene acceso al panel y qué puede ver o cambiar cada persona.",
    grupos: [
      {
        titulo: "Consultar",
        pasos: [
          "Entra en «Usuarios». Cada fila es una persona con su nombre, su tipo de usuario y sus accesos.",
          "Pulsa «Permisos» para ver, sección a sección, qué puede ver («Ver») y qué puede cambiar («Editar»).",
        ],
      },
      {
        titulo: "Dar de alta, cambiar permisos o bloquear",
        pasos: [
          "Las altas, los cambios de permisos, las contraseñas y los bloqueos los hace el administrador desde Super Admin › Usuarios.",
          "Si alguien necesita otra sección o ha olvidado su contraseña, pídeselo al administrador (o envía una «Nueva petición»).",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "¿Qué diferencia hay entre «Ver» y «Editar»?",
        respuesta: "Con «Ver» la persona entra en la sección y consulta; con «Editar» además puede cambiar cosas.",
      },
      {
        pregunta: "¿Cómo cambio mi contraseña?",
        respuesta: "Pulsa tu nombre, abajo en el menú de la izquierda («Mi cuenta»), y después «Cambiar contraseña».",
      },
    ],
  },
  {
    seccion: "facturas",
    titulo: "Facturas",
    ruta: "/facturas?tab=compras",
    queEs:
      "Aquí se guardan las facturas de los proveedores. Les haces una foto o subes el PDF, la aplicación las lee sola, comprueba que cuadren y luego puedes buscar qué compraste, a quién, cuándo y a qué precio.",
    grupos: [
      {
        titulo: "Subir facturas",
        pasos: [
          "Entra en «Facturas» y abre la pestaña «Cargar».",
          "Pulsa «Hacer foto» para usar la cámara o elige PDF y fotos del dispositivo. Puedes subir varias a la vez, y las páginas de una misma factura juntas.",
          "Se leen solas en unos segundos (las largas, por trozos en el servidor). Puedes seguir trabajando: el aviso del menú te dice cuántas quedan.",
          "Si una factura ya estaba subida, te lo dice: puedes dejar la que había, sustituirla por la nueva o, si es otra página, añadírsela.",
        ],
      },
      {
        titulo: "Revisar lo leído",
        pasos: [
          "En «Compras» › «Documentos» están todas, por meses. Las que cuadran (base + IVA = total, sin precios raros, de un proveedor conocido) se marcan solas como «Revisada auto».",
          "Abre una para ver sus datos y sus líneas con el original al lado. Con «Editar» corriges lo que se haya leído mal y la das por revisada.",
          "Los avisos (un total que no cuadra, un precio que dobla lo normal…) salen en la fila y en la ficha. Al marcarla como revisada desaparecen.",
        ],
      },
      {
        titulo: "Productos, precios y proveedores",
        pasos: [
          "En «Productos» tienes lo que compras agrupado (por ejemplo «Vidrio templado 8 mm incoloro» o «Silicona neutra transparente»), con su categoría y lo que has gastado.",
          "Toca un producto para ver la gráfica de su precio con cada proveedor y en qué facturas aparece. «Subieron de precio» te enseña los que han llegado más caros.",
          "En «Proveedores» ves a quién le compras más; toca uno para ver cada cuánto le compras, qué le compras y sus facturas.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "¿Tengo que revisar todas las facturas?",
        respuesta:
          "No. Las que cuadran se dan por revisadas solas. Mira las que tienen avisos o salen como «Sin revisar»: con el original al lado se hace rápido.",
      },
      {
        pregunta: "¿Cómo sé si algo ha subido de precio?",
        respuesta:
          "Te avisa la campana cuando una compra llega más cara que lo normal (el porcentaje se cambia en «Productos» › «Avisos de precio»). También puedes filtrar «Subieron de precio» en «Productos».",
      },
      {
        pregunta: "¿Dónde está el papel original?",
        respuesta:
          "Se guarda con la factura. Ábrelo desde la ficha (sale al lado de los datos) o con el icono de la derecha de cada fila de la lista.",
      },
      {
        pregunta: "Solo puedo subir, ¿por qué no veo «Compras»?",
        respuesta:
          "Con el permiso «Facturas · Subida» subes facturas y corriges lo que has subido tú. Para consultar todas hace falta «Ver» en Facturas: pídeselo al encargado.",
      },
    ],
  },
  {
    seccion: "presupuestos",
    titulo: "Presupuestos",
    ruta: "/presupuestos",
    queEs:
      "Aquí haces los presupuestos de los clientes con la calculadora de la web y tus tarifas, los descargas en PDF con el logotipo y los envías por WhatsApp o por correo. Las solicitudes que mandan los clientes desde la calculadora de la web también llegan aquí.",
    grupos: [
      {
        titulo: "Hacer un presupuesto",
        pasos: [
          "Pulsa «Nuevo presupuesto», escribe el nombre del cliente (y su teléfono si lo tienes) y pulsa «Crear y abrir». El número (P-2026-0001…) lo pone el panel.",
          "«Añadir desde calculadora»: elige qué es (mampara, espejo, cerramiento…), rellena las medidas y las opciones y pulsa «Añadir al presupuesto». La línea sale con el detalle de lo elegido y el precio de tus tarifas de hoy.",
          "Lo que no está en la calculadora (desplazamiento, retirar un cristal…) va con «Línea manual».",
          "En cada línea puedes cambiar la descripción, el detalle, la cantidad y el precio; se guarda al salir del campo. Ordénalas arrastrando o con las flechas.",
          "En «Totales» pon el descuento y el IVA (21 % de serie). Revisa las condiciones y la validez y pulsa «Guardar cambios».",
        ],
      },
      {
        titulo: "Enviarlo",
        pasos: [
          "«Descargar PDF» baja el presupuesto con el logotipo, tus datos (los de Web › Contenido), el cliente, las líneas, los totales y las condiciones.",
          "«Enviar por WhatsApp» abre WhatsApp con el móvil del cliente y un mensaje con el número, el total y la validez.",
          "«Enviar por email» descarga el PDF y abre tu correo con el asunto y el texto puestos: adjunta tú el PDF antes de enviarlo.",
          "Después pulsa «Marcar como enviado». Cuando el cliente conteste, márcalo como «Aceptado» o «Rechazado».",
        ],
      },
      {
        titulo: "Solicitudes de la web",
        pasos: [
          "Cuando un cliente pide presupuesto desde la calculadora de la web, te llega un aviso a la campana y sale en «Solicitudes» con lo que escribió y el precio que le dio la web.",
          "Pulsa «Convertir en borrador» para trabajarlo: revisa las medidas con «Recalcular», añade lo que falte y envíaselo.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "He cambiado las tarifas, ¿se cambian los presupuestos que ya tenía?",
        respuesta:
          "No: cada línea guarda su precio. Si con las tarifas de hoy sale otro, la línea lo avisa («Tarifa de hoy») y con «Recalcular» la pones al día si quieres.",
      },
      {
        pregunta: "¿Por qué el total es más alto que el precio que vio el cliente en la web?",
        respuesta:
          "El precio de la web va como precio de la línea y el presupuesto le suma el IVA. Si ese precio ya llevaba el IVA, cambia el precio de la línea o pon el IVA que corresponda.",
      },
      {
        pregunta: "¿Qué significa «Caducado»?",
        respuesta: "Que se envió y ya ha pasado su validez sin que el cliente conteste. Puedes duplicarlo para hacerle uno nuevo con fecha de hoy.",
      },
      {
        pregunta: "No puedo cambiar nada, ¿por qué?",
        respuesta: "Tienes permiso para ver los presupuestos pero no para cambiarlos (sale «Solo lectura»). Pídeselo al encargado.",
      },
    ],
  },
];

/** ¿Es un archivo de vídeo (se enseña con <video>) y no un enlace de inserción (<iframe>)? */
export const esArchivoVideo = (url: string): boolean => /\.(webm|mp4|m4v|ogv|mov)(\?.*)?$/i.test(url);
