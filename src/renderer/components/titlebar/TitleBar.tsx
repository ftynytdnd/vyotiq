/**
 * Frameless title bar. Layout:
 *
 *   [ MenuBar ]                         …                         [ window controls ]
 *   ←─ interactive ─→   ←────────── drag region ──────────→   ←─ interactive ─→
 *
 * The middle region is an empty drag handle so the user can grab any
 * empty area to move the window. The workspace label is surfaced by the
 * Sidebar's workspace row — no need to duplicate it in the chrome.
 */

import { WindowControls } from './WindowControls.js';
import { MenuBar, type FileMenuActions } from './menu/index.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
}

export function TitleBar({ fileActions }: TitleBarProps) {
  return (
    <header className="app-drag flex h-8 select-none items-center bg-surface-base text-row">
      <div className="app-no-drag flex items-stretch px-1">
        <MenuBar fileActions={fileActions} />
      </div>
      <div className="flex-1" />
      <WindowControls />
    </header>
  );
}
