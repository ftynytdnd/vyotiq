/**
 * Title bar keyboard shortcuts reference — portaled popover.
 */

import { useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { ShortcutsPanel } from '../shortcuts/ShortcutsPanel.js';
import { cn } from '../../lib/cn.js';
import { chromeIconActionClassName } from '../ui/SurfaceShell.js';
import {
  CHROME_LAYER_TITLEBAR_POPOVER,
  TITLEBAR_ICON_ACTION_CLASS,
  TITLEBAR_SHORTCUTS_PANEL_CLASS
} from './titlebarShared.js';
import {
  SHELL_CHROME_ICON_CLASS,
  SHELL_CHROME_ICON_STROKE
} from '../../lib/shellIcons.js';

export function TitleBarShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = 'titlebar-shortcuts-help';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          chromeIconActionClassName,
          TITLEBAR_ICON_ACTION_CLASS,
          'px-0 text-text-muted'
        )}
      >
        <Keyboard className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="end"
        offset={6}
        zIndex={CHROME_LAYER_TITLEBAR_POPOVER}
        className={TITLEBAR_SHORTCUTS_PANEL_CLASS}
      >
        <div id={panelId}>
          <ShortcutsPanel />
        </div>
      </Popover>
    </>
  );
}
