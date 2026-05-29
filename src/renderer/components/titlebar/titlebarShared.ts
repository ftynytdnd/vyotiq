/**
 * Shared layout classes for the frameless title bar.
 *
 * Layering (low → high): titlebar chrome (z-30) → dock panel (50) →
 * titlebar popovers (55) → secondary panel backdrop (59) → panels (60) →
 * modals (70).
 */

import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

/** Portaled titlebar popovers (hamburger menu, keyboard shortcuts help). */
export const CHROME_LAYER_TITLEBAR_POPOVER = 55;

export const TITLEBAR_ROOT_CLASS = cn(
  'vx-titlebar app-drag relative z-30 flex shrink-0 select-none items-stretch bg-surface-base text-row'
);

const TITLEBAR_ZONE_CLASS = 'app-no-drag flex items-center gap-0.5 py-1';

export const TITLEBAR_MENUBAR_ZONE_CLASS = cn(
  TITLEBAR_ZONE_CLASS,
  'pl-3 pr-1.5 sm:pl-3.5'
);

export const TITLEBAR_ACTIONS_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'gap-0.5 pr-1');

/** Center drag region — workspace › chat breadcrumb. */
export const TITLEBAR_BREADCRUMB_ZONE_CLASS = cn(
  'app-drag flex min-w-0 flex-1 items-center justify-center px-2'
);

/** Settings / help icon buttons — pairs with 16px glyph floor in index.css. */
export const TITLEBAR_ICON_ACTION_CLASS = 'vx-titlebar-action';

/** Hamburger trigger — open-state fill pairs with {@link TITLEBAR_HAMBURGER_TRIGGER_CLASS}. */
export const TITLEBAR_HAMBURGER_TRIGGER_CLASS = 'vx-titlebar-hamburger-trigger';

export const TITLEBAR_MENU_ITEM_CLASS = 'vx-titlebar-menu-item';

export const TITLEBAR_MENU_SEPARATOR_CLASS = 'vx-titlebar-menu-separator';

export const TITLEBAR_MENU_PANEL_CLASS = cn(
  chromePopoverPanelClassName,
  'vx-titlebar-menu-panel absolute left-0 top-full z-10 mt-1.5 w-[min(100vw-1rem,14rem)] min-w-[12rem] max-w-[min(100vw-1rem,20rem)] border border-border-subtle/18 p-1'
);

export const TITLEBAR_SHORTCUTS_PANEL_CLASS = cn(
  chromePopoverPanelClassName,
  'vx-titlebar-shortcuts-panel w-[min(100vw-1rem,22rem)] max-w-[min(100vw-1rem,24rem)] border border-border-subtle/18 p-3'
);

export const TITLEBAR_WINDOW_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'gap-0 pr-1.5');
