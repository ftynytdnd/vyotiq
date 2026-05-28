/**
 * RAM helpers — salvage terminal sub-agent payloads and unload idle slices.
 */

import { describe, expect, it } from 'vitest';
import {
  isTerminalSubAgentStatus,
  salvageTerminalSubAgent,
  salvageTerminalSubagents,
  shouldUnloadIdleSlice,
  unloadIdleSlice
} from '@renderer/store/chatStoreRam';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function subagentFixture(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'sub-1',
    task: 'Explore auth module',
    files: ['src/auth.ts'],
    missingFiles: [],
    tools: ['read'],
    unknownTools: [],
    status: 'done',
    startedAt: 1,
    endedAt: 2,
    steps: [{ callId: 'c1', startedAt: 1 }],
    fileEdits: [],
    assistantTexts: { a1: { id: 'a1', text: 'hello', startedAt: 1 } },
    reasoningTexts: {},
    iterationOrder: ['a1'],
    ...overrides
  };
}

describe('chatStoreRam', () => {
  it('detects terminal sub-agent statuses', () => {
    expect(isTerminalSubAgentStatus('done')).toBe(true);
    expect(isTerminalSubAgentStatus('running')).toBe(false);
  });

  it('salvages heavy terminal sub-agent fields while keeping status/task', () => {
    const salvaged = salvageTerminalSubAgent(subagentFixture());
    expect(salvaged.status).toBe('done');
    expect(salvaged.task).toBe('Explore auth module');
    expect(salvaged.steps).toEqual([]);
    expect(salvaged.assistantTexts).toEqual({});
    expect(salvaged.liveStatus).toBeUndefined();
  });

  it('salvageTerminalSubagents is a no-op when nothing heavy remains', () => {
    const light = subagentFixture({
      steps: [],
      assistantTexts: {},
      iterationOrder: []
    });
    const input = { [light.id]: light };
    expect(salvageTerminalSubagents(input)).toBe(input);
  });

  it('unloadIdleSlice preserves draft and drops transcript weight', () => {
    const slice = {
      ...emptySlice('conv-1'),
      draft: 'typed but unsent',
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'hi' } as const]
    };
    const unloaded = unloadIdleSlice(slice);
    expect(unloaded.draft).toBe('typed but unsent');
    expect(unloaded.events).toEqual([]);
    expect(unloaded.isProcessing).toBe(false);
  });

  it('shouldUnloadIdleSlice skips in-flight slices', () => {
    const idle = { ...emptySlice('conv-1'), events: [{ kind: 'error', id: 'e1', ts: 1, message: 'x' }] };
    const busy = { ...idle, isProcessing: true, runId: 'run-1' };
    expect(shouldUnloadIdleSlice(idle)).toBe(true);
    expect(shouldUnloadIdleSlice(busy)).toBe(false);
  });
});
