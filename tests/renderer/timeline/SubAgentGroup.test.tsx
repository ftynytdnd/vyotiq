/**
 * SubAgentGroup — optional meta line + N inline SubAgentTrace rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubAgentGroup } from '@renderer/components/timeline/subagent/SubAgentGroup';
import { useChatStore } from '@renderer/store/useChatStore';
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
  useChatStore.setState({ conversationId: 'c-test', subagents: {} });
});

describe('SubAgentGroup', () => {
  it('shows meta line and N trace headers for parallel workers', () => {
    useChatStore.setState({
      subagents: {
        A1: makeSnap('A1', 'task one'),
        A2: makeSnap('A2', 'task two', 'done')
      }
    });

    const { container } = render(
      <SubAgentGroup subagentIds={['A1', 'A2']} />
    );

    expect(container.querySelector('[data-row-kind="subagent-group"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('Delegated');
    expect(container.textContent ?? '').toContain('2 tasks');
    expect(container.textContent ?? '').toContain('1 running');
    expect(container.textContent ?? '').toContain('1 done');
    expect(container.querySelectorAll('[data-row-kind="subagent-line"]')).toHaveLength(2);
    expect(screen.getByText(/task one/)).toBeInTheDocument();
    expect(screen.getByText(/task two/)).toBeInTheDocument();
  });

  it('omits meta line for a single worker', () => {
    useChatStore.setState({
      subagents: { A1: makeSnap('A1', 'solo task') }
    });

    const { container } = render(
      <SubAgentGroup subagentIds={['A1']} />
    );

    expect(container.textContent ?? '').not.toContain('Delegated');
    expect(container.querySelectorAll('[data-row-kind="subagent-line"]')).toHaveLength(1);
    expect(screen.getByText(/solo task/)).toBeInTheDocument();
  });
});
