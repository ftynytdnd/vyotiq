/**
 * Embedded web browser (Globe) — a single `WebContentsView` owned by main
 * and positioned over a renderer placeholder. Uses a persistent isolated
 * partition so logins survive restarts. Navigation for this view is
 * intentionally unrestricted (see the `will-navigate` exemption in
 * `index.ts`); all other windows stay locked down.
 */

import { WebContentsView, shell } from 'electron';
import type {
  BrowserBounds,
  BrowserFindInput,
  BrowserStateEvent
} from '@shared/types/browser.js';
import { IPC } from '@shared/constants.js';
import { getMainWindow } from './getMainWindow.js';
import { safeWebContentsSend } from './safeWebContentsSend.js';
import { logger } from '../logging/logger.js';

const log = logger.child('browser');

const BROWSER_PARTITION = 'persist:vyotiq-browser';

let view: WebContentsView | null = null;
let viewWebContentsId: number | null = null;
let bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
let visible = false;

/** True when the given webContents id is the embedded browser view. */
export function isBrowserWebContents(id: number): boolean {
  return viewWebContentsId !== null && viewWebContentsId === id;
}

function snapshotState(error?: string): BrowserStateEvent {
  const wc = view?.webContents;
  return {
    url: wc?.getURL() ?? '',
    title: wc?.getTitle() ?? '',
    loading: wc?.isLoading() ?? false,
    canGoBack: wc?.navigationHistory.canGoBack() ?? false,
    canGoForward: wc?.navigationHistory.canGoForward() ?? false,
    ...(error ? { error } : {})
  };
}

function emitState(error?: string): void {
  safeWebContentsSend(IPC.BROWSER_STATE, snapshotState(error));
}

function applyVisibility(): void {
  if (!view) return;
  view.setVisible(visible);
  // Park the view off-screen while hidden so it never intercepts clicks.
  view.setBounds(
    visible ? bounds : { x: -20000, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }
  );
}

function createView(): WebContentsView {
  const win = getMainWindow();
  if (!win) throw new Error('No main window for browser view');

  const created = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // Transparent until first paint; matches the workbench surface.
  created.setBackgroundColor('#00000000');
  win.contentView.addChildView(created);

  const wc = created.webContents;
  viewWebContentsId = wc.id;

  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => emitState());
  wc.on('did-stop-loading', () => emitState());
  wc.on('did-navigate', () => emitState());
  wc.on('did-navigate-in-page', () => emitState());
  wc.on('page-title-updated', () => emitState());
  wc.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED */) return;
    emitState(errorDescription || `Load failed (${errorCode})`);
  });

  view = created;
  applyVisibility();
  return created;
}

function ensureView(): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view;
  return createView();
}

export function browserAttach(url?: string): BrowserStateEvent {
  const v = ensureView();
  visible = true;
  applyVisibility();
  const current = v.webContents.getURL();
  if (url) {
    void v.webContents.loadURL(url).catch((err) => {
      log.warn('browser load failed', { err: err instanceof Error ? err.message : String(err) });
    });
  } else if (!current || current === 'about:blank') {
    // No URL yet — stay blank; renderer shows the start UI.
  }
  return snapshotState();
}

export function browserNavigate(url: string): void {
  const v = ensureView();
  void v.webContents.loadURL(url).catch((err) => {
    emitState(err instanceof Error ? err.message : String(err));
  });
}

export function browserBack(): void {
  view?.webContents.navigationHistory.goBack();
}

export function browserForward(): void {
  view?.webContents.navigationHistory.goForward();
}

export function browserReload(): void {
  view?.webContents.reload();
}

export function browserStop(): void {
  view?.webContents.stop();
}

export function browserSetBounds(next: BrowserBounds): void {
  bounds = {
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: Math.max(0, Math.round(next.width)),
    height: Math.max(0, Math.round(next.height))
  };
  if (view && visible) view.setBounds(bounds);
}

export function browserSetVisible(next: boolean): void {
  visible = next;
  if (view) applyVisibility();
}

export function browserFind(input: BrowserFindInput): void {
  if (!view || !input.text) return;
  view.webContents.findInPage(input.text, {
    forward: input.forward ?? true,
    findNext: input.findNext ?? false
  });
}

export function browserStopFind(): void {
  view?.webContents.stopFindInPage('clearSelection');
}

export function browserOpenExternal(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    void shell.openExternal(url);
    return;
  }
  throw new Error('Only http(s) URLs can be opened externally');
}

export function browserDestroy(): void {
  if (!view) return;
  const win = getMainWindow();
  try {
    win?.contentView.removeChildView(view);
  } catch {
    /* window may be gone */
  }
  try {
    if (!view.webContents.isDestroyed()) view.webContents.close();
  } catch {
    /* noop */
  }
  view = null;
  viewWebContentsId = null;
  visible = false;
}
