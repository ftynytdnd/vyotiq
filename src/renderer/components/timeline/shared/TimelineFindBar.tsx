/**
 * Slim in-timeline find bar (Cmd/Ctrl+F). Highlights matches via `<mark>`.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { escapeFocusInRoots, registerEscapeLayer } from '../../../lib/escapeLayerStack.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { appPopoverPanelClassName } from '../../ui/SurfaceShell.js';
import { FindBarShell } from '../../ui/FindBarShell.js';

const MARK_CLASS = 'vyotiq-timeline-find-mark';
const MARK_ACTIVE_CLASS = 'vyotiq-timeline-find-mark-active';

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
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const focusMatch = useCallback((root: HTMLElement, index: number) => {
    const marks = root.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`);
    marks.forEach((mark, i) => {
      mark.classList.toggle(MARK_ACTIVE_CLASS, i === index);
    });
    const active = marks[index];
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const stepMatch = useCallback(
    (direction: 1 | -1) => {
      const root = rootRef.current;
      if (!root || matchCount === 0) return;
      setActiveIndex((prev) => {
        const next = (prev + direction + matchCount) % matchCount;
        focusMatch(root, next);
        return next;
      });
    },
    [focusMatch, matchCount, rootRef]
  );

  useEffect(() => {
    if (!open) return;
    return registerEscapeLayer('timeline-find', 70, () => {
      if (!escapeFocusInRoots(document.activeElement, [shellRef.current, rootRef.current])) {
        return false;
      }
      onClose();
      return true;
    });
  }, [open, onClose, rootRef]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQuery('');
      setMatchCount(0);
      setActiveIndex(0);
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
      setActiveIndex(0);
      return;
    }

    const count = highlightMatches(root, debouncedQuery);
    setMatchCount(count);
    setActiveIndex(0);
    if (count > 0) {
      requestAnimationFrame(() => focusMatch(root, 0));
    }
    return () => clearFindMarks(root);
  }, [open, debouncedQuery, rootRef, contentGeneration, focusMatch]);

  if (!open) return null;

  const matchLabel =
    debouncedQuery && matchCount > 0
      ? `${activeIndex + 1}/${matchCount}`
      : debouncedQuery
        ? '0'
        : '—';

  return (
    <div ref={shellRef} data-timeline-find>
      <FindBarShell
      placeholder="Find in conversation…"
      value={query}
      onChange={setQuery}
      onStep={(forward) => stepMatch(forward ? 1 : -1)}
      onClose={onClose}
      inputRef={inputRef}
      matchLabel={matchLabel}
      stepDisabled={matchCount === 0}
      navVariant="chevron"
      inputType="search"
      inputClassName="border-b-0 py-0 text-row"
      inputAriaLabel="Find in conversation"
      leadingIcon={
        <Search className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      }
      className={cn(
        'sticky top-2 z-40 mb-2 flex items-center gap-2 px-2 py-1.5 backdrop-blur-sm',
        appPopoverPanelClassName
      )}
      role="search"
    />
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
