/**
 * Renderer RAM helpers for chat slices — salvage terminal sub-agent
 * trace payloads and unload idle inactive slices so long sessions do
 * not pin full transcripts for every conversation ever opened.
 */

import type { SubAgentSnapshot } from '../components/timeline/reducer/types.js';
import { emptySlice, type ChatSlice } from './chatStoreTypes.js';

const TERMINAL_SUBAGENT_STATUSES = new Set<SubAgentSnapshot['status']>([
  'done',
  'partial',
  'failed',
  'malformed',
  'aborted'
]);

export function isTerminalSubAgentStatus(status: SubAgentSnapshot['status']): boolean {
  return TERMINAL_SUBAGENT_STATUSES.has(status);
}

/** Strip heavy trace fields; keep status/task for delegate batch rows. */
export function salvageTerminalSubAgent(snap: SubAgentSnapshot): SubAgentSnapshot {
  return {
    id: snap.id,
    task: snap.task,
    files: snap.files,
    missingFiles: snap.missingFiles,
    tools: snap.tools,
    unknownTools: snap.unknownTools,
    status: snap.status,
    message: snap.message,
    output: snap.output,
    startedAt: snap.startedAt,
    endedAt: snap.endedAt,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    liveStatus: undefined,
    ...(snap.usage !== undefined ? { usage: snap.usage } : {})
  };
}

function subagentNeedsSalvage(snap: SubAgentSnapshot): boolean {
  return (
    snap.steps.length > 0 ||
    snap.fileEdits.length > 0 ||
    Object.keys(snap.assistantTexts).length > 0 ||
    Object.keys(snap.reasoningTexts).length > 0 ||
    snap.iterationOrder.length > 0 ||
    snap.liveStatus !== undefined
  );
}

export function salvageTerminalSubagents(
  subagents: Record<string, SubAgentSnapshot>
): Record<string, SubAgentSnapshot> {
  let changed = false;
  const next: Record<string, SubAgentSnapshot> = {};
  for (const [id, snap] of Object.entries(subagents)) {
    if (isTerminalSubAgentStatus(snap.status) && subagentNeedsSalvage(snap)) {
      next[id] = salvageTerminalSubAgent(snap);
      changed = true;
    } else {
      next[id] = snap;
    }
  }
  return changed ? next : subagents;
}

export function salvageSliceSubagents(slice: ChatSlice): ChatSlice {
  const subagents = salvageTerminalSubagents(slice.subagents);
  return subagents === slice.subagents ? slice : { ...slice, subagents };
}

export function shouldUnloadIdleSlice(slice: ChatSlice | undefined): slice is ChatSlice {
  if (!slice) return false;
  if (slice.isProcessing || slice.runId) return false;
  return slice.events.length > 0 || Object.keys(slice.subagents).length > 0;
}

/** Drop transcript weight from an idle slice; preserve draft for re-open. */
export function unloadIdleSlice(slice: ChatSlice): ChatSlice {
  if (slice.isProcessing || slice.runId) return slice;
  const draft = slice.draft;
  return { ...emptySlice(slice.conversationId), draft };
}
