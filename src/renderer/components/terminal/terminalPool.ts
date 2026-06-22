/**
 * Persistent xterm.js instance pool, keyed by PTY `sessionId`.
 *
 * Each session keeps one long-lived `Terminal` whose host element is
 * re-parented into whichever pane currently shows it. Output streams into
 * the buffer continuously (single global `onData` listener) so scrollback
 * survives tab switches, splits, and session re-selection without losing
 * history or re-spawning the shell.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { vyotiq } from '../../lib/ipc.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { applyXtermTheme, buildXtermTheme, resolveMonoFontFamily } from '@shared/terminal/xtermTheme.js';

export interface TerminalPoolEntry {
  sessionId: string;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  opened: boolean;
}

const pool = new Map<string, TerminalPoolEntry>();

let listenersBound = false;
let themeObserver: MutationObserver | null = null;

interface TerminalPoolGlobals {
  __vyotiqTerminalPoolUnsub?: Array<() => void>;
}
const globalsRef = globalThis as unknown as TerminalPoolGlobals;

function teardownTerminalPoolListeners(): void {
  if (Array.isArray(globalsRef.__vyotiqTerminalPoolUnsub)) {
    for (const fn of globalsRef.__vyotiqTerminalPoolUnsub) {
      try {
        fn();
      } catch {
        /* noop */
      }
    }
  }
  globalsRef.__vyotiqTerminalPoolUnsub = undefined;
  themeObserver?.disconnect();
  themeObserver = null;
  listenersBound = false;
}

function bindGlobalListeners(): void {
  if (listenersBound) return;

  // Tear down any previous subscriptions (HMR).
  teardownTerminalPoolListeners();

  const unsub: Array<() => void> = [];
  unsub.push(
    vyotiq.terminal.onData((event) => {
      pool.get(event.sessionId)?.term.write(event.data);
    })
  );
  unsub.push(
    vyotiq.terminal.onExit((event) => {
      const entry = pool.get(event.sessionId);
      entry?.term.writeln(`\r\n\x1b[38;5;245m[shell exited ${event.exitCode}]\x1b[0m`);
      useTerminalStore.getState().handleExit(event.sessionId);
    })
  );
  globalsRef.__vyotiqTerminalPoolUnsub = unsub;
  listenersBound = true;

  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      for (const entry of pool.values()) {
        applyXtermTheme(entry.term);
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-density']
    });
  }
}

function tryLoadWebglRenderer(term: Terminal): void {
  try {
    const webgl = new WebglAddon();
    term.loadAddon(webgl);
  } catch {
    /* canvas renderer fallback */
  }
}

export function getTerminalEntry(sessionId: string): TerminalPoolEntry {
  bindGlobalListeners();
  const existing = pool.get(sessionId);
  if (existing) return existing;

  const host = document.createElement('div');
  host.className = 'vx-xterm-host h-full min-h-0 w-full';

  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    fontFamily: resolveMonoFontFamily(),
    fontSize: 13,
    lineHeight: 1.55,
    letterSpacing: 0,
    scrollback: 8000,
    smoothScrollDuration: 120,
    theme: buildXtermTheme()
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon());

  // Forward keystrokes to the owning PTY session.
  term.onData((data) => {
    void vyotiq.terminal.input({ sessionId, data });
  });

  const entry: TerminalPoolEntry = { sessionId, term, fit, search, host, opened: false };
  pool.set(sessionId, entry);
  return entry;
}

/** Open the terminal into its host (idempotent) and fit + report size. */
export function openTerminalEntry(entry: TerminalPoolEntry): void {
  if (!entry.opened) {
    entry.term.open(entry.host);
    tryLoadWebglRenderer(entry.term);
    applyXtermTheme(entry.term);
    entry.opened = true;
  }
  fitTerminalEntry(entry);
}

const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 4;

/** Clamp xterm dimensions to main-process validation minimums; null when unusable. */
export function clampTerminalDimensions(
  cols: number,
  rows: number
): { cols: number; rows: number } | null {
  if (cols <= 0 || rows <= 0) return null;
  return {
    cols: Math.max(MIN_TERMINAL_COLS, cols),
    rows: Math.max(MIN_TERMINAL_ROWS, rows)
  };
}

export function fitTerminalEntry(entry: TerminalPoolEntry): void {
  if (!entry.opened) return;
  try {
    entry.fit.fit();
  } catch {
    return;
  }
  const clamped = clampTerminalDimensions(entry.term.cols, entry.term.rows);
  if (!clamped) return;
  void vyotiq.terminal.resize({
    sessionId: entry.sessionId,
    cols: clamped.cols,
    rows: clamped.rows
  });
}

export function disposeTerminalEntry(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry) return;
  try {
    entry.term.dispose();
  } catch {
    /* noop */
  }
  entry.host.remove();
  pool.delete(sessionId);
}
