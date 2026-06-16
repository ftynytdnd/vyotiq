/**
 * Terminal empty / error state — attach failures and idle shell chrome.
 */

import { RotateCcw, TerminalSquare } from 'lucide-react';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { WORKBENCH_EMPTY_CARD_CLASS } from './workbenchChrome.js';
import { cn } from '../../lib/cn.js';

export function TerminalEmptyState({ message }: { message: string }) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const openPanel = useTerminalStore((s) => s.openPanel);

  return (
    <div
      className={cn(
        WORKBENCH_BODY_CLASS,
        'vx-terminal-empty flex flex-col items-center justify-center gap-6 px-6 py-10 text-center'
      )}
    >
      <TerminalSquare className="h-8 w-8 text-text-faint" strokeWidth={SHELL_ACTION_ICON_STROKE} />
      <div className={cn('max-w-md space-y-3', WORKBENCH_EMPTY_CARD_CLASS)}>
        <p className="text-section font-medium text-text-primary">Terminal</p>
        <p className="text-row text-text-muted">{message}</p>
        {workspaceId ? (
          <button
            type="button"
            className="vx-btn vx-btn-quiet app-no-drag inline-flex items-center gap-1.5 text-row"
            onClick={() => void openPanel(workspaceId)}
          >
            <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
