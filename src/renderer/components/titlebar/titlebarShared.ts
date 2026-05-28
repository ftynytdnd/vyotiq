/**
 * Shared layout classes for the frameless title bar.
 *
 * Layering (low → high): titlebar chrome (z-30) → titlebar popovers (z-40) →
 * open secondary panels (z-50) → modals. Menus stay inside the titlebar
 * stacking context so an open Settings drawer paints above them.
 */

import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

/** Portaled titlebar popovers (keyboard shortcuts help). */
export const CHROME_LAYER_TITLEBAR_POPOVER = 40;

export const TITLEBAR_ROOT_CLASS = cn(
  'vx-titlebar app-drag relative z-30 flex shrink-0 select-none items-stretch bg-surface-base text-row'
);

const TITLEBAR_ZONE_CLASS = 'app-no-drag flex items-center gap-0.5 py-1';

export const TITLEBAR_MENUBAR_ZONE_CLASS = cn(
  TITLEBAR_ZONE_CLASS,
  'pl-3 pr-1.5 sm:pl-3.5'
);

export const TITLEBAR_ACTIONS_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'gap-0.5 pr-1');

/** Settings / help icon buttons — pairs with 16px glyph floor in index.css. */
export const TITLEBAR_ICON_ACTION_CLASS = 'vx-titlebar-action';

export const TITLEBAR_MENU_PANEL_CLASS = cn(
  chromePopoverPanelClassName,
  'absolute left-0 top-full z-10 mt-1.5 w-[min(100vw-1rem,14rem)] min-w-[12rem] max-w-[min(100vw-1rem,20rem)] border border-border-subtle/18 p-1'
);

export const TITLEBAR_WINDOW_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'gap-0 pr-1.5');
