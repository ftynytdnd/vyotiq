/**
 * TurnRunningMeta — footer placeholder while the trailing run is open.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnRunningMeta } from '@renderer/components/timeline/activity/TurnRunningMeta';
import { useChatStore } from '@renderer/store/useChatStore';

const CONNECTING_LABEL = 'Connecting to Ollama Cloud…';

beforeEach(() => {
  useChatStore.setState({
    isProcessing: true,
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      phase: 'connecting',
      label: CONNECTING_LABEL,
      ts: Date.now()
    } as never
  });
});

describe('TurnRunningMeta', () => {
  it('hides connecting phase (composer status strip owns that headline)', () => {
    render(<TurnRunningMeta live />);

    expect(screen.queryByText(CONNECTING_LABEL)).toBeNull();
    expect(document.querySelector('[data-turn-running-meta]')).toBeNull();
  });

  it('shows Starting… after connecting', () => {
    useChatStore.setState({
      isProcessing: true,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        phase: 'awaiting-response',
        label: 'Starting…',
        ts: Date.now()
      } as never
    });
    render(<TurnRunningMeta live />);

    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(document.querySelector('[data-turn-running-meta]')).toBeTruthy();
  });

  it('shows Running… during streaming when phase headline is hidden', () => {
    useChatStore.setState({
      isProcessing: true,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        phase: 'streaming-text',
        label: 'Streaming response…',
        ts: Date.now()
      } as never
    });
    render(<TurnRunningMeta live />);

    expect(screen.getByText('Running…')).toBeTruthy();
  });
});
