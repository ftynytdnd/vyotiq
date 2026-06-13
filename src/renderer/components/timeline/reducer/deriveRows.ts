/**
 * Pure transformer from `TimelineEvent[]` → a stable row-descriptor list
 * rendered in the Cascade-style compact log.
 *
 * Behaviours:
 *   - Streaming deltas (text / reasoning) coalesce into a single row per id.
 *   - Consecutive tool-call/-result pairs of the *same* tool name fold into
 *     a single `tool-group` row: `Read foo.tsx` → `Read foo.tsx and 1 other
 *     file` → `Read foo.tsx and 2 other files`. Expanded, it shows each
 *     individual call as a nested row (each further expandable to the
 *     existing bespoke detail).
 *   - Consecutive `file-edit` events fold into a single
 *     `file-edit-group` row with an expanded list of per-file cards.
 *   - Reasoning becomes a single `reasoning-line` row (`Thought for Ns`).
 *
 * Breakers that close any in-flight group: different tool/kind, assistant
 * text delta, reasoning delta, phase, user-prompt, agent-thought,
 * file-edit, error.
 */

import type { PromptAttachmentMeta, TimelineEvent } from '@shared/types/chat.js';
import type { MentionRef } from '@shared/types/mention.js';
import type { ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import type { DiffStreamSnapshot, PartialToolCallArgs, TokenUsageAggregate } from './types.js';
import { foldTokenUsage } from './types.js';
import { appendSynthesizedPartialRows } from './deriveRows/partials.js';
import { flushRunToRows, type OpenRun, type OpenRunUsage } from './deriveRows/runBoundaries.js';
import {
  foldOrchestratorFileEdit,
  foldToolCall,
  foldToolResult,
  type ScopedGroupState
} from './deriveRows/scopedToolGroups.js';
import { isTimelineHiddenTool } from '../shared/timelineHiddenTools.js';

export {
  toolGroupSummary,
  toolGroupDiffStats,
  toolGroupStatus,
  tailInFlightEditChildIndex
} from './deriveRows/groupTools.js';

export interface ToolGroupChild {
  callId: string;
  call?: ToolCall;
  result?: ToolResult;
  /**
   * Diff stats attached when a successful `edit` tool-call has a
   * matching `file-edit` event. Lets `ToolGroupRow` render the
   * aggregate `+N -M` badge inline instead of emitting a separate
   * `file-edit-group` row right beneath it. Populated by the
   * `case 'file-edit'` branch when it folds into the prior edit
   * tool-group; otherwise undefined.
   */
  fileEditAdditions?: number;
  fileEditDeletions?: number;
  /**
   * When this child is a synthesized in-flight placeholder (created
   * from `tool-call-args-delta` events before the final `tool-call`
   * lands), the args are best-effort partial-JSON snapshots. Renderers
   * use this flag to gate the live `+N -M` shimmer / partial diff
   * variant. Cleared the moment the authoritative `tool-call` event
   * reconciles the placeholder.
   */
  partial?: boolean;
  /**
   * FS-aware live diff snapshot from the main-process diff streamer
   * (Phase 2). When present, the renderer paints these hunks instead
   * of the renderer-side `synthesizeDiffPreview` output because
   * they're computed against the actual on-disk file body. Always
   * paired with `partial: true`; cleared when the authoritative
   * `tool-call` event lands.
   */
  diffStream?: DiffStreamSnapshot;
  /** Collapsed retry count for consecutive failed edits on the same path. */
  retryCount?: number;
}

export interface FileEditGroupChild {
  key: string;
  filePath: string;
  additions: number;
  deletions: number;
  entryId?: string;
}

export type Row =
  | {
    kind: 'user-prompt';
    key: string;
    /** Original `user-prompt` event id — used by the inline Revert button to bind the rewind to this turn. */
    id: string;
    /**
     * Originating run id for this prompt's turn. Threaded through to
     * `UserPromptRow` so the inline Revert button can read its
     * per-turn file-edit count from `runIdToFileEditCount[runId]` and
     * render a numeric badge. Optional because legacy transcripts
     * persisted before the field was added still deserialise — the
     * badge simply renders no count for those turns.
     */
    runId?: string;
    content: string;
    attachments?: PromptAttachmentMeta[];
    mentions?: MentionRef[];
  }
  | { kind: 'assistant-text'; key: string; id: string }
  | { kind: 'reasoning-line'; key: string; id: string }
  | { kind: 'agent-thought'; key: string; content: string; severity?: 'info' | 'warn' }
  | {
    kind: 'ask-user-prompt';
    key: string;
    id: string;
    displayText: string;
    payload: import('@shared/types/askUser.js').AskUserStructuredPayload;
    toolCallId: string;
    runId: string;
    status?: 'pending' | 'submitted';
  }
  | {
    kind: 'error';
    key: string;
    message: string;
    promptId?: string;
    durationMs?: number;
    completedAt?: number;
    usage?: TokenUsageAggregate;
    editCount?: number;
    fileCount?: number;
    commandCount?: number;
  }
  | {
    kind: 'tool-group';
    key: string;
    toolName: ToolName;
    children: ToolGroupChild[];
  }
  | {
    kind: 'file-edit-group';
    key: string;
    children: FileEditGroupChild[];
  }
  | {
    kind: 'phase-log';
    key: string;
    id: string;
    label: string;
    tooltip?: string;
  }
  | {
    kind: 'run-complete';
    key: string;
    promptId: string;
    durationMs: number;
    completedAt: number;
    usage?: TokenUsageAggregate;
    editCount?: number;
    fileCount?: number;
    commandCount?: number;
  }
  | {
    kind: 'context-reduction';
    key: string;
    /** Tool result/input bodies offloaded to disk in this fold. */
    offloadCount: number;
    /** History summarizations in this fold. */
    summaryCount: number;
    /** Total original chars across all items (reduction magnitude). */
    originalChars: number;
    /** Individual reduction items, expandable to view/restore the full body. */
    items: ContextReductionItem[];
  };

export interface ContextReductionItem {
  id: string;
  type: 'offload-result' | 'offload-input' | 'summary';
  /** Workspace-relative artifact path holding the full original content. */
  relativePath: string;
  originalChars: number;
  /** Short type label ('tool result' / 'tool input' / 'history summary'). */
  label: string;
  /** Present for summary items — the structured summary text inserted in-context. */
  summary?: string;
}

export interface DeriveRowsOptions {
  /**
   * When `true`, the trailing run (events after the last `user-prompt`) is
   * still in flight and the closing `run-complete` row must NOT be emitted
   * yet. Live IPC streams pass `runActive: isProcessing`; transcript
   * rebuilds and tests use the default (`false`) so every persisted run
   * gets its trailing closer exactly once.
   */
  runActive?: boolean;
  /**
   * Live partial-args snapshots for orchestrator-level tool calls that
   * haven't yet emitted their authoritative `tool-call` event. When
   * present, the deriver synthesises in-flight `tool-group` rows so
   * users see a streaming preview (path label, live diff, query) as
   * the arguments stream in. Pass `{}`
   * (or omit) for transcript rebuilds; the live timeline forwards the
   * mirror's `partialToolCallArgs` from `useChatStore`.
   */
  partialToolCallArgs?: Record<string, PartialToolCallArgs>;
  /**
   * Audit fix L-11. Pre-computed map of callIds the reducer has
   * already observed in an authoritative `tool-call` event. When
   * provided, `appendSynthesizedPartialRows` skips its O(R×C) walk
   * over every `tool-group` row's children to recover the same set
   * — Timeline forwards this from `state.settledCallIds`, which the
   * reducer already maintains for the late-frame race guard.
   * Optional for back-compat with callers that don't have access
   * to the slot (the deriver falls back to the walk).
   */
  settledCallIds?: Record<string, true>;
  /** Live FS diff keyed by callId — merged into settled tool-group children. */
  liveDiffByCallId?: Record<string, import('./types.js').DiffStreamSnapshot>;
}

function enrichToolGroupsWithLiveDiff(
  rows: Row[],
  liveDiffByCallId: DeriveRowsOptions['liveDiffByCallId']
): Row[] {
  if (!liveDiffByCallId || Object.keys(liveDiffByCallId).length === 0) return rows;
  return rows.map((row) => {
    if (row.kind !== 'tool-group') return row;
    let changed = false;
    const children = row.children.map((child) => {
      if (child.result) return child;
      const diff = liveDiffByCallId[child.callId];
      if (!diff) return child;
      changed = true;
      return {
        ...child,
        diffStream: diff,
        partial: child.partial === true
      };
    });
    return changed ? { ...row, children } : row;
  });
}

export function deriveRows(
  events: TimelineEvent[],
  opts: DeriveRowsOptions = {}
): Row[] {
  const out: Row[] = [];
  const seenText = new Set<string>();
  const seenReasoning = new Set<string>();
  const scopedGroups: ScopedGroupState = {
    openToolGroupIdx: null,
    openFileEditGroupIdx: null,
    callIdToGroupIdx: new Map(),
    callIdToChildIdx: new Map()
  };

  // Track the currently-open run (a span starting at the most recent
  // `user-prompt` event). When a new prompt arrives the previous run is
  // closed and a single `run-complete` row is emitted carrying the
  // wall-clock total. The trailing run is closed at end-of-input only
  // when `opts.runActive` is false.
  let openRun: OpenRun | null = null;
  let openRunUsage: OpenRunUsage | null = null;

  const flushRun = () => {
    const next = flushRunToRows(out, openRun, openRunUsage);
    openRun = next.openRun;
    openRunUsage = next.openRunUsage;
  };

  const closeGroups = () => {
    scopedGroups.openToolGroupIdx = null;
    scopedGroups.openFileEditGroupIdx = null;
  };

  for (const e of events) {
    // Extend the open run's tail timestamp with every event EXCEPT a
    // following `user-prompt` — that prompt belongs to the next turn and
    // its `ts` would otherwise smuggle the user's idle/typing window
    // into the prior run's reported duration.
    if (
      openRun &&
      e.kind !== 'user-prompt' &&
      typeof e.ts === 'number' &&
      e.ts > openRun.lastTs
    ) {
      openRun.lastTs = e.ts;
    }
    switch (e.kind) {
      case 'user-prompt':
        closeGroups();
        flushRun();
        openRun = {
          promptId: e.id,
          promptTs: e.ts,
          lastTs: e.ts,
          editCount: 0,
          filePaths: new Set(),
          commandCount: 0
        };
        out.push({
          kind: 'user-prompt',
          key: e.id,
          id: e.id,
          ...(typeof e.runId === 'string' && e.runId.length > 0
            ? { runId: e.runId }
            : {}),
          content: e.content,
          ...(e.attachments && e.attachments.length > 0
            ? { attachments: e.attachments }
            : {}),
          ...(e.mentions && e.mentions.length > 0 ? { mentions: e.mentions } : {})
        });
        break;

      case 'agent-thought':
        closeGroups();
        out.push({
          kind: 'agent-thought',
          key: e.id,
          content: e.content,
          ...(e.severity ? { severity: e.severity } : {})
        });
        break;

      case 'ask-user-prompt':
        closeGroups();
        // Answers land on the user-prompt row — no post-submit status bar.
        if (e.status === 'submitted') break;
        out.push({
          kind: 'ask-user-prompt',
          key: e.id,
          id: e.id,
          displayText: e.displayText,
          payload: e.payload,
          toolCallId: e.toolCallId,
          runId: e.runId,
          ...(e.status ? { status: e.status } : {})
        });
        break;

      case 'ask-user-submitted':
        closeGroups();
        break;

      case 'agent-text-delta':
        if (!seenText.has(e.id)) {
          seenText.add(e.id);
          closeGroups();
          out.push({
            kind: 'assistant-text',
            key: `text:${e.id}`,
            id: e.id
          });
        }
        break;

      case 'agent-reasoning-delta':
        if (!seenReasoning.has(e.id)) {
          seenReasoning.add(e.id);
          closeGroups();
          out.push({
            kind: 'reasoning-line',
            key: `thoughts:${e.id}`,
            id: e.id
          });
        }
        break;

      case 'agent-text-aborted': {
        // Drop whichever rows were optimistically added for this id so a
        // reloaded transcript behaves identically to live execution.
        seenText.delete(e.id);
        seenReasoning.delete(e.id);
        for (let i = out.length - 1; i >= 0; i--) {
          const row = out[i]!;
          if (
            (row.kind === 'assistant-text' && row.id === e.id) ||
            (row.kind === 'reasoning-line' && row.id === e.id)
          ) {
            out.splice(i, 1);
          }
        }
        closeGroups();
        break;
      }

      case 'agent-text-end':
      case 'agent-reasoning-end':
        break;

      case 'phase':
        closeGroups();
        out.push({
          kind: 'phase-log',
          key: e.id,
          id: e.id,
          label: e.label,
          ...(e.tooltip ? { tooltip: e.tooltip } : {})
        });
        break;

      case 'tool-call': {
        if (isTimelineHiddenTool(e.call.name)) break;
        foldToolCall(out, scopedGroups, e.call);
        break;
      }

      case 'tool-result': {
        if (e.result.name === 'ask_user' || isTimelineHiddenTool(e.result.name)) break;
        if (openRun && e.result.name === 'bash' && e.result.ok) {
          openRun.commandCount += 1;
        }
        foldToolResult(out, scopedGroups, e.result);
        break;
      }

      case 'file-edit': {
        const editPayload = {
          id: e.id,
          filePath: e.filePath,
          additions: e.additions,
          deletions: e.deletions,
          ...(e.entryId ? { entryId: e.entryId } : {})
        };

        if (openRun) {
          openRun.editCount += 1;
          if (e.filePath) openRun.filePaths.add(e.filePath);
        }

        foldOrchestratorFileEdit(out, scopedGroups, editPayload);
        break;
      }

      case 'error':
        closeGroups();
        out.push({ kind: 'error', key: e.id, message: e.message });
        if (openRun) {
          openRun.endedInError = true;
          openRun.errorKey = e.id;
        }
        break;

      case 'token-usage':
        if (openRun) {
          openRun.lastTs = e.ts;
          if (!openRunUsage) openRunUsage = {};
          openRunUsage.orchestrator = foldTokenUsage(
            openRunUsage.orchestrator,
            e.usage,
            e.ts,
            e.assistantMsgId
          );
        }
        break;

      case 'run-status':
        // Pure live-telemetry signal — surfaced in TurnStickyFooter /
        // the tail of the timeline, never as an inline row. Deliberately
        // does not close tool groups: a `run-status` landing between
        // two consecutive `tool-call`s of the same name must NOT split
        // the rolled-up group.
        break;

      case 'tool-call-args-delta':
      case 'diff-stream':
        // Ephemeral partial-args / FS-aware live diff — neither
        // emits its own row. Both fold into the matching
        // `partialToolCallArgs[callId]` entry; the in-flight
        // tool-group child is synthesised from that snapshot in a
        // second pass (see `appendSynthesizedPartialRows` below)
        // so the event stream itself stays append-only and
        // replay-safe.
        //
        // Also MUST NOT close the open tool / file-edit group:
        // deltas landing between two real tool-calls of the same
        // name must not split the rolled-up group.
        break;

      case 'checkpoint-entry':
      case 'checkpoint-revert':
      case 'checkpoint-bash-mutation':
        // Checkpoint events are not timeline rows — file edits and
        // tool results already show diffs inline. Like `token-usage`
        // and `run-status` above, they must NOT close the open tool group.
        break;

      case 'tool-compacted':
      case 'context-summary': {
        // Reversible-reduction markers fold into ONE collapsed card per
        // contiguous pass (consecutive markers share a row). Close any open
        // tool/file-edit group first so the card renders as its own activity
        // row; the agent-thought notice still covers the one-line summary.
        closeGroups();
        const last = out[out.length - 1];
        const row =
          last && last.kind === 'context-reduction'
            ? last
            : ((): Extract<Row, { kind: 'context-reduction' }> => {
              const fresh: Extract<Row, { kind: 'context-reduction' }> = {
                kind: 'context-reduction',
                key: `reduction:${e.id}`,
                offloadCount: 0,
                summaryCount: 0,
                originalChars: 0,
                items: []
              };
              out.push(fresh);
              return fresh;
            })();
        if (e.kind === 'tool-compacted') {
          row.offloadCount += 1;
          row.originalChars += e.originalChars;
          row.items.push({
            id: e.id,
            type: e.reason === 'input' ? 'offload-input' : 'offload-result',
            relativePath: e.relativePath,
            originalChars: e.originalChars,
            label: e.reason === 'input' ? 'tool input' : 'tool result'
          });
        } else {
          row.summaryCount += 1;
          row.originalChars += e.originalChars;
          row.items.push({
            id: e.id,
            type: 'summary',
            relativePath: e.relativePath,
            originalChars: e.originalChars,
            label: 'history summary',
            summary: e.summary
          });
        }
        break;
      }

      case 'context-usage':
        // Live context-window meter telemetry — surfaces only on the
        // composer meter; no inline row, no group close.
        break;

      case 'synthetic-usage-update':
        // Phase 3 (2026): renderer-local mid-stream completion-token
        // estimate. Surfaces ONLY on the composer token pill via the
        // aggregate's `inFlight` slot; no inline timeline row. Same
        // treatment as `run-status` / `token-usage` — pure telemetry.
        break;

      default: {
        const _exhaustive: never = e;
        void _exhaustive;
        break;
      }
    }
  }
  // Append synthesized in-flight rows for partial tool calls that
  // haven't yet emitted their authoritative `tool-call` event. We
  // append AFTER the event walk so they sit at the timeline tail —
  // the live position the user is watching.
  if (!opts.runActive) {
    flushRun();
  }
  return applyDeriveRowsLiveLayer(out, opts);
}

/**
 * Applies streaming partial tool rows and live FS diffs without re-walking
 * the full event transcript. Timeline memoizes the event-only pass separately
 * so high-frequency `partialToolCallArgs` / `liveDiffByCallId` updates stay
 * O(rows) instead of O(events).
 */
export function applyDeriveRowsLiveLayer(rows: Row[], opts: DeriveRowsOptions): Row[] {
  let out = rows;
  const partials = opts.partialToolCallArgs;
  if (partials && Object.keys(partials).length > 0) {
    out = [...rows];
    appendSynthesizedPartialRows(out, partials, opts.settledCallIds, true);
  }
  return enrichToolGroupsWithLiveDiff(out, opts.liveDiffByCallId);
}
