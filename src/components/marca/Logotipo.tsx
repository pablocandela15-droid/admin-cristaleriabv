import { LOGOTIPO, NEGOCIO } from "@/config/negocio";
import { cn } from "@/lib/utils";

export type VarianteLogotipo = keyof typeof LOGOTIPO;

interface LogotipoProps {
  /** `horizontal` (positivo), `horizontalNegativo` (sobre marino) o `simbolo` (la cúpula sola). */
  variante?: VarianteLogotipo;
  /** Da el tamaño con la altura (`h-10`) o el ancho (`w-40`); el otro lado sale de la proporción. */
  className?: string;
  /** Si el nombre ya está escrito al lado, el logotipo es decorativo y no se anuncia dos veces. */
  decorativo?: boolean;
}

/**
 * El logotipo original de Cristalería Baix Vinalopó (manual de marca, página 05). Es una imagen, no un SVG en
 * línea: los trazos pesan ~100 KB y así el navegador y el service worker los guardan una sola vez para todo
 * el panel en lugar de repetirlos dentro del JavaScript.
 */
export function Logotipo({ variante = "horizontal", className, decorativo = false }: LogotipoProps) {
  const { src, ancho, alto } = LOGOTIPO[variante];
  return (
    <img
      src={src}
      width={ancho}
      height={alto}
      alt={decorativo ? "" : NEGOCIO.nombre}
      aria-hidden={decorativo || undefined}
      draggable={false}
      decoding="async"
      className={cn("block h-auto w-auto max-w-none select-none", className)}
    />
  );
}
