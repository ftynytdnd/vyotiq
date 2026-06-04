/**
 * Frameless title bar — compact app menu and window controls.
 * Center zone is an empty drag handle (workspace/chat context is in the dock).
 */

import { WindowControls } from './WindowControls.js';
import { HamburgerMenu } from './HamburgerMenu.js';
import { type FileMenuActions } from './menu/menus/FileMenu.js';
import {
  TITLEBAR_BREADCRUMB_ZONE_CLASS,
  TITLEBAR_MENUBAR_ZONE_CLASS,
  TITLEBAR_ROOT_CLASS,
  TITLEBAR_WINDOW_ZONE_CLASS
} from './titlebarShared.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
}

export function TitleBar({ fileActions }: TitleBarProps) {
  return (
    <header className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_MENUBAR_ZONE_CLASS}>
        <HamburgerMenu fileActions={fileActions} />
      </div>

      <div className={TITLEBAR_BREADCRUMB_ZONE_CLASS} aria-hidden />

      <div className={TITLEBAR_WINDOW_ZONE_CLASS}>
        <WindowControls />
      </div>
    </header>
  );
}
