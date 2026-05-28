/**
 * AgentTracePanel — tab switch opens trace for another sub-agent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AgentTracePanel } from '@renderer/components/agent/AgentTracePanel';
import { useChatStore } from '@renderer/store/useChatStore';
import { useSecondaryZoneStore } from '@renderer/store/useSecondaryZoneStore';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function makeSnap(id: string, task: string): SubAgentSnapshot {
  return {
    id,
    task,
    files: [],
    missingFiles: [],
    tools: ['read'],
    status: 'running',
    startedAt: 1,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {}
  };
}

beforeEach(() => {
  useChatStore.setState({ subagents: {} });
  useSecondaryZoneStore.setState({ agentTraceId: null, panel: null });
});

describe('AgentTracePanel', () => {
  it('switching tabs calls openAgentTrace for the selected sub-agent', async () => {
    const openSpy = vi.spyOn(useSecondaryZoneStore.getState(), 'openAgentTrace');
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: makeSnap('A1', 'first task'),
          A2: makeSnap('A2', 'second task')
        }
      });
    });

    render(
      <AgentTracePanel open subagentId="A1" onClose={() => undefined} />
    );

    const tab = screen.getByRole('tab', { name: /second task/i });
    await act(async () => {
      tab.click();
    });
    expect(openSpy).toHaveBeenCalledWith('A2');
  });
});
