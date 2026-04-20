import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { customElementsPlugin } from "./vite-plugin-custom-elements";
import { sidecarPlugin } from "./vite-plugin-sidecar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the projects root the same way scripts/cli/paths.ts does so Vite's
// fs.allow list covers per-project custom-elements/ dirs that may live
// outside the repo (MV_PROJECTS_DIR can point anywhere).
const resolveProjectsDir = (): string => {
  const override = process.env.MV_PROJECTS_DIR?.trim();
  if (override) {
    return override.startsWith("~/")
      ? path.resolve(process.env.HOME || "", override.slice(2))
      : path.resolve(override);
  }
  return path.resolve(__dirname, "../projects");
};

export default defineConfig({
  plugins: [react(), sidecarPlugin(), customElementsPlugin()],
  // Editor shares Remotion's public/ dir so staticFile() paths resolve in-browser.
  publicDir: path.resolve(__dirname, "../public"),
  resolve: {
    // Use an absolute path so both `vite` (dev server) and `vite build`
    // resolve the alias. A relative string worked for `tsc --noEmit` but
    // not for Rollup at build time (ENOENT on `../src/compositions/X`).
    alias: {
      "@compositions": path.resolve(__dirname, "../src/compositions"),
      "@hooks": path.resolve(__dirname, "../src/hooks"),
      "@utils": path.resolve(__dirname, "../src/utils"),
      // Per-project custom-elements alias — see remotion.config.ts for
      // why this exists. Both the editor's Vite plugin and the renderer's
      // Webpack must resolve `@engine/types` to the same engine surface
      // so a custom element file works in both pipelines unchanged.
      "@engine": path.resolve(__dirname, "../src/compositions/elements"),
      // Force a single React copy. Without this, `../src/compositions/*.tsx`
      // resolves React from the repo root's node_modules while the editor's
      // entry uses its own copy — two Reacts means useContext() sees a null
      // dispatcher and everything explodes on first hook.
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "node_modules/react/jsx-dev-runtime.js"),
      // Same trap for `remotion` itself — the Player owns the TimelineContext
      // it publishes, and useCurrentFrame() must read from that same module
      // instance.
      remotion: path.resolve(__dirname, "node_modules/remotion"),
      // Per-project custom elements author their own Zod schemas. Without
      // dedupe, the editor bundles the repo-root copy (engine) + a second
      // copy for the project code, and z.instanceof checks in the registry
      // break because the ZodType constructor identity differs.
      zod: path.resolve(__dirname, "../node_modules/zod"),
    },
    dedupe: ["react", "react-dom", "remotion", "zod"],
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
    // Vite's default fs.allow is the project root (editor/). Per-project
    // custom-elements live in projects/<stem>/custom-elements/*.tsx — outside
    // editor/ by design, and outside the repo entirely when MV_PROJECTS_DIR
    // overrides it. Explicitly whitelist both the repo root and the projects
    // root so the custom-elements Vite plugin can load them.
    fs: {
      allow: [path.resolve(__dirname, ".."), resolveProjectsDir()],
    },
  },
});
