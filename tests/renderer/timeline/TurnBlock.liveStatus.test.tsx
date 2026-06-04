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
  activity: [],
  response: null,
  footer: [],
  agentStream: []
};

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

describe('TurnBlock live status', () => {
  it('does not duplicate connecting in timeline meta (composer strip owns it)', () => {
    render(
      <TurnBlock
        partitioned={livePartition}
        live
        renderRow={(row) => <div data-row-key={row.key}>{row.kind}</div>}
      />
    );

    expect(screen.queryByText(CONNECTING_LABEL)).toBeNull();
    expect(document.querySelector('[data-turn-running-meta]')).toBeNull();
  });

  it('renders starting label in running meta when past connecting', () => {
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

    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(document.querySelector('[data-turn-running-meta]')).toBeTruthy();
  });
});
