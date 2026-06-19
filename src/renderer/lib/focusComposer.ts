/**
 * Focus the chat composer contenteditable (Mod+J and programmatic callers).
 */

const COMPOSER_EDITOR_SELECTOR = '[data-composer-editor]';

/** Move the caret to the end of a contenteditable root. */
function placeCaretAtEnd(root: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Focus the composer editor when present and enabled. */
export function focusComposer(): boolean {
  const el = document.querySelector<HTMLElement>(COMPOSER_EDITOR_SELECTOR);
  if (!el || el.getAttribute('contenteditable') === 'false') return false;
  el.focus({ preventScroll: true });
  placeCaretAtEnd(el);
  return true;
}
