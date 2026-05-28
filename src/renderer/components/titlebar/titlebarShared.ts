/**
 * Shared layout classes for the frameless title bar.
 */

import { chromeEdgeClassName, chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

export const TITLEBAR_ROOT_CLASS = cn(
  'app-drag flex h-9 shrink-0 select-none items-stretch border-b bg-surface-raised/30 text-row',
  chromeEdgeClassName
);

const TITLEBAR_ZONE_CLASS = 'app-no-drag flex items-center gap-1 py-1';

export const TITLEBAR_MENUBAR_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'pl-2 pr-1');

export const TITLEBAR_ACTIONS_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'pr-0.5');

export const TITLEBAR_MENU_PANEL_CLASS = cn(
  chromePopoverPanelClassName,
  'absolute left-0 top-full z-[80] mt-1.5 min-w-52 border border-border-subtle/18 p-1'
);

export const TITLEBAR_WINDOW_ZONE_CLASS = cn(TITLEBAR_ZONE_CLASS, 'gap-0 pr-1.5');
