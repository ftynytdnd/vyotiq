/**
 * `Menu` — a single dropdown panel anchored under its label button. Pure
 * controlled component; the parent (`MenuBar`) owns which one is open so
 * hovering between adjacent labels feels like a native menu strip.
 *
 * Stealth dark theme: surface-overlay panel, no visible borders, soft
 * shadow. Items inside should use the `MenuItem` primitive for consistent
 * spacing and hover behavior.
 *
 * Keyboard-driven opens (`ArrowDown` / `Enter` / `Space`) advance focus
 * to the first enabled `[role="menuitem"]` inside the panel — this is
 * the WAI-ARIA menubar contract. Mouse-driven opens leave focus alone
 * so a click + immediate move-to-item doesn't fight the user's pointer.
 * The discriminator comes through `openSource`.
 */

import { forwardRef, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { chromePillClassName } from '../../ui/SurfaceShell.js';
import { TITLEBAR_MENU_PANEL_CLASS } from '../titlebarShared.js';
import { cn } from '../../../lib/cn.js';

export type MenuOpenSource = 'mouse' | 'keyboard';

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
  /**
   * How the panel was opened. `'keyboard'` triggers an auto-focus of
   * the first enabled menuitem on the next frame (WAI-ARIA menubar
   * pattern). `'mouse'` (the default) leaves focus on the label so a
   * click doesn't yank focus away from the user's pointer.
   */
  openSource?: MenuOpenSource;
  children: React.ReactNode;
}

export const Menu = forwardRef<HTMLButtonElement, MenuProps>(function Menu(
  { label, open, onOpen, onHover, onClose, tabIndex, onLabelKeyDown, openSource = 'mouse', children },
  ref
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Keyboard-driven opens advance focus into the panel on the next
  // frame so the just-rendered menuitems are queryable. We deliberately
  // skip the focus for mouse-driven opens — moving focus there would
  // fight the pointer (and trip outside-click close in unusual layouts).
  // The rAF + open guard lets the effect tear down cleanly if the user
  // closes the menu before the frame lands.
  useEffect(() => {
    if (!open) return;
    if (openSource !== 'keyboard') return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      );
      first?.focus();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [open, openSource]);

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
        className={cn(chromePillClassName(open), 'px-2.5 text-row')}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          className={TITLEBAR_MENU_PANEL_CLASS}
        >
          {children}
        </div>
      )}
    </div>
  );
});
