import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setOverwriteOutput(true);
Config.setCodec("h264");

// Video and pixel format for optimal compatibility
Config.setVideoImageFormat("jpeg");
Config.setPixelFormat("yuv420p");

// Audio settings - Use shared audio tags to bypass browser autoplay policies
Config.setNumberOfSharedAudioTags(5);

// Webpack alias for per-project custom elements. Custom elements live at
// <MV_PROJECTS_DIR>/<stem>/custom-elements/*.tsx — possibly outside the
// engine repo entirely on an external volume. Without this alias they'd
// have to import engine types via a brittle relative path that bakes a
// machine-specific layout into the source.
//
// DELIBERATELY NARROW: exact-match on `@engine/types` only, NOT a prefix
// alias for `@engine/*`. A prefix alias would let a custom element write
// `from "@engine/../../utils/secret"` and reach arbitrary engine code —
// Webpack/Vite don't normalize `..` before alias resolution. The
// narrow-map pattern closes that traversal escape. If a custom element
// genuinely needs another engine type later, add a new exact entry here
// rather than widening to a prefix. `types.ts` is the only contract
// surface the element-authoring API depends on.
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: {
      ...(current.resolve?.alias ?? {}),
      "@engine/types": path.resolve(__dirname, "src/compositions/elements/types.ts"),
    },
  },
}));
