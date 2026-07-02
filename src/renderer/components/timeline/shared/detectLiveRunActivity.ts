/**
 * Infer what the orchestrator is doing right now from live reducer
 * state — run-status alone stays on connecting/awaiting too long.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolName } from '@shared/types/tool.js';
import { isTimelineHiddenTool } from './timelineHiddenTools.js';
import type {
  AssistantTextAcc,
  PartialToolCallArgs,
  ReasoningTextAcc
} from '../reducer/types.js';

export interface LiveRunActivity {
  streamingReasoning?: boolean;
  streamingText?: boolean;
  activeToolName?: ToolName;
  streamingToolName?: ToolName;
  /** Edit path known but diff stream not yet visible. */
  creatingFilePath?: string;
}

export function detectLiveRunActivity(input: {
  isProcessing: boolean;
  reasoningTexts: Record<string, ReasoningTextAcc>;
  assistantTexts: Record<string, AssistantTextAcc>;
  partialToolCallArgs: Record<string, PartialToolCallArgs>;
  events: TimelineEvent[];
  toolResultSettledIds: Record<string, true>;
}): LiveRunActivity {
  if (!input.isProcessing) return {};

  for (const acc of Object.values(input.reasoningTexts)) {
    if (!acc.done) return { streamingReasoning: true };
  }

  for (const acc of Object.values(input.assistantTexts)) {
    if (!acc.done) return { streamingText: true };
  }

  let latestPartial: PartialToolCallArgs | undefined;
  for (const partial of Object.values(input.partialToolCallArgs)) {
    if (!latestPartial || partial.ts > latestPartial.ts) latestPartial = partial;
  }
  if (latestPartial?.name === 'edit' || latestPartial?.diffStream?.tool === 'edit') {
    const path =
      typeof latestPartial.parsed?.['path'] === 'string'
        ? (latestPartial.parsed['path'] as string)
        : latestPartial.diffStream?.filePath ?? '';
    const hasStream =
      (latestPartial.diffStream?.hunks?.length ?? 0) > 0 ||
      typeof latestPartial.parsed?.['content'] === 'string' ||
      typeof latestPartial.parsed?.['newString'] === 'string';
    if (path.length > 0 && !hasStream) {
      return { streamingToolName: 'edit', creatingFilePath: path };
    }
    return { streamingToolName: 'edit' };
  }
  if (latestPartial?.name && !isTimelineHiddenTool(latestPartial.name)) {
    return { streamingToolName: latestPartial.name as ToolName };
  }

  for (let i = input.events.length - 1; i >= 0; i--) {
    const event = input.events[i]!;
    if (event.kind === 'tool-result') continue;
    if (event.kind === 'tool-call') {
      if (isTimelineHiddenTool(event.call.name)) continue;
      if (!input.toolResultSettledIds[event.call.id]) {
        return { activeToolName: event.call.name };
      }
      break;
    }
  }

  return {};
}
