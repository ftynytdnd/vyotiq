/**
 * Picker preview dimensions — keep small to limit desktopCapturer work (Electron docs:
 * set thumbnailSize to 0 when previews are not needed; use minimal size when you do).
 */

export const CAPTURE_PICKER_PREVIEW_SIZE = { width: 128, height: 72 } as const;

export const CAPTURE_SOURCE_LIST_CACHE_MS = 20_000;

/** Show skeleton only when the fast source list takes longer than this. */
export const CAPTURE_PICKER_SKELETON_DELAY_MS = 50;

/** Debounce hover prefetch so moving across the footer does not spam IPC. */
export const CAPTURE_PICKER_PREFETCH_DEBOUNCE_MS = 120;

/** Show search when window count exceeds this. */
export const CAPTURE_PICKER_SEARCH_THRESHOLD = 8;

/** Virtualize the window list when count exceeds this. */
export const CAPTURE_PICKER_VIRTUALIZE_THRESHOLD = 12;

/** Fixed row height for virtualized window rows (px). */
export const CAPTURE_PICKER_ROW_HEIGHT_PX = 52;

/** Max height of the virtualized window scroller (px). */
export const CAPTURE_PICKER_WINDOW_LIST_MAX_HEIGHT_PX = 260;
