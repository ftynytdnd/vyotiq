/**
 * DelegateBatchRow — one quiet delegate summary line (detail in AgentTracePanel).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { DelegateBatchRow } from '@renderer/components/timeline/delegation/DelegateBatchRow';
import { useChatStore } from '@renderer/store/useChatStore';
import { useSecondaryZoneStore } from '@renderer/store/useSecondaryZoneStore';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function makeSnap(id: string, task: string, status: SubAgentSnapshot['status'] = 'running'): SubAgentSnapshot {
  return {
    id,
    task,
    files: [],
    missingFiles: [],
    tools: ['read'],
    status,
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
  useChatStore.setState({
    conversationId: 'c-test',
    subagents: {}
  });
  useSecondaryZoneStore.setState({ agentTraceId: null, panel: null });
});

describe('DelegateBatchRow', () => {
  it('renders a one-line delegate summary with status counts', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: makeSnap('A1', 'task one'),
          A2: makeSnap('A2', 'task two', 'done')
        }
      });
    });

    const { container } = render(
      <DelegateBatchRow rowKey="delegate:A1:A2" subagentIds={['A1', 'A2']} />
    );

    expect(container.textContent ?? '').toContain('Delegated');
    expect(container.textContent ?? '').toContain('2 tasks');
    expect(container.textContent ?? '').toContain('1 running');
    expect(container.textContent ?? '').toContain('1 done');
    expect(container.textContent ?? '').not.toContain('worker alpha');
    expect(container.querySelector('[data-row-kind="subagent-line"]')).toBeNull();
  });

  it('opens trace when clicked', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: makeSnap('A1', 'task one')
        }
      });
    });

    const { container } = render(
      <DelegateBatchRow rowKey="delegate:A1" subagentIds={['A1']} />
    );

    const button = container.querySelector('[data-row-kind="delegate-batch"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useSecondaryZoneStore.getState().agentTraceId).toBe('A1');
  });
});
