/**
 * SubAgentTrace — collapsed by default; expands only on user click.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SubAgentTrace } from '@renderer/components/timeline/subagent/SubAgentTrace';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
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
    subagents: { A1: makeSnap('A1', 'scan auth/') }
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

describe('SubAgentTrace', () => {
  it('renders collapsed by default while running', () => {
    render(<SubAgentTrace subagentId="A1" />);
    expect(screen.getByText(/scan auth/)).toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand sub-agent trace/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('expands trace body only after user click', async () => {
    render(<SubAgentTrace subagentId="A1" />);
    const toggle = screen.getByRole('button', { name: /Expand sub-agent trace/i });

    await act(async () => {
      toggle.click();
    });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('does not auto-expand when status changes to done without user click', async () => {
    const { rerender } = render(<SubAgentTrace subagentId="A1" />);

    await act(async () => {
      useChatStore.setState({
        subagents: { A1: makeSnap('A1', 'scan auth/', 'done') }
      });
    });
    rerender(<SubAgentTrace subagentId="A1" />);

    expect(screen.getByRole('button', { name: /Expand sub-agent trace/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
  });
});
