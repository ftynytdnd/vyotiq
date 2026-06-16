/**
 * New-shell control in the workbench tab bar trailing tray.
 * Session tabs (select + per-tab close) live in {@link WorkbenchTabBar}.
 */

import { Plus } from 'lucide-react';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import {
  WORKBENCH_ICON_BTN_CLASS,
  WORKBENCH_TAB_TRAY_CLASS
} from './workbenchChrome.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

export function TerminalSessionStrip() {
  const attaching = useTerminalStore((s) => s.attaching);
  const createSession = useTerminalStore((s) => s.createSession);

  return (
    <div className={WORKBENCH_TAB_TRAY_CLASS} data-terminal-session-strip>
      <button
        type="button"
        className={WORKBENCH_ICON_BTN_CLASS}
        title="New shell"
        aria-label="New shell"
        onClick={() => void createSession()}
        disabled={attaching}
      >
        <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
    </div>
  );
}
