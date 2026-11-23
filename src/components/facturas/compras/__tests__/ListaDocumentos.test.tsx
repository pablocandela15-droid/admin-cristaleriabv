/**
 * Compras › Documentos a todo el ancho, agrupados por mes: cabeceras con
 * totales (y abonos), filas con fecha · proveedor · número · marcas · importe,
 * meses antiguos plegados, recuerdo
 * del plegado, mes pedido desde el resumen y despliegue de proveedor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Factura } from "@/hooks/useFacturas";
import { crearResolverProveedor, type Proveedor } from "@/lib/facturas/proveedores";
import { ListaDocumentos } from "../ListaDocumentos";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  numero_documento: `F-${id}`,
  proveedor: "Tecnovidrio",
  cif: null,
  fecha: "2026-10-03",
  subtotal: null,
  iva: null,
  total: 100,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: true,
  ...extra,
});

const prov = (id: number, nombre: string, variantes: string[]): Proveedor => ({
  id,
  nombre,
  nombre_comercial: null,
  cif: null,
  activo: true,
  origen: null,
  documentos: 1,
  total: 0,
  ultima_fecha: null,
  variantes,
  alias: [],
  cifs_extra: [],
});

const resolver = crearResolverProveedor([prov(1, "Vidrios Rías Baixas", ["Vidrios Rías Baixas S.L."]), prov(2, "Tecnovidrio", ["Tecnovidrio"])]);
const HOY = new Date(2026, 9, 10);

const DOCS: Factura[] = [
  doc(1, { numero_documento: "F-0001", proveedor: "Vidrios Rías Baixas S.L.", total: 1000 }),
  doc(3, { numero_documento: "F-0003", proveedor: "Vidrios Rías Baixas S.L.", total: 120.5 }),
  doc(4, { numero_documento: "F-0004", proveedor: "Tecnovidrio", total: 50 }),
  doc(5, { numero_documento: "F-0005", proveedor: "Tecnovidrio", fecha: "2026-09-12", total: 70 }),
  doc(6, { numero_documento: "F-0006", proveedor: "Tecnovidrio", fecha: "2026-05-02", total: 33 }),
  doc(7, { numero_documento: "F-0007", proveedor: "Tecnovidrio", fecha: "", total: 9 }),
];

function pintar(extra: Partial<React.ComponentProps<typeof ListaDocumentos>> = {}) {
  const onAbrir = vi.fn();
  const props: React.ComponentProps<typeof ListaDocumentos> = {
    documentos: DOCS,
    resolver,
    avisosPorId: new Map(),
    seleccionadoId: null,
    cargando: false,
    hayFiltros: false,
    onAbrir,
    hoy: HOY,
    ...extra,
  };
  const r = render(<ListaDocumentos {...props} />);
  return { ...r, onAbrir, props };
}

const cabeceraMes = (nombre: RegExp) => screen.getByRole("button", { name: nombre });
const fila = (numero: string) => screen.getByText(numero).closest("button")!;

describe("ListaDocumentos agrupada por mes", () => {
  beforeEach(() => window.localStorage.clear());

  it("cabeceras de mes en orden, con nº de documentos y total sin doble conteo", () => {
    pintar();
    const meses = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(meses).toHaveLength(4);
    expect(meses[0]).toMatch(/^Octubre 2026 · 3 documentos · 1\.170,50\s€ con IVA$/); // 1000 + 120,50 + 50
    expect(meses[1]).toMatch(/^Septiembre 2026 · 1 documento · 70,00\s€ con IVA$/);
    expect(meses[2]).toMatch(/^Mayo 2026 · 1 documento · 33,00\s€ con IVA$/);
    expect(meses[3]).toMatch(/^Sin fecha · 1 documento · 9,00\s€ con IVA$/);
  });

  it("sin subgrupos por proveedor: el proveedor es una columna de cada fila, del más reciente al más antiguo", () => {
    pintar({ documentos: [doc(1, { fecha: "2026-10-01" }), doc(2, { fecha: "2026-10-09", proveedor: "Vidrios Rías Baixas S.L." })] });
    expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
    const filas = within(screen.getByRole("region", { name: "Octubre 2026" })).getAllByRole("listitem");
    expect(filas.map((li) => li.querySelector("[data-numero]")?.textContent)).toEqual(["F-2", "F-1"]);
    // Nombre canónico del proveedor, no el texto del documento.
    expect(filas[0]).toHaveTextContent("Vidrios Rías Baixas");
    expect(filas[0]).not.toHaveTextContent("S.L.");
    expect(filas[0]).toHaveTextContent("09/10/26");
  });

  it("los abonos: insignia, signo menos y «incl. abonos» en la cabecera del mes", () => {
    pintar({ documentos: [doc(1, { total: 500 }), doc(2, { numero_documento: "AB-7", total: -120.4 })] });
    const abono = fila("AB-7");
    expect(abono).toHaveTextContent("Abono");
    expect(abono).toHaveTextContent("−120,40");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/379,60\s€ con IVA · incl\. abonos −120,40\s€/);
  });

  it("todas las marcas a la vista (avisos, sin revisar, IRPF), sin tooltip; «Factura» no se repite", () => {
    pintar({
      documentos: [doc(1, { numero_documento: "F-1" }), doc(2, { numero_documento: "F-2", verificada: false, retencion_irpf: 19 })],
      avisosPorId: new Map([[2, [{}, {}]]]),
    });
    expect(fila("F-1").textContent).not.toMatch(/Factura|aviso|Sin revisar/);
    const f2 = fila("F-2");
    for (const t of ["2 avisos", "Sin revisar", "IRPF"]) expect(f2).toHaveTextContent(t);
    expect(f2).not.toHaveAttribute("title");
  });

  it("mes actual y anterior desplegados; más antiguos y «Sin fecha» plegados", () => {
    pintar();
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Septiembre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("F-0006")).toBeNull();
    expect(screen.getByText("F-0005")).toBeTruthy();
  });

  it("si solo hay un mes (p. ej. un periodo), sale abierto aunque sea antiguo", () => {
    pintar({ documentos: [DOCS[4]] });
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("F-0006")).toBeTruthy();
  });

  it("plegar y desplegar, y se recuerda en localStorage", () => {
    const { unmount } = pintar();
    fireEvent.click(cabeceraMes(/^Mayo 2026/));
    expect(screen.getByText("F-0006")).toBeTruthy();
    fireEvent.click(cabeceraMes(/^Octubre 2026/));
    expect(screen.queryByText("F-0004")).toBeNull();
    unmount();
    pintar();
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("false");
  });

  it("con localStorage roto sigue funcionando", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("bloqueado");
    };
    try {
      pintar();
      fireEvent.click(cabeceraMes(/^Mayo 2026/));
      expect(screen.getByText("F-0006")).toBeTruthy();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("un chip (sin texto) no despliega meses: se respeta lo plegado", () => {
    pintar({ hayFiltros: true });
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("F-0006")).toBeNull();
    expect(screen.queryByTestId("barra-meses")).toBeNull();
  });

  it("con filtros (chip Abonos o periodo): 3 meses más recientes abiertos y «Abrir todos»", () => {
    // Antes, con un filtro todo salía plegado salvo el mes de hoy y el anterior, sin «Abrir todos».
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ "m:2026-10": false }));
    pintar({ hayFiltros: true, filtros: "abonos|todos|todo|" });
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Septiembre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    // Lo plegado con un filtro no se guarda.
    expect(JSON.parse(window.localStorage.getItem("compras.documentos.plegado") ?? "{}")).toEqual({ "m:2026-10": false });
  });

  it("cada cabecera de mes abierta dice qué lista controla (aria-controls, QA M9)", () => {
    pintar();
    const octubre = cabeceraMes(/^Octubre 2026/);
    const id = octubre.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.tagName).toBe("UL");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-controls")).toBeNull();
  });

  it("con texto buscado: solo los 3 meses más recientes con resultados, y «Abrir todos» / «Plegar todos»", () => {
    // Octubre plegado a mano antes de buscar: durante la búsqueda no cuenta.
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ "m:2026-10": false }));
    pintar({ hayFiltros: true, busqueda: "f-" });
    expect(cabeceraMes(/^Octubre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Septiembre 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("barra-meses").textContent).toContain("4 meses con resultados");

    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("F-0007")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Plegar todos" }));
    for (const m of [/^Octubre 2026/, /^Septiembre 2026/, /^Mayo 2026/, /^Sin fecha/]) {
      expect(cabeceraMes(m).getAttribute("aria-expanded")).toBe("false");
    }
    // Lo de la búsqueda no se recuerda en localStorage.
    expect(JSON.parse(window.localStorage.getItem("compras.documentos.plegado") ?? "{}")).toEqual({ "m:2026-10": false });
  });

  it("al cambiar el texto buscado se vuelve a la regla de los 3 primeros", () => {
    const { rerender, props } = pintar({ hayFiltros: true, busqueda: "f-" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("true");
    rerender(<ListaDocumentos {...props} busqueda="f-0" />);
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    // Al borrar la búsqueda vuelve lo recordado (mes actual y anterior).
    rerender(<ListaDocumentos {...props} busqueda="" hayFiltros={false} />);
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("barra-meses")).toBeNull();
  });

  it("cada mes lleva content-visibility: auto con un tamaño previsto", () => {
    const { container } = pintar();
    const mayo = container.querySelector('section[data-mes="2026-05"]') as HTMLElement;
    const octubre = container.querySelector('section[data-mes="2026-10"]') as HTMLElement;
    expect(mayo.className).toContain("[content-visibility:auto]");
    expect(mayo.getAttribute("style") ?? "").toMatch(/contain-intrinsic-size:\s*auto 49px/);
    expect(octubre.getAttribute("style") ?? "").toMatch(new RegExp(`contain-intrinsic-size:\\s*auto ${49 + 3 * 53}px`));
  });

  it("mes pedido desde el resumen: lo despliega", () => {
    const { rerender, props } = pintar();
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("false");
    rerender(<ListaDocumentos {...props} mesPedido={{ mes: "2026-05", n: 1 }} />);
    expect(cabeceraMes(/^Mayo 2026/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("F-0006")).toBeTruthy();
  });

  it("el último documento abierto se marca con aria-current", () => {
    pintar({ seleccionadoId: 4 });
    expect(fila("F-0004").getAttribute("aria-current")).toBe("true");
    expect(fila("F-0001").getAttribute("aria-current")).toBeNull();
  });

  it("despliegue de un proveedor: sin columna de proveedor, 3 meses abiertos y nada en localStorage", () => {
    pintar({ conProveedor: false, recordar: false, cabecerasFijas: false });
    // Cabeceras de mes como h4 (van debajo del h3 del proveedor) y no fijas.
    const meses = screen.getAllByRole("heading", { level: 4 });
    expect(meses).toHaveLength(4);
    expect(meses[0].className).not.toContain("sticky");
    for (const m of [/^Octubre 2026/, /^Septiembre 2026/, /^Mayo 2026/]) expect(cabeceraMes(m).getAttribute("aria-expanded")).toBe("true");
    expect(cabeceraMes(/^Sin fecha/).getAttribute("aria-expanded")).toBe("false");
    // La fila empieza por el número (no por el proveedor).
    expect(fila("F-0004").textContent).not.toContain("Tecnovidrio");
    fireEvent.click(cabeceraMes(/^Sin fecha/));
    expect(screen.getByText("F-0007")).toBeTruthy();
    expect(window.localStorage.getItem("compras.documentos.plegado")).toBeNull();
  });

  it("un clic en una fila abre el documento", () => {
    const { onAbrir } = pintar();
    fireEvent.click(screen.getByText("F-0004"));
    expect(onAbrir).toHaveBeenCalledWith(4);
  });

  it("estados vacío y cargando", () => {
    const { unmount } = pintar({ documentos: [], hayFiltros: true });
    expect(screen.getByText("Ningún documento coincide")).toBeTruthy();
    unmount();
    pintar({ documentos: [], hayFiltros: false });
    expect(screen.getByText("No hay documentos registrados")).toBeTruthy();
  });

  it("cabeceras y filas con zona táctil de 44 px como mínimo y foco visible", () => {
    pintar();
    expect(cabeceraMes(/^Octubre 2026/).className).toMatch(/min-h-12/);
    expect(fila("F-0004").className).toMatch(/min-h-12/);
    expect(fila("F-0004").className).toMatch(/focus-visible:outline/);
  });
});

describe("ListaDocumentos › retención de IRPF y meses incompletos (06/11/2026)", () => {
  beforeEach(() => window.localStorage.clear());

  it("marca discreta «IRPF» solo en la fila del documento con retención", () => {
    pintar({ documentos: [doc(1, { numero_documento: "F-0001", retencion_irpf: 209 }), doc(4, { numero_documento: "F-0004" })] });
    expect(within(fila("F-0001")).getByText("IRPF")).toBeInTheDocument();
    expect(fila("F-0001")).toHaveTextContent(/IRPF retenido/);
    expect(within(fila("F-0004")).queryByText("IRPF")).toBeNull();
  });

  it("«posiblemente incompleto» en la cabecera de los meses incompletos, y solo en esos", () => {
    pintar({ mesesIncompletos: new Set(["2026-10"]) });
    expect(cabeceraMes(/^Octubre 2026/)).toHaveTextContent(/posiblemente incompleto/);
    expect(cabeceraMes(/^Septiembre 2026/)).not.toHaveTextContent(/incompleto/);
  });

  it("sin la lista de meses incompletos (migración sin aplicar) no sale nada", () => {
    pintar();
    expect(screen.queryByText(/posiblemente incompleto/)).toBeNull();
  });
});
