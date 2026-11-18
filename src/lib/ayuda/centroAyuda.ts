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
];

/** ¿Es un archivo de vídeo (se enseña con <video>) y no un enlace de inserción (<iframe>)? */
export const esArchivoVideo = (url: string): boolean => /\.(webm|mp4|m4v|ogv|mov)(\?.*)?$/i.test(url);
