/**
 * SubAgentTrace - compact sub-agent row with optional nested execution detail.
 *
 * Collapsed:
 *   [chevron] [bot-icon] Delegated "<task>" · N steps · M edits [actions] [status]
 *
 * Expanded:
 *   SubAgentHeader, chronological SubAgentRunFlow, and structured result.
 */

import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { SubAgentHeader } from './SubAgentHeader.js';
import { SubAgentRunFlow } from './SubAgentRunFlow.js';
import { SubAgentResult } from './SubAgentResult.js';
import { SubAgentActions } from './SubAgentActions.js';
import { SubAgentBriefing } from './briefing/SubAgentBriefing.js';
import { SubAgentFocusModal } from './focus/SubAgentFocusModal.js';
import { useSubAgentFocus } from './focus/useSubAgentFocus.js';
import { StatusIcon } from '../tools/shared/StatusIcon.js';
import { NestedDetailRail } from '../shared/NestedDetailRail.js';
import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';

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
  const focus = useSubAgentFocus();

  if (!snap) return null;

  const isLive = snap.status === 'pending' || snap.status === 'running';
  const expanded = userOverridden ? persistedExpanded : (shouldAutoExpand || persistedExpanded);
  const ok: boolean | null =
    snap.status === 'pending' || snap.status === 'running'
      ? null
      : snap.status === 'done'
        ? true
        : false;
  const hasOutput = typeof snap.output === 'string' && snap.output.trim().length > 0;

  const onToggle = () => {
    if (!conversationId) return;
    setExpanded(conversationId, rowKey, !expanded);
  };

  const stepCount = snap.steps.length;
  const fileCount = snap.fileEdits.length;
  const touchedFiles = uniqueTouchedFiles(snap.fileEdits.map((f) => f.filePath));
  const editStats = summarizeEdits(snap.fileEdits);

  return (
    <div className="vyotiq-stepfade flex flex-col">
      <div
        className={cn(
          'group log-line app-no-drag flex w-full items-center gap-1.5 rounded-inner px-2 py-1',
          'transition-colors duration-150',
          conversationId ? 'cursor-pointer' : 'cursor-default',
          !isLive && snap.status === 'done' && 'opacity-80 hover:opacity-100'
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          disabled={!conversationId}
          aria-expanded={expanded}
          className={cn(
            'app-no-drag flex min-w-0 flex-1 items-center gap-2 rounded-inner text-left',
            conversationId ? 'cursor-pointer' : 'cursor-default'
          )}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-chevron" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-chevron" strokeWidth={2} />
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
                  {quote(snap.task, 96)}
                </span>
              </>
            )}
            {(stepCount > 0 || fileCount > 0) && (
              <span className="text-text-muted">
                {' · '}
                {stepCount} step{stepCount === 1 ? '' : 's'}
                {fileCount > 0 && ` · ${fileCount} edit${fileCount === 1 ? '' : 's'}`}
              </span>
            )}
            {editStats.total > 0 && (
              <span className="text-text-faint">
                {' · '}
                +{editStats.additions} -{editStats.deletions}
              </span>
            )}
          </div>
        </button>
        <SubAgentActions
          output={snap.output}
          touchedFiles={touchedFiles}
          onFocus={focus.open}
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        />
        <StatusIcon ok={ok} size="sm" className="shrink-0" />
      </div>

      {expanded && (
        <NestedDetailRail gap="gap-1.5">
          <SubAgentHeader snap={snap} />
          <SubAgentBriefing snap={snap} />
          <SubAgentRunFlow snap={snap} />
          {hasOutput && <SubAgentResult output={snap.output!} />}
        </NestedDetailRail>
      )}
      <SubAgentFocusModal
        open={focus.isOpen}
        onClose={focus.close}
        snap={snap}
      />
    </div>
  );
}

function quote(s: string, max: number): string {
  const truncated = s.length > max ? `${s.slice(0, max - 1)}...` : s;
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

function summarizeEdits(edits: Array<{ additions: number; deletions: number }>): {
  total: number;
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const edit of edits) {
    additions += edit.additions;
    deletions += edit.deletions;
  }
  return { total: additions + deletions, additions, deletions };
}
