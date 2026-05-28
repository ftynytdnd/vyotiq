/**
 * TurnActivitySummary — collapsed default and expand reveals activity.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TurnActivitySummary } from '@renderer/components/timeline/activity/TurnActivitySummary';
import type { PartitionedTurn } from '@renderer/components/timeline/shared/groupTurnSegment';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

const CONV_ID = 'c-activity-summary';

const partitioned: PartitionedTurn = {
  prompt: {
    kind: 'user-prompt',
    key: 'p-1',
    id: 'p-1',
    runId: 'run-1',
    content: 'Do work'
  },
  activity: [
    {
      kind: 'tool-group',
      key: 'tg-1',
      toolName: 'read',
      children: []
    },
    {
      kind: 'reasoning-line',
      key: 'thought:1',
      id: 'thought-1'
    }
  ],
  response: {
    kind: 'assistant-text',
    key: 'text:a1',
    id: 'a1'
  },
  footer: [
    {
      kind: 'run-complete',
      key: 'rc-1',
      durationMs: 5500,
      editCount: 2,
      fileCount: 1
    }
  ],
  agentStream: [
    {
      kind: 'tool-group',
      key: 'tg-1',
      toolName: 'read',
      children: []
    },
    {
      kind: 'reasoning-line',
      key: 'thought:1',
      id: 'thought-1'
    },
    {
      kind: 'assistant-text',
      key: 'text:a1',
      id: 'a1'
    }
  ]
};

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: CONV_ID
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    diffFoldExpandedByScope: {},
    hydrated: true
  });
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ ...INITIAL_TIMELINE_STATE, conversationId: null });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    diffFoldExpandedByScope: {},
    hydrated: false
  });
});

describe('TurnActivitySummary', () => {
  it('defaults collapsed with Worked for duration label', () => {
    const { container, queryByText } = render(
      <TurnActivitySummary
        partitioned={partitioned}
        renderRow={(row) => <div data-testid={`row-${row.key}`} />}
      />
    );

    expect(container.textContent ?? '').toMatch(/Worked for 5\.5s/);
    expect(container.textContent ?? '').toMatch(/2 edits/);
    expect(queryByText('Reasoning')).toBeNull();
    expect(container.querySelector('[data-testid="row-thought:1"]')).toBeNull();
  });

  it('expands to reveal categorized activity and persists ui-store key', () => {
    const { container, getByRole } = render(
      <TurnActivitySummary
        partitioned={partitioned}
        renderRow={(row) => <div data-testid={`row-${row.key}`}>{row.kind}</div>}
      />
    );

    fireEvent.click(getByRole('button', { expanded: false }));

    expect(container.querySelector('[data-testid="row-tg-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-thought:1"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('Tools');
    expect(container.textContent ?? '').toContain('Reasoning');

    expect(
      useTimelineUiStore.getState().isExpanded(CONV_ID, 'turn-activity:run-1')
    ).toBe(true);
  });
});
