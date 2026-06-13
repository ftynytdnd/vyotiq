/**
 * Secondary-zone floating terminal — shared workspace PTY.
 */

import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { FloatingPanel } from '../ui/FloatingPanel.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { XtermView } from './XtermView.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

export interface TerminalPanelProps {
  initialWidth?: number;
  onWidthChange?: (w: number) => void;
}

export function TerminalPanel({ initialWidth, onWidthChange }: TerminalPanelProps) {
  const open = useTerminalStore((s) => s.open);
  const workspaceId = useTerminalStore((s) => s.workspaceId);
  const shellLabel = useTerminalStore((s) => s.shellLabel);
  const attaching = useTerminalStore((s) => s.attaching);
  const close = useTerminalStore((s) => s.close);

  const title = shellLabel ? `Terminal · ${shellLabel}` : 'Terminal';

  const onRestart = useCallback(async () => {
    if (!workspaceId) return;
    try {
      await vyotiq.terminal.restart(workspaceId);
      await vyotiq.terminal.attach({ workspaceId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(msg, 'danger');
    }
  }, [workspaceId]);

  const headerActions = (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void onRestart()}
        disabled={!workspaceId || attaching}
        title="Restart shell"
      >
        <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </Button>
    </div>
  );

  return (
    <FloatingPanel
      open={open}
      onClose={close}
      title={title}
      widthKey="workspaceTerminal"
      {...(initialWidth !== undefined ? { initialWidth } : {})}
      {...(onWidthChange ? { onWidthChange } : {})}
      className="vx-terminal-panel"
      headerActions={headerActions}
    >
      <div className="vx-terminal-panel-body flex h-full min-h-0 flex-col">
        {attaching || !workspaceId ? (
          <LoadingHint message="Starting shell…" className="py-6" />
        ) : (
          <XtermView workspaceId={workspaceId} active={open} />
        )}
      </div>
    </FloatingPanel>
  );
}
