import { useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = items.find((i) => i.value === value);

  // Group items if any have a `group`.
  const groups = new Map<string, DropdownItem<T>[]>();
  for (const item of items) {
    const key = item.group ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <div ref={ref} className={cn('relative inline-block app-no-drag', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex h-8 max-w-64 items-center gap-1.5 rounded-inner px-2.5 text-row',
          'bg-surface-overlay text-text-secondary transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
      </button>
      {open && (
        <div
          role="listbox"
          className={cn(
            'elev-1 absolute z-50 mt-1.5 max-h-80 min-w-60 overflow-y-auto rounded-card p-1',
            'bg-surface-overlay'
          )}
          style={{ right: 0 }}
        >
          {[...groups.entries()].map(([groupName, groupItems]) => (
            <div key={groupName}>
              {groupName && (
                <Eyebrow bold className="px-2 pt-2 pb-1">
                  {groupName}
                </Eyebrow>
              )}
              {groupItems.map((item) => (
                <button
                  key={String(item.value)}
                  type="button"
                  role="option"
                  aria-selected={item.value === value}
                  disabled={item.disabled}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-inner px-2 py-1.5 text-left text-row transition-colors duration-150',
                    'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                    item.value === value && 'bg-surface-hover text-text-primary',
                    item.disabled && 'opacity-50'
                  )}
                >
                  <span className="truncate font-medium">{item.label}</span>
                  {item.description && (
                    <span className="truncate text-meta text-text-muted">
                      {item.description}
                    </span>
                  )}
                </button>
              ))}
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
