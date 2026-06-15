import type { ToolName } from '@shared/types/tool.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import type { PartialToolCallArgs } from '../types.js';
import { shouldSynthesizePartialToolEntry } from '../partialToolVisibility.js';
import type { Row, ToolGroupChild } from '../deriveRows.js';

const KNOWN_TOOL_NAMES: readonly ToolName[] = [
  'bash', 'ls', 'read', 'edit', 'delete', 'search', 'sg', 'memory', 'recall', 'report', 'unknown'
];
export function appendSynthesizedPartialRows(
  out: Row[],
  partials: Record<string, PartialToolCallArgs>,
  preComputedSettled?: Record<string, true>,
  /** Live inline mode — append at turn tail instead of before assistant-text. */
  insertAtTail = false
): void {
  // Skip entries whose callId is already keyed in the events walk.
  // The reducer drops the partial entry on `tool-call` so the only
  // way this would matter is mid-frame inconsistency — defensive.
  //
  // Audit fix L-11: when the caller passes a pre-computed
  // `settledCallIds` map (built into reducer state for the late-frame
  // race guard), skip the O(R×C) walk over every tool-group row's
  // children to derive the same set. Fall back to the walk for
  // callers that don't have the slot.
  const settledIds = new Set<string>();
  if (preComputedSettled) {
    for (const id of Object.keys(preComputedSettled)) settledIds.add(id);
  } else {
    for (const row of out) {
      if (row.kind === 'tool-group') {
        for (const c of row.children) settledIds.add(c.callId);
      }
    }
  }
  // Append in `index` order so parallel tool-call streams render in
  // their wire order rather than `Object.keys` order.
  const entries = Object.values(partials)
    .filter((p) => !settledIds.has(p.callId))
    .sort((a, b) => a.index - b.index);
  if (entries.length === 0) return;

  let activityInsertIdx = insertAtTail ? out.length : findActivityInsertIndex(out);

  // Reuse the trailing group when its tool name matches the next
  // partial entry — same grouping rule as live events.
  for (const p of entries) {
    if (!shouldSynthesizePartialToolEntry(p, KNOWN_TOOL_NAMES)) continue;
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
    const insertAt = Math.min(activityInsertIdx, out.length);
    const prior = insertAt > 0 ? out[insertAt - 1] : undefined;
    if (prior && prior.kind === 'tool-group' && prior.toolName === toolName) {
      const next: Extract<Row, { kind: 'tool-group' }> = {
        ...prior,
        children: [...prior.children, child]
      };
      out[insertAt - 1] = next;
    } else {
      // Use the same `tg:${callId}` keyspace settled groups use so a
      // partial-only group's manual expand/collapse override survives
      // the partial → settled transition. The reducer's
      // `appendSynthesizedPartialRows` filter already guarantees we
      // never emit a duplicate of an existing settled `tg:${callId}`
      // (the callId-in-out scan happens above), so there's no key
      // collision risk. Audit fix — live diff visibility.
      out.splice(activityInsertIdx, 0, {
        kind: 'tool-group',
        key: `tg:${p.callId}`,
        toolName,
        children: [child]
      });
      activityInsertIdx += 1;
    }
  }
}

function findActivityInsertIndex(out: Row[]): number {
  let lastPromptIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.kind === 'user-prompt') lastPromptIdx = i;
  }
  const searchFrom = lastPromptIdx >= 0 ? lastPromptIdx + 1 : 0;
  for (let i = searchFrom; i < out.length; i++) {
    const kind = out[i]!.kind;
    if (
      kind === 'assistant-text' ||
      kind === 'run-complete' ||
      kind === 'error'
    ) {
      return i;
    }
  }
  return out.length;
}

function pickToolName(raw: string | undefined): ToolName {
  const normalized = normalizeRegisteredToolName(raw);
  if (normalized) return normalized;
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
