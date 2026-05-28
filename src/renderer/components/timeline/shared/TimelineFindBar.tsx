/**
 * Slim in-timeline find bar (Cmd/Ctrl+F). Highlights matches via `<mark>`.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { chromePopoverPanelClassName } from '../../ui/SurfaceShell.js';

const MARK_CLASS = 'vyotiq-timeline-find-mark';

/** Debounce DOM highlight work while the user types in the find field. */
const FIND_DEBOUNCE_MS = 150;

interface TimelineFindBarProps {
  open: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
  /** Bump when timeline body changes so highlights refresh during streaming. */
  contentGeneration?: number;
}

export function TimelineFindBar({
  open,
  onClose,
  rootRef,
  contentGeneration = 0
}: TimelineFindBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQuery('');
      setMatchCount(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDebouncedQuery('');
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    clearFindMarks(root);

    if (!open || debouncedQuery.length === 0) {
      setMatchCount(0);
      return;
    }

    const count = highlightMatches(root, debouncedQuery);
    setMatchCount(count);
    return () => clearFindMarks(root);
  }, [open, debouncedQuery, rootRef, contentGeneration]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'sticky top-2 z-40 mb-2 flex items-center gap-2 px-1',
        chromePopoverPanelClassName,
        'border border-border-subtle/40 bg-surface-raised/95 px-2 py-1.5 shadow-md backdrop-blur-sm'
      )}
      role="search"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2.25} />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in conversation…"
        className="min-w-0 flex-1 bg-transparent text-row text-text-primary outline-none placeholder:text-text-faint"
        aria-label="Find in conversation"
      />
      <span className="shrink-0 font-mono text-meta text-text-faint">
        {debouncedQuery ? matchCount : '—'}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="rounded-inner p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-secondary"
        aria-label="Close find"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/** @internal Exported for unit tests. */
export function clearFindMarks(root: HTMLElement): void {
  root.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  });
}

/** @internal Exported for unit tests. */
export function highlightMatches(root: HTMLElement, query: string): number {
  const needle = query.toLowerCase();
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.parentElement?.closest(`.${MARK_CLASS}`)) {
      node = walker.nextNode();
      continue;
    }
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const source = textNode.textContent ?? '';
    const lower = source.toLowerCase();
    if (!lower.includes(needle)) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (cursor < source.length) {
      const idx = lower.indexOf(needle, cursor);
      if (idx < 0) {
        frag.appendChild(document.createTextNode(source.slice(cursor)));
        break;
      }
      if (idx > cursor) {
        frag.appendChild(document.createTextNode(source.slice(cursor, idx)));
      }
      const mark = document.createElement('mark');
      mark.className = `${MARK_CLASS} rounded-sm bg-accent/25 text-inherit`;
      mark.textContent = source.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      count += 1;
      cursor = idx + needle.length;
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return count;
}
