/**
 * Editor de un presupuesto con los hooks simulados (sin Supabase): añadir una línea desde la calculadora de la web,
 * totales con descuento e IVA al momento, cambios de estado, solicitud de la web, recalcular con las tarifas de hoy,
 * línea manual, borrar con confirmación, PDF y WhatsApp, y solo lectura con «Ver».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PRICING } from "@/lib/web/pricing/config";
import { categories } from "@/lib/web/pricing/categories";
import { mergePricing } from "@/lib/web/pricing/tarifas";
import type { PresupuestoConLineas } from "@/lib/presupuestos/tipos";
import { argumentos, crearMutaciones, lineaDePrueba, presupuestoDePrueba, type ArgsAnadir, type ArgsCambiarLinea, type ArgsCrear, type ArgsEstado, type ArgsPdf, type Mutaciones } from "./dobles";

const h = vi.hoisted(() => ({
  detalle: null as unknown as PresupuestoConLineas | null,
  mut: null as unknown as Mutaciones,
  tarifas: undefined as unknown,
  descargar: vi.fn(async () => "Presupuesto-P-2026-0001.pdf"),
}));

vi.mock("@/hooks/usePresupuestos", () => ({
  usePresupuesto: () => ({ data: h.detalle, isLoading: false, error: null, refetch: () => undefined }),
  useCrearPresupuesto: () => h.mut.crear,
  useGuardarPresupuesto: () => h.mut.guardar,
  useCambiarEstado: () => h.mut.estado,
  useBorrarPresupuesto: () => h.mut.borrar,
  useAnadirLinea: () => h.mut.anadir,
  useCambiarLinea: () => h.mut.cambiarLinea,
  useBorrarLinea: () => h.mut.borrarLinea,
  useOrdenarLineas: () => h.mut.ordenar,
}));
vi.mock("@/hooks/useWebTarifas", () => ({ useTarifasWeb: () => ({ data: h.tarifas, isLoading: false, error: null }) }));
vi.mock("@/hooks/useWebContenido", () => ({ useContenidoWeb: () => ({ data: undefined, isLoading: false, error: null }) }));
vi.mock("@/lib/presupuestos/descargar", () => ({ descargarPdfPresupuesto: h.descargar }));

import { EditorPresupuesto } from "@/components/presupuestos/EditorPresupuesto";

const onVolver = vi.fn();
const onAbrir = vi.fn();
function montar(detalle: PresupuestoConLineas, puedeEditar = true) {
  h.detalle = detalle;
  return render(<EditorPresupuesto id={detalle.id} puedeEditar={puedeEditar} onVolver={onVolver} onAbrir={onAbrir} />);
}
const conLineas = (extra: Partial<PresupuestoConLineas> = {}): PresupuestoConLineas => ({ ...presupuestoDePrueba(), lineas: [], ...extra });

beforeEach(() => {
  h.mut = crearMutaciones();
  h.tarifas = undefined;
});
afterEach(() => {
  h.descargar.mockClear();
  onVolver.mockReset();
  onAbrir.mockReset();
  vi.restoreAllMocks();
});

describe("líneas", { timeout: 20_000 }, () => {
  it("añadir desde la calculadora: mampara de 100 cm → línea con su detalle, cantidad 1 y el total (IVA incluido) sin IVA como precio", () => {
    montar(conLineas());
    expect(screen.getByTestId("sin-lineas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Añadir desde calculadora/ }));
    const dialogo = screen.getByTestId("dialogo-calculadora");
    expect(within(dialogo).getByRole("button", { name: "Añadir al presupuesto" })).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText(/^Ancho/), { target: { value: "100" } });
    expect(within(dialogo).getByTestId("total-calculo")).toHaveTextContent("500 €");
    expect(within(dialogo).getByTestId("vista-linea")).toHaveTextContent("Mampara a medida");
    // 500 € de la calculadora llevan el IVA: la línea va a 413,22 € y con el 21 % vuelve a dar 500 €.
    expect(within(dialogo).getByTestId("vista-linea-precio")).toHaveTextContent("1 × 413,22 € sin IVA · 500,00 € con IVA (21 %)");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir al presupuesto" }));

    expect(h.mut.anadir.mutate).toHaveBeenCalledTimes(1);
    const args = argumentos<ArgsAnadir>(h.mut.anadir.mutate);
    expect(args).toMatchObject({ presupuestoId: "p1", orden: 0, pasarABorrador: false });
    expect(args.linea).toMatchObject({ categoria: "mamparas", descripcion: "Mampara a medida", cantidad: 1, precio_unitario: 413.22, precio_calculado: 500 });
    expect(args.linea.valores?.ancho).toBe(100);
    expect(args.linea.detalle).toMatch(/Ancho: 100 cm/);
    // Se cierra al guardarse.
    expect(screen.queryByTestId("dialogo-calculadora")).toBeNull();
  });

  it("recalcular: avisa de que con las tarifas de hoy sale otro precio y actualiza la línea", () => {
    h.tarifas = { config: mergePricing({ mamparas: { ...DEFAULT_PRICING.mamparas, base: 250 } }), catalogo: {} };
    const valores = { ...categories.mamparas.defaults, ancho: 100 };
    montar(conLineas({ lineas: [lineaDePrueba({ categoria: "mamparas", valores, descripcion: "Mampara a medida", precio_unitario: 413.22, importe: 413.22, precio_calculado: 500 })] }));
    expect(screen.getByTestId("tarifa-distinta")).toHaveTextContent("Tarifa de hoy: 550,00 €");
    expect(screen.getByTestId("precio-web-linea")).toHaveTextContent("Precio web (IVA incl.): 500,00 €");
    fireEvent.click(screen.getByRole("button", { name: "Recalcular Mampara a medida" }));
    const comparar = screen.getByTestId("comparar-tarifas");
    expect(comparar).toHaveTextContent("Precio en la línea (sin IVA)413,22 €");
    expect(comparar).toHaveTextContent("Precio web al añadirla (IVA incl.)500,00 €");
    expect(comparar).toHaveTextContent("Con las tarifas de hoy (IVA incl.)550,00 €");
    expect(comparar).toHaveTextContent("más caro: +50,00 €");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar línea" }));
    const args = argumentos<ArgsCambiarLinea>(h.mut.cambiarLinea.mutate);
    expect(args).toMatchObject({ presupuestoId: "p1", id: "l1", aviso: "Línea recalculada" });
    expect(args.cambios).toMatchObject({ precio_unitario: 454.55, precio_calculado: 550, descripcion: "Mampara a medida", categoria: "mamparas" });
  });

  it("cambiar el IVA no reescribe las líneas: lo avisa y «Recalcular» usa el IVA nuevo", () => {
    const valores = { ...categories.mamparas.defaults, ancho: 100 };
    montar(conLineas({ lineas: [lineaDePrueba({ categoria: "mamparas", valores, descripcion: "Mampara a medida", precio_unitario: 413.22, importe: 413.22, precio_calculado: 500 })] }));
    expect(screen.queryByTestId("aviso-iva-lineas")).toBeNull();
    fireEvent.change(screen.getByLabelText("IVA (%)"), { target: { value: "10" } });
    expect(screen.getByTestId("aviso-iva-lineas")).toHaveTextContent("Una línea de la calculadora no da su precio web con el IVA nuevo (10 %)");
    expect(screen.getByTestId("precio-web-linea")).toHaveTextContent("con este precio e IVA: 454,54 €");
    expect(h.mut.cambiarLinea.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recalcular Mampara a medida" }));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar línea" }));
    // 500 / 1,10 = 454,55
    expect(argumentos<ArgsCambiarLinea>(h.mut.cambiarLinea.mutate).cambios).toMatchObject({ precio_unitario: 454.55, precio_calculado: 500 });
  });

  it("cambiar cantidad y precio se guarda al salir del campo; quitar una línea", () => {
    montar(conLineas({ lineas: [lineaDePrueba()] }));
    const cantidad = screen.getByLabelText("Cantidad de Desplazamiento");
    fireEvent.change(cantidad, { target: { value: "2,5" } });
    expect(screen.getByTestId("importe-linea")).toHaveTextContent("250,00 €");
    fireEvent.blur(cantidad);
    expect(h.mut.cambiarLinea.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: "l1", cambios: { cantidad: 2.5 } }), expect.anything());
    const precio = screen.getByLabelText("Precio de Desplazamiento");
    fireEvent.change(precio, { target: { value: "abc" } });
    fireEvent.blur(precio);
    // Un precio que no es un número no se guarda: vuelve a lo que había.
    const llamadas = h.mut.cambiarLinea.mutate.mock.calls.map(([a]) => (a as { cambios: object }).cambios);
    expect(llamadas.every((c) => !("precio_unitario" in c))).toBe(true);
    expect(precio).toHaveValue("100");
    fireEvent.click(screen.getByRole("button", { name: "Quitar Desplazamiento" }));
    expect(h.mut.borrarLinea.mutate).toHaveBeenCalledWith(expect.objectContaining({ presupuestoId: "p1", id: "l1" }), expect.anything());
  });

  it("línea manual: concepto, cantidad y precio", () => {
    montar(conLineas());
    fireEvent.click(screen.getByRole("button", { name: /Línea manual/ }));
    fireEvent.change(screen.getByLabelText(/^Concepto/), { target: { value: "Retirar cristal roto" } });
    fireEvent.change(screen.getByLabelText("Precio unitario (€)"), { target: { value: "45,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir línea" }));
    const args = argumentos<ArgsAnadir>(h.mut.anadir.mutate);
    expect(args.linea).toEqual({ categoria: null, valores: null, descripcion: "Retirar cristal roto", detalle: null, cantidad: 1, precio_unitario: 45.5, precio_calculado: null });
  });
});

describe("totales", () => {
  const lineas = [
    lineaDePrueba({ id: "a", cantidad: 2, precio_unitario: 640.5, importe: 1281 }),
    lineaDePrueba({ id: "b", orden: 1, cantidad: 1, precio_unitario: 100, importe: 100, descripcion: "Montaje" }),
  ];

  it("subtotal, base imponible, IVA y total al momento; cambiar el descuento se guarda con la barra", () => {
    montar(conLineas({ lineas, subtotal: 1381, total: 1671.01 }));
    expect(screen.getByTestId("subtotal")).toHaveTextContent("1.381,00 €");
    expect(screen.getByTestId("base-imponible")).toHaveTextContent("1.381,00 €");
    expect(screen.getByTestId("iva")).toHaveTextContent("290,01 €");
    expect(screen.getByTestId("total")).toHaveTextContent("1.671,01 €");
    // Sin cambios no sale la barra de guardar.
    expect(screen.queryByRole("button", { name: /Guardar cambios/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Descuento (%)"), { target: { value: "10" } });
    expect(screen.getByTestId("descuento")).toHaveTextContent("-138,10 €");
    expect(screen.getByTestId("base-imponible")).toHaveTextContent("1.242,90 €");
    expect(screen.getByTestId("iva")).toHaveTextContent("261,01 €");
    expect(screen.getByTestId("total")).toHaveTextContent("1.503,91 €");
    expect(screen.getByText(/Guardado: 1.671,01 €/)).toBeInTheDocument();
    expect(screen.getByText("Tienes cambios sin guardar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    expect(h.mut.guardar.mutateAsync).toHaveBeenCalledWith({ id: "p1", cambios: { descuento_pct: 10 }, pasarABorrador: false });
  });

  it("un IVA fuera de rango no deja guardar", () => {
    montar(conLineas({ lineas }));
    fireEvent.change(screen.getByLabelText("IVA (%)"), { target: { value: "150" } });
    expect(screen.getByText("Revisa los datos marcados en rojo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar cambios/ })).toBeDisabled();
  });

  it("cambiar los días de validez pone al día la frase de las condiciones", () => {
    montar(conLineas());
    fireEvent.change(screen.getByLabelText("Validez (días)"), { target: { value: "15" } });
    expect(screen.getByLabelText("Condiciones")).toHaveValue("Presupuesto válido durante 15 días desde su fecha.");
    expect(screen.getByText("Válido hasta el 05/12/2026.")).toBeInTheDocument();
  });
});

describe("estado", () => {
  it("borrador → «Marcar como enviado»", () => {
    montar(conLineas());
    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviado" }));
    expect(h.mut.estado.mutate).toHaveBeenCalledWith(expect.objectContaining({ destino: "enviado", presupuesto: expect.objectContaining({ id: "p1" }) }));
  });

  it("enviado: «Aceptado», «Rechazado» y «Volver a borrador»; con la validez pasada sale «Caducado»", () => {
    montar(conLineas({ estado: "enviado", enviado_en: "2026-01-02T00:00:00Z", fecha: "2026-01-01", validez_dias: 30 }));
    expect(screen.getByTestId("caducado")).toBeInTheDocument();
    for (const nombre of ["Aceptado", "Rechazado", "Volver a borrador"]) expect(screen.getByRole("button", { name: nombre })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aceptado" }));
    expect(h.mut.estado.mutate).toHaveBeenCalledWith(expect.objectContaining({ destino: "aceptado" }));
  });

  it("solicitud de la web: lo que escribió el cliente, el precio que vio y «Convertir en borrador» (con las condiciones de siempre)", () => {
    montar(
      conLineas({
        estado: "solicitud",
        origen: "web",
        condiciones: null,
        notas_cliente: "Es para el baño de arriba, ¿podéis venir el jueves?",
        lineas: [lineaDePrueba({ categoria: "mamparas", valores: { ancho: 120 }, descripcion: "Solicitud web · Mampara a medida", precio_unitario: 462.81, importe: 462.81, precio_calculado: 560 })],
      }),
    );
    const bloque = screen.getByTestId("bloque-solicitud");
    expect(bloque).toHaveTextContent("¿podéis venir el jueves?");
    expect(bloque).toHaveTextContent("Precio que vio en la web (IVA incl.): 560,00 €. La línea lo lleva sin el IVA (21 %)");
    expect(screen.queryByTestId("aviso-iva-lineas")).toBeNull();
    expect(screen.getByTestId("origen-web")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Convertir en borrador" }));
    const args = argumentos<ArgsEstado>(h.mut.estado.mutate);
    expect(args.destino).toBe("borrador");
    expect(args.condicionesSiFaltan).toMatch(/^Presupuesto válido durante 30 días desde su fecha.\nPrecio orientativo/);
  });

  it("editar una solicitud la pasa a borrador al guardar", () => {
    montar(conLineas({ estado: "solicitud", origen: "web", lineas: [lineaDePrueba()] }));
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Juan Pérez Gómez" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar \(pasa a borrador\)/ }));
    expect(h.mut.guardar.mutateAsync).toHaveBeenCalledWith({ id: "p1", cambios: { cliente_nombre: "Juan Pérez Gómez" }, pasarABorrador: true });
    fireEvent.blur(screen.getByLabelText("Cantidad de Desplazamiento"));
    fireEvent.change(screen.getByLabelText("Cantidad de Desplazamiento"), { target: { value: "3" } });
    fireEvent.blur(screen.getByLabelText("Cantidad de Desplazamiento"));
    expect(h.mut.cambiarLinea.mutate).toHaveBeenCalledWith(expect.objectContaining({ pasarABorrador: true }), expect.anything());
  });

  it("borrar pide confirmación y vuelve a la lista", () => {
    montar(conLineas());
    fireEvent.keyDown(screen.getByRole("button", { name: "Más acciones" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Borrar/ }));
    expect(h.mut.borrar.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Borrar presupuesto" }));
    expect(h.mut.borrar.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", numero: "P-2026-0001" }), expect.anything());
    expect(onVolver).toHaveBeenCalled();
  });

  it("duplicar crea un borrador con las mismas líneas y lo abre", async () => {
    montar(conLineas({ estado: "aceptado", lineas: [lineaDePrueba()] }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Más acciones" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Duplicar/ }));
    await vi.waitFor(() => expect(h.mut.crear.mutate).toHaveBeenCalled());
    const args = argumentos<ArgsCrear>(h.mut.crear.mutate);
    expect(args.cabecera).toMatchObject({ cliente_nombre: "Juan Pérez", estado: "borrador" });
    expect(args.lineas).toHaveLength(1);
    expect(args.lineas?.[0]).not.toHaveProperty("id");
    expect(onAbrir).toHaveBeenCalledWith("p-nuevo");
  });
});

describe("PDF y envíos", () => {
  it("descargar el PDF con lo que hay en pantalla y los datos del negocio", async () => {
    montar(conLineas({ lineas: [lineaDePrueba()] }));
    fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
    await vi.waitFor(() => expect(h.descargar).toHaveBeenCalledTimes(1));
    const datos = argumentos<ArgsPdf>(h.descargar);
    expect(datos.presupuesto).toMatchObject({ numero: "P-2026-0001", cliente_nombre: "Juan Pérez" });
    expect(datos.lineas).toHaveLength(1);
    expect(datos.negocio).toMatchObject({ nombre: "Cristalería Baix Vinalopó", email: "info@cristaleriabaixvinalopo.es" });
  });

  it("WhatsApp abre wa.me con el móvil del cliente y el total; sin teléfono, no se puede", async () => {
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    const { unmount } = montar(conLineas({ lineas: [lineaDePrueba()] }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }));
    await vi.waitFor(() => expect(abrir).toHaveBeenCalledTimes(1));
    const url = String(abrir.mock.calls[0][0]);
    expect(url.startsWith("https://wa.me/34650066323?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Total: 121,00 € (IVA incluido).");
    unmount();
    montar(conLineas({ cliente_telefono: null }));
    expect(screen.getByRole("button", { name: "Enviar por WhatsApp" })).toBeDisabled();
  });
});

describe("solo lectura («Ver» sin «Editar»)", () => {
  it("sin botones de cambiar, campos bloqueados, y el PDF sí se descarga", () => {
    montar(conLineas({ lineas: [lineaDePrueba()] }), false);
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
    for (const nombre of [/Añadir desde calculadora/, /Línea manual/, /Marcar como enviado/, /Enviar por WhatsApp/, /Enviar por email/, /Más acciones/]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull();
    }
    expect(screen.queryByLabelText("Cantidad de Desplazamiento")).toBeNull();
    expect(screen.getByLabelText(/^Nombre/)).toBeDisabled();
    expect(screen.getByLabelText("Condiciones")).toBeDisabled();
    expect(screen.queryByLabelText("Descuento (%)")).toBeNull();
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
    expect(screen.queryByText(/Tienes cambios sin guardar|Todo guardado/)).toBeNull();
  });

  it("un presupuesto que no existe", () => {
    h.detalle = null;
    render(<EditorPresupuesto id="nada" puedeEditar onVolver={onVolver} onAbrir={onAbrir} />);
    expect(screen.getByTestId("presupuesto-no-existe")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Presupuestos/ }));
    expect(onVolver).toHaveBeenCalled();
  });
});
