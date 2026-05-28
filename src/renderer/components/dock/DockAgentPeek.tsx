/**
 * Thin vertical peek tab on dock inner edge — hover shows active sub-agents.
 */

import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { useChatStore } from '../../store/useChatStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { cn } from '../../lib/cn.js';
import { SHELL_COMPACT_ICON_CLASS, SHELL_COMPACT_ICON_STROKE } from '../../lib/shellIcons.js';
import { timelineSubAgentDotClassName } from '../timeline/shared/rowStyles.js';

export function DockAgentPeek() {
  const [hover, setHover] = useState(false);
  const subagents = useChatStore((s) => s.subagents);
  const openAgentTrace = useSecondaryZoneStore((s) => s.openAgentTrace);

  const active = useMemo(
    () =>
      Object.values(subagents).filter(
        (s) => s.status === 'pending' || s.status === 'running'
      ),
    [subagents]
  );

  if (active.length === 0) return null;

  return (
    <div
      className="vx-dock-agent-peek"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="vx-btn vx-btn-quiet flex h-16 w-6 flex-col items-center justify-center rounded-l-md border border-r-0 border-border-subtle/30 bg-surface-raised text-text-muted"
        aria-label={`${active.length} active sub-agents`}
      >
        <Bot className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        <span className="mt-0.5 text-meta">{active.length}</span>
      </button>
      {hover && (
        <div
          className={cn(
            'absolute left-full top-1/2 z-30 ml-1 min-w-52 -translate-y-1/2',
            'rounded-md border border-border-subtle/30 bg-surface-overlay p-1 shadow-lg'
          )}
          role="list"
        >
          {active.map((s) => (
            <button
              key={s.id}
              type="button"
              role="listitem"
              className="vx-btn vx-btn-quiet w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-row"
              onClick={() => openAgentTrace(s.id)}
            >
              <span className="inline-flex w-full min-w-0 items-center gap-1.5">
                <span className={timelineSubAgentDotClassName(true)} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {s.task.slice(0, 40) || s.id.slice(0, 8)}
                </span>
                <span className="shrink-0 text-meta text-text-faint">{s.status}</span>
              </span>
              {s.liveStatus?.label && (
                <span className="pl-3.5 text-meta text-text-muted">{s.liveStatus.label}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
