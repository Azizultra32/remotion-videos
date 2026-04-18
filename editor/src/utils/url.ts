// editor/src/utils/url.ts
//
// Converts store-side audio / analysis src strings into URLs the browser can
// actually fetch. The store holds path-relative strings like
//   "projects/love-in-traffic/audio.mp3"
// which are not served by Vite's publicDir directly — the sidecar's
// GET /api/projects/<rest> handler is the canonical serving surface.
//
// This helper lives alone because many components used to hand-roll the
// conversion; that drifted across Preview/App/SongPicker/useBeatData and
// caused a class of "works here, 404s there" bugs during the migration.
// One helper, one rule: projects/* paths go through /api/projects/*.

/**
 * Convert a store-side audioSrc/beatsSrc to a browser-fetchable URL.
 *
 * Rules, in order:
 *   - null / empty             -> null
 *   - http(s)://...            -> passthrough
 *   - starts with /api/        -> passthrough (already an API path)
 *   - starts with /            -> passthrough (root-relative, legacy)
 *   - starts with projects/    -> "/api/" + src (new canonical form)
 *   - anything else (bare)     -> "/" + src (legacy pre-migration fallback)
 */
export const toEditorUrl = (src: string | null | undefined): string | null => {
  if (!src) return null;
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("/api/")) return src;
  if (src.startsWith("/")) return src;
  if (src.startsWith("projects/")) return `/api/${src}`;
  // Bare filename — used to work via Vite publicDir. Keep as last-resort
  // fallback so very old persisted state doesn't crash; SongPicker will
  // surface it as "(missing)" and a track switch will fix it.
  return `/${src.replace(/^\//, "")}`;
};

/**
 * Parse a store-side audioSrc into the stem portion of its project path.
 * Returns null for legacy bare-filename formats that don't carry a stem.
 *   "projects/love-in-traffic/audio.mp3" -> "love-in-traffic"
 *   "love-in-traffic.mp3"                -> "love-in-traffic" (legacy fallback)
 */
export const stemFromAudioSrc = (src: string | null | undefined): string | null => {
  if (!src) return null;
  const m1 = src.match(/^projects\/([^/]+)\/audio\.(mp3|wav|m4a)$/i);
  if (m1) return m1[1];
  // Legacy bare-filename fallback: "<stem>.mp3"
  const m2 = src.replace(/^\//, "").match(/^([^/]+)\.(mp3|wav|m4a)$/i);
  if (m2) return m2[1];
  return null;
};
