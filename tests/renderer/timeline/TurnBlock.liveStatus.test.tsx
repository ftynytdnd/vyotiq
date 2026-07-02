/**
 * TurnBlock — live run status in footer meta while processing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnBlock } from '@renderer/components/timeline/shared/TurnBlock';
import { useChatStore } from '@renderer/store/useChatStore';
import type { PartitionedTurn } from '@renderer/components/timeline/shared/groupTurnSegment';

const CONNECTING_LABEL = 'Connecting to Ollama Cloud…';

const livePartition: PartitionedTurn = {
  prompt: { kind: 'user-prompt', key: 'p1', id: 'p1', content: 'hi' },
  footer: [],
  agentStream: []
};

beforeEach(() => {
  useChatStore.setState({
    isProcessing: true,
    events: [
      { kind: 'user-prompt', id: 'p1', ts: Date.now() - 2000, content: 'hi', runId: 'r1' }
    ],
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      phase: 'connecting',
      label: CONNECTING_LABEL,
      ts: Date.now()
    } as never
  });
});

describe('TurnBlock live status', () => {
  it('does not duplicate connecting label in sticky footer', () => {
    render(
      <TurnBlock
        partitioned={livePartition}
        live
        renderRow={(row) => <div data-row-key={row.key}>{row.kind}</div>}
      />
    );

    expect(screen.queryByText(CONNECTING_LABEL)).toBeNull();
    expect(screen.getByText(/Connecting/)).toBeTruthy();
    expect(document.querySelector('[data-turn-sticky-footer]')).not.toBeNull();
  });

  it('shows elapsed running telemetry when past connecting', () => {
    useChatStore.setState({
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        phase: 'awaiting-response',
        label: 'Starting…',
        ts: Date.now()
      } as never
    });

    render(
      <TurnBlock
        partitioned={livePartition}
        live
        renderRow={(row) => <div data-row-key={row.key}>{row.kind}</div>}
      />
    );

    expect(screen.getByText(/Waiting for model/)).toBeTruthy();
    expect(document.querySelector('[data-turn-sticky-footer]')).not.toBeNull();
  });
});
