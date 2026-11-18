// ============================================================================
// useAbrirAviso — qué pasa al tocar «Ver» en un aviso: se va a su origen (`rutaDeAviso`).
//   const { abrirAviso, dialogoAviso } = useAbrirAviso();
//   …  {dialogoAviso}   ← pintarlo UNA vez, fuera de cualquier popover que se cierre (hoy no hay modal:
//   se conserva para que un aviso pueda abrir su ficha en un diálogo sin cambiar a quien lo usa).
// ============================================================================
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { rutaDeAviso } from "@/lib/avisos";

type AvisoAbrible = Parameters<typeof rutaDeAviso>[0];

export function useAbrirAviso() {
  const navigate = useNavigate();

  /** Va al origen del aviso. Devuelve qué ha hecho («ruta» o nada). */
  const abrirAviso = useCallback(
    (n: AvisoAbrible): "ruta" | null => {
      const ruta = rutaDeAviso(n);
      if (ruta) {
        navigate(ruta);
        return "ruta";
      }
      return null;
    },
    [navigate],
  );

  return { abrirAviso, dialogoAviso: null };
}
