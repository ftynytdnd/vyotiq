/**
 * Frameless title bar. Layout:
 *
 *   [ MenuBar pills ]     …drag…     [ settings ] [ help ]  [ window tray ]
 */

import { useMemo, useRef, useState } from 'react';
import { HelpCircle, Settings } from 'lucide-react';
import { WindowControls } from './WindowControls.js';
import { MenuBar, type FileMenuActions } from './menu/index.js';
import { type ViewMenuActions } from './menu/menus/ViewMenu.js';
import { Popover } from '../ui/Popover.js';
import { ShortcutsPanel, platformAltKey, platformModKey } from '../shortcuts/ShortcutsPanel.js';
import { chromeIconPillClassName, chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import {
  TITLEBAR_ACTIONS_ZONE_CLASS,
  TITLEBAR_MENUBAR_ZONE_CLASS,
  TITLEBAR_ROOT_CLASS
} from './titlebarShared.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
  viewActions: ViewMenuActions;
  onOpenSettings: () => void;
}

export function TitleBar({ fileActions, viewActions, onOpenSettings }: TitleBarProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const mod = useMemo(platformModKey, []);
  const alt = useMemo(platformAltKey, []);

  return (
    <header className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_MENUBAR_ZONE_CLASS}>
        <MenuBar fileActions={fileActions} viewActions={viewActions} />
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <div className={TITLEBAR_ACTIONS_ZONE_CLASS}>
        <button
          type="button"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
          className={chromeIconPillClassName()}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          ref={helpButtonRef}
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          aria-expanded={shortcutsOpen}
          onClick={() => setShortcutsOpen((v) => !v)}
          className={chromeIconPillClassName(shortcutsOpen)}
        >
          <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <Popover
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          triggerRef={helpButtonRef}
          align="end"
          offset={8}
          className={cn(
            chromePopoverPanelClassName,
            'w-72 border border-border-subtle/10 p-2.5'
          )}
        >
          <ShortcutsPanel mod={mod} alt={alt} />
        </Popover>
      </div>

      <WindowControls />
    </header>
  );
}
