/**
 * SubAgentTrace — inline expandable row; Run / Brief / Result tabs in timeline.
 *
 * May 2026 restyle: the row is now a Cursor-style dot-prefixed line.
 *
 *   [● task title]                       [model badge] [chevron]
 *   [italic subtitle from liveStatus → snap.message]
 *
 *   - The dot lives in the `text-accent-gold-strong` family while the
 *     worker is live and fades to `text-text-muted` on settle.
 *   - The model badge floats to the right (provider · model) when the
 *     snapshot's `model` slot is populated. Older transcripts predating
 *     the field hide the badge silently.
 *   - The subtitle is resolved by `subtitleResolver.ts` and reflects
 *     the freshest concrete activity signal (in-flight tool action,
 *     trailing sentence of a streaming reasoning/text accumulator,
 *     or `liveStatus.label`). On settle it surfaces the parsed
 *     `<summary>` from the result envelope plus a quiet
 *     `done in Xs`, falling back to `snap.message` for failed
 *     terminals or just `done in Xs` when nothing else is available.
 *
 * Stats (`N steps · M edits · +A −D`) moved into the expanded body —
 * `SubAgentDetailTabs` already surfaces them inside the briefing
 * tab, so duplicating them on the collapsed line would be noise.
 */

import { useMemo } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { SubAgentActions } from './SubAgentActions.js';
import { SubAgentDetailTabs } from './SubAgentDetailTabs.js';
import { SubAgentFocusModal } from './focus/SubAgentFocusModal.js';
import { useSubAgentFocus } from './focus/useSubAgentFocus.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { subagentHasInflightDiff } from '../shared/toolInflight.js';
import {
  timelineModelBadgeClassName,
  timelineSubAgentDotClassName,
  timelineSubAgentSubtitleClassName
} from '../shared/rowStyles.js';
import { resolveSubAgentSubtitle } from './subtitleResolver.js';
import { cn } from '../../../lib/cn.js';

interface SubAgentTraceProps {
  subagentId: string;
  /** Nested under a delegate batch row — compact id + task header. */
  nested?: boolean;
}

export function SubAgentTrace({ subagentId, nested = false }: SubAgentTraceProps) {
  const snap = useChatStore((s) => s.subagents[subagentId]);
  const conversationId = useChatStore((s) => s.conversationId);
  const rowKey = `sub:${subagentId}`;
  const liveAutoExpand = useMemo(
    () => (snap ? subagentHasInflightDiff(snap) : false),
    [snap?.partialToolCallArgs, snap?.steps]
  );
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey, liveAutoExpand });
  const focus = useSubAgentFocus();

  if (!snap) return null;

  const isLive = snap.status === 'pending' || snap.status === 'running';
  const isFailed =
    snap.status === 'failed' || snap.status === 'aborted' || snap.status === 'malformed';

  const touchedFiles = uniqueTouchedFiles(snap.fileEdits.map((f) => f.filePath));
  const subtitle = resolveSubAgentSubtitle(snap);
  const taskLabel = snap.task ? quote(snap.task, nested ? 72 : 96) : '';

  return (
    <div
      data-row-kind="subagent-line"
      data-subagent-id={subagentId}
      className={cn(
        'vyotiq-stepfade-once flex flex-col',
        !nested && !isLive && (snap.status === 'done' || snap.status === 'partial') && 'opacity-90'
      )}
    >
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandable={!!conversationId}
        chevronOnRight
        trailing={
          snap.model ? (
            <span
              className={timelineModelBadgeClassName}
              title={`Model: ${snap.model.providerId} · ${snap.model.modelId}`}
              aria-label={`Model ${snap.model.modelId}`}
            >
              <span className="truncate">{snap.model.modelId}</span>
            </span>
          ) : undefined
        }
        actions={
          <SubAgentActions
            output={snap.output}
            touchedFiles={touchedFiles}
            onFocus={focus.open}
          />
        }
      >
        <span
          className={cn(
            'inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-row',
            isFailed && 'text-danger',
            isLive ? 'text-text-secondary' : 'text-text-muted'
          )}
        >
          <span className={timelineSubAgentDotClassName(isLive)} aria-hidden />
          {nested ? (
            <span className="min-w-0 truncate">
              <span className="font-mono text-text-faint">{subagentId}</span>
              {taskLabel && (
                <>
                  {' '}
                  <span className="text-text-secondary">{taskLabel}</span>
                </>
              )}
            </span>
          ) : (
            <span className="min-w-0 truncate">
              <span className={cn('font-medium', isLive ? 'text-text-primary' : 'text-text-secondary')}>
                Delegated
              </span>
              {taskLabel && (
                <>
                  {' '}
                  <span className={isLive ? 'text-text-secondary' : 'text-text-muted'}>
                    {taskLabel}
                  </span>
                </>
              )}
            </span>
          )}
        </span>
      </TimelineRowHeader>

      {subtitle && (
        <div
          className={cn(
            timelineSubAgentSubtitleClassName,
            isFailed && 'text-danger/80'
          )}
          aria-label="Sub-agent status"
        >
          {subtitle}
        </div>
      )}

      {expanded && (
        <DetailShell variant="flush" gap="gap-1.5">
          <SubAgentDetailTabs snap={snap} idPrefix={snap.id} />
        </DetailShell>
      )}

      <SubAgentFocusModal open={focus.isOpen} onClose={focus.close} snap={snap} />
    </div>
  );
}

function quote(s: string, max: number): string {
  const truncated = s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
  return `"${truncated}"`;
}

function uniqueTouchedFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

