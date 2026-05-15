/**
 * `Menu` — a single dropdown panel anchored under its label button. Pure
 * controlled component; the parent (`MenuBar`) owns which one is open so
 * hovering between adjacent labels feels like a native menu strip.
 *
 * Stealth dark theme: surface-overlay panel, no visible borders, soft
 * shadow. Items inside should use the `MenuItem` primitive for consistent
 * spacing and hover behavior.
 */

import { forwardRef, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../../../lib/cn.js';

interface MenuProps {
  label: string;
  open: boolean;
  /** Called when the user clicks the label (toggle / open). */
  onOpen: () => void;
  /** Called when the user hovers the label while ANOTHER menu is open. */
  onHover: () => void;
  /** Called when the user clicks outside or presses Escape. */
  onClose: () => void;
  /**
   * Roving tabindex for the parent `MenuBar`. Exactly one label in the
   * strip is `tabIndex=0` so screen-reader / keyboard users land on it
   * with a single Tab; the others are `tabIndex=-1` and reachable only
   * via the menubar's arrow-key navigation.
   */
  tabIndex?: number;
  /**
   * Forwarded keydown handler installed on the label button so the
   * parent `MenuBar` can intercept `ArrowLeft` / `ArrowRight` / `Home` /
   * `End` and move focus across the strip without owning the button DOM.
   */
  onLabelKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

export const Menu = forwardRef<HTMLButtonElement, MenuProps>(function Menu(
  { label, open, onOpen, onHover, onClose, tabIndex, onLabelKeyDown, children },
  ref
) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative app-no-drag">
      <button
        ref={ref}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={tabIndex}
        onClick={onOpen}
        onMouseEnter={onHover}
        onKeyDown={onLabelKeyDown}
        className={cn(
          'inline-flex h-7 items-center rounded-inner px-2 text-row',
          'transition-colors duration-150',
          open
            ? 'bg-surface-overlay text-text-primary'
            : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
        )}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'elev-1 absolute left-0 top-full z-[80] mt-1 min-w-50 rounded-card p-1',
            'bg-surface-overlay'
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
});
