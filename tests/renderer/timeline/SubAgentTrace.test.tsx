/**
 * SubAgentTrace — inline timeline sub-agent rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { SubAgentTrace } from '@renderer/components/timeline/subagent/SubAgentTrace';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function makeSnap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'S1',
    task: 'analyze providers/',
    files: [],
    missingFiles: [],
    tools: ['read'],
    status: 'running',
    startedAt: 1,
    steps: [{ call: { id: 'c1', name: 'read', args: { path: 'x' } } }],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...overrides
  };
}

beforeEach(() => {
  useChatStore.setState({
    conversationId: 'c-test',
    subagents: {},
    orchestratorUsage: undefined
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

describe('SubAgentTrace — inline timeline', () => {
  it('renders delegated task in the timeline row', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          S1: makeSnap({ id: 'S1', task: 'first task' }),
          S2: makeSnap({ id: 'S2', task: 'second task', startedAt: 2 })
        }
      });
    });
    const { container: c1 } = render(<SubAgentTrace subagentId="S1" />);
    const { container: c2 } = render(<SubAgentTrace subagentId="S2" />);
    expect(c1.textContent ?? '').toContain('first task');
    expect(c2.textContent ?? '').toContain('second task');
  });

  it('expands to show RunFlow with briefing content inline', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          S1: makeSnap({
            id: 'S1',
            task: 'expand me',
            iterationOrder: ['iter-1'],
            reasoningTexts: {
              'iter-1': { id: 'iter-1', text: 'thinking', done: true, startedAt: 10, endedAt: 20 }
            }
          }),
          S2: makeSnap({ id: 'S2', task: 'other worker', startedAt: 2 })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="S1" />);

    const rowBtn = container.querySelector('button[aria-expanded="false"]');
    expect(rowBtn).not.toBeNull();
    fireEvent.click(rowBtn!);

    expect(container.textContent ?? '').toContain('expand me');
    expect(container.textContent ?? '').toContain('Sub-agent S1');
    expect(container.textContent ?? '').toContain('Thought for');
  });

  it('marks the row with data attributes for scroll targeting', async () => {
    await act(async () => {
      useChatStore.setState({ subagents: { S1: makeSnap({ id: 'S1' }) } });
    });
    const { container } = render(<SubAgentTrace subagentId="S1" />);
    const row = container.querySelector('[data-row-kind="subagent-line"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-subagent-id')).toBe('S1');
  });
});
