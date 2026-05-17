/**
 * SubAgentRunFlow — chronological body for an expanded sub-agent
 * trace card.
 *
 * Replaces the previous two-component split (`SubAgentSteps` +
 * `SubAgentBody`) which rendered ALL tool calls grouped at the top
 * and THEN every iteration's reasoning + text body underneath. That
 * layout was non-sequential: a worker that did
 *
 *   reason₁ → text₁ → read foo → reason₂ → text₂ → edit foo
 *
 * rendered as
 *
 *   Read foo, Edit foo            ← all tools first, grouped
 *   Iteration 1 reasoning + text  ← then all bodies
 *   Iteration 2 reasoning + text
 *
 * which inverts execution order and obscures *which* iteration
 * decided to call which tool.
 *
 * Post-fix layout walks every artifact in real chronological order
 * and renders them inline:
 *
 *   Iteration 1 reasoning panel
 *   Iteration 1 text panel
 *   Read foo                       ← iter-1's tool round
 *   Iteration 2 reasoning panel
 *   Iteration 2 text panel
 *   Edit foo +N -M                 ← iter-2's tool round
 *   (synthesised in-flight rows)
 *
 * Same-tool roll-up is preserved (the Cascade-style compression we
 * already use at the orchestrator level): consecutive `read` steps
 * inside ONE iteration's tool round still fold into a single
 * `ToolGroupRow`. But an iteration boundary closes any open group so
 * tool calls from different model turns never bleed together.
 *
 * Inputs are plain `SubAgentSnapshot` slots — no IPC, no event
 * subscription. Pure transformation of the per-iteration accumulators
 * the reducer already maintains.
 */

import { useMemo } from 'react';
import type { SubAgentSnapshot } from '../reducer/types.js';
import {
  editChildPath,
  type FileEditGroupChild,
  type Row,
  type ToolGroupChild
} from '../reducer/deriveRows.js';
import type { ToolName } from '@shared/types/tool.js';
import { ToolGroupRow } from '../rows/ToolGroupRow.js';
import { FileEditGroupRow } from '../rows/FileEditGroupRow.js';
import { ReasoningPanel, TextPanel } from './iterationPanels.js';

interface SubAgentRunFlowProps {
  snap: SubAgentSnapshot;
}

/** One renderable item along the chronological flow. */
type FlowItem =
  | {
    kind: 'iteration';
    /** Earlier of `reasoning.startedAt` and `text.startedAt`; drives
     *  the chronological merge. */
    ts: number;
    iterationId: string;
  }
  | {
    kind: 'step';
    ts: number;
    step: SubAgentSnapshot['steps'][number];
  }
  | {
    kind: 'edit';
    ts: number;
    edit: SubAgentSnapshot['fileEdits'][number];
  }
  | {
    kind: 'partial';
    /** Partial entries land at the tail; they have no settled
     *  timestamp at the moment of grouping. `index` decides intra-
     *  partial ordering. */
    index: number;
    entry: SubAgentSnapshot['partialToolCallArgs'][string];
  };

/**
 * Final renderable group descriptor. Same shape vocabulary as
 * `deriveRows.Row` (we reuse `ToolGroupRow` and `FileEditGroupRow`)
 * with one extra kind for inline iteration panels.
 */
type FlowGroup =
  | { kind: 'iteration'; key: string; iterationId: string }
  | Extract<Row, { kind: 'tool-group' }>
  | Extract<Row, { kind: 'file-edit-group' }>;

const KNOWN_SUBAGENT_TOOLS: readonly ToolName[] = [
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

function pickToolName(raw: string | undefined): ToolName {
  if (raw && (KNOWN_SUBAGENT_TOOLS as readonly string[]).includes(raw)) {
    return raw as ToolName;
  }
  return 'unknown';
}

/**
 * Build the chronological item list and fold it into renderable
 * groups. Pure — pulled out of the component so the test harness can
 * pin the resulting shape without rendering React.
 *
 * Grouping rules (close any open group at every iteration boundary):
 *   - Consecutive `step` items with the SAME tool name fold into one
 *     `tool-group` (Cascade-style same-tool roll-up).
 *   - Consecutive `edit` items fold into one `file-edit-group`.
 *   - An `edit` item immediately after an `edit` tool-step targeting
 *     the SAME path with a successful result merges its diff stats
 *     into the prior step's `fileEditAdditions/Deletions` (mirrors
 *     the orchestrator-level fold in `deriveRows.ts`).
 *   - Any `iteration` item closes both open groups so cross-turn
 *     tool calls never bleed into one row.
 *   - Synthesized `partial` items append at the tail — with the same
 *     consecutive-same-tool fold rule against the trailing settled
 *     group when names match.
 */
export function buildSubAgentFlow(snap: SubAgentSnapshot): FlowGroup[] {
  // Settled items (iterations, steps, file edits) participate in the
  // chronological merge. Partial entries are streaming-only and have
  // no settled timestamp — they are appended at the tail after the
  // sort so a volatile in-flight delta can never reorder a
  // historical row.
  type SettledItem = Exclude<FlowItem, { kind: 'partial' }>;
  const settled: SettledItem[] = [];

  // Iterations — one per id, with the earliest `startedAt` of its
  // reasoning + text accumulators.
  for (const iterId of snap.iterationOrder) {
    const r = snap.reasoningTexts[iterId];
    const t = snap.assistantTexts[iterId];
    // Only emit an iteration item if it actually has a body to show.
    // The reducer prunes accumulators on abort, so checking `text`
    // length here mirrors the body-rendering predicate the previous
    // `SubAgentBody` used.
    const hasReasoning = r && r.text.length > 0;
    const hasText = t && t.text.length > 0;
    if (!hasReasoning && !hasText) continue;
    const rTs = hasReasoning ? r.startedAt ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    const tTs = hasText ? t.startedAt ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    settled.push({
      kind: 'iteration',
      ts: Math.min(rTs, tTs),
      iterationId: iterId
    });
  }

  for (const step of snap.steps) {
    settled.push({ kind: 'step', ts: step.startedAt, step });
  }
  for (const edit of snap.fileEdits) {
    settled.push({ kind: 'edit', ts: edit.ts, edit });
  }

  // Stable chronological sort. When timestamps tie, fall back to
  // a kind-rank so a turn's reasoning panel always sits above its
  // first tool round when their `startedAt` matches (rare but
  // possible on very fast providers).
  settled.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return settledRank(a) - settledRank(b);
  });

  const items: FlowItem[] = [...settled];

  // Partial entries — appended at the tail in `index` order so a
  // multi-call streaming round renders left-to-right by wire order.
  // They never participate in the timestamp sort (the most recent
  // delta's `ts` is too volatile to interleave honestly).
  //
  // Defensive `?? {}`: the live reducer always populates this slot
  // via `ensureSnapshot`, but legacy persisted snapshots and
  // hand-rolled test fixtures predating Phase 1 may omit it. The
  // same defensive pattern is used in the reducer for other late-
  // added slots (e.g. `tools`, `missingFiles`).
  const partials = Object.values(snap.partialToolCallArgs ?? {})
    .filter((p) => !snap.steps.some((s) => s.callId === p.callId))
    .sort((a, b) => a.index - b.index);
  for (const entry of partials) {
    items.push({ kind: 'partial', index: entry.index, entry });
  }

  // Fold into groups.
  const out: FlowGroup[] = [];
  let openTool: Extract<FlowGroup, { kind: 'tool-group' }> | null = null;
  let openEdit: Extract<FlowGroup, { kind: 'file-edit-group' }> | null = null;
  const closeGroups = () => {
    openTool = null;
    openEdit = null;
  };

  for (const it of items) {
    if (it.kind === 'iteration') {
      closeGroups();
      out.push({
        kind: 'iteration',
        key: `iter:${it.iterationId}`,
        iterationId: it.iterationId
      });
      continue;
    }
    if (it.kind === 'step') {
      const s = it.step;
      const name: ToolName = (s.call?.name ?? s.result?.name ?? 'unknown') as ToolName;
      openEdit = null;
      if (!openTool || openTool.toolName !== name) {
        const next: Extract<FlowGroup, { kind: 'tool-group' }> = {
          kind: 'tool-group',
          key: `tg:${s.callId}`,
          toolName: name,
          children: []
        };
        out.push(next);
        openTool = next;
      }
      const child: ToolGroupChild = {
        callId: s.callId,
        ...(s.call ? { call: s.call } : {}),
        ...(s.result ? { result: s.result } : {})
      };
      openTool.children = [...openTool.children, child];
      continue;
    }
    if (it.kind === 'edit') {
      // Mirror the deriveRows fold: a `file-edit` immediately after a
      // successful `edit` tool-step targeting the same path merges
      // diff stats into the prior step instead of opening a new
      // `file-edit-group` row.
      if (openTool && openTool.toolName === 'edit' && openTool.children.length > 0) {
        const lastIdx = openTool.children.length - 1;
        const last = openTool.children[lastIdx]!;
        const lastPath = editChildPath(last);
        if (last.result && last.result.ok && lastPath === it.edit.filePath) {
          const merged: ToolGroupChild = {
            ...last,
            fileEditAdditions: (last.fileEditAdditions ?? 0) + it.edit.additions,
            fileEditDeletions: (last.fileEditDeletions ?? 0) + it.edit.deletions
          };
          const nextChildren = openTool.children.slice();
          nextChildren[lastIdx] = merged;
          openTool.children = nextChildren;
          continue;
        }
      }
      openTool = null;
      if (!openEdit) {
        const next: Extract<FlowGroup, { kind: 'file-edit-group' }> = {
          kind: 'file-edit-group',
          key: `fe:${it.edit.key}`,
          children: []
        };
        out.push(next);
        openEdit = next;
      }
      const child: FileEditGroupChild = {
        key: it.edit.key,
        filePath: it.edit.filePath,
        additions: it.edit.additions,
        deletions: it.edit.deletions
      };
      openEdit.children = [...openEdit.children, child];
      continue;
    }
    // partial
    const toolName = pickToolName(it.entry.name);
    const child: ToolGroupChild = {
      callId: it.entry.callId,
      call: {
        id: it.entry.callId,
        name: toolName,
        args: it.entry.parsed ?? {}
      },
      partial: true,
      ...(it.entry.diffStream ? { diffStream: it.entry.diffStream } : {})
    };
    if (openTool && openTool.toolName === toolName) {
      openTool.children = [...openTool.children, child];
    } else {
      // Mirror `appendSynthesizedPartialRows` in `deriveRows.ts`: use
      // the settled `tg:${callId}` keyspace so a partial-only sub-agent
      // tool group's manual expand override survives the partial →
      // settled transition. The earlier filter (`!snap.steps.some...`)
      // guarantees no callId collision with an already-settled step.
      const next: Extract<FlowGroup, { kind: 'tool-group' }> = {
        kind: 'tool-group',
        key: `tg:${it.entry.callId}`,
        toolName,
        children: [child]
      };
      out.push(next);
      openTool = next;
      openEdit = null;
    }
  }

  return out;
}

/** Tie-break rank for `settled.sort`. Iteration before step before
 *  edit so a turn's reasoning panel always sits above its first
 *  tool round when their `startedAt` matches exactly (rare but
 *  observed on very fast providers). */
function settledRank(it: Exclude<FlowItem, { kind: 'partial' }>): number {
  switch (it.kind) {
    case 'iteration': return 0;
    case 'step': return 1;
    case 'edit': return 2;
  }
}

export function SubAgentRunFlow({ snap }: SubAgentRunFlowProps) {
  // Memo deps are narrowed to the slots `buildSubAgentFlow` actually
  // reads off `snap`. Pre-fix the `[snap]` dep invalidated on every
  // reducer event that produced a fresh top-level snapshot reference
  // (including `token-usage` events that touch no flow-shape data),
  // forcing a full sort + group fold per delta. Shallow-equal'ing
  // the per-slot references aligns the memo lifetime with what
  // actually changes the render.
  const groups = useMemo(
    () => buildSubAgentFlow(snap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      snap.iterationOrder,
      snap.steps,
      snap.fileEdits,
      snap.partialToolCallArgs,
      snap.reasoningTexts,
      snap.assistantTexts
    ]
  );
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((g) => {
        if (g.kind === 'iteration') {
          return (
            <IterationBlock
              key={g.key}
              snap={snap}
              iterationId={g.iterationId}
            />
          );
        }
        if (g.kind === 'tool-group') {
          return (
            <ToolGroupRow
              key={g.key}
              rowKey={`${snap.id}:${g.key}`}
              toolName={g.toolName}
              items={g.children}
            />
          );
        }
        return (
          <FileEditGroupRow
            key={g.key}
            rowKey={`${snap.id}:${g.key}`}
            items={g.children}
          />
        );
      })}
    </div>
  );
}

interface IterationBlockProps {
  snap: SubAgentSnapshot;
  iterationId: string;
}

function IterationBlock({ snap, iterationId }: IterationBlockProps) {
  const reasoning = snap.reasoningTexts[iterationId];
  const text = snap.assistantTexts[iterationId];
  return (
    <div className="flex flex-col gap-1.5">
      {reasoning && reasoning.text.length > 0 && (
        <ReasoningPanel
          subagentId={snap.id}
          iterationId={iterationId}
          text={reasoning.text}
          done={reasoning.done}
          startedAt={reasoning.startedAt ?? 0}
          {...(reasoning.endedAt !== undefined ? { endedAt: reasoning.endedAt } : {})}
        />
      )}
      {text && text.text.length > 0 && (
        <TextPanel
          subagentId={snap.id}
          iterationId={iterationId}
          text={text.text}
          done={text.done}
        />
      )}
    </div>
  );
}
