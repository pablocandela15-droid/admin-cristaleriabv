import { cn } from "@/lib/utils";

/**
 * Elementos gráficos del manual de marca (página 09). Son decoración: siempre `aria-hidden`, en un solo color
 * por pieza y nunca encima del logotipo.
 */

interface PiezaProps {
  className?: string;
}

/**
 * El reflejo: dos trazos paralelos a 60°, como el brillo sobre un vidrio. Va en una esquina. El trazo grueso
 * toma `currentColor`; el fino, el mismo color o el que se le pase en `colorFino`.
 */
export function Reflejo({ className, colorFino }: PiezaProps & { colorFino?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false" className={cn("pointer-events-none", className)}>
      <line x1="22" y1="86" x2="58" y2="24" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <line x1="46" y1="92" x2="76" y2="40" stroke={colorFino ?? "currentColor"} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** El óculo: el aro de las ventanas del tambor de la cúpula (crema grueso por fuera, azul claro fino dentro). */
export function Oculo({ className }: PiezaProps) {
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden="true" focusable="false" className={cn("pointer-events-none", className)}>
      <circle cx="100" cy="100" r="88" stroke="hsl(var(--marca-crema))" strokeWidth="14" />
      <circle cx="100" cy="100" r="68" stroke="hsl(var(--marca-claro))" strokeWidth="2.5" />
    </svg>
  );
}

/** Los gajos: las costillas de la cúpula, como líneas de fondo en un solo color (`currentColor`). */
export function Gajos({ className }: PiezaProps) {
  return (
    <svg viewBox="0 0 240 140" fill="none" aria-hidden="true" focusable="false" className={cn("pointer-events-none", className)}>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="120" cy="12" r="7" />
        <path d="M120 19 V140" />
        <path d="M118 20 C 70 40, 18 90, 10 140" />
        <path d="M122 20 C 170 40, 222 90, 230 140" />
        <path d="M118 21 C 92 50, 62 100, 58 140" />
        <path d="M122 21 C 148 50, 178 100, 182 140" />
        <path d="M24 118 C 70 92, 170 92, 216 118" />
      </g>
    </svg>
  );
}
