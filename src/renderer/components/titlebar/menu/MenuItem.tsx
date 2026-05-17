/**
 * `MenuItem` — a single clickable row inside a `Menu` panel. Optional
 * right-aligned shortcut hint and disabled state. The action is invoked,
 * then the menu is closed via the parent's onAfterAction callback.
 */

import { cn } from '../../../lib/cn.js';

interface MenuItemProps {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
  /** Called by the menu host after `onSelect` runs to close the panel. */
  onAfterAction?: () => void;
}

export function MenuItem({ label, shortcut, disabled, onSelect, onAfterAction }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect();
        onAfterAction?.();
      }}
      className={cn(
        'app-no-drag flex w-full items-center justify-between rounded-inner px-2.5 py-1 text-left text-row',
        'transition-colors duration-150',
        disabled
          ? 'text-text-faint cursor-not-allowed'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      )}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="ml-6 text-meta text-text-faint">{shortcut}</span>
      )}
    </button>
  );
}
