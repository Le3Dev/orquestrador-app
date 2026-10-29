import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Fontes empacotadas (sem CDN): funcionam também fora da internet.
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import "@xyflow/react/dist/style.css";

import { CanvasDeOrquestradores } from "./paginas/CanvasDeOrquestradores";
// Depois do CSS do React Flow, para o tema sobrescrever as cores dele.
import "./theme/index.css";

const raiz = document.getElementById("root");

if (raiz === null) {
  throw new Error("Elemento #root não encontrado no index.html.");
}

createRoot(raiz).render(
  <StrictMode>
    <CanvasDeOrquestradores />
  </StrictMode>,
);
