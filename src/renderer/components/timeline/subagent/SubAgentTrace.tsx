/**
 * SubAgentTrace — Cascade-style single-line sub-agent row.
 *
 * Collapsed:
 *   [chevron] [bot-icon]  Delegated "<task>" · N steps   [status]
 *
 * Expanded: the existing SubAgentHeader (files chips, status pill,
 * failure message), the chronological run flow (SubAgentRunFlow —
 * walks per-iteration reasoning + text + tool calls + file edits in
 * true execution order), and the final result envelope
 * (SubAgentResult).
 *
 * Per-row durations were intentionally removed — wall-clock timing is
 * surfaced once per run via the trailing `RunCompleteRow`.
 *
 * Auto-expand-while-running:
 *   By default the row is expanded while the sub-agent is `pending` or
 *   `running` so live `tool-call` / `tool-result` / `file-edit` events
 *   are visible without an extra click. Once the run reaches a terminal
 *   state (`done` / `failed` / `aborted`) the row auto-collapses. A user
 *   click on the chevron records a manual override; subsequent state
 *   transitions respect the user's choice instead of overriding it.
 *
 * Expansion state is persisted per-conversation via `useTimelineUiStore`.
 */

import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { SubAgentHeader } from './SubAgentHeader.js';
import { SubAgentRunFlow } from './SubAgentRunFlow.js';
import { SubAgentResult } from './SubAgentResult.js';
import { StatusIcon } from '../tools/shared/StatusIcon.js';
import { NestedDetailRail } from '../shared/NestedDetailRail.js';
import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';

/**
 * Pending vs running is communicated by the shimmer rhythm on the row
 * (plus the shimmering status pill inside `SubAgentHeader`) and the
 * `StatusIcon` spinner (`ok === null` for both states). The earlier
 * `PendingDot` was redundant with those two signals and was removed as
 * part of the streaming-shimmer rollout.
 */

interface SubAgentTraceProps {
  subagentId: string;
}

export function SubAgentTrace({ subagentId }: SubAgentTraceProps) {
  const snap = useChatStore((s) => s.subagents[subagentId]);
  const shouldAutoExpand = useChatStore((s) => {
    const current = s.subagents[subagentId];
    if (!current || (current.status !== 'pending' && current.status !== 'running')) {
      return false;
    }
    let liveCount = 0;
    let latestStartedAt = Number.NEGATIVE_INFINITY;
    let latestId: string | null = null;
    for (const sa of Object.values(s.subagents)) {
      if (sa.status !== 'pending' && sa.status !== 'running') continue;
      liveCount++;
      if (sa.startedAt >= latestStartedAt) {
        latestStartedAt = sa.startedAt;
        latestId = sa.id;
      }
    }
    return liveCount <= 1 || latestId === subagentId;
  });
  const conversationId = useChatStore((s) => s.conversationId);
  const rowKey = `sub:${subagentId}`;
  const persistedExpanded = useTimelineUiStore((s) => s.isExpanded(conversationId, rowKey));
  const userOverridden = useTimelineUiStore((s) => s.hasManualOverride(conversationId, rowKey));
  const setExpanded = useTimelineUiStore((s) => s.setExpanded);

  if (!snap) return null;

  // While the sub-agent is live (pending / running) and the user has
  // not yet clicked the chevron, force the row open so live telemetry
  // is visible. After a manual toggle, surrender to the persisted
  // expand state so the user's intent wins.
  const isLive = snap.status === 'pending' || snap.status === 'running';
  const expanded = userOverridden ? persistedExpanded : (shouldAutoExpand || persistedExpanded);

  const ok: boolean | null =
    snap.status === 'pending' || snap.status === 'running'
      ? null
      : snap.status === 'done'
        ? true
        : false;
  // Note: `hasSteps` was dropped along with the `SubAgentSteps`
  // gate when we switched to `SubAgentRunFlow`. The flow component
  // is its own empty-state guard (returns `null` when neither
  // iterations, steps, nor file edits exist), so a parent gate
  // would just be defensive duplication.
  const hasOutput = typeof snap.output === 'string' && snap.output.trim().length > 0;

  const onToggle = () => {
    if (!conversationId) return;
    // Invert the visible state, NOT the persisted state — they can
    // differ when the row is auto-expanded-while-running.
    setExpanded(conversationId, rowKey, !expanded);
  };

  const stepCount = snap.steps.length;
  const fileCount = snap.fileEdits.length;

  return (
    <div className="vyotiq-stepfade flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        disabled={!conversationId}
        aria-expanded={expanded}
        className={cn(
          'log-line app-no-drag flex w-full items-center gap-2 rounded-inner px-2 py-1 text-left',
          'transition-colors duration-150 hover:bg-surface-hover/60',
          conversationId ? 'cursor-pointer' : 'cursor-default',
          !isLive && snap.status === 'done' && 'opacity-80 hover:opacity-100'
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-chevron)]" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-chevron)]" strokeWidth={2} />
        )}
        <Bot
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            isLive
              ? 'text-accent'
              : snap.status === 'failed' || snap.status === 'aborted'
                ? 'text-danger'
                : 'text-text-muted'
          )}
          strokeWidth={2}
        />
        <div
          className={shimmerText(
            isLive,
            cn(
              'min-w-0 flex-1 truncate text-log',
              isLive ? 'text-text-secondary' : 'text-text-muted'
            )
          )}
          style={isLive ? shimmerStyle(`subagent:${subagentId}`) : undefined}
        >
          <span className={cn('font-medium', isLive ? 'text-text-primary' : 'text-text-secondary')}>
            Delegated
          </span>
          {snap.task && (
            <>
              {' '}
              <span className={isLive ? 'text-text-secondary' : 'text-text-muted'}>
                {quote(snap.task, 60)}
              </span>
            </>
          )}
          {(stepCount > 0 || fileCount > 0) && (
            <span className="text-text-muted">
              {' · '}
              {stepCount} step{stepCount === 1 ? '' : 's'}
              {fileCount > 0 && ` · ${fileCount} file${fileCount === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        <StatusIcon ok={ok} size="sm" className="shrink-0" />
      </button>

      {expanded && (
        <NestedDetailRail gap="gap-1.5">
          <SubAgentHeader snap={snap} />
          {/* Chronological run flow: per-iteration reasoning + text
              panels interleaved with the tool calls and file edits
              produced by THAT iteration's tool round. Replaces the
              earlier two-component split (`SubAgentSteps` +
              `SubAgentBody`) which inverted execution order by
              rendering every tool call grouped at the top and only
              then the bodies. See `SubAgentRunFlow.tsx` file header
              for the merge rules. */}
          <SubAgentRunFlow snap={snap} />
          {hasOutput && <SubAgentResult output={snap.output!} />}
        </NestedDetailRail>
      )}
    </div>
  );
}

function quote(s: string, max: number): string {
  const truncated = s.length > max ? s.slice(0, max - 1) + '…' : s;
  return `"${truncated}"`;
}
