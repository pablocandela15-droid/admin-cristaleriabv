/**
 * Lógica del gestor de presupuestos (sin React): estados y «Caducado», totales como los calcula la base, filtros de
 * la lista, líneas desde la calculadora de la web (y recalcular con las tarifas de hoy), datos del negocio y
 * condiciones, enlaces de WhatsApp y correo, el formulario de la cabecera y el enlace del aviso de la campana.
 */
import { describe, expect, it } from "vitest";
import { categories } from "@/lib/web/pricing/categories";
import { DEFAULT_PRICING } from "@/lib/web/pricing/config";
import { mergePricing, resolverTarifas } from "@/lib/web/pricing/tarifas";
import { rutaDeAviso } from "@/lib/avisos";
import { accionesDeEstado, cambiosEstado, estaCaducado, fechaCorta, sumarDias, validoHasta } from "../estados";
import { calcularTotales, eurosCentimos, leerNumero, redondear2 } from "../totales";
import { coincideBusqueda, contarPorEstado, filtrarPresupuestos, leerFiltroEstado } from "../filtros";
import {
  cambiosAlRecalcular,
  copiarLineas,
  descripcionAutomatica,
  lineaDesdeCalculadora,
  mover,
  ordenesNuevos,
  precioConIva,
  precioConTarifasDeHoy,
  precioFueraDelPrecioWeb,
  precioSinIva,
  precioWeb,
  siguienteOrdenLinea,
} from "../lineas";
import { condicionesConValidez, condicionesPorDefecto, negocioParaDocumentos } from "../documento";
import { enlaceEmail, enlaceWhatsApp, telefonoWhatsApp, textoWhatsApp } from "../envio";
import { cambiosFormulario, erroresFormulario, formularioDe, fusionarFormulario } from "../formulario";
import type { LineaPresupuesto, Presupuesto } from "../tipos";

const presupuesto = (extra: Partial<Presupuesto> = {}): Presupuesto => ({
  id: "p1",
  numero: "P-2026-0001",
  estado: "borrador",
  origen: "panel",
  cliente_nombre: "Juan Pérez",
  cliente_telefono: "650 06 63 23",
  cliente_email: "juan@example.com",
  cliente_direccion: null,
  cliente_poblacion: "Elche",
  notas_cliente: null,
  notas_internas: null,
  condiciones: null,
  fecha: "2026-11-01",
  validez_dias: 30,
  descuento_pct: 0,
  iva_pct: 21,
  subtotal: 0,
  total: 0,
  enviado_en: null,
  respondido_en: null,
  creado_por: null,
  creado_en: "2026-11-01T10:00:00Z",
  actualizado_en: "2026-11-01T10:00:00Z",
  ...extra,
});

const linea = (extra: Partial<LineaPresupuesto> = {}): LineaPresupuesto => ({
  id: "l1",
  presupuesto_id: "p1",
  orden: 0,
  categoria: null,
  valores: null,
  descripcion: "Concepto",
  detalle: null,
  cantidad: 1,
  precio_unitario: 100,
  importe: 100,
  precio_calculado: null,
  creado_en: "2026-11-01T10:00:00Z",
  ...extra,
});

describe("estados", () => {
  it("«Caducado» solo si está enviado y ya pasó fecha + validez", () => {
    const p = presupuesto({ estado: "enviado", fecha: "2026-11-01", validez_dias: 30 });
    expect(validoHasta(p)).toBe("2026-12-01");
    expect(estaCaducado(p, "2026-12-01")).toBe(false);
    expect(estaCaducado(p, "2026-12-02")).toBe(true);
    expect(estaCaducado({ ...p, estado: "borrador" }, "2027-01-01")).toBe(false);
    expect(estaCaducado({ ...p, estado: "aceptado" }, "2027-01-01")).toBe(false);
  });

  it("fechas: sumar días cruzando de mes y año, y al estilo español", () => {
    expect(sumarDias("2026-12-20", 15)).toBe("2027-01-04");
    expect(fechaCorta("2026-11-23")).toBe("23/11/2026");
    expect(fechaCorta(null)).toBe("—");
  });

  it("botones de cada estado", () => {
    const destinos = (estado: Presupuesto["estado"], enviado_en: string | null = null) => accionesDeEstado({ estado, enviado_en }).map((a) => a.destino);
    expect(destinos("solicitud")).toEqual(["borrador", "rechazado"]);
    expect(destinos("borrador")).toEqual(["enviado"]);
    expect(destinos("enviado")).toEqual(["aceptado", "rechazado", "borrador"]);
    expect(destinos("aceptado", "2026-11-02T00:00:00Z")).toEqual(["enviado", "borrador"]);
    expect(destinos("rechazado")).toEqual(["borrador"]);
  });

  it("marcar como enviado pone enviado_en; aceptar y rechazar, respondido_en; volver a borrador los quita", () => {
    const ahora = new Date("2026-11-23T12:00:00Z");
    expect(cambiosEstado({ estado: "borrador", enviado_en: null }, "enviado", ahora)).toEqual({
      estado: "enviado",
      enviado_en: "2026-11-23T12:00:00.000Z",
      respondido_en: null,
    });
    expect(cambiosEstado({ estado: "enviado", enviado_en: "x" }, "aceptado", ahora)).toEqual({ estado: "aceptado", respondido_en: "2026-11-23T12:00:00.000Z" });
    expect(cambiosEstado({ estado: "enviado", enviado_en: "x" }, "rechazado", ahora)).toEqual({ estado: "rechazado", respondido_en: "2026-11-23T12:00:00.000Z" });
    expect(cambiosEstado({ estado: "enviado", enviado_en: "x" }, "borrador", ahora)).toEqual({ estado: "borrador", enviado_en: null, respondido_en: null });
    // Deshacer una respuesta conserva cuándo se envió.
    expect(cambiosEstado({ estado: "aceptado", enviado_en: "2026-11-02T00:00:00Z" }, "enviado", ahora)).toEqual({
      estado: "enviado",
      enviado_en: "2026-11-02T00:00:00Z",
      respondido_en: null,
    });
  });
});

describe("totales (como presupuesto_calcular_totales)", () => {
  it("subtotal, descuento, base imponible, IVA y total redondeados a céntimos", () => {
    const t = calcularTotales(
      [
        { cantidad: 2, precio_unitario: 640.5 },
        { cantidad: 1.5, precio_unitario: 33.33 },
      ],
      5,
      21,
    );
    // 1281 + 49.995→50.00 (round 2 por línea) = 1331
    expect(t.subtotal).toBe(1331);
    expect(t.baseImponible).toBe(1264.45);
    expect(t.descuento).toBe(66.55);
    expect(t.total).toBe(redondear2(1331 * 0.95 * 1.21));
    expect(t.total).toBe(1529.98);
    expect(redondear2(t.baseImponible + t.iva)).toBe(t.total);
  });

  it("sin líneas, todo a 0; porcentajes fuera de rango se acotan", () => {
    expect(calcularTotales([], 0, 21)).toEqual({ subtotal: 0, descuento: 0, baseImponible: 0, iva: 0, total: 0 });
    expect(calcularTotales([{ cantidad: 1, precio_unitario: 100 }], 150, 21).total).toBe(0);
  });

  it("redondeo como Postgres (mitades hacia fuera) y números a la española", () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(-1.005)).toBe(-1.01);
    expect(eurosCentimos(1234.5)).toBe("1.234,50 €");
    expect(eurosCentimos(0)).toBe("0,00 €");
    expect(leerNumero("1.234,5")).toBe(1234.5);
    expect(leerNumero("12,5")).toBe(12.5);
    expect(leerNumero("12.5")).toBe(12.5);
    expect(leerNumero("1.234")).toBe(1234);
    expect(leerNumero("abc")).toBeNull();
    expect(leerNumero("")).toBeNull();
  });
});

describe("filtros de la lista", () => {
  const lista = [
    presupuesto({ id: "a", numero: "P-2026-0001", estado: "solicitud", cliente_nombre: "María Ñúñez", cliente_telefono: "650 11 22 33" }),
    presupuesto({ id: "b", numero: "P-2026-0002", estado: "borrador", cliente_nombre: "José García", cliente_telefono: null, cliente_poblacion: "Crevillente" }),
    presupuesto({ id: "c", numero: "P-2026-0003", estado: "solicitud", cliente_nombre: "Ana López" }),
    presupuesto({ id: "d", numero: "P-2026-0004", estado: "enviado", cliente_nombre: "Pedro Ruiz" }),
  ];

  it("por estado y la cuenta de cada uno", () => {
    expect(filtrarPresupuestos(lista, { estado: "solicitud", busqueda: "" }).map((p) => p.id)).toEqual(["a", "c"]);
    expect(filtrarPresupuestos(lista, { estado: "todos", busqueda: "" })).toHaveLength(4);
    expect(contarPorEstado(lista)).toEqual({ solicitud: 2, borrador: 1, enviado: 1, aceptado: 0, rechazado: 0 });
    expect(leerFiltroEstado("enviado")).toBe("enviado");
    expect(leerFiltroEstado("cualquiera")).toBe("todos");
  });

  it("búsqueda por número, cliente (sin acentos), población y teléfono (solo cifras)", () => {
    const ids = (q: string) => filtrarPresupuestos(lista, { estado: "todos", busqueda: q }).map((p) => p.id);
    expect(ids("0002")).toEqual(["b"]);
    expect(ids("nunez")).toEqual(["a"]);
    expect(ids("JOSÉ crevillente")).toEqual(["b"]);
    expect(ids("650112233")).toEqual(["a"]);
    expect(ids("11 22")).toEqual(["a"]);
    expect(ids("nadie")).toEqual([]);
    expect(coincideBusqueda(lista[0], "   ")).toBe(true);
  });
});

describe("líneas desde la calculadora", () => {
  const { categorias, precios } = resolverTarifas(categories, null);

  it("mampara: nombre de la categoría, lo elegido y el desglose; cantidad 1 y el total (IVA incluido) sin IVA como precio", () => {
    const valores = { ...categorias.mamparas.defaults, ancho: 100 };
    const calculo = categorias.mamparas.quote(valores, precios);
    expect(calculo.ready).toBe(true);
    expect(calculo.total).toBe(500);
    const l = lineaDesdeCalculadora(categorias.mamparas, valores, calculo);
    // 500 / 1,21 = 413,2231… → 413,22; el precio web (IVA incluido) se queda en precio_calculado.
    expect(l).toMatchObject({ categoria: "mamparas", descripcion: "Mampara a medida", cantidad: 1, precio_unitario: 413.22, precio_calculado: 500 });
    // Y el total del presupuesto con el 21 % vuelve a ser el precio web.
    expect(calcularTotales([l], 0, 21).total).toBe(500);
    // Con otro IVA en el presupuesto, la línea se calcula con ese.
    expect(lineaDesdeCalculadora(categorias.mamparas, valores, calculo, 10).precio_unitario).toBe(454.55);
    expect(lineaDesdeCalculadora(categorias.mamparas, valores, calculo, 0).precio_unitario).toBe(500);
    expect(l.valores).toEqual(valores);
    expect(l.valores).not.toBe(valores);
    expect(l.detalle).toMatch(/Ancho: 100 cm/);
    expect(l.detalle).toMatch(/Desglose:\n· /);
  });

  it("con nombre de la pieza (Dominó) la descripción lo lleva", () => {
    const valores = { ...categorias.domino.defaults, nombrePieza: "Puerta del salón", ancho: 80, alto: 200 };
    const l = lineaDesdeCalculadora(categorias.domino, valores, categorias.domino.quote(valores, precios));
    expect(l.descripcion).toBe("Cristal Dominó · Puerta del salón");
  });

  it("precio con las tarifas de hoy y recalcular (respeta una descripción cambiada a mano)", () => {
    const valores = { ...categorias.mamparas.defaults, ancho: 100 };
    const antes = lineaDesdeCalculadora(categorias.mamparas, valores, categorias.mamparas.quote(valores, precios));
    const guardada = linea({ ...antes, id: "l1", importe: antes.precio_unitario });
    // Sube el precio base de la mampara en Web › Tarifas.
    const caras = mergePricing({ mamparas: { ...DEFAULT_PRICING.mamparas, base: DEFAULT_PRICING.mamparas.base + 50 } });
    expect(precioConTarifasDeHoy(guardada, categorias, caras)).toBe(antes.precio_calculado! + 50);
    expect(precioConTarifasDeHoy(linea(), categorias, caras)).toBeNull();

    const nuevoCalculo = categorias.mamparas.quote(valores, caras);
    expect(cambiosAlRecalcular(guardada, categorias.mamparas, valores, nuevoCalculo, categorias)).toMatchObject({
      descripcion: "Mampara a medida",
      precio_unitario: precioSinIva(550, 21),
      precio_calculado: 550,
    });
    expect(cambiosAlRecalcular(guardada, categorias.mamparas, valores, nuevoCalculo, categorias, 10)).toMatchObject({ precio_unitario: 500, precio_calculado: 550 });
    const aMano = { ...guardada, descripcion: "Mampara del baño de arriba" };
    expect(descripcionAutomatica(aMano, categorias)).toBe(false);
    expect(cambiosAlRecalcular(aMano, categorias.mamparas, valores, nuevoCalculo, categorias)).not.toHaveProperty("descripcion");
    // La de una solicitud de la web se pone al día.
    expect(descripcionAutomatica({ ...guardada, descripcion: "Solicitud web · Mampara a medida" }, categorias)).toBe(true);
  });

  it("precio sin y con IVA, y líneas que ya no dan su precio web con el IVA de ahora", () => {
    expect(precioSinIva(560)).toBe(462.81);
    expect(precioConIva(462.81)).toBe(560);
    expect(precioSinIva(100, 0)).toBe(100);
    // IVA no válido: el de serie.
    expect(precioSinIva(121, Number.NaN)).toBe(100);
    expect(precioFueraDelPrecioWeb({ precio_unitario: 462.81, precio_calculado: 560 }, 21)).toBe(false);
    expect(precioFueraDelPrecioWeb({ precio_unitario: 462.81, precio_calculado: 560 }, 10)).toBe(true);
    // Las de antes del cambio (precio web como precio de la línea) y las manuales.
    expect(precioFueraDelPrecioWeb({ precio_unitario: 560, precio_calculado: 560 }, 21)).toBe(true);
    expect(precioFueraDelPrecioWeb({ precio_unitario: 45, precio_calculado: null }, 21)).toBe(false);
  });

  it("orden, mover, copiar y precio que vio el cliente en la web", () => {
    const ls = [linea({ id: "a", orden: 0 }), linea({ id: "b", orden: 1 }), linea({ id: "c", orden: 5 })];
    expect(siguienteOrdenLinea(ls)).toBe(6);
    expect(siguienteOrdenLinea([])).toBe(0);
    const ids = mover(["a", "b", "c"], 2, 0);
    expect(ids).toEqual(["c", "a", "b"]);
    expect(ordenesNuevos(ids, new Map([["a", 0], ["b", 1], ["c", 5]]))).toEqual([
      { id: "c", orden: 0 },
      { id: "a", orden: 1 },
      { id: "b", orden: 2 },
    ]);
    expect(copiarLineas([linea({ id: "x", orden: 1, descripcion: "B" }), linea({ id: "y", orden: 0, descripcion: "A" })]).map((l) => l.descripcion)).toEqual(["A", "B"]);
    expect(copiarLineas([linea()])[0]).not.toHaveProperty("id");
    expect(precioWeb([{ precio_calculado: 560, cantidad: 1 }, { precio_calculado: null, cantidad: 2 }])).toBe(560);
    expect(precioWeb([{ precio_calculado: null, cantidad: 1 }])).toBeNull();
  });
});

describe("negocio, condiciones y envíos", () => {
  it("datos del negocio de Web › Contenido y, lo que falte, los de siempre", () => {
    const porDefecto = negocioParaDocumentos(null);
    expect(porDefecto.nombre).toBe("Cristalería Baix Vinalopó");
    expect(porDefecto.direccion).toEqual(["C/ Pío XII, 5", "03330 Crevillente (Alicante)"]);
    expect(porDefecto.telefonos[0]).toBe("650 06 63 23 (Oficina)");
    expect(porDefecto.email).toBe("info@cristaleriabaixvinalopo.es");
    const propio = negocioParaDocumentos({ email: "hola@cbv.es", phones: [{ display: "966 00 00 00", label: "" }], address: { street: "C/ Nueva, 2", city: "" } });
    expect(propio.email).toBe("hola@cbv.es");
    expect(propio.telefonos).toEqual(["966 00 00 00"]);
    expect(propio.direccion).toEqual(["C/ Nueva, 2", "03330 Crevillente (Alicante)"]);
  });

  it("condiciones de siempre con la validez y la nota de precios; cambiar los días las pone al día", () => {
    const c = condicionesPorDefecto("Precio orientativo, sujeto a confirmación tras la visita técnica.", 30);
    expect(c).toBe("Presupuesto válido durante 30 días desde su fecha.\nPrecio orientativo, sujeto a confirmación tras la visita técnica.");
    expect(condicionesConValidez(c, 30, 15)).toMatch(/^Presupuesto válido durante 15 días/);
    expect(condicionesConValidez("Pago al contado.", 30, 15)).toBe("Pago al contado.");
    expect(condicionesPorDefecto("", 1)).toBe("Presupuesto válido durante 1 día desde su fecha.");
  });

  it("WhatsApp al móvil del cliente con número, total y validez", () => {
    expect(telefonoWhatsApp("650 06 63 23")).toBe("34650066323");
    expect(telefonoWhatsApp("+33 6 12 34 56 78")).toBe("33612345678");
    expect(telefonoWhatsApp("0034 650066323")).toBe("34650066323");
    expect(telefonoWhatsApp("12")).toBeNull();
    expect(telefonoWhatsApp(null)).toBeNull();
    const datos = { ...presupuesto(), total: 1234.5 };
    expect(textoWhatsApp(datos, "Cristalería Baix Vinalopó")).toBe(
      "Hola, Juan. Te enviamos el presupuesto P-2026-0001 de Cristalería Baix Vinalopó.\nTotal: 1.234,50 € (IVA incluido).\nVálido hasta el 01/12/2026.\nCualquier duda, aquí estamos.",
    );
    const url = enlaceWhatsApp(datos, "Cristalería Baix Vinalopó")!;
    expect(url.startsWith("https://wa.me/34650066323?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toContain("P-2026-0001");
    expect(enlaceWhatsApp({ ...datos, cliente_telefono: null }, "X")).toBeNull();
    expect(textoWhatsApp({ ...datos, iva_pct: 0 }, "X")).toContain("Total: 1.234,50 €.");
  });

  it("correo con asunto y cuerpo (y el nombre del PDF que hay que adjuntar)", () => {
    const url = enlaceEmail({ ...presupuesto(), total: 100 }, "Cristalería Baix Vinalopó", "Presupuesto-P-2026-0001.pdf");
    expect(url.startsWith("mailto:juan@example.com?subject=")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("subject")).toBe("Presupuesto P-2026-0001 · Cristalería Baix Vinalopó");
    expect(q.get("body")).toContain("Te adjuntamos el presupuesto P-2026-0001 (Presupuesto-P-2026-0001.pdf).");
    expect(q.get("body")).toContain("Válido hasta el 01/12/2026");
  });
});

describe("formulario de la cabecera", () => {
  it("valida y saca solo lo cambiado, con los textos vacíos como null", () => {
    const p = presupuesto();
    const f = { ...formularioDe(p), cliente_telefono: "  ", descuento: "7,5", condiciones: "Pago a 30 días.\n" };
    expect(erroresFormulario(f)).toEqual({});
    expect(cambiosFormulario(f, p)).toEqual({ cliente_telefono: null, descuento_pct: 7.5, condiciones: "Pago a 30 días." });
    expect(erroresFormulario({ ...f, cliente_nombre: " ", iva: "150", validez: "0", cliente_email: "x@" })).toEqual({
      cliente_nombre: expect.any(String),
      iva: expect.any(String),
      validez: expect.any(String),
      cliente_email: expect.any(String),
    });
  });

  it("lo que llega de la base pone al día lo no tocado y respeta lo tocado", () => {
    const base = formularioDe(presupuesto());
    const actual = { ...base, cliente_poblacion: "Santa Pola" };
    const nuevo = formularioDe(presupuesto({ cliente_poblacion: "Elx", notas_internas: "Llamar por la tarde" }));
    expect(fusionarFormulario(actual, base, nuevo)).toMatchObject({ cliente_poblacion: "Santa Pola", notas_internas: "Llamar por la tarde" });
  });
});

describe("aviso de la campana", () => {
  it("una solicitud de la web lleva a su presupuesto (o a las solicitudes)", () => {
    expect(rutaDeAviso({ tipo: "presupuesto_solicitud", referencia_tipo: "presupuesto", referencia_id: "11111111-2222-4333-8444-555555555555" })).toBe(
      "/presupuestos?id=11111111-2222-4333-8444-555555555555",
    );
    expect(rutaDeAviso({ tipo: "presupuesto_solicitud", referencia_tipo: "presupuesto" })).toBe("/presupuestos?estado=solicitud");
  });
});
