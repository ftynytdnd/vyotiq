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
 *   - Each sub-agent becomes a single `subagent-line` row.
 *
 * Breakers that close any in-flight group: different tool/kind, assistant
 * text delta, reasoning delta, phase, subagent-spawn, user-prompt,
 * agent-thought, file-edit, error, subagent status/result.
 *
 * Sub-agent tool-call/-result events (tagged with `subagentId`) are not
 * emitted as top-level rows — they remain nested inside the sub-agent
 * snapshot and are rendered by `SubAgentTrace`.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import { computeDiffOps } from '@shared/text/diff/computeDiffHunks.js';
import type { DiffStreamSnapshot, PartialToolCallArgs } from './types.js';

/** Tool names recognised at the orchestrator + sub-agent level. Used
 *  for surrogate-call name lookup. Keep in sync with `ToolName`. */
const KNOWN_TOOL_NAMES: readonly ToolName[] = [
  'bash',
  'ls',
  'read',
  'edit',
  'delete',
  'search',
  'memory',
  'recall',
  'report',
  'unknown'
];

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
}

export interface FileEditGroupChild {
  key: string;
  filePath: string;
  additions: number;
  deletions: number;
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
  }
  | { kind: 'assistant-text'; key: string; id: string }
  | { kind: 'reasoning-line'; key: string; id: string }
  | { kind: 'agent-thought'; key: string; content: string; severity?: 'info' | 'warn' }
  | { kind: 'phase'; key: string; label: string }
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
  | { kind: 'run-complete'; key: string; durationMs: number };

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
   * the arguments stream in. Sub-agent partials live on the matching
   * snapshot and are wired in by `SubAgentSteps`, not here. Pass `{}`
   * (or omit) for transcript rebuilds; the live timeline forwards the
   * mirror's `partialToolCallArgs` from `useChatStore`.
   */
  partialToolCallArgs?: Record<string, PartialToolCallArgs>;
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
  let openRun: { promptId: string; promptTs: number; lastTs: number } | null = null;

  const flushRun = () => {
    if (!openRun) return;
    const durationMs = openRun.lastTs - openRun.promptTs;
    if (durationMs > 0) {
      out.push({
        kind: 'run-complete',
        key: `done:${openRun.promptId}`,
        durationMs
      });
    }
    openRun = null;
  };

  const closeGroups = () => {
    openToolGroupIdx = null;
    openFileEditGroupIdx = null;
  };

  /**
   * Defensive fail-soft for sub-agent visibility. The `subagent-line`
   * row is normally emitted by the `subagent-pending` / `subagent-spawn`
   * branch below — but if either of those events is missing or arrives
   * out of order (lost in IPC, dropped by the reducer's
   * `subagent-pending` no-op when a tool event auto-created a `running`
   * snapshot first, or simply never emitted because the orchestrator
   * bypassed the delegate path), every sub-agent-scoped `tool-call`
   * / `tool-result` / `file-edit` would be rendered as an
   * "if (subagentId) break;" no-op and the worker's entire activity
   * would be invisible to the user (visible end-state in the
   * "Nothing between text and panel" symptom).
   *
   * This helper synthesises the row the FIRST time we observe any
   * sub-agent-scoped event for a given id. The matching snapshot
   * already exists in `state.subagents` (created by
   * `ensureSnapshot` in `applyTimelineEvent`), so `SubAgentTrace`
   * has data to render even without an authoritative spawn.
   *
   * Ordering: closes any open orchestrator-level tool/file-edit
   * group first — same contract as the authoritative
   * `subagent-pending` / `subagent-spawn` branch — so a sub-agent
   * row never splits a preceding tool-group into two halves.
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
        openRun = { promptId: e.id, promptTs: e.ts, lastTs: e.ts };
        out.push({
          kind: 'user-prompt',
          key: e.id,
          id: e.id,
          ...(typeof e.runId === 'string' && e.runId.length > 0
            ? { runId: e.runId }
            : {}),
          content: e.content
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
        out.push({ kind: 'phase', key: e.id, label: e.label });
        break;

      case 'subagent-pending':
      case 'subagent-spawn':
        // Either event opens the sub-agent's row. We dedup by `subagentId`
        // so the matching `subagent-spawn` after a `subagent-pending`
        // does NOT produce a second row — the snapshot in the chat store
        // transitions from `pending` → `running` and the existing row
        // re-renders. The fail-soft helper below ALSO opens the row
        // when nested tool / file-edit events arrive without a preceding
        // spawn (defense-in-depth), so we go through the same code path
        // here to keep dedup semantics in one place.
        ensureSubagentLine(e.subagentId);
        break;

      case 'subagent-status':
      case 'subagent-result':
        // Live state flows through the store; nothing to emit here.
        closeGroups();
        break;

      case 'tool-call': {
        if (e.subagentId) {
          // Fail-soft sub-agent row synthesis: ensure the worker's
          // `subagent-line` exists before we drop into the nested
          // `SubAgentTrace` render path. Without this, a missing or
          // out-of-order `subagent-spawn` / `subagent-pending` would
          // leave the worker's tool calls completely invisible. The
          // matching snapshot in the chat store is auto-created by
          // `applyTimelineEvent`'s `ensureSnapshot`, so `SubAgentTrace`
          // can render — we just need to surface the row.
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
          children[existingChildIdx] = { ...prev, call: e.call };
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
          // Same fail-soft as the `tool-call` branch — sub-agent
          // visibility must survive a missing spawn event.
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
          // Same fail-soft as the `tool-call` / `tool-result`
          // branches — sub-agent visibility must survive a missing
          // spawn event. The file-edit metadata itself flows into
          // the snapshot's `fileEdits` array via
          // `applyTimelineEvent`, so once the row is open it
          // renders the per-file chips correctly.
          ensureSubagentLine(e.subagentId);
          break; // rendered inside sub-agent trace
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
            deletions: e.deletions
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
        // Usage reports are consumed via the dedicated aggregates on
        // `TimelineState.orchestratorUsage` / `SubAgentSnapshot.usage`
        // and are intentionally invisible as timeline rows. No group
        // close either — they're metadata, not content.
        break;

      case 'run-status':
        // Pure live-telemetry signal — rendered by `LiveStatusRow` at
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

      case 'history-summary':
        // Audit fix §2.2 — transcript-aware summarization sentinel.
        // Persists in the JSONL so transcript replay can mask the
        // `replacedEventIds`, but is intentionally invisible as a
        // timeline row (see the matching skip in
        // `applyTimelineEvent.ts` and the contract on
        // `TimelineEvent` in `@shared/types/chat.ts`). Like
        // `token-usage` / `run-status` above, it must NOT close the
        // currently-open tool group either — the summary lands at
        // the orchestrator's iteration boundary, not at a turn
        // boundary.
        break;

      case 'checkpoint-entry':
      case 'checkpoint-revert':
      case 'checkpoint-bash-mutation':
        // Checkpoint events are surfaced via the dedicated
        // PendingChangesPanel and Checkpoints view (driven by
        // `useCheckpointsStore`), not as timeline rows. The
        // existing `tool-result` and `file-edit` events already
        // paint the diff in-line; layering a fourth row per edit
        // would just clutter the transcript. Like `token-usage`
        // and `run-status` above, they must NOT close the open
        // tool group.
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
  const partials = opts.partialToolCallArgs;
  if (partials) {
    appendSynthesizedPartialRows(out, partials);
  }
  if (!opts.runActive) {
    flushRun();
  }
  return out;
}

/**
 * Walk `partialToolCallArgs` and append a synthesized `tool-group`
 * child for each entry whose callId hasn't already been observed as
 * a settled `tool-call`. Folds consecutive entries of the same tool
 * name into one group (mirroring the live-event rule).
 *
 * The synthesized `ToolCall` carries the parser's best-effort
 * snapshot in `args`; the renderer's bespoke per-tool components
 * already tolerate partial / missing keys (see `EditInvocation`,
 * `ReadInvocation`, etc.).
 */
function appendSynthesizedPartialRows(
  out: Row[],
  partials: Record<string, PartialToolCallArgs>
): void {
  // Skip entries whose callId is already keyed in the events walk.
  // The reducer drops the partial entry on `tool-call` so the only
  // way this would matter is mid-frame inconsistency — defensive.
  const settledIds = new Set<string>();
  for (const row of out) {
    if (row.kind === 'tool-group') {
      for (const c of row.children) settledIds.add(c.callId);
    }
  }
  // Append in `index` order so parallel tool-call streams render in
  // their wire order rather than `Object.keys` order.
  const entries = Object.values(partials)
    .filter((p) => !settledIds.has(p.callId))
    .sort((a, b) => a.index - b.index);
  if (entries.length === 0) return;

  // Reuse the trailing group when its tool name matches the next
  // partial entry — same grouping rule as live events.
  for (const p of entries) {
    // Phase 2: when a diff-stream snapshot has landed before the
    // first args-delta seeded a parsed name, prefer the
    // diff-stream's tool field so the synthesized child renders
    // under the right tool icon / verb.
    const toolHint =
      p.name === undefined && p.diffStream
        ? p.diffStream.tool
        : p.name;
    const toolName = pickToolName(toolHint);
    const child: ToolGroupChild = {
      callId: p.callId,
      call: {
        id: p.callId,
        name: toolName,
        args: p.parsed ?? {}
      },
      partial: true,
      ...(p.diffStream ? { diffStream: p.diffStream } : {})
    };
    const tail = out[out.length - 1];
    if (tail && tail.kind === 'tool-group' && tail.toolName === toolName) {
      const next: Extract<Row, { kind: 'tool-group' }> = {
        ...tail,
        children: [...tail.children, child]
      };
      out[out.length - 1] = next;
    } else {
      // Use the same `tg:${callId}` keyspace settled groups use so a
      // partial-only group's manual expand/collapse override survives
      // the partial → settled transition. The reducer's
      // `appendSynthesizedPartialRows` filter already guarantees we
      // never emit a duplicate of an existing settled `tg:${callId}`
      // (the callId-in-out scan happens above), so there's no key
      // collision risk. Audit fix — live diff visibility.
      out.push({
        kind: 'tool-group',
        key: `tg:${p.callId}`,
        toolName,
        children: [child]
      });
    }
  }
}

function pickToolName(raw: string | undefined): ToolName {
  if (raw && (KNOWN_TOOL_NAMES as readonly string[]).includes(raw)) {
    return raw as ToolName;
  }
  return 'unknown';
}

/**
 * Derive a verb + primary-arg label for a tool group.
 *
 * Returns the rolled-up summary like:
 *   `Read foo.tsx and 16 other files`
 *   `Searched "query" and 2 other queries`
 *   `Ran \`command\` and 3 other commands`
 * Used by the `ToolGroupRow` single-line renderer. Kept pure + sync so it
 * can be memoized at the call site.
 */
export function toolGroupSummary(
  toolName: ToolName,
  children: ToolGroupChild[]
): { verb: string; primary: string; suffix: string } {
  const first = children[0];
  const total = children.length;
  const rest = Math.max(0, total - 1);
  const primary = first ? extractPrimary(toolName, first) : '';
  const verb = verbFor(toolName);
  // Defect 3 (edit only): two edits to the same file previously read
  // as "snake.py and 1 other file" — misleading because there's no
  // OTHER file at all. When every `edit` child targets a single
  // distinct path, switch the unit to "edit/edits" so the wording
  // reflects what actually happened. Other tools keep their existing
  // suffix unchanged.
  let suffix = '';
  if (rest > 0) {
    if (toolName === 'edit' && countDistinctEditPaths(children) === 1) {
      suffix = ` and ${rest} more edit${rest === 1 ? '' : 's'}`;
    } else {
      const unit = unitFor(toolName, rest === 1);
      suffix = ` and ${rest} other ${unit}`;
    }
  }
  return { verb, primary, suffix };
}

/**
 * Count how many distinct file paths an `edit` group's children
 * collectively address. Reads from `call.args.path` first (the
 * pre-result source, populated the moment the tool-call streams in)
 * and falls back to `result.data.filePath` for any child that has
 * already settled. Children with no resolvable path are ignored —
 * they don't contribute to the "same file?" determination.
 */
function countDistinctEditPaths(children: ToolGroupChild[]): number {
  const paths = new Set<string>();
  for (const c of children) {
    const p = editChildPath(c);
    if (p) paths.add(p);
  }
  return paths.size;
}

/**
 * Resolve the file path an `edit` tool-group child targets, preferring
 * the authoritative `result.data.filePath` when settled and falling
 * back to the streamed `call.args.path`. Returns the empty string if
 * neither is populated (e.g. a still-streaming partial with no path
 * key yet).
 *
 * Exported so `SubAgentRunFlow` can reuse the exact same preference
 * order at the sub-agent level — both call sites need to identify
 * "edits to the same file" for diff-stats merging and the
 * `n other edits` summary unit, and divergent helpers risk silently
 * drifting (`SubAgentRunFlow` previously held a near-duplicate copy).
 */
export function editChildPath(child: ToolGroupChild | undefined): string {
  if (!child) return '';
  const dataPath =
    child.result?.data?.tool === 'edit' ? child.result.data.filePath : undefined;
  if (typeof dataPath === 'string' && dataPath.length > 0) return dataPath;
  const argPath = child.call?.args?.['path'];
  if (typeof argPath === 'string' && argPath.length > 0) return argPath;
  return '';
}

/**
 * Aggregate diff stats across all children of a tool-group. Three
 * sources fold into the badge:
 *
 *   1. **Settled `file-edit` merge** — `fileEditAdditions` /
 *      `fileEditDeletions` populated by the merge fold in the
 *      `case 'file-edit'` branch of `deriveRows`. The authoritative
 *      number; survives across renders.
 *
 *   2. **Authoritative `tool-result` diff stats** — for an edit that
 *      has settled but whose `file-edit` event hasn't merged yet
 *      (rare race). Falls back to `result.data.additions/deletions`
 *      so the badge isn't blank during the one-frame gap.
 *
 *   3. **Live partial preview** — for synthesised `partial: true`
 *      children, count `+`/`-` lines in the synthesised preview
 *      hunks derived from the streaming `oldString` / `newString`
 *      args. This is what drives the live `+N -M` counter while
 *      the model is still emitting bytes.
 *
 * Returns zeros when no source contributes (e.g. a streaming-only
 * group whose `oldString` hasn't started yet).
 */
export function toolGroupDiffStats(children: ToolGroupChild[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const c of children) {
    // Path 1 — settled file-edit merge.
    if (c.fileEditAdditions !== undefined || c.fileEditDeletions !== undefined) {
      additions += c.fileEditAdditions ?? 0;
      deletions += c.fileEditDeletions ?? 0;
      continue;
    }
    // Path 2 — authoritative result without merge.
    const data = c.result?.data;
    if (data && data.tool === 'edit') {
      additions += data.additions;
      deletions += data.deletions;
      continue;
    }
    // Path 3a — Phase 2 FS-aware live diff snapshot. When the
    // main-process diff streamer has produced authoritative counts
    // against the actual file body, use those directly. Takes
    // precedence over the renderer-side synthesised preview because
    // the FS-aware count reflects real surrounding context (hidden
    // unchanged lines, line numbers, EOL handling).
    if (c.partial && c.diffStream) {
      additions += c.diffStream.additions;
      deletions += c.diffStream.deletions;
      continue;
    }
    // Path 3b — live partial preview synthesised renderer-side from
    // the model's `oldString` / `newString`. Fallback for the
    // pre-`diff-stream` window or for tools / files where the FS
    // path can't compute (e.g. `create: true` against a not-yet-
    // existing path).
    if (c.partial && c.call) {
      const counts = countPartialDiffLines(c.call.args ?? {});
      additions += counts.additions;
      deletions += counts.deletions;
    }
  }
  return { additions, deletions };
}

/**
 * Count `+` / `-` lines that the renderer-side preview synthesiser
 * would produce for a streaming `edit` call's partial args. Mirrors
 * the LCS-based `synthesizeDiffPreview` exactly so the rolled-up
 * `+N -M` badge always agrees with what the expanded preview shows
 * line-for-line.
 *
 *   - `create: true` + partial `content` → every line in the
 *     accumulated content is a `+` line.
 *   - `oldString` + `newString` → run through the shared
 *     `computeDiffHunks` (same call the renderer makes when it
 *     paints the preview) and count `+` / `-` lines emitted.
 *     Unchanged lines are NOT counted — Phase 1.2 fix: the
 *     pre-1.2 implementation just split both strings and called
 *     every line a delete or an add, which inflated the badge for
 *     typo-sized edits where most lines were anchor context.
 *
 * Pure helper, called from `toolGroupDiffStats` on each render.
 * Bounded cost: the strings are the model's `oldString` /
 * `newString` only, never the full file body.
 */
function countPartialDiffLines(args: Record<string, unknown>): {
  additions: number;
  deletions: number;
} {
  if (args['create'] === true) {
    const content = args['content'];
    if (typeof content !== 'string' || content.length === 0) {
      return { additions: 0, deletions: 0 };
    }
    return { additions: content.split('\n').length, deletions: 0 };
  }
  const oldString = args['oldString'];
  const newString = args['newString'];
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return { additions: 0, deletions: 0 };
  }
  if (oldString.length === 0 && newString.length === 0) {
    return { additions: 0, deletions: 0 };
  }
  // Use `computeDiffOps` (the unsegmented LCS walk) so the count
  // matches `synthesizeDiffPreview` line-for-line. The hunk-
  // segmenter in `computeDiffHunks` is for surrounding-context
  // rendering — counting through it would either skip context
  // lines (which we don't want to count anyway) or, with
  // `context = 0`, truncate trailing changes after a context
  // anchor. The flat op list avoids both pitfalls.
  const ops = computeDiffOps(oldString, newString);
  let additions = 0;
  let deletions = 0;
  for (const l of ops.lines) {
    if (l.kind === '+') additions++;
    else if (l.kind === '-') deletions++;
  }
  return { additions, deletions };
}

function verbFor(name: ToolName): string {
  switch (name) {
    case 'bash': return 'Ran';
    case 'read': return 'Read';
    case 'ls': return 'Listed';
    case 'edit': return 'Edited';
    case 'delete': return 'Deleted';
    case 'search': return 'Searched';
    case 'memory': return 'Memory';
    case 'recall': return 'Recalled';
    case 'report': return 'Wrote';
    case 'unknown': return 'Unknown tool';
  }
}

function unitFor(name: ToolName, singular: boolean): string {
  switch (name) {
    case 'bash': return singular ? 'command' : 'commands';
    case 'read': return singular ? 'file' : 'files';
    case 'ls': return singular ? 'path' : 'paths';
    case 'edit': return singular ? 'file' : 'files';
    case 'delete': return singular ? 'file' : 'files';
    case 'search': return singular ? 'query' : 'queries';
    case 'memory': return singular ? 'note' : 'notes';
    case 'recall': return singular ? 'conversation' : 'conversations';
    case 'report': return singular ? 'report' : 'reports';
    case 'unknown': return singular ? 'invocation' : 'invocations';
  }
}

function extractPrimary(name: ToolName, child: ToolGroupChild): string {
  const args = child.call?.args ?? {};
  const data = child.result?.data;
  switch (name) {
    case 'bash': {
      const cmd =
        typeof args['command'] === 'string'
          ? (args['command'] as string)
          : data?.tool === 'bash'
            ? data.command
            : '';
      return cmd;
    }
    case 'read':
    case 'ls':
    case 'edit':
    case 'delete': {
      const raw =
        typeof args['path'] === 'string'
          ? (args['path'] as string)
          : data?.tool === name && 'path' in data
            ? (data as { path: string }).path
            : data?.tool === 'edit'
              ? data.filePath
              : data?.tool === 'delete'
                ? data.filePath
                : '';
      // The agent often passes `.` (or empty) to mean the workspace
      // root. Surface that intent verbally instead of rendering a
      // stray period after the verb (`Listed .` → `Listed workspace`).
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed === '.' || trimmed === './') {
        return name === 'ls' ? 'workspace' : trimmed;
      }
      return raw;
    }
    case 'search': {
      const q =
        typeof args['query'] === 'string'
          ? (args['query'] as string)
          : data?.tool === 'search'
            ? data.query
            : '';
      return q;
    }
    case 'memory': {
      const action =
        typeof args['action'] === 'string'
          ? (args['action'] as string)
          : data?.tool === 'memory'
            ? data.action
            : '';
      const key =
        typeof args['key'] === 'string'
          ? (args['key'] as string)
          : data?.tool === 'memory' && data.key
            ? data.key
            : '';
      return key ? `${action} ${key}` : action;
    }
    case 'recall': {
      // Surface the action; for `read`, also show a short id prefix so
      // collapsed groups carry the breadcrumb without printing a 36-
      // char UUID.
      const action =
        typeof args['action'] === 'string'
          ? (args['action'] as string)
          : data?.tool === 'recall'
            ? data.action
            : '';
      const targetId =
        typeof args['conversationId'] === 'string'
          ? (args['conversationId'] as string)
          : data?.tool === 'recall' && data.conversationId
            ? data.conversationId
            : '';
      if (action === 'read' && targetId) {
        return `read ${targetId.slice(0, 8)}…`;
      }
      return action;
    }
    case 'report': {
      // Surface the title once it lands (typed on `data`), or fall back
      // to the in-flight `args.title` so the rolled-up row stays
      // informative while the sub-agent is still authoring the body.
      const title =
        typeof args['title'] === 'string'
          ? (args['title'] as string)
          : data?.tool === 'report'
            ? data.title
            : '';
      return title;
    }
    case 'unknown': {
      // Surface whatever name the call/result reported (or empty if both
      // are also `'unknown'`) so the rolled-up row remains informative.
      const callName = child.call?.name;
      const resultName = child.result?.name;
      if (callName && callName !== 'unknown') return callName;
      if (resultName && resultName !== 'unknown') return resultName;
      return '';
    }
  }
}

/**
 * Derive the overall status for a tool group. Mirrors the per-row status
 * logic: running if any child is still in-flight, failed if any child's
 * result is !ok, otherwise done.
 */
export function toolGroupStatus(children: ToolGroupChild[]): 'running' | 'done' | 'failed' {
  let anyFailed = false;
  for (const c of children) {
    if (!c.result) return 'running';
    if (!c.result.ok) anyFailed = true;
  }
  return anyFailed ? 'failed' : 'done';
}

