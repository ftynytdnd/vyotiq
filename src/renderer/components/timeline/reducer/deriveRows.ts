/**
 * Pure transformer from `TimelineEvent[]` â†’ a stable row-descriptor list
 * rendered in the Cascade-style compact log.
 *
 * Behaviours:
 *   - Streaming deltas (text / reasoning) coalesce into a single row per id.
 *   - Consecutive tool-call/-result pairs of the *same* tool name fold into
 *     a single `tool-group` row: `Read foo.tsx` â†’ `Read foo.tsx and 1 other
 *     file` â†’ `Read foo.tsx and 2 other files`. Expanded, it shows each
 *     individual call as a nested row (each further expandable to the
 *     existing bespoke detail).
 *   - Consecutive `file-edit` events (non-sub-agent) fold into a single
 *     `file-edit-group` row with an expanded list of per-file cards.
 *   - Reasoning becomes a single `reasoning-line` row (`Thought for Ns`).
 *
 * Breakers that close any in-flight group: different tool/kind, assistant
 * text delta, reasoning delta, phase, subagent-spawn, user-prompt,
 * agent-thought, file-edit, error, subagent status/result.
 *
 *   - Each sub-agent spawn becomes a `subagent-line` row; scoped text,
 *     reasoning, tools, and file-edits emit as top-level rows tagged with
 *     `subagentId` in wire order for inline delegation UI.
 *
 * Sub-agent scoped events are emitted inline (not nested in expand-only traces).
 */

import type { PromptAttachmentMeta, TimelineEvent } from '@shared/types/chat.js';
import type { ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import { TOKEN_BUDGET_WARNING_DEFAULT_RATIO } from '@shared/constants.js';
import type { DiffStreamSnapshot, PartialToolCallArgs, TokenUsageAggregate } from './types.js';
import { foldTokenUsage } from './types.js';
import { appendSynthesizedPartialRows } from './deriveRows/partials.js';
import { flushRunToRows, type OpenRun, type OpenRunUsage } from './deriveRows/runBoundaries.js';
import {
  foldOrchestratorFileEdit,
  foldScopedFileEdit,
  foldToolCall,
  foldToolResult,
  type ScopedGroupState
} from './deriveRows/scopedToolGroups.js';

export {
  toolGroupSummary,
  editChildPath,
  toolGroupDiffStats,
  toolGroupStatus,
  tailInFlightEditChildIndex
} from './deriveRows/groupTools.js';
export { pickToolName } from './deriveRows/partials.js';

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
    /** Original `user-prompt` event id â€” used by the inline Revert button to bind the rewind to this turn. */
    id: string;
    /**
     * Originating run id for this prompt's turn. Threaded through to
     * `UserPromptRow` so the inline Revert button can read its
     * per-turn file-edit count from `runIdToFileEditCount[runId]` and
     * render a numeric badge. Optional because legacy transcripts
     * persisted before the field was added still deserialise â€” the
     * badge simply renders no count for those turns.
     */
    runId?: string;
    content: string;
    attachments?: PromptAttachmentMeta[];
  }
  | { kind: 'assistant-text'; key: string; id: string; subagentId?: string }
  | { kind: 'reasoning-line'; key: string; id: string; subagentId?: string }
  | { kind: 'agent-thought'; key: string; content: string; severity?: 'info' | 'warn' }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'subagent-line'; key: string; subagentId: string }
  | {
    kind: 'tool-group';
    key: string;
    toolName: ToolName;
    children: ToolGroupChild[];
    subagentId?: string;
  }
  | {
    kind: 'file-edit-group';
    key: string;
    children: FileEditGroupChild[];
    subagentId?: string;
  }
  | {
    kind: 'run-complete';
    key: string;
    durationMs: number;
    completedAt: number;
    usage?: TokenUsageAggregate;
    editCount?: number;
    fileCount?: number;
  }
  | {
    kind: 'token-budget-warning';
    key: string;
    percent: number;
    tokens?: number;
    ceiling?: number;
  }
  /**
   * exists at this position in the timeline. The row component
   * (`ContextSummaryRow`) reads the live state by `summaryId` from
   * `useChatStore.summaries[summaryId]` so streaming deltas paint
   * without re-deriving the entire row list. ONE row per
   * `summaryId`; the `pending` event is the anchor.
   */
  | { kind: 'context-summary'; key: string; summaryId: string };

export interface DeriveRowsOptions {
  /**
   * When `true`, the trailing run (events after the last `user-prompt`) is
   * still in flight and the closing `run-complete` row must NOT be emitted
   * yet. Live IPC streams pass `runActive: isProcessing`; transcript
   * rebuilds and tests use the default (`false`) so every persisted run
   * gets its trailing closer exactly once.
   */
  runActive?: boolean;
  /** Model context window â€” used for warning-row percent / detail display. */
  contextWindow?: number;
  /**
   * Absolute token threshold for budget-warning rows (from Settings â†’
   * Context). When omitted, falls back to `contextWindow *
   * TOKEN_BUDGET_WARNING_DEFAULT_RATIO` when a window is known.
   */
  tokenBudgetWarnThreshold?: number;
  /**
   * Live partial-args snapshots for orchestrator-level tool calls that
   * haven't yet emitted their authoritative `tool-call` event. When
   * present, the deriver synthesises in-flight `tool-group` rows so
   * users see a streaming preview (path label, live diff, query) as
   * the arguments stream in. Sub-agent partials live on the matching
   * snapshot and are wired in by `SubAgentRunFlow`, not here. Pass `{}`
   * (or omit) for transcript rebuilds; the live timeline forwards the
   * mirror's `partialToolCallArgs` from `useChatStore`.
   */
  partialToolCallArgs?: Record<string, PartialToolCallArgs>;
  /**
   * Audit fix L-11. Pre-computed map of callIds the reducer has
   * already observed in an authoritative `tool-call` event. When
   * provided, `appendSynthesizedPartialRows` skips its O(RÃ—C) walk
   * over every `tool-group` row's children to recover the same set
   * â€” Timeline forwards this from `state.settledCallIds`, which the
   * reducer already maintains for the late-frame race guard.
   * Optional for back-compat with callers that don't have access
   * to the slot (the deriver falls back to the walk).
   */
  settledCallIds?: Record<string, true>;
  /** Live FS diff keyed by callId â€” merged into settled tool-group children. */
  liveDiffByCallId?: Record<string, import('./types.js').DiffStreamSnapshot>;
}

export function enrichToolGroupsWithLiveDiff(
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
  const seenSubagent = new Set<string>();
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
    const next = flushRunToRows(out, openRun, openRunUsage, opts.contextWindow);
    openRun = next.openRun;
    openRunUsage = next.openRunUsage;
  };

  const closeGroups = () => {
    scopedGroups.openToolGroupIdx = null;
    scopedGroups.openFileEditGroupIdx = null;
  };

  /**
   * Defensive fail-soft for sub-agent visibility. The `subagent-line`
   * row is normally emitted by the `subagent-pending` / `subagent-spawn`
   * branch below â€” but if either of those events is missing or arrives
   * out of order, every sub-agent-scoped `tool-call` / `tool-result` /
   * `file-edit` would be invisible without this synthesis.
   */
  const ensureSubagentLine = (subagentId: string | undefined): void => {
    if (!subagentId) return;
    if (seenSubagent.has(subagentId)) return;
    seenSubagent.add(subagentId);
    closeGroups();
    out.push({
      kind: 'subagent-line',
      key: `sub:${subagentId}`,
      subagentId
    });
  };

  for (const e of events) {
    // Extend the open run's tail timestamp with every event EXCEPT a
    // following `user-prompt` â€” that prompt belongs to the next turn and
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
        openRun = { promptId: e.id, promptTs: e.ts, lastTs: e.ts, editCount: 0, filePaths: new Set() };
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
            : {})
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

      case 'agent-text-delta':
        if (!seenText.has(e.id)) {
          seenText.add(e.id);
          closeGroups();
          if (e.subagentId) ensureSubagentLine(e.subagentId);
          out.push({
            kind: 'assistant-text',
            key: `text:${e.id}`,
            id: e.id,
            ...(e.subagentId ? { subagentId: e.subagentId } : {})
          });
        }
        break;

      case 'agent-reasoning-delta':
        if (!seenReasoning.has(e.id)) {
          seenReasoning.add(e.id);
          closeGroups();
          if (e.subagentId) ensureSubagentLine(e.subagentId);
          out.push({
            kind: 'reasoning-line',
            key: `thoughts:${e.id}`,
            id: e.id,
            ...(e.subagentId ? { subagentId: e.subagentId } : {})
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
        break;

      case 'subagent-pending':
      case 'subagent-spawn':
        ensureSubagentLine(e.subagentId);
        break;

      case 'subagent-status':
      case 'subagent-result':
        // Live state flows through the store; nothing to emit here.
        closeGroups();
        break;

      case 'tool-call': {
        if (e.subagentId) ensureSubagentLine(e.subagentId);
        foldToolCall(out, scopedGroups, e.call, e.subagentId);
        break;
      }

      case 'tool-result': {
        if (e.subagentId) ensureSubagentLine(e.subagentId);
        foldToolResult(out, scopedGroups, e.result, e.subagentId);
        break;
      }

      case 'file-edit': {
        if (e.subagentId) ensureSubagentLine(e.subagentId);
        const editPayload = {
          id: e.id,
          filePath: e.filePath,
          additions: e.additions,
          deletions: e.deletions,
          ...(e.entryId ? { entryId: e.entryId } : {})
        };
        if (e.subagentId) {
          foldScopedFileEdit(out, scopedGroups, editPayload, e.subagentId);
          break;
        }

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
        break;

      case 'token-usage':
        if (openRun) {
          openRun.lastTs = e.ts;
          if (!openRunUsage) openRunUsage = { subagents: {} };
          const ownerKey = e.subagentId ?? 'orc';
          if (ownerKey === 'orc') {
            openRunUsage.orchestrator = foldTokenUsage(
              openRunUsage.orchestrator,
              e.usage,
              e.ts
            );
            const ceiling = opts.contextWindow;
            const latest = openRunUsage.orchestrator?.latest.totalTokens;
            const absoluteThreshold = opts.tokenBudgetWarnThreshold;
            const ratioThreshold =
              typeof ceiling === 'number' && ceiling > 0
                ? ceiling * TOKEN_BUDGET_WARNING_DEFAULT_RATIO
                : undefined;
            const threshold =
              typeof absoluteThreshold === 'number' && absoluteThreshold > 0
                ? absoluteThreshold
                : ratioThreshold;
            if (typeof threshold === 'number' && typeof latest === 'number' && latest >= threshold) {
              const pctBase =
                typeof ceiling === 'number' && ceiling > 0 ? ceiling : threshold;
              openRun.tokenBudgetWarnPct = Math.min(100, Math.round((latest / pctBase) * 100));
              openRun.tokenBudgetWarnTokens = latest;
            }
          } else {
            openRunUsage.subagents[ownerKey] = foldTokenUsage(
              openRunUsage.subagents[ownerKey],
              e.usage,
              e.ts
            );
          }
        }
        break;

      case 'run-status':
        // Pure live-telemetry signal â€” surfaced in TurnRunningMeta /
        // the tail of the timeline, never as an inline row. Deliberately
        // does not close tool groups: a `run-status` landing between
        // two consecutive `tool-call`s of the same name must NOT split
        // the rolled-up group.
        break;

      case 'tool-call-args-delta':
      case 'diff-stream':
        // Ephemeral partial-args / FS-aware live diff â€” neither
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
        // Checkpoint events are surfaced via the dedicated
        // PendingChangesTimelineRow and Checkpoints view (driven by
        // `useCheckpointsStore`), not as timeline rows. The
        // existing `tool-result` and `file-edit` events already
        // paint the diff in-line; layering a fourth row per edit
        // would just clutter the transcript. Like `token-usage`
        // and `run-status` above, they must NOT close the open
        // tool group.
        break;

      case 'context-summary-pending':
        // Anchor row for a summarization. `ContextSummaryRow`
        // pulls every subsequent state change off
        // `useChatStore.summaries[summaryId]` so streaming
        // deltas paint without re-deriving rows. Closes any
        // open tool/file-edit group â€” a summary is a structural
        // boundary in the transcript.
        closeGroups();
        out.push({
          kind: 'context-summary',
          key: `summary:${e.summaryId}`,
          summaryId: e.summaryId
        });
        break;

      case 'context-summary-delta':
      case 'context-summary-reasoning-delta':
      case 'context-summary-end':
      case 'context-summary-aborted':
      case 'context-summary-undone':
        // Pure state mutations on the matching `summaries[id]`
        // accumulator. The single `context-summary` row already
        // emitted by `-pending` re-renders against the live
        // store snapshot; no extra row is synthesized here.
        // Like the streaming agent-text deltas, these must NOT
        // close the open tool group.
        break;

      case 'context-override-set':
        // Pure state mutation on `messageOverrides`. Inspector
        // surfaces it; timeline does not render a row for the
        // toggle itself (the only visible side-effect is that
        // the next summarization splices a different range).
        break;

      case 'synthetic-usage-update':
        // Phase 3 (2026): renderer-local mid-stream completion-token
        // estimate. Surfaces ONLY on the composer pill / Inspector
        // chip via the aggregate's `inFlight` slot; no inline
        // timeline row. Same treatment as `run-status` /
        // `token-usage` â€” pure telemetry, never a row.
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
  // append AFTER the event walk so they sit at the timeline tail â€”
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
