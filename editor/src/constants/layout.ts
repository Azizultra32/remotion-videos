// editor/src/constants/layout.ts
//
// Single source of truth for the editor\'s top-level grid column widths.
// App.tsx\'s CSS grid template and FloatingPreview\'s default position both
// depend on these — keep them in sync by importing, never re-typing.

export const SIDEBAR_COL_WIDTH = 240;
export const CHAT_COL_WIDTH = 320;
export const DEFAULT_LEFT_MARGIN = 40;
