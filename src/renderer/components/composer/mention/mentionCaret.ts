/**
 * Map DOM selection offsets to {@link documentToPlainText} coordinates
 * (chips count as `@label` in the plain string).
 */

import type { MentionRef } from '@shared/types/mention.js';
import { extractMentions } from './mentionDocument.js';
import type { MentionDocument } from './mentionDocument.js';

const CHIP_CLASS = 'vx-mention-chip';

export function getPlainCaretOffset(
  root: HTMLElement | null,
  knownMentions: MentionRef[]
): number | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  return measurePlainOffset(root, range.startContainer, range.startOffset, knownMentions);
}

function measurePlainOffset(
  root: HTMLElement,
  endNode: Node,
  endOffset: number,
  knownMentions: MentionRef[]
): number {
  let total = 0;
  let done = false;

  const visit = (node: Node): void => {
    if (done) return;
    if (node === endNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += Math.min(endOffset, (node.textContent ?? '').length);
      }
      done = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent ?? '').length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elem = node as HTMLElement;
    if (elem.classList.contains(CHIP_CLASS) && elem.dataset.mentionId) {
      const ref = knownMentions.find((m) => m.id === elem.dataset.mentionId);
      total += ref ? `@${ref.label}`.length : (elem.textContent ?? '').length;
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
      if (done) return;
    }
  };

  for (const child of Array.from(root.childNodes)) {
    visit(child);
    if (done) break;
  }
  return total;
}

export function getPlainSelectionRange(
  root: HTMLElement | null,
  knownMentions: MentionRef[]
): { start: number; end: number; collapsed: boolean } | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = measurePlainOffset(root, range.startContainer, range.startOffset, knownMentions);
  const end = measurePlainOffset(root, range.endContainer, range.endOffset, knownMentions);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    collapsed: range.collapsed
  };
}

export function placeCaretAtPlainOffset(
  root: HTMLElement | null,
  offset: number,
  doc: MentionDocument
): void {
  if (!root) return;
  const mentions = extractMentions(doc);
  let remaining = offset;
  const range = document.createRange();

  const placeInText = (node: Text, off: number) => {
    range.setStart(node, off);
    range.collapse(true);
  };

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (remaining <= len) {
        placeInText(node as Text, remaining);
        return true;
      }
      remaining -= len;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const elem = node as HTMLElement;
    if (elem.classList.contains(CHIP_CLASS) && elem.dataset.mentionId) {
      const ref = mentions.find((m) => m.id === elem.dataset.mentionId);
      const len = ref ? `@${ref.label}`.length : (elem.textContent ?? '').length;
      if (remaining <= len) {
        range.setStartAfter(elem);
        range.collapse(true);
        return true;
      }
      remaining -= len;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };

  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) break;
  }

  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
