import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sidecarPlugin } from "./vite-plugin-sidecar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), sidecarPlugin()],
  // Editor shares Remotion's public/ dir so staticFile() paths resolve in-browser.
  publicDir: path.resolve(__dirname, "../public"),
  resolve: {
    // Use an absolute path so both `vite` (dev server) and `vite build`
    // resolve the alias. A relative string worked for `tsc --noEmit` but
    // not for Rollup at build time (ENOENT on `../src/compositions/X`).
    alias: {
      "@compositions": path.resolve(__dirname, "../src/compositions"),
      "@hooks": path.resolve(__dirname, "../src/hooks"),
      // Force a single React copy. Without this, `../src/compositions/*.tsx`
      // resolves React from the repo root's node_modules while the editor's
      // entry uses its own copy — two Reacts means useContext() sees a null
      // dispatcher and everything explodes on first hook.
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-runtime.js",
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-dev-runtime.js",
      ),
      // Same trap for `remotion` itself — the Player owns the TimelineContext
      // it publishes, and useCurrentFrame() must read from that same module
      // instance.
      remotion: path.resolve(__dirname, "node_modules/remotion"),
    },
    dedupe: ["react", "react-dom", "remotion"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "remotion"],
  },
  server: {
    port: 4000,
    // Allow any Host header — needed for cloudflared / ngrok tunnels.
    // Safe in dev: the dev server doesn't expose secrets; sidecar has its
    // own path-traversal guards on /api/projects/*.
    allowedHosts: true,
  },
});
