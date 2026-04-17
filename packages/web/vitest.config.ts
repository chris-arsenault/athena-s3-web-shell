import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    alias: {
      // monaco-editor's package.json exports map trips vite's resolver
      // in test context. Most of our code uses monaco types only
      // (erased at compile time), so a tiny stub that provides the
      // runtime enum we care about is enough.
      "monaco-editor": resolve(__dirname, "./src/test/monacoStub.ts"),
    },
  },
});
