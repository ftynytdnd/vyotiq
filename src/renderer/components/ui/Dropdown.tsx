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
 *   - Trigger : Vyotiq UI `vx-input` underline field.
 *   - Panel   : `vx-dropdown-menu` popover list.
 *   - Rows    : `vx-dropdown-item` with hover / selected tint.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { chromeNoMatchesClassName } from './SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';
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
          'vx-input flex max-w-full items-center justify-between gap-2 text-left',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={cn(
            SHELL_CHROME_ICON_CLASS,
            'opacity-50 transition-transform duration-200',
            open && 'rotate-180'
          )}
          strokeWidth={SHELL_CHROME_ICON_STROKE}
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
          className="vx-dropdown-menu absolute z-50 max-h-80 min-w-full overflow-y-auto"
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
                    data-active={isSelected ? 'true' : 'false'}
                    data-focused={isFocused && !item.disabled ? 'true' : 'false'}
                    className={cn(
                      'vx-dropdown-item flex w-full flex-col items-start gap-0.5',
                      item.disabled && 'cursor-not-allowed opacity-50'
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
            <div className={chromeNoMatchesClassName}>No options.</div>
          )}
        </div>
      )}
    </div>
  );
}
