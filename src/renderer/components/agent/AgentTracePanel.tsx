/**
 * Dedicated floating panel for full sub-agent trace / tool output.
 */

import { useEffect, useMemo, useState } from 'react';
import { FloatingPanel } from '../ui/FloatingPanel.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { AgentTraceContent } from './AgentTraceContent.js';
import { timelineSubAgentDotClassName } from '../timeline/shared/rowStyles.js';
import { cn } from '../../lib/cn.js';
import { sanitizeTraceTitle } from '../../lib/traceSanitize.js';

interface AgentTracePanelProps {
  open: boolean;
  onClose: () => void;
  subagentId: string | null;
  initialWidth?: number;
  onWidthChange?: (w: number) => void;
}

function shortTaskLabel(task: string, id: string): string {
  const trimmed = sanitizeTraceTitle(task);
  if (trimmed.length > 0) return trimmed.slice(0, 36);
  return id.slice(0, 8);
}

export function AgentTracePanel({
  open,
  onClose,
  subagentId,
  initialWidth,
  onWidthChange
}: AgentTracePanelProps) {
  const subagents = useChatStore((s) => s.subagents);
  const openAgentTrace = useSecondaryZoneStore((s) => s.openAgentTrace);
  const [activeId, setActiveId] = useState<string | null>(subagentId);

  useEffect(() => {
    if (subagentId) setActiveId(subagentId);
  }, [subagentId]);

  const agentIds = useMemo(
    () =>
      Object.values(subagents)
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((s) => s.id),
    [subagents]
  );

  const activeSnap = activeId ? subagents[activeId] : undefined;
  const title =
    (activeSnap?.task ? sanitizeTraceTitle(activeSnap.task).slice(0, 48) : '') ||
    activeId ||
    (agentIds.length > 1 ? 'Sub-agents' : 'Sub-agent');

  const tabItems: TabItem<string>[] = useMemo(
    () =>
      agentIds.map((id) => {
        const snap = subagents[id];
        const running = snap?.status === 'pending' || snap?.status === 'running';
        return {
          id,
          label: shortTaskLabel(snap?.task ?? '', id),
          tabId: `agent-trace-tab-${id}`,
          panelId: `agent-trace-panel-${id}`,
          icon: (
            <span
              className={cn(timelineSubAgentDotClassName(!!running), 'mr-0.5')}
              aria-hidden
            />
          )
        };
      }),
    [agentIds, subagents]
  );

  const onTabChange = (next: string) => {
    setActiveId(next);
    openAgentTrace(next);
  };

  return (
    <FloatingPanel
      open={open}
      onClose={onClose}
      title={title}
      widthKey="agentTrace"
      initialWidth={initialWidth}
      onWidthChange={onWidthChange}
      showBackdrop={false}
      className="vx-agent-panel"
    >
      {!subagentId ? (
        <LoadingHint message="Select a sub-agent…" />
      ) : agentIds.length === 0 ? (
        <LoadingHint message="Loading trace…" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {agentIds.length > 1 && activeId && (
            <div className="shrink-0 border-b border-border-subtle/20 px-2 py-1.5">
              <Tabs<string>
                items={tabItems}
                value={activeId}
                onChange={onTabChange}
                variant="strip"
                stripNav
                ariaLabel="Sub-agent traces"
                className="scrollbar-stealth overflow-x-auto"
              />
            </div>
          )}
          <div
            role="tabpanel"
            id={activeId ? `agent-trace-panel-${activeId}` : undefined}
            aria-labelledby={activeId ? `agent-trace-tab-${activeId}` : undefined}
            className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto"
          >
            {activeSnap ? (
              <AgentTraceContent snap={activeSnap} />
            ) : (
              <LoadingHint message="Loading trace…" />
            )}
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
