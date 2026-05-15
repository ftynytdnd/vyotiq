import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatHistoryList } from '@renderer/components/sidebar/ChatHistoryList';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

const meta = (id: string, title: string) => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  eventCount: 0,
  workspaceId: 'ws-test'
});

describe('ChatHistoryList action affordance', () => {
  it('renders the delete button (and no Stop button) while the slice is idle', () => {
    render(
      <ChatHistoryList
        entries={[meta('cA', 'Alpha')]}
        activeId={null}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: /^delete conversation /i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^stop run in /i })).toBeNull();
    cleanup();
  });

  it('swaps the trash for a Stop button when the slice is processing', () => {
    useChatStore.setState({
      slices: {
        cA: chatSliceFixture({
          conversationId: 'cA',
          runId: 'r1',
          isProcessing: true,
          runStartedAt: Date.now()
        })
      },
      runIdToConv: { r1: 'cA' }
    });
    render(
      <ChatHistoryList
        entries={[meta('cA', 'Alpha')]}
        activeId={null}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    // Stop is visible; the trash is gone (per-row abort affordance
    // replaces delete while running so a misclick can't both abort AND
    // delete in one motion).
    expect(
      screen.getByRole('button', { name: /stop run in alpha/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^delete conversation /i })
    ).toBeNull();
    cleanup();
  });

  it('confirms before deleting an idle conversation', async () => {
    // The running sibling (cB) ensures sibling-slice flips never affect
    // the visible affordance for an unrelated row (cA stays idle, so
    // its trash is what we click).
    useChatStore.setState({
      slices: {
        cB: chatSliceFixture({
          conversationId: 'cB',
          runId: 'r-other',
          isProcessing: true,
          runStartedAt: Date.now()
        })
      },
      runIdToConv: { 'r-other': 'cB' }
    });

    const removeSpy = vi.fn();

    render(
      <ChatHistoryList
        entries={[meta('cA', 'Alpha'), meta('cB', 'Bravo')]}
        activeId={'cB'}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onRemove={removeSpy}
      />
    );
    // Each delete button is individually labelled with its
    // conversation title so screen readers can disambiguate. cA is
    // idle, so its trash button is rendered; cB is processing, so its
    // trash is replaced by the Stop button (asserted below).
    const deleteAlpha = screen.getByRole('button', {
      name: /delete conversation alpha/i
    });
    expect(
      screen.queryByRole('button', { name: /delete conversation bravo/i })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /stop run in bravo/i })
    ).toBeInTheDocument();

    await userEvent.click(deleteAlpha);

    expect(removeSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Delete conversation?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('cA');
    cleanup();
  });
});
