/**
 * Embedded web browser (Globe) IPC types. The browser surface is an
 * Electron `WebContentsView` owned by the main process and positioned
 * over a renderer placeholder; the renderer drives it through these
 * messages and receives navigation state via `BROWSER_STATE`.
 */

/** Pixel rect (relative to the window content area) for the browser view. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserAttachInput {
  /** Optional URL to load if the view has no current page yet. */
  url?: string;
}

export interface BrowserNavigateInput {
  url: string;
}

export interface BrowserOpenExternalInput {
  url: string;
}

export interface BrowserSetBoundsInput {
  bounds: BrowserBounds;
}

export interface BrowserSetVisibleInput {
  visible: boolean;
}

export interface BrowserFindInput {
  text: string;
  forward?: boolean;
  /** When true, restart the find from the first match. */
  findNext?: boolean;
}

/** Navigation / loading snapshot pushed from main on every state change. */
export interface BrowserStateEvent {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Set when the last load failed. */
  error?: string;
}

export type BrowserAttachResult = { ok: true; state: BrowserStateEvent };
