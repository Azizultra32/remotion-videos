import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use an absolute path so both `vite` (dev server) and `vite build`
    // resolve the alias. A relative string worked for `tsc --noEmit` but
    // not for Rollup at build time (ENOENT on `../src/compositions/X`).
    alias: {
      "@compositions": path.resolve(__dirname, "../src/compositions"),
    },
  },
  server: { port: 4000 },
});
