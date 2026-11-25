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
          "«Añadir desde calculadora»: elige qué es (mampara, espejo, cerramiento…), rellena las medidas y las opciones y pulsa «Añadir al presupuesto». La línea sale con el detalle de lo elegido y el precio de tus tarifas de hoy. Los precios de la calculadora llevan el IVA incluido: la línea lo guarda sin IVA para que el total con IVA sea el precio de la calculadora.",
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
        pregunta: "¿El precio de la web lleva IVA?",
        respuesta:
          "Sí: el precio de la calculadora de la web lleva el IVA incluido. La línea lo guarda sin IVA (sale «Precio web (IVA incl.)» al lado) y el presupuesto le suma el IVA, así el total es el precio que vio el cliente. Si cambias el IVA del presupuesto, las líneas no cambian solas: usa «Recalcular» en las que quieras ajustar.",
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
  {
    seccion: "trafico_web",
    titulo: "Tráfico web",
    ruta: "/trafico-web",
    queEs:
      "Aquí ves cuánta gente entra en la web de la cristalería y qué hace en ella: las visitas de cada día, las páginas más vistas, de dónde llegan y cuántos usan la calculadora, piden presupuesto, pulsan WhatsApp o llaman. Las cifras se ponen al día solas cada noche.",
    grupos: [
      {
        titulo: "Las visitas",
        pasos: [
          "Arriba elige el periodo (30, 90, 180 o 365 días). Todo lo de la página cambia a ese periodo.",
          "Las cifras de arriba son las visitas y los visitantes del periodo, comparados con el periodo anterior, y la tendencia (si suben o bajan). Si aún hay pocos días, la página lo avisa.",
          "La gráfica enseña las visitas día a día y marca los días raros: muchas más o muchas menos visitas de lo normal para ese día de la semana. Debajo están las páginas más vistas y de dónde llegan (Google, Instagram, un enlace…), qué dispositivos usan y de qué país son.",
        ],
      },
      {
        titulo: "Qué hacen los visitantes",
        pasos: [
          "En «Comportamiento de los visitantes» ves cuántos han usado la calculadora, cuántos han pedido presupuesto desde la web, cuántos han pulsado WhatsApp o el teléfono y cuántos han enviado el formulario de contacto.",
          "Los recorridos («embudos») dicen cuántos empiezan a pedir un presupuesto y cuántos lo terminan; así sabes si algo de la web les frena.",
          "También ves qué servicios y qué trabajos miran más. Las solicitudes que llegan aparecen además en Presupuestos › Solicitudes.",
        ],
      },
      {
        titulo: "La transferencia",
        pasos: [
          "La web está en el plan gratuito de Vercel, que tiene un límite de transferencia al mes. «Transferencia del mes» estima cuánto lleva gastado y cuánto gastará a final de mes; si se acerca al límite, avisa.",
          "«Pesos por página» es lo que pesa de media cada página al abrirla. Solo cambia si sabes lo que haces: si no, déjalo como está.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "Hoy no sale nada de hoy, ¿por qué?",
        respuesta:
          "Las visitas se copian cada noche (a las 03:30 UTC) con los días ya cerrados: lo de hoy aparece mañana. El comportamiento de los visitantes, en cambio, se pone al día cada pocos minutos.",
      },
      {
        pregunta: "¿Por qué no coinciden del todo las visitas con lo que hacen los visitantes?",
        respuesta:
          "Son dos cuentas distintas: las visitas las cuenta Vercel y el comportamiento lo cuenta la propia web. Además, quien tiene puesto en su navegador «No rastrear» no se cuenta en el comportamiento. Las cifras se parecen, pero no son exactamente iguales.",
      },
      {
        pregunta: "¿La web usa cookies para esto?",
        respuesta:
          "No. Ni las visitas ni el comportamiento usan cookies ni guardan nada en el móvil o el ordenador del visitante, y no se sabe quién es cada uno: solo se cuenta lo que pasa.",
      },
      {
        pregunta: "Pone «Aún no hay datos», ¿qué hago?",
        respuesta:
          "Si la web acaba de ponerse en marcha, espera a mañana. Si sigue igual, la página te dice qué falta configurar: díselo a quien lleva la parte técnica del panel.",
      },
      {
        pregunta: "No puedo cambiar los pesos por página, ¿por qué?",
        respuesta: "Tienes permiso para ver el tráfico pero no para cambiarlo. Pídeselo al encargado si lo necesitas.",
      },
    ],
  },
  {
    seccion: "newsletter",
    titulo: "Newsletter",
    ruta: "/newsletter",
    queEs:
      "Aquí preparas y envías por correo las novedades y ofertas de la cristalería a los clientes que se han apuntado, ves quién está suscrito y cómo funcionan los envíos. La gente se apunta en la web (al pie de cada página o al pedir presupuesto) y solo recibe correos después de confirmar su dirección.",
    grupos: [
      {
        titulo: "Preparar y enviar",
        pasos: [
          "En «Crear y enviar», elige una plantilla (novedades, oferta, temporada, trabajos, consejos o aviso) o pulsa «Crear con IA» y cuéntale qué quieres comunicar, con fechas y precios reales.",
          "Cambia el asunto, la etiqueta y los bloques (texto, foto, lista de productos, fechas, botón…). Completa lo que va entre [corchetes]. A la derecha ves cómo queda en el ordenador y en el móvil.",
          "Pulsa «Enviar prueba a mi correo» y revísala en tu buzón. Si te gusta el diseño, «Guardar como plantilla».",
          "Pulsa «Enviar» y confírmalo: le llega solo a los suscriptores activos. Cada correo lleva el enlace para darse de baja y los datos del negocio.",
        ],
      },
      {
        titulo: "Suscriptores",
        pasos: [
          "En «Suscriptores» ves los activos, los pendientes (se apuntaron pero no han pulsado el enlace del correo de confirmación) y los dados de baja. Puedes buscar y filtrar.",
          "«Añadir» apunta a alguien que te lo ha pedido en persona: escribe cómo te dio su permiso. Le llega un correo para confirmar y hasta entonces no recibe nada.",
          "«Importar CSV» sube una lista (una columna con el correo y, si quieres, otra con el nombre); «Exportar CSV» la descarga.",
          "En el menú «⋯» de cada persona: reenviar la confirmación, darla de baja o borrar sus datos si te lo pide (supresión RGPD).",
        ],
      },
      {
        titulo: "Estadísticas y configuración",
        pasos: [
          "«Estadísticas» enseña cuántos correos se entregaron, se abrieron y tuvieron clic, y los que rebotaron o se marcaron como spam; debajo, cada envío.",
          "«Configuración» dice qué falta para poder enviar y guarda el remitente, a quién se responde, la dirección de pruebas y cómo se envía.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "¿Por qué hay gente «pendiente»?",
        respuesta:
          "Porque la ley pide que cada persona confirme que su correo es suyo antes de mandarle publicidad. Al apuntarse le llega un correo con un enlace; hasta que lo pulsa no recibe nada. Si en 30 días no lo confirma, se borra solo.",
      },
      {
        pregunta: "Pone que falta configurar, ¿qué hago?",
        respuesta:
          "Hace falta una cuenta de Resend (el servicio que envía los correos) con un dominio propio verificado, su clave en Supabase y el remitente en «Configuración». Díselo a quien lleva la parte técnica: los pasos están en la guía del panel.",
      },
      {
        pregunta: "¿Puedo volver a apuntar a alguien que se dio de baja?",
        respuesta: "No desde el panel: la baja se respeta. Solo vuelve si se apunta él mismo en la web y confirma su correo.",
      },
      {
        pregunta: "Alguien quiere que borremos sus datos, ¿cómo lo hago?",
        respuesta:
          "En «Suscriptores», menú «⋯» de esa persona, «Borrar sus datos (RGPD)». Se borran su suscripción, sus estadísticas y su correo del registro del panel.",
      },
      {
        pregunta: "No veo «Crear y enviar», ¿por qué?",
        respuesta: "Tienes permiso para ver la newsletter pero no para enviarla. Pídeselo al encargado si lo necesitas.",
      },
    ],
  },
  {
    seccion: "rrss",
    titulo: "RRSS",
    ruta: "/rrss",
    queEs:
      "Aquí publicas en Instagram y en la página de Facebook de la cristalería: fotos de los trabajos, carruseles, reels e historias, al momento o programadas. La IA te ayuda con los textos, las ideas y las campañas, y ves qué funciona mejor.",
    grupos: [
      {
        titulo: "Crear y publicar",
        pasos: [
          "En «Crear», marca Instagram, Facebook o las dos y elige el formato: foto, carrusel (de 2 a 10), reel (vídeo) o historia.",
          "Sube las fotos o el vídeo del móvil, o pulsa «Elegir de Web › Fotos» para usar las de cada tipo de trabajo. Con el botón del recorte eliges qué parte se ve.",
          "Escribe el texto o pulsa «Ayuda de la IA»: cuéntale qué se hizo (sin datos del cliente) y te propone tres textos con hashtags. Elige uno y revísalo.",
          "Mira a la derecha cómo queda en el móvil. Si falta algo, sale en la lista de encima de los botones.",
          "«Publicar ahora» (te pide confirmarlo) o «Programar…» para elegir día y hora. También puedes «Guardar borrador» y terminarlo otro día.",
        ],
      },
      {
        titulo: "Calendario y publicaciones",
        pasos: [
          "En «Calendario» ves lo programado, lo publicado y los borradores con fecha. Pulsa uno para moverlo, cancelarlo o abrirlo en «Crear».",
          "En «Publicaciones» está todo lo creado con su estado. Si algo falla, se explica por qué y cómo arreglarlo, y puedes reintentarlo.",
        ],
      },
      {
        titulo: "Ideas, campañas y métricas",
        pasos: [
          "En «Ideas y campañas», pide ideas para la semana (con cómo grabarlas) o una campaña de 2 a 4 semanas. Al aceptarla, sus publicaciones quedan como borradores en el calendario: añade la foto y prográmalas.",
          "«Métricas» enseña seguidores, alcance e interacciones, las publicaciones que más llegan y qué funciona mejor. Se actualizan solas cada noche.",
          "En «Conexión y estilo» ves la cuenta conectada y cuándo caduca el permiso, y cambias el estilo de los textos. «Aprender de lo publicado» propone mejoras a partir de las métricas.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "Pone «sin conectar», ¿qué hago?",
        respuesta:
          "Hace falta una app de Meta (la crea quien lleva la parte técnica, con los pasos de la guía del panel) y que la cuenta de Instagram sea profesional y esté vinculada a la página de Facebook. Después, en «Conexión y estilo», pulsa «Conectar con Facebook».",
      },
      {
        pregunta: "Me avisa de que la conexión caduca, ¿qué hago?",
        respuesta: "Entra en «Conexión y estilo» y pulsa «Renovar conexión»: entras en Facebook, aceptas los permisos y listo. No se pierde nada de lo programado.",
      },
      {
        pregunta: "Un vídeo se queda «procesando», ¿está mal?",
        respuesta: "No: Instagram tarda unos minutos en preparar los vídeos. El panel lo termina de publicar solo. Si en un día no sale, te avisa con el motivo.",
      },
      {
        pregunta: "¿La IA publica sola?",
        respuesta: "No. La IA solo propone textos, ideas y campañas. Nada se publica ni se programa sin que tú lo pulses.",
      },
      {
        pregunta: "No veo «Crear», ¿por qué?",
        respuesta: "Tienes permiso para ver RRSS pero no para publicar. Pídeselo al encargado si lo necesitas.",
      },
    ],
  },
];

/** ¿Es un archivo de vídeo (se enseña con <video>) y no un enlace de inserción (<iframe>)? */
export const esArchivoVideo = (url: string): boolean => /\.(webm|mp4|m4v|ogv|mov)(\?.*)?$/i.test(url);
