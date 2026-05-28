/**
 * timelineSubagentGroup - inline sub-agent group projection end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'c-test',
    isProcessing: true,
    subagents: {
      A1: {
        id: 'A1',
        task: 'scan auth/',
        files: [],
        missingFiles: [],
        tools: ['read'],
        status: 'running',
        startedAt: 1,
        steps: [],
        fileEdits: [],
        assistantTexts: {},
        reasoningTexts: {},
        iterationOrder: [],
        partialToolCallArgs: {}
      },
      A2: {
        id: 'A2',
        task: 'scan api/',
        files: [],
        missingFiles: [],
        tools: ['read'],
        status: 'pending',
        startedAt: 2,
        steps: [],
        fileEdits: [],
        assistantTexts: {},
        reasoningTexts: {},
        iterationOrder: [],
        partialToolCallArgs: {}
      }
    },
    events: [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'analyze' },
      {
        kind: 'subagent-pending',
        id: 'sp1',
        ts: 2,
        subagentId: 'A1',
        task: 'scan auth/',
        files: [],
        tools: ['read']
      },
      {
        kind: 'subagent-spawn',
        id: 'ss1',
        ts: 3,
        subagentId: 'A1',
        task: 'scan auth/',
        files: [],
        tools: ['read']
      },
      {
        kind: 'subagent-pending',
        id: 'sp2',
        ts: 4,
        subagentId: 'A2',
        task: 'scan api/',
        files: [],
        tools: ['read']
      },
      {
        kind: 'subagent-spawn',
        id: 'ss2',
        ts: 5,
        subagentId: 'A2',
        task: 'scan api/',
        files: [],
        tools: ['read']
      }
    ] satisfies TimelineEvent[]
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('timelineSubagentGroup', () => {
  it('renders one group with meta and two collapsed trace headers', () => {
    const { container } = render(<Timeline />);

    const groups = container.querySelectorAll('[data-row-kind="subagent-group"]');
    expect(groups).toHaveLength(1);
    expect(container.textContent ?? '').toContain('Delegated');
    expect(container.textContent ?? '').toContain('2 tasks');
    expect(container.querySelectorAll('[data-row-kind="subagent-line"]')).toHaveLength(2);
    expect(container.querySelector('[data-row-kind="delegate-batch"]')).toBeNull();
  });

  it('renders a single-worker group without meta line', async () => {
    await act(async () => {
      useChatStore.setState({
        events: [
          { kind: 'user-prompt', id: 'p1', ts: 1, content: 'solo' },
          {
            kind: 'subagent-pending',
            id: 'sp1',
            ts: 2,
            subagentId: 'S1',
            task: 'only one',
            files: [],
            tools: ['read']
          },
          {
            kind: 'subagent-spawn',
            id: 'ss1',
            ts: 3,
            subagentId: 'S1',
            task: 'only one',
            files: [],
            tools: ['read']
          }
        ],
        subagents: {
          S1: {
            id: 'S1',
            task: 'only one',
            files: [],
            missingFiles: [],
            tools: ['read'],
            status: 'running',
            startedAt: 1,
            steps: [],
            fileEdits: [],
            assistantTexts: {},
            reasoningTexts: {},
            iterationOrder: [],
            partialToolCallArgs: {}
          }
        }
      });
    });

    const { container } = render(<Timeline />);
    const group = container.querySelector('[data-row-kind="subagent-group"]');
    expect(group).not.toBeNull();
    expect(group!.textContent ?? '').not.toContain('Delegated');
    expect(container.textContent ?? '').toContain('only one');
    expect(container.querySelectorAll('[data-row-kind="subagent-line"]')).toHaveLength(1);
  });
});
