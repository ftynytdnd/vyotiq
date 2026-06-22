/**
 * Shared focus-trap helpers for modal surfaces ({@link ComposerDialog}).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/** Focus the first visible focusable element inside `root`. */
export function focusFirstFocusable(root: HTMLElement): void {
  getFocusable(root)[0]?.focus();
}

export interface FocusTrapBindOptions {
  root?: HTMLElement | null;
  /** Resolved on each keydown when the root mounts after open. */
  getRoot?: () => HTMLElement | null;
  onEscape?: () => void;
  disableEscape?: boolean;
}

/** Document-level Tab trap; optional Escape handler. */
export function bindFocusTrap({
  root: rootProp,
  getRoot,
  onEscape,
  disableEscape = false
}: FocusTrapBindOptions): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onEscape) {
      if (disableEscape) return;
      const root = getRoot?.() ?? rootProp ?? null;
      if (root && !root.contains(document.activeElement)) return;
      e.preventDefault();
      onEscape();
      return;
    }
    const root = getRoot?.() ?? rootProp ?? null;
    if (e.key !== 'Tab' || !root) return;
    const focusables = getFocusable(root);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
