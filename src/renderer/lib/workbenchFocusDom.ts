/**
 * DOM focus callbacks for open workbench companion panes.
 */

import type { CompanionTab } from '../components/workbench/workbenchShared.js';

let terminalFocus: (() => void) | null = null;
let editorFocus: (() => void) | null = null;
let browserUrlFocus: (() => void) | null = null;

export function registerTerminalDomFocus(fn: () => void): () => void {
  terminalFocus = fn;
  return () => {
    if (terminalFocus === fn) terminalFocus = null;
  };
}

export function registerEditorDomFocus(fn: () => void): () => void {
  editorFocus = fn;
  return () => {
    if (editorFocus === fn) editorFocus = null;
  };
}

export function registerBrowserUrlDomFocus(fn: () => void): () => void {
  browserUrlFocus = fn;
  return () => {
    if (browserUrlFocus === fn) browserUrlFocus = null;
  };
}

/** Focus the DOM surface for the active workbench companion tab. */
export function focusActiveWorkbenchDom(tab: CompanionTab): void {
  const run = () => {
    switch (tab) {
      case 'terminal':
        terminalFocus?.();
        break;
      case 'editor':
        editorFocus?.();
        break;
      case 'browser':
        browserUrlFocus?.();
        break;
      case 'preview':
        break;
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

/** Test-only reset. */
export function __test_resetWorkbenchFocusDom(): void {
  terminalFocus = null;
  editorFocus = null;
  browserUrlFocus = null;
}
