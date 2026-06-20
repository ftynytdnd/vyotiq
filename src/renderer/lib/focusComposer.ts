/**
 * Focus the chat composer contenteditable (Mod+J and programmatic callers).
 */

const COMPOSER_EDITOR_SELECTOR = '[data-composer-editor]';

/** Move the caret to the end of a contenteditable root. */
export function placeCaretAtEnd(root: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export interface ScheduleDomFocusOptions {
  /** Place caret at end after focusing a contenteditable. */
  caretAtEnd?: boolean;
}

/**
 * Defer focus until after layout/paint (two animation frames).
 * Returns a cancel function for effect cleanups.
 */
export function scheduleDomFocus(
  el: HTMLElement,
  options: ScheduleDomFocusOptions = {}
): () => void {
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(() => {
      if (!document.body.contains(el)) return;
      el.focus({ preventScroll: true });
      if (options.caretAtEnd && el.isContentEditable) {
        placeCaretAtEnd(el);
      }
    });
  });
  return () => {
    cancelAnimationFrame(outer);
    cancelAnimationFrame(inner);
  };
}

/** Focus the composer editor when present and enabled. */
export function focusComposer(): boolean {
  const el = document.querySelector<HTMLElement>(COMPOSER_EDITOR_SELECTOR);
  if (!el || el.getAttribute('contenteditable') === 'false') return false;
  scheduleDomFocus(el, { caretAtEnd: true });
  return true;
}
