import { Facebook, Instagram } from "lucide-react";
import { cn } from "@/lib/utils";

// Un solo sitio para los estados de RRSS (como estados.ts e InsigniaEstado.tsx del panel de referencia): verde
// publicada, oro programada, discontinua borrador, azul lista, ámbar procesando y rojo error.

export const ESTADOS_RRSS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "border-dashed border-muted-foreground/50 text-muted-foreground" },
  lista: { texto: "Lista", clase: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200" },
  programada: { texto: "Programada", clase: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" },
  publicando: { texto: "Publicando", clase: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" },
  procesando: { texto: "Meta la está procesando", clase: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200" },
  publicada: { texto: "Publicada", clase: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" },
  error: { texto: "Error", clase: "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200" },
};

export function InsigniaEstado({ estado, className }: { estado: string; className?: string }) {
  const e = ESTADOS_RRSS[estado] ?? { texto: estado, clase: "border-border text-muted-foreground" };
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-medium", e.clase, className)} data-estado={estado}>
      {e.texto}
    </span>
  );
}

export function IconoRed({ red, className }: { red: string; className?: string }) {
  const Icono = red === "facebook" ? Facebook : Instagram;
  return <Icono className={cn("h-4 w-4 shrink-0", red === "facebook" ? "text-[#1877F2]" : "text-[#C13584]", className)} aria-label={red === "facebook" ? "Facebook" : "Instagram"} />;
}

export const NOMBRE_FORMATO: Record<string, string> = { foto: "Foto", carrusel: "Carrusel", reel: "Reel", story: "Historia" };
