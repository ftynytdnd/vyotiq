/**
 * Composer ghost suffix DOM helpers (contenteditable-safe).
 */

const GHOST_ATTR = 'data-vx-composer-ghost';

export function removeComposerGhost(editor: HTMLElement | null): void {
  if (!editor) return;
  editor.querySelectorAll(`[${GHOST_ATTR}]`).forEach((node) => node.remove());
}

export function renderComposerGhost(editor: HTMLElement | null, ghost: string | null): void {
  removeComposerGhost(editor);
  if (!editor || !ghost) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return;

  const span = document.createElement('span');
  span.className = 'vx-composer-inline-ghost';
  span.setAttribute(GHOST_ATTR, '1');
  span.contentEditable = 'false';
  span.textContent = ghost;
  range.insertNode(span);

  const restore = document.createRange();
  restore.setStartBefore(span);
  restore.collapse(true);
  sel.removeAllRanges();
  sel.addRange(restore);
}
