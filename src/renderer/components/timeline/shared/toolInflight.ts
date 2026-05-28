/**
 * Shared predicates for in-flight tool rows (live diff auto-expand).
 */

import type { SubAgentSnapshot } from '../reducer/types.js';
import {
  partialToolNameHint,
  shouldSynthesizePartialToolEntry
} from '../reducer/partialToolVisibility.js';
import type { ToolGroupChild } from '../reducer/deriveRows.js';
import { synthesizeDiffPreview } from '../tools/edit/synthesizeDiffPreview.js';
import { synthesizeReportPreview } from '../tools/report/synthesizeReportPreview.js';

const KNOWN_PARTIAL_TOOLS = [
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
] as const;

/** True while an edit call has not yet received a tool-result. */
function isInflightEditChild(child: ToolGroupChild): boolean {
  if (child.result !== undefined) return false;
  if (child.call?.name !== 'edit') return false;
  if (child.partial === true) return true;
  if (child.diffStream != null && child.diffStream.settled !== true) return true;
  if (child.call && synthesizeDiffPreview(child.call.args ?? null) != null) return true;
  return Boolean(child.call);
}

/** True while a report call has not yet received a tool-result. */
function isInflightReportChild(child: ToolGroupChild): boolean {
  if (child.result !== undefined) return false;
  if (child.call?.name !== 'report') return false;
  if (child.partial === true) return true;
  if (child.diffStream != null && child.diffStream.settled !== true) return true;
  if (child.call && synthesizeReportPreview(child.call.args ?? null) != null) return true;
  return Boolean(child.call);
}

export function toolGroupLiveAutoExpand(
  toolName: string,
  items: ToolGroupChild[]
): boolean {
  if (toolName === 'edit') {
    return items.some((c) => isInflightEditChild(c));
  }
  if (toolName === 'report') {
    return items.some((c) => isInflightReportChild(c));
  }
  return items.some((c) => c.partial === true && c.diffStream != null);
}

/**
 * True when a sub-agent snapshot carries at least one in-flight partial
 * tool entry that should surface a live diff or streaming preview.
 */
export function subagentHasInflightDiff(
  snap: Pick<SubAgentSnapshot, 'partialToolCallArgs' | 'steps'>
): boolean {
  const settledCallIds = new Set(snap.steps.filter((s) => s.result).map((s) => s.callId));
  for (const entry of Object.values(snap.partialToolCallArgs ?? {})) {
    if (settledCallIds.has(entry.callId)) continue;
    if (!shouldSynthesizePartialToolEntry(entry, KNOWN_PARTIAL_TOOLS)) continue;
    const hint = partialToolNameHint(entry);
    if (entry.diffStream != null && entry.diffStream.settled !== true) return true;
    if (hint === 'edit') {
      if (entry.parsed != null && synthesizeDiffPreview(entry.parsed) != null) return true;
      return true;
    }
    if (hint === 'report') {
      if (entry.parsed != null && synthesizeReportPreview(entry.parsed) != null) return true;
      return true;
    }
    if ((hint === 'bash' || hint === 'delete') && entry.diffStream != null) return true;
  }
  return false;
}

/**
 * True when any sub-agent in `ids` has an in-flight diff preview.
 */
export function delegateBatchHasInflightDiff(
  subagentIds: string[],
  subagents: Record<string, SubAgentSnapshot | undefined>
): boolean {
  for (const id of subagentIds) {
    const snap = subagents[id];
    if (snap && subagentHasInflightDiff(snap)) return true;
  }
  return false;
}
