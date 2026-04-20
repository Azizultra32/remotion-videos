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
// machine-specific layout into the source. With the alias, every custom
// element imports `from "@engine/types"` and works regardless of where
// MV_PROJECTS_DIR points.
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: {
      ...(current.resolve?.alias ?? {}),
      "@engine": path.resolve(__dirname, "src/compositions/elements"),
    },
  },
}));
