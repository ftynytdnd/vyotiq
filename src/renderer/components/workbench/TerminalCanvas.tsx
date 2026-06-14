/**
 * Terminal canvas — xterm body without duplicate chrome (toolbar owns shell row).
 */

import { LoadingHint } from '../ui/LoadingHint.js';
import { XtermView } from '../terminal/XtermView.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';

export function TerminalCanvas() {
  const open = useTerminalStore((s) => s.open);
  const workspaceId = useTerminalStore((s) => s.workspaceId);
  const attaching = useTerminalStore((s) => s.attaching);
  const error = useTerminalStore((s) => s.error);

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-terminal-canvas')}>
      <div className="vx-terminal-panel-body flex min-h-0 flex-1 flex-col">
        {error ? (
          <p className="px-4 py-6 text-meta text-text-muted">{error}</p>
        ) : attaching || !workspaceId ? (
          <LoadingHint message="Starting shell…" className="py-6" />
        ) : (
          <XtermView workspaceId={workspaceId} active={open} />
        )}
      </div>
    </div>
  );
}
