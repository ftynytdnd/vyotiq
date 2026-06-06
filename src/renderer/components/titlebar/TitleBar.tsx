/**
 * Frameless title bar — compact app menu and window controls.
 * Center zone is an empty drag handle (workspace/chat context is in the dock).
 */

import { useRef } from 'react';
import { WindowControls } from './WindowControls.js';
import { HamburgerMenu } from './HamburgerMenu.js';
import { type FileMenuActions } from './menu/menus/FileMenu.js';
import { useTitlebarHeight } from '../../hooks/useTitlebarHeight.js';
import {
  TITLEBAR_BREADCRUMB_ZONE_CLASS,
  TITLEBAR_MENUBAR_ZONE_CLASS,
  TITLEBAR_MENUBAR_ZONE_STYLE,
  TITLEBAR_ROOT_CLASS,
  TITLEBAR_WINDOW_ZONE_CLASS
} from './titlebarShared.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
}

export function TitleBar({ fileActions }: TitleBarProps) {
  const rootRef = useRef<HTMLElement>(null);
  useTitlebarHeight(rootRef);

  return (
    <header ref={rootRef} className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_MENUBAR_ZONE_CLASS} style={TITLEBAR_MENUBAR_ZONE_STYLE}>
        <HamburgerMenu fileActions={fileActions} />
      </div>

      <div className={TITLEBAR_BREADCRUMB_ZONE_CLASS} aria-hidden />

      <div className={TITLEBAR_WINDOW_ZONE_CLASS}>
        <WindowControls />
      </div>
    </header>
  );
}
