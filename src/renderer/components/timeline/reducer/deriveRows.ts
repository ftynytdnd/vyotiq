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
 *   - Consecutive `file-edit` events (non-sub-agent) fold into a single
 *     `file-edit-group` row with an expanded list of per-file cards.
 *   - Reasoning becomes a single `reasoning-line` row (`Thought for Ns`).
 *
 * Breakers that close any in-flight group: different tool/kind, assistant
 * text delta, reasoning delta, phase, subagent-spawn, user-prompt,
 * agent-thought, file-edit, error, subagent status/result.
 *
 *   - Each sub-agent becomes a single `subagent-line` row.
 *
 * Sub-agent tool-call/-result events (tagged with `subagentId`) are not
 * emitted as top-level rows — they remain nested inside the sub-agent
 * snapshot; timeline projects these into subagent-group / activity rows.
 */

import type { PromptAttachmentMeta, TimelineEvent } from '@shared/types/chat.js';
import type { ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import { TOKEN_BUDGET_WARNING_DEFAULT_RATIO } from '@shared/constants.js';
import type { DiffStreamSnapshot, PartialToolCallArgs, TokenUsageAggregate } from './types.js';
import { foldTokenUsage } from './types.js';
import { appendSynthesizedPartialRows } from './deriveRows/partials.js';
import { flushRunToRows, type OpenRun, type OpenRunUsage } from './deriveRows/runBoundaries.js';

import { editChildPath } from './deriveRows/groupTools.js';

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
  }
  | { kind: 'assistant-text'; key: string; id: string }
  | { kind: 'reasoning-line'; key: string; id: string }
  | { kind: 'agent-thought'; key: string; content: string; severity?: 'info' | 'warn' }
  | { kind: 'phase'; key: string; label: string; tooltip?: string }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'subagent-line'; key: string; subagentId: string }
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
  /** Model context window — used for warning-row percent / detail display. */
  contextWindow?: number;
  /**
   * Absolute token threshold for budget-warning rows (from Settings →
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
  // Index of the last *open* tool-group per tool name so we can append to
  // it when the next event is a matching tool call/result. Reset by any
  // "breaker" event (see rules in the file header).
  let openToolGroupIdx: number | null = null;
  let openFileEditGroupIdx: number | null = null;

  // Track call → child record so a tool-result that arrives after the
  // tool-call can patch the same child entry without adding a duplicate.
  const callIdToGroupIdx = new Map<string, number>();
  const callIdToChildIdx = new Map<string, number>();

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
    openToolGroupIdx = null;
    openFileEditGroupIdx = null;
  };

  /**
   * Defensive fail-soft for sub-agent visibility. The `subagent-line`
   * row is normally emitted by the `subagent-pending` / `subagent-spawn`
   * branch below — but if either of those events is missing or arrives
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
          out.push({ kind: 'assistant-text', key: `text:${e.id}`, id: e.id });
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
          kind: 'phase',
          key: e.id,
          label: e.label,
          ...(e.tooltip ? { tooltip: e.tooltip } : {})
        });
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
        if (e.subagentId) {
          ensureSubagentLine(e.subagentId);
          break; // nested inside sub-agent trace
        }
        const toolName = e.call.name;

        // Patch an existing child if we've already seen this callId (rare
        // — e.g. echoed re-delivery).
        const existingGroupIdx = callIdToGroupIdx.get(e.call.id);
        const existingChildIdx = callIdToChildIdx.get(e.call.id);
        if (
          existingGroupIdx !== undefined &&
          existingChildIdx !== undefined &&
          out[existingGroupIdx]?.kind === 'tool-group'
        ) {
          const row = out[existingGroupIdx] as Extract<Row, { kind: 'tool-group' }>;
          const children = row.children.slice();
          const prev = children[existingChildIdx]!;
          children[existingChildIdx] = {
            ...prev,
            call: e.call,
            partial: false,
            diffStream: undefined
          };
          out[existingGroupIdx] = { ...row, children };
          break;
        }

        let groupIdx: number;
        const curIdx = openToolGroupIdx;
        if (curIdx === null || (out[curIdx] as Extract<Row, { kind: 'tool-group' }>).toolName !== toolName) {
          out.push({
            kind: 'tool-group',
            key: `tg:${e.call.id}`,
            toolName,
            children: []
          });
          groupIdx = out.length - 1;
          openToolGroupIdx = groupIdx;
          openFileEditGroupIdx = null;
        } else {
          groupIdx = curIdx;
        }
        const row = out[groupIdx] as Extract<Row, { kind: 'tool-group' }>;
        const children = [...row.children, { callId: e.call.id, call: e.call }];
        out[groupIdx] = { ...row, children };
        callIdToGroupIdx.set(e.call.id, groupIdx);
        callIdToChildIdx.set(e.call.id, children.length - 1);
        break;
      }

      case 'tool-result': {
        if (e.subagentId) {
          ensureSubagentLine(e.subagentId);
          break;
        }
        const groupIdx = callIdToGroupIdx.get(e.result.id);
        const childIdx = callIdToChildIdx.get(e.result.id);
        if (
          groupIdx !== undefined &&
          childIdx !== undefined &&
          out[groupIdx]?.kind === 'tool-group'
        ) {
          const row = out[groupIdx] as Extract<Row, { kind: 'tool-group' }>;
          const children = row.children.slice();
          const prev = children[childIdx]!;
          children[childIdx] = { ...prev, result: e.result };
          out[groupIdx] = { ...row, children };
          break;
        }

        // Result arrived without a matching call. Create a new group from
        // the result alone so we don't lose the signal.
        const toolName = e.result.name;
        let gIdx: number;
        const curIdx = openToolGroupIdx;
        if (curIdx === null || (out[curIdx] as Extract<Row, { kind: 'tool-group' }>).toolName !== toolName) {
          out.push({
            kind: 'tool-group',
            key: `tg:${e.result.id}`,
            toolName,
            children: []
          });
          gIdx = out.length - 1;
          openToolGroupIdx = gIdx;
          openFileEditGroupIdx = null;
        } else {
          gIdx = curIdx;
        }
        const row = out[gIdx] as Extract<Row, { kind: 'tool-group' }>;
        const children = [...row.children, { callId: e.result.id, result: e.result }];
        out[gIdx] = { ...row, children };
        callIdToGroupIdx.set(e.result.id, gIdx);
        callIdToChildIdx.set(e.result.id, children.length - 1);
        break;
      }

      case 'file-edit': {
        if (e.subagentId) {
          ensureSubagentLine(e.subagentId);
          break; // rendered inside sub-agent trace
        }

        if (openRun) {
          openRun.editCount += 1;
          if (e.filePath) openRun.filePaths.add(e.filePath);
        }

        // Merge into the immediately-prior `edit` tool-group when its
        // last successful child targets the same path. Avoids the
        // duplicate "Edited X" + "Edited X +N -M" pair that previously
        // rendered for every successful edit. Failed/no-op edits emit
        // no `file-edit`, so they remain distinct rows with the error
        // chip. The fold is conservative: only when the prior row is
        // a tool-group of the `edit` tool AND its last child has a
        // matching path with a successful result do we suppress the
        // file-edit-group emission.
        if (openToolGroupIdx !== null) {
          const prior = out[openToolGroupIdx];
          if (prior && prior.kind === 'tool-group' && prior.toolName === 'edit') {
            const lastIdx = prior.children.length - 1;
            const last = prior.children[lastIdx];
            const lastPath = editChildPath(last);
            if (
              last &&
              last.result &&
              last.result.ok &&
              lastPath === e.filePath
            ) {
              const children = prior.children.slice();
              children[lastIdx] = {
                ...last,
                fileEditAdditions: (last.fileEditAdditions ?? 0) + e.additions,
                fileEditDeletions: (last.fileEditDeletions ?? 0) + e.deletions
              };
              out[openToolGroupIdx] = { ...prior, children };
              break;
            }
          }
        }

        openToolGroupIdx = null; // file-edits break tool-group runs
        let groupIdx: number;
        const curIdx = openFileEditGroupIdx;
        if (curIdx === null) {
          out.push({
            kind: 'file-edit-group',
            key: `fe:${e.id}`,
            children: []
          });
          groupIdx = out.length - 1;
          openFileEditGroupIdx = groupIdx;
        } else {
          groupIdx = curIdx;
        }
        const row = out[groupIdx] as Extract<Row, { kind: 'file-edit-group' }>;
        const children = [
          ...row.children,
          {
            key: e.id,
            filePath: e.filePath,
            additions: e.additions,
            deletions: e.deletions,
            ...(e.entryId ? { entryId: e.entryId } : {})
          }
        ];
        out[groupIdx] = { ...row, children };
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
        // Pure live-telemetry signal — surfaced in TurnActivitySummary /
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
        // open tool/file-edit group — a summary is a structural
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
        // `token-usage` — pure telemetry, never a row.
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
