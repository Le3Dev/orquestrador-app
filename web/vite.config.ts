/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Os mesmos cabeçalhos do servidor (src/root.ts, isolarOrigem): liberam
    // threads no WebAssembly para o ditado por voz.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    // Em desenvolvimento o Vite serve a tela e repassa /api ao Express, para
    // que o front rode na mesma origem que terá depois do build — sem CORS e
    // sem variável de ambiente com a URL da API.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3200",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
