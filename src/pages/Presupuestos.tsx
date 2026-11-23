import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EditorPresupuesto } from "@/components/presupuestos/EditorPresupuesto";
import { ListaPresupuestos } from "@/components/presupuestos/ListaPresupuestos";
import { usePermisosPresupuestos } from "@/hooks/usePermisosPresupuestos";
import { leerFiltroEstado, type FiltroEstado } from "@/lib/presupuestos/filtros";

// ---------------------------------------------------------------------------
// Presupuestos (/presupuestos): el gestor de presupuestos de la cristalería, con
// la lógica de la calculadora de la web (sus categorías y las tarifas de Web ›
// Tarifas). Lista con filtros y, con `?id=`, un presupuesto (enlace directo; lo
// usa el aviso de la campana de cada solicitud que llega de la web). El filtro
// (`?estado=`) y la búsqueda (`?q=`) también van en la dirección. Sección de
// permisos «presupuestos»: «Ver» en lectura, «Editar» todo.
// ---------------------------------------------------------------------------

const Presupuestos = () => {
  const permisos = usePermisosPresupuestos();
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const estado = leerFiltroEstado(params.get("estado"));
  const busqueda = params.get("q") ?? "";

  const cambiarParam = (clave: string, valor: string | null, reemplazar = true) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (valor) n.set(clave, valor);
        else n.delete(clave);
        return n;
      },
      { replace: reemplazar },
    );

  return (
    <DashboardLayout>
      {id ? (
        <EditorPresupuesto
          id={id}
          puedeEditar={permisos.editar}
          cargandoPermisos={permisos.cargando}
          onVolver={() => cambiarParam("id", null, false)}
          onAbrir={(otro) => cambiarParam("id", otro, false)}
        />
      ) : (
        <ListaPresupuestos
          puedeEditar={permisos.editar}
          cargandoPermisos={permisos.cargando}
          onAbrir={(otro) => cambiarParam("id", otro, false)}
          estado={estado}
          onEstado={(e: FiltroEstado) => cambiarParam("estado", e === "todos" ? null : e)}
          busqueda={busqueda}
          onBusqueda={(q) => cambiarParam("q", q || null)}
        />
      )}
    </DashboardLayout>
  );
};

export default Presupuestos;
