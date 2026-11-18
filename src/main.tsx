import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Fuentes de la marca (manual, página 08), autoalojadas para que el panel las tenga también sin conexión.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/lexend/wght.css";
import "./index.css";
import { registrarServiceWorker } from "./registrarServiceWorker";
import { AvisoActualizacion } from "./actualizacion/AvisoActualizacion";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <AvisoActualizacion />
  </>,
);

registrarServiceWorker();
