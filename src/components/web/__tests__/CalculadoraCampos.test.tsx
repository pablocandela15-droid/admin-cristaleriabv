/**
 * CalculadoraCampos + useCalculadora: el renderizador genérico de la calculadora de la web (lo reutiliza el gestor de
 * presupuestos). Pinta los campos por secciones, respeta `when` y recalcula al momento con los precios que se le dan.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CalculadoraCampos, ResultadoCalculo } from "@/components/web/CalculadoraCampos";
import { useCalculadora } from "@/hooks/useCalculadora";
import { categories } from "@/lib/web/pricing/categories";
import { resolverTarifas, type FilaTarifas } from "@/lib/web/pricing/tarifas";

function Prueba({ fila, id = "mamparas" }: { fila?: FilaTarifas; id?: keyof typeof categories }) {
  const { categorias, precios } = resolverTarifas(categories, fila ?? null);
  const calc = useCalculadora(categorias, precios, id);
  return (
    <>
      <CalculadoraCampos categoria={calc.categoria} valores={calc.valores} onCambiar={calc.cambiar} />
      <ResultadoCalculo presupuesto={calc.presupuesto} />
      <pre data-testid="resumen">{calc.resumen}</pre>
    </>
  );
}

describe("CalculadoraCampos", () => {
  it("pinta las secciones y pide lo que falta antes de calcular", () => {
    render(<Prueba />);
    expect(screen.getByText("Tipo y composición")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /Tipo de mampara/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Falta: Ancho");
  });

  it("al escribir el ancho calcula; al cambiar el cristal, recalcula", () => {
    render(<Prueba />);
    fireEvent.change(screen.getByLabelText(/^Ancho/), { target: { value: "100" } });
    // 200 base + 100 cm × 3 €/cm (alto 195 por defecto, sin suplementos)
    expect(screen.getByTestId("total-calculo")).toHaveTextContent("500 €");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: /Cristal templado/ })).getByRole("radio", { name: "10 mm" }));
    expect(screen.getByTestId("total-calculo")).toHaveTextContent("600 €");
    expect(screen.getByTestId("resumen")).toHaveTextContent("Cristal templado: 10 mm");
  });

  it("respeta `when`: «Dirección» solo con puerta abatible o fijo + puerta", () => {
    render(<Prueba />);
    expect(screen.getByRole("radiogroup", { name: "Dirección" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: /Tipo de mampara/ })).getByRole("radio", { name: "Panel fijo (walk-in)" }));
    expect(screen.queryByRole("radiogroup", { name: "Lado de apertura" })).not.toBeInTheDocument();
  });

  it("usa los precios que se le dan (los del editor sin guardar)", () => {
    render(<Prueba fila={{ config: { mamparas: { base: 300 } } as never }} />);
    fireEvent.change(screen.getByLabelText(/^Ancho/), { target: { value: "100" } });
    expect(screen.getByTestId("total-calculo")).toHaveTextContent("600 €");
  });

  it("varias opciones (multi) y lo que se valora en la visita", () => {
    render(<Prueba />);
    fireEvent.change(screen.getByLabelText(/^Ancho/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Al ácido (translúcido)" }));
    expect(screen.getByRole("button", { name: "Al ácido (translúcido)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Se valora en la visita: Cristal al ácido/)).toBeInTheDocument();
  });
});
