/**
 * Read-only scheduled runs list at the top of the dock flyout.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';
import {
  formatScheduledRunDockSubtitle
} from '@shared/scheduler/formatScheduledRunDockLine.js';
import { vyotiq } from '../../lib/ipc.js';
import { useDockSchedulesStore } from '../../store/useDockSchedulesStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useAppViewStore } from '../../store/useAppViewStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { cn } from '../../lib/cn.js';
import {
  chromeNoMatchesClassName,
  chromePillClassName
} from '../ui/SurfaceShell.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';

const DOCK_SCHEDULES_ARIA_LABEL = 'Scheduled runs';

export function DockScheduledRunsPopover() {
  const open = useDockSchedulesStore((s) => s.open);
  if (!open) return null;

  return (
    <div
      role="region"
      aria-label={DOCK_SCHEDULES_ARIA_LABEL}
      className="flex shrink-0 flex-col gap-2 border-b border-border-subtle/30 px-2 pb-2 pt-1"
    >
      <DockScheduledRunsBody />
    </div>
  );
}

function DockScheduledRunsBody() {
  const setOpen = useDockSchedulesStore((s) => s.setOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const selectConversation = useConversationsStore((s) => s.select);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActive);
  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await vyotiq.scheduledRuns.list();
      setRuns(rows);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return vyotiq.scheduledRuns.onUpdated((rows) => {
      setRuns(rows);
      setLoading(false);
    });
  }, [refresh]);

  const enabled = runs.filter((run) => run.enabled);
  const activeRuns = activeWorkspaceId
    ? enabled.filter((run) => run.workspaceId === activeWorkspaceId)
    : enabled;
  const otherCount = enabled.length - activeRuns.length;

  const openManage = () => {
    setOpen(false);
    useAppViewStore.getState().openSettings('agent-behavior', {
      agentBehaviorSection: 'scheduled-runs'
    });
  };

  const activateRun = (run: ScheduledRun) => {
    if (run.workspaceId !== activeWorkspaceId) {
      void setActiveWorkspace(run.workspaceId);
    }
    useUiStore.getState().setDockPanelTab('chats');
    void selectConversation(run.conversationId);
    setOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="font-mono text-meta text-text-faint">Scheduled runs</p>
        <button
          type="button"
          className={cn(chromePillClassName, 'text-chat-meta text-text-muted')}
          onClick={openManage}
        >
          Manage…
        </button>
      </div>

      {loading ? (
        <p className="px-1 text-meta text-text-faint">Loading…</p>
      ) : activeRuns.length === 0 ? (
        <p className={cn(chromeNoMatchesClassName, 'px-1 py-2')}>
          {enabled.length === 0
            ? 'No enabled schedules. Add one in Settings.'
            : 'No enabled schedules in this workspace.'}
        </p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {activeRuns.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="vx-dock-search-row flex w-full items-start gap-2 rounded-inner px-2 py-1.5 text-left hover:bg-chrome-hover-soft"
                onClick={() => activateRun(run)}
              >
                <CalendarClock
                  className={cn(SHELL_ROW_ICON_CLASS, 'mt-0.5 shrink-0 text-text-faint')}
                  strokeWidth={SHELL_ROW_ICON_STROKE}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-row text-text-primary">
                    {run.label.trim() || 'Scheduled run'}
                  </span>
                  <span className="block truncate font-mono text-chat-meta text-text-faint">
                    {formatScheduledRunDockSubtitle(run)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {otherCount > 0 ? (
        <p className="px-1 font-mono text-chat-meta text-text-faint">
          {otherCount} enabled in other workspace{otherCount === 1 ? '' : 's'}
        </p>
      ) : null}

      {!loading && enabled.length > 0 ? (
        <p className="px-1 font-mono text-chat-meta text-text-faint">
          Runs while Vyotiq is open · busy chats queue the prompt
        </p>
      ) : null}
    </>
  );
}
