/**
 * DelegateBatchRow — V5 tool-like delegate batch line.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { DelegateBatchRow } from '@renderer/components/timeline/delegation/DelegateBatchRow';
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
    subagents: {}
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

describe('DelegateBatchRow', () => {
  it('renders a tool-like delegate summary line', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: makeSnap('A1', 'task one'),
          A2: makeSnap('A2', 'task two', 'done')
        }
      });
    });

    const { container } = render(
      <DelegateBatchRow rowKey="delegate:A1:A2" subagentIds={['A1', 'A2']} />
    );

    expect(container.textContent ?? '').toContain('Delegated');
    expect(container.textContent ?? '').toContain('2 tasks');
    expect(container.textContent ?? '').toContain('1 running');
    expect(container.textContent ?? '').toContain('1 done');
  });

  it('auto-expands while workers are live and shows nested roster', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: makeSnap('A1', 'worker alpha'),
          A2: makeSnap('A2', 'worker beta')
        }
      });
    });

    const { container } = render(
      <DelegateBatchRow rowKey="delegate:A1:A2" subagentIds={['A1', 'A2']} />
    );

    expect(container.textContent ?? '').toContain('worker alpha');
    expect(container.textContent ?? '').toContain('worker beta');
  });

  it('toggles roster visibility when batch is idle', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: makeSnap('A1', 'done one', 'done'),
          A2: makeSnap('A2', 'done two', 'done')
        }
      });
    });

    const { container } = render(
      <DelegateBatchRow rowKey="delegate:A1:A2" subagentIds={['A1', 'A2']} />
    );

    expect(container.textContent ?? '').not.toContain('done one');

    const headerBtn = container.querySelector('[data-row-kind="delegate-batch"] button');
    expect(headerBtn).not.toBeNull();
    fireEvent.click(headerBtn!);

    expect(container.textContent ?? '').toContain('done one');
    expect(container.textContent ?? '').toContain('done two');
  });

  it('auto-expands when a done worker still has an in-flight report diff', async () => {
    const reportBody = '<html>\n<body>Survey</body>\n</html>';
    await act(async () => {
      useChatStore.setState({
        subagents: {
          A1: {
            ...makeSnap('A1', 'done one', 'done'),
            partialToolCallArgs: {
              'c-report': {
                callId: 'c-report',
                name: 'report',
                index: 0,
                argsBuf: JSON.stringify({ title: 'Survey', body: reportBody }),
                parsed: { title: 'Survey', body: reportBody },
                ts: 2,
                diffStream: {
                  tool: 'report',
                  filePath: '.vyotiq/reports/survey-preview.html',
                  hunks: [
                    {
                      oldStart: 1,
                      newStart: 1,
                      lines: [{ kind: '+', text: '<html>' }]
                    }
                  ],
                  additions: 1,
                  deletions: 0,
                  settled: false,
                  ts: 2
                }
              }
            }
          },
          A2: makeSnap('A2', 'done two', 'done')
        }
      });
    });

    const { container } = render(
      <DelegateBatchRow rowKey="delegate:A1:A2" subagentIds={['A1', 'A2']} />
    );

    const batchBtn = container.querySelector('[data-row-kind="delegate-batch"] button');
    expect(batchBtn!.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent ?? '').toContain('Survey');
  });
});
