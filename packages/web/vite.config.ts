import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginDefault from "vite-plugin-monaco-editor";

const monacoEditorPlugin =
  (monacoEditorPluginDefault as unknown as { default?: typeof monacoEditorPluginDefault })
    .default ?? monacoEditorPluginDefault;

export default defineConfig({
  plugins: [react(), monacoEditorPlugin({ languageWorkers: ["editorWorkerService"] })],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
