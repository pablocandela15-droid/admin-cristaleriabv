/**
 * Lista de presupuestos con los hooks simulados: filtro por estado (con las solicitudes contadas), búsqueda por
 * número, cliente o teléfono, solicitudes de la web (comentario, precio de la web y «Convertir en borrador»),
 * «Caducado», «Nuevo presupuesto», tarjetas en el móvil y estados vacío y de error.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PresupuestoLista } from "@/hooks/usePresupuestos";
import type { FiltroEstado } from "@/lib/presupuestos/filtros";
import { argumentos, crearMutaciones, deLista, presupuestoDePrueba, type ArgsCrear, type ArgsEstado, type Mutaciones } from "./dobles";

const h = vi.hoisted(() => ({
  lista: [] as PresupuestoLista[],
  error: null as unknown,
  mut: null as unknown as Mutaciones,
  movil: false,
}));

vi.mock("@/hooks/usePresupuestos", () => ({
  usePresupuestos: () => ({ data: h.lista, isLoading: false, error: h.error, refetch: () => undefined }),
  useCambiarEstado: () => h.mut.estado,
  useCrearPresupuesto: () => h.mut.crear,
}));
vi.mock("@/components/ayuda/BotonAyuda", () => ({ BotonAyuda: () => <button type="button">Ayuda</button> }));
vi.mock("@/hooks/useWebTarifas", () => ({ useTarifasWeb: () => ({ data: undefined, isLoading: false, error: null }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => h.movil }));

import { ListaPresupuestos } from "@/components/presupuestos/ListaPresupuestos";

const onAbrir = vi.fn();
function Envoltorio({ puedeEditar = true, inicial = "todos" as FiltroEstado }) {
  const [estado, setEstado] = useState<FiltroEstado>(inicial);
  const [busqueda, setBusqueda] = useState("");
  return <ListaPresupuestos puedeEditar={puedeEditar} onAbrir={onAbrir} estado={estado} onEstado={setEstado} busqueda={busqueda} onBusqueda={setBusqueda} />;
}
const filas = () => screen.queryAllByTestId("presupuesto");
const numeros = () => filas().map((f) => f.textContent?.match(/P-\d{4}-\d{4}/)?.[0]);

const LISTA = [
  deLista(presupuestoDePrueba({ id: "a", numero: "P-2026-0004", estado: "solicitud", origen: "web", cliente_nombre: "María Ñúñez", cliente_telefono: "611 22 33 44", notas_cliente: "Para el baño pequeño", total: 677.6 }), { precioWeb: 560 }),
  deLista(presupuestoDePrueba({ id: "b", numero: "P-2026-0003", estado: "enviado", cliente_nombre: "José García", fecha: "2026-01-10", validez_dias: 30, total: 1210 })),
  deLista(presupuestoDePrueba({ id: "c", numero: "P-2026-0002", estado: "solicitud", origen: "web", cliente_nombre: "Ana López", total: 0 }), { precioWeb: null }),
  deLista(presupuestoDePrueba({ id: "d", numero: "P-2026-0001", estado: "aceptado", cliente_nombre: "Pedro Ruiz", total: 302.5 })),
];

beforeEach(() => {
  h.mut = crearMutaciones();
  h.lista = LISTA;
  h.error = null;
  h.movil = false;
});
afterEach(() => onAbrir.mockReset());

describe("lista de presupuestos", () => {
  it("enseña número, cliente, fecha, estado y total; «Caducado» y «Web» donde toca", () => {
    render(<Envoltorio />);
    expect(numeros()).toEqual(["P-2026-0004", "P-2026-0003", "P-2026-0002", "P-2026-0001"]);
    const enviado = filas()[1];
    expect(within(enviado).getByText("José García")).toBeInTheDocument();
    expect(within(enviado).getByText("10/01/2026")).toBeInTheDocument();
    expect(within(enviado).getByTestId("estado-presupuesto")).toHaveTextContent("Enviado");
    expect(within(enviado).getByTestId("caducado")).toBeInTheDocument();
    expect(within(enviado).getByText("1.210,00 €")).toBeInTheDocument();
    expect(within(filas()[0]).getByTestId("origen-web")).toBeInTheDocument();
    expect(within(filas()[3]).queryByTestId("origen-web")).toBeNull();
    expect(screen.getByText("4 presupuestos")).toBeInTheDocument();
  });

  it("filtra por estado, con las solicitudes sin atender contadas", () => {
    render(<Envoltorio />);
    const chip = screen.getByRole("tab", { name: /Solicitudes/ });
    expect(chip).toHaveTextContent("2");
    fireEvent.mouseDown(chip);
    expect(numeros()).toEqual(["P-2026-0004", "P-2026-0002"]);
    expect(screen.getByText("2 de 4 presupuestos")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rechazados" }));
    expect(filas()).toHaveLength(0);
    expect(screen.getByTestId("sin-presupuestos")).toHaveTextContent("No hay presupuestos en este estado.");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Todos" }));
    expect(filas()).toHaveLength(4);
  });

  it("busca por número, cliente (sin acentos) o teléfono", () => {
    render(<Envoltorio />);
    const buscar = screen.getByLabelText("Buscar por número, cliente o teléfono");
    fireEvent.change(buscar, { target: { value: "0003" } });
    expect(numeros()).toEqual(["P-2026-0003"]);
    fireEvent.change(buscar, { target: { value: "nunez" } });
    expect(numeros()).toEqual(["P-2026-0004"]);
    fireEvent.change(buscar, { target: { value: "611223344" } });
    expect(numeros()).toEqual(["P-2026-0004"]);
    fireEvent.change(buscar, { target: { value: "nadie" } });
    expect(screen.getByTestId("sin-presupuestos")).toHaveTextContent("Ningún presupuesto coincide con «nadie».");
    fireEvent.click(screen.getByRole("button", { name: "Borrar la búsqueda" }));
    expect(filas()).toHaveLength(4);
  });

  it("solicitud de la web: comentario del cliente, precio de la web y «Convertir en borrador» (y se abre)", () => {
    render(<Envoltorio />);
    const solicitud = within(filas()[0]).getByTestId("solicitud-web");
    expect(solicitud).toHaveTextContent("Para el baño pequeño");
    expect(solicitud).toHaveTextContent("Precio web (IVA incl.): 560,00 €");
    expect(within(filas()[2]).getByTestId("solicitud-web")).toHaveTextContent("Sin comentarios del cliente.");
    fireEvent.click(within(solicitud).getByRole("button", { name: "Convertir en borrador" }));
    const args = argumentos<ArgsEstado>(h.mut.estado.mutate);
    expect(args.presupuesto.id).toBe("a");
    expect(args.destino).toBe("borrador");
    expect(args.condicionesSiFaltan).toMatch(/^Presupuesto válido durante 30 días/);
    expect(onAbrir).toHaveBeenCalledWith("a");
  });

  it("abrir uno al pulsar su fila", () => {
    render(<Envoltorio />);
    fireEvent.click(within(filas()[3]).getByText("Pedro Ruiz"));
    expect(onAbrir).toHaveBeenCalledWith("d");
  });

  it("«Nuevo presupuesto» con el nombre del cliente lo crea con las condiciones de siempre y lo abre", () => {
    render(<Envoltorio />);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo presupuesto/ }));
    expect(screen.getByRole("button", { name: "Crear y abrir" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Cliente/), { target: { value: "Lucía Sempere" } });
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "699 00 00 00" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear y abrir" }));
    const args = argumentos<ArgsCrear>(h.mut.crear.mutate);
    expect(args.cabecera).toMatchObject({ cliente_nombre: "Lucía Sempere", cliente_telefono: "699 00 00 00", cliente_email: null, validez_dias: 30 });
    expect(args.cabecera.condiciones).toMatch(/Precio orientativo/);
    expect(onAbrir).toHaveBeenCalledWith("p-nuevo");
  });

  it("solo lectura: sin «Nuevo presupuesto» ni «Convertir en borrador»", () => {
    render(<Envoltorio puedeEditar={false} />);
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nuevo presupuesto/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Convertir en borrador" })).toBeNull();
    expect(within(filas()[0]).getByTestId("solicitud-web")).toHaveTextContent("Precio web (IVA incl.): 560,00 €");
  });

  it("en el móvil, tarjetas", () => {
    h.movil = true;
    render(<Envoltorio />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("list", { name: "Presupuestos" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir P-2026-0001 de Pedro Ruiz" }));
    expect(onAbrir).toHaveBeenCalledWith("d");
  });

  it("vacía y con error", () => {
    h.lista = [];
    const { unmount } = render(<Envoltorio />);
    expect(screen.getByTestId("sin-presupuestos")).toHaveTextContent("Aún no hay ningún presupuesto.");
    unmount();
    h.error = new Error("sin red");
    render(<Envoltorio />);
    expect(screen.getByText(/No se han podido cargar los presupuestos/)).toBeInTheDocument();
  });
});
