/**
 * Dropdown — single-select listbox with optional grouping.
 *
 * Keyboard model (matches the ARIA listbox pattern):
 *   - `ArrowDown` / `ArrowUp` move focus through enabled options.
 *   - `Home` / `End` jump to the first / last enabled option.
 *   - `Enter` / `Space` commit the focused option.
 *   - `Escape` closes the panel and restores focus to the trigger.
 *   - `Tab` closes the panel without committing (lets the user
 *     continue tabbing through the surrounding form).
 *
 * Mouse hover synchronises the focused index so the highlighted row
 * tracks the pointer, mirroring the model picker's command-palette
 * feel.
 *
 * Positioning: the panel is right-anchored under the trigger inside
 * a `relative` parent. Callers that mount the dropdown inside an
 * `overflow-hidden` ancestor should use the `Popover` primitive
 * directly instead — every Dropdown consumer today sits in a free-
 * flowing settings layout, so the simpler positioning is preserved.
 *
 * Surface palette:
 *   - Trigger : `bg-surface-overlay` resting → `bg-surface-hover` on
 *     hover / open, with `text-text-secondary` → `text-text-primary`.
 *   - Panel   : `elev-1` on `bg-surface-overlay` rounded-card.
 *   - Rows    : same hover transition as the rest of the app's row
 *     family; `bg-surface-hover` is the active-selected tint.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Eyebrow } from './Eyebrow.js';

export interface DropdownItem<T = string> {
  value: T;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
}

interface DropdownProps<T = string> {
  items: DropdownItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Dropdown<T extends string>({
  items,
  value,
  onChange,
  placeholder = 'Select…',
  disabled,
  className
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

  const selected = items.find((i) => i.value === value);

  // Group items if any have a `group`. Preserves caller-provided
  // ordering — group iteration follows insertion order via the Map.
  const groups = useMemo(() => {
    const map = new Map<string, DropdownItem<T>[]>();
    for (const item of items) {
      const key = item.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  // Flat list of enabled items in render order — drives keyboard nav
  // so disabled rows are skipped without bookkeeping.
  const navigable = useMemo(
    () =>
      groups
        .flatMap(([, gItems]) => gItems)
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => !item.disabled),
    [groups]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // When the panel opens, pre-focus the currently-selected option (or
  // the first enabled option as a fallback). Mirrors the model picker.
  useEffect(() => {
    if (!open) {
      setFocusedIdx(-1);
      return;
    }
    const selectedNav = navigable.find(({ item }) => item.value === value);
    if (selectedNav) {
      setFocusedIdx(selectedNav.idx);
    } else if (navigable.length > 0) {
      setFocusedIdx(navigable[0]!.idx);
    }
  }, [open, value, navigable]);

  // Keep the focused row in view as the user navigates.
  useEffect(() => {
    if (focusedIdx === -1) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-idx="${focusedIdx}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  const moveFocus = (dir: 1 | -1) => {
    if (navigable.length === 0) return;
    const order = navigable.map(({ idx }) => idx);
    if (focusedIdx === -1) {
      setFocusedIdx(dir === 1 ? order[0]! : order[order.length - 1]!);
      return;
    }
    const pos = order.indexOf(focusedIdx);
    const nextPos = (pos + dir + order.length) % order.length;
    setFocusedIdx(order[nextPos]!);
  };

  const commit = (idx: number) => {
    const item = items[idx];
    if (!item || item.disabled) return;
    onChange(item.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      if (navigable.length > 0) setFocusedIdx(navigable[0]!.idx);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      if (navigable.length > 0) setFocusedIdx(navigable[navigable.length - 1]!.idx);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusedIdx !== -1) commit(focusedIdx);
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn('relative inline-block app-no-drag', className)}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          'inline-flex h-8 max-w-64 items-center gap-1.5 rounded-inner px-2.5 text-row',
          'bg-surface-overlay text-text-secondary transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          open && 'bg-surface-hover text-text-primary',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-180'
          )}
          strokeWidth={2.25}
        />
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          id={listboxId}
          aria-activedescendant={
            focusedIdx === -1 ? undefined : `${listboxId}-row-${focusedIdx}`
          }
          className={cn(
            'elev-1 absolute z-50 mt-1.5 max-h-80 min-w-60 overflow-y-auto rounded-card p-1',
            'bg-surface-overlay'
          )}
          style={{ right: 0 }}
        >
          {groups.map(([groupName, groupItems]) => (
            <div key={groupName}>
              {groupName && (
                <Eyebrow bold className="px-2 pt-2 pb-1">
                  {groupName}
                </Eyebrow>
              )}
              {groupItems.map((item) => {
                const idx = items.indexOf(item);
                const isFocused = idx === focusedIdx;
                const isSelected = item.value === value;
                return (
                  <div
                    key={String(item.value)}
                    role="option"
                    id={`${listboxId}-row-${idx}`}
                    data-row-idx={idx}
                    aria-selected={isSelected}
                    aria-disabled={item.disabled || undefined}
                    onMouseEnter={() => !item.disabled && setFocusedIdx(idx)}
                    onMouseDown={(e) => {
                      // Prevent the trigger from regaining focus before
                      // the click registers — keeps `commit` deterministic.
                      e.preventDefault();
                    }}
                    onClick={() => commit(idx)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-inner px-2 py-1.5 text-left text-row transition-colors duration-150',
                      isFocused
                        ? 'bg-surface-hover text-text-primary'
                        : isSelected
                          ? 'text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                      item.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
                    )}
                  >
                    <span className="truncate font-medium">{item.label}</span>
                    {item.description && (
                      <span className="truncate text-meta text-text-muted">
                        {item.description}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-2 py-3 text-row text-text-muted">No options.</div>
          )}
        </div>
      )}
    </div>
  );
}
