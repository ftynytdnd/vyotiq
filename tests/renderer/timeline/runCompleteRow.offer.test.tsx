/**
 * RunCompleteRow — HTML run summary offer after large edit runs.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunCompleteRow } from '@renderer/components/timeline/rows/RunCompleteRow';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

function resetStores(): void {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'c1',
    events: [],
    orchestratorUsage: undefined,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useConversationsStore.setState({
    list: [{ id: 'c1', title: 'Test', workspaceId: 'w1', updatedAt: 1, createdAt: 1 }],
    loaded: true
  } as ReturnType<typeof useConversationsStore.getState>);
}

describe('RunCompleteRow run summary offer', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows Quick summary when edit thresholds are met', () => {
    useChatStore.setState({
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1_000, content: 'fix providers', runId: 'r1' },
        {
          kind: 'file-edit',
          id: 'e1',
          ts: 2_000,
          runId: 'r1',
          filePath: 'a.ts',
          additions: 1,
          deletions: 0
        },
        {
          kind: 'file-edit',
          id: 'e2',
          ts: 3_000,
          runId: 'r1',
          filePath: 'b.ts',
          additions: 2,
          deletions: 0
        },
        {
          kind: 'file-edit',
          id: 'e3',
          ts: 4_000,
          runId: 'r1',
          filePath: 'c.ts',
          additions: 1,
          deletions: 0
        }
      ]
    });

    render(
      <RunCompleteRow
        promptId="p1"
        durationMs={3_000}
        completedAt={5_000}
        editCount={3}
        fileCount={3}
      />
    );

    expect(screen.getByText(/HTML report available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick summary/i })).toBeInTheDocument();
  });

  it('hides the offer for short runs without enough edits', () => {
    useChatStore.setState({
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1_000, content: 'hi', runId: 'r1' },
        {
          kind: 'file-edit',
          id: 'e1',
          ts: 2_000,
          runId: 'r1',
          filePath: 'a.ts',
          additions: 1,
          deletions: 0
        }
      ]
    });

    render(
      <RunCompleteRow
        promptId="p1"
        durationMs={1_000}
        completedAt={3_000}
        editCount={1}
        fileCount={1}
      />
    );

    expect(screen.queryByRole('button', { name: /Quick summary/i })).toBeNull();
  });
});
