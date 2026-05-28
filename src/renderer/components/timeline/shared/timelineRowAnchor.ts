/**
 * Stable row anchors for timeline deep-linking (`#row-<key>`).
 */

import { safeCopy } from '../../../lib/clipboard.js';

export function rowAnchorDomId(rowKey: string): string {
  return `row-${encodeURIComponent(rowKey)}`;
}

export function rowAnchorHash(rowKey: string): string {
  return `#${rowAnchorDomId(rowKey)}`;
}

export function parseRowAnchorHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('row-')) return null;
  try {
    return decodeURIComponent(raw.slice(4));
  } catch {
    return null;
  }
}

export function scrollToRowAnchor(rowKey: string, behavior: ScrollBehavior = 'smooth'): boolean {
  const el = document.getElementById(rowAnchorDomId(rowKey));
  if (!el) return false;
  el.scrollIntoView({ behavior, block: 'start' });
  return true;
}

export async function copyRowAnchor(rowKey: string): Promise<boolean> {
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', rowAnchorHash(rowKey));
  }
  const url = typeof window !== 'undefined' ? `${window.location.href}` : rowAnchorHash(rowKey);
  return safeCopy(url, { context: 'timeline-row-anchor' });
}
