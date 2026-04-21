// editor/src/constants/layout.ts
//
// Single source of truth for the editor\'s top-level grid column widths.
// App.tsx\'s CSS grid template and FloatingPreview\'s default position both
// depend on these — keep them in sync by importing, never re-typing.

export const SIDEBAR_COL_WIDTH = 210;
// Second "details" column immediately to the right of the palette.
// Shows ElementDetail when an element is selected, placeholder when not.
// Split out so the palette column stays narrow and detail controls get
// their own scroll view instead of fighting the palette for vertical space.
export const DETAIL_COL_WIDTH = 300;
export const CHAT_COL_WIDTH = 320;
export const DEFAULT_LEFT_MARGIN = 40;
