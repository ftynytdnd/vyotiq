/**
 * Frameless title bar — hamburger flat menu, settings gear, window controls.
 */

import { Settings } from 'lucide-react';
import { WindowControls } from './WindowControls.js';
import { HamburgerMenu } from './HamburgerMenu.js';
import { type FileMenuActions } from './menu/menus/FileMenu.js';
import { type ViewMenuActions } from './menu/menus/ViewMenu.js';
import { chromeIconActionClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import {
  TITLEBAR_ACTIONS_ZONE_CLASS,
  TITLEBAR_ICON_ACTION_CLASS,
  TITLEBAR_MENUBAR_ZONE_CLASS,
  TITLEBAR_ROOT_CLASS,
  TITLEBAR_WINDOW_ZONE_CLASS
} from './titlebarShared.js';
import {
  SHELL_CHROME_ICON_CLASS,
  SHELL_CHROME_ICON_STROKE
} from '../../lib/shellIcons.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
  viewActions: ViewMenuActions;
  onOpenSettings: () => void;
}

export function TitleBar({ fileActions, viewActions, onOpenSettings }: TitleBarProps) {
  const iconButtonClass = cn(chromeIconActionClassName, TITLEBAR_ICON_ACTION_CLASS, 'px-0 text-text-muted');

  return (
    <header className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_MENUBAR_ZONE_CLASS}>
        <HamburgerMenu fileActions={fileActions} viewActions={viewActions} />
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <div className={TITLEBAR_ACTIONS_ZONE_CLASS}>
        <button
          type="button"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
          className={iconButtonClass}
        >
          <Settings className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
        </button>
      </div>

      <div className={TITLEBAR_WINDOW_ZONE_CLASS}>
        <WindowControls />
      </div>
    </header>
  );
}
