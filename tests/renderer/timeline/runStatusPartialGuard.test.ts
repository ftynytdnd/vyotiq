/**
 * `run-status` must not resurrect `liveStatus` on terminal sub-agents.
 */

import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  INITIAL_TIMELINE_STATE,
  type SubAgentSnapshot,
  type TimelineState
} from '@renderer/components/timeline/reducer/types';

const baseSnap: SubAgentSnapshot = {
  id: 'S1',
  task: 'work',
  files: [],
  missingFiles: [],
  tools: [],
  status: 'partial',
  startedAt: 1,
  endedAt: 50,
  steps: [],
  fileEdits: [],
  assistantTexts: {},
  reasoningTexts: {},
  iterationOrder: [],
  partialToolCallArgs: {}
};

function withSubagent(state: TimelineState = INITIAL_TIMELINE_STATE): TimelineState {
  return {
    ...state,
    subagents: { S1: baseSnap }
  };
}

describe('applyTimelineEvent — run-status terminal guard', () => {
  it('ignores late run-status after a sub-agent reaches partial', () => {
    const prior = withSubagent();
    expect(prior.subagents.S1?.liveStatus).toBeUndefined();

    const next = applyTimelineEvent(prior, {
      kind: 'run-status',
      id: 'rs-late',
      ts: 99,
      phase: 'running-tool',
      label: 'Exploring',
      detail: { subagentId: 'S1', toolName: 'read' }
    });

    expect(next.subagents.S1?.liveStatus).toBeUndefined();
    expect(next.subagents.S1?.status).toBe('partial');
  });
});
