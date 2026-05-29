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
  it('renders connecting label in running meta footer', () => {
    render(
      <TurnBlock
        partitioned={livePartition}
        live
        renderRow={(row) => <div data-row-key={row.key}>{row.kind}</div>}
      />
    );

    expect(screen.getByText(CONNECTING_LABEL)).toBeTruthy();
    expect(document.querySelector('[data-turn-running-meta]')).toBeTruthy();
    expect(document.querySelector('[data-turn-activity-summary]')).toBeNull();
  });
});
