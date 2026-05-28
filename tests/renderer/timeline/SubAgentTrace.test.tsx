/**
 * SubAgentTrace — inline timeline sub-agent rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { SubAgentTrace } from '@renderer/components/timeline/subagent/SubAgentTrace';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function makeSnap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'S1',
    task: 'analyze providers/',
    files: [],
    missingFiles: [],
    tools: ['read'],
    unknownTools: [],
    status: 'running',
    startedAt: 1,
    steps: [{ callId: 'c1', call: { id: 'c1', name: 'read', args: { path: 'x' } }, startedAt: 1 }],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...overrides
  };
}

beforeEach(() => {
  useChatStore.setState({
    conversationId: 'c-test',
    subagents: {},
    orchestratorUsage: undefined
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

describe('SubAgentTrace — inline timeline', () => {
  it('renders delegated task in the timeline row', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          S1: makeSnap({ id: 'S1', task: 'first task' }),
          S2: makeSnap({ id: 'S2', task: 'second task', startedAt: 2 })
        }
      });
    });
    const { container: c1 } = render(<SubAgentTrace subagentId="S1" />);
    const { container: c2 } = render(<SubAgentTrace subagentId="S2" />);
    expect(c1.textContent ?? '').toContain('first task');
    expect(c2.textContent ?? '').toContain('second task');
  });

  it('expands inline detail tabs on row click', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          S1: makeSnap({
            id: 'S1',
            task: 'expand me',
            iterationOrder: ['iter-1'],
            reasoningTexts: {
              'iter-1': { id: 'iter-1', text: 'thinking', done: true, startedAt: 10, endedAt: 20 }
            }
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="S1" />);

    expect(container.textContent ?? '').not.toContain('Thought for');

    const rowBtn = container.querySelector('[data-row-kind="subagent-line"] button');
    expect(rowBtn).not.toBeNull();
    fireEvent.click(rowBtn!);

    expect(container.textContent ?? '').toContain('expand me');
    expect(container.textContent ?? '').toContain('Thought for');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens focus modal from the focus action button', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          S1: makeSnap({
            id: 'S1',
            task: 'focus me',
            output: '<result><status>success</status></result>'
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="S1" />);

    const focusBtn = container.querySelector('button[title="Open in focus mode"]');
    expect(focusBtn).not.toBeNull();
    fireEvent.click(focusBtn!);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent ?? '').toContain('focus me');
    expect(dialog?.textContent ?? '').toContain('Sub-agent S1');
  });

  it('marks the row with data attributes for scroll targeting', async () => {
    await act(async () => {
      useChatStore.setState({ subagents: { S1: makeSnap({ id: 'S1' }) } });
    });
    const { container } = render(<SubAgentTrace subagentId="S1" />);
    const row = container.querySelector('[data-row-kind="subagent-line"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-subagent-id')).toBe('S1');
  });

  it('renders a dot prefix on every row (running and settled)', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          R1: makeSnap({ id: 'R1', task: 'live one', status: 'running' }),
          D1: makeSnap({ id: 'D1', task: 'settled one', status: 'done', endedAt: 1_000 })
        }
      });
    });
    const { container: live } = render(<SubAgentTrace subagentId="R1" />);
    const { container: done } = render(<SubAgentTrace subagentId="D1" />);

    // Running → gold-strong dot tone; settled → muted dot tone.
    expect(live.innerHTML).toMatch(/h-1\.5[^"]*w-1\.5[^"]*rounded-full/);
    expect(live.innerHTML).toMatch(/bg-accent-gold-strong/);
    expect(done.innerHTML).toMatch(/h-1\.5[^"]*w-1\.5[^"]*rounded-full/);
    expect(done.innerHTML).toMatch(/bg-text-muted/);
  });

  it('shows a right-floated model badge when snap.model is populated', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          M1: makeSnap({
            id: 'M1',
            task: 'with model',
            model: { providerId: 'openai', modelId: 'gpt-test' }
          }),
          M2: makeSnap({ id: 'M2', task: 'no model' })
        }
      });
    });
    const { container: withModel } = render(<SubAgentTrace subagentId="M1" />);
    const { container: noModel } = render(<SubAgentTrace subagentId="M2" />);

    expect(withModel.querySelector('[aria-label="Model gpt-test"]')).not.toBeNull();
    expect(noModel.querySelector('[aria-label^="Model"]')).toBeNull();
  });

  it('falls back to liveStatus.label when no tool / stream is in flight', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          // `steps: []` and no open accumulators so liveStatus is the
          // only signal left. This pins the regression behaviour for
          // the legitimate `connecting` / `awaiting-response` /
          // `retrying` windows where nothing concrete is streaming yet.
          L1: makeSnap({
            id: 'L1',
            task: 'awaiting first token',
            status: 'running',
            steps: [],
            liveStatus: {
              phase: 'awaiting-response',
              label: 'Awaiting first token from gpt-test\u2026',
              ts: 100
            }
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="L1" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent ?? '').toBe(
      'Awaiting first token from gpt-test\u2026'
    );
  });

  it('renders the in-flight tool action when a step has no result yet', async () => {
    // Worker has a live `read` step open and the orchestrator emitted
    // its generic `Exploring` liveStatus. The new resolver MUST surface
    // the concrete tool action ahead of the bare phase label.
    await act(async () => {
      useChatStore.setState({
        subagents: {
          T1: makeSnap({
            id: 'T1',
            task: 'live tool',
            status: 'running',
            steps: [
              {
                callId: 'c1',
                call: {
                  id: 'c1',
                  name: 'read',
                  args: { path: 'src/main/orchestrator/loop/runLoop.ts' }
                },
                startedAt: 1
              }
            ],
            liveStatus: { phase: 'running-tool', label: 'Exploring', ts: 200 }
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="T1" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle?.textContent ?? '').toBe('Reading runLoop.ts');
  });

  it('prefers a partialToolCallArgs entry over an older settled step', async () => {
    // The bash command is still streaming in via partial args while
    // the previous read step has already settled. The latest in-flight
    // call wins.
    await act(async () => {
      useChatStore.setState({
        subagents: {
          T2: makeSnap({
            id: 'T2',
            task: 'partial args',
            status: 'running',
            steps: [
              {
                callId: 'c1',
                call: { id: 'c1', name: 'read', args: { path: 'README.md' } },
                result: {
                  id: 'c1',
                  name: 'read',
                  ok: true,
                  data: { tool: 'read', path: 'README.md', content: '' }
                },
                startedAt: 1,
                endedAt: 2
              }
            ],
            partialToolCallArgs: {
              c2: {
                callId: 'c2',
                name: 'bash',
                index: 1,
                argsBuf: '',
                parsed: { command: 'npm   test --silent' },
                ts: 300
              }
            }
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="T2" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle?.textContent ?? '').toBe(
      'Running bash \u00b7 npm test --silent'
    );
  });

  it('surfaces the trailing sentence of a streaming reasoning accumulator', async () => {
    // No partial args and no open step (steps cleared) — only an open
    // reasoning accumulator. The subtitle should end with the latest
    // sentence rather than the stale `Awaiting first token` liveStatus.
    await act(async () => {
      useChatStore.setState({
        subagents: {
          R1: makeSnap({
            id: 'R1',
            task: 'streaming reasoning',
            status: 'running',
            steps: [],
            iterationOrder: ['iter-1'],
            reasoningTexts: {
              'iter-1': {
                id: 'iter-1',
                text:
                  'Mapping the change set across modules. ' +
                  'Reviewing orchestrator error paths.',
                done: false,
                startedAt: 50
              }
            },
            liveStatus: {
              phase: 'awaiting-response',
              label: 'Awaiting first token from gpt-test\u2026',
              ts: 10
            }
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="R1" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle?.textContent ?? '').toBe('Reviewing orchestrator error paths');
  });

  it('shows the parsed <summary> with `done in Xs` once the worker settles', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          S1: makeSnap({
            id: 'S1',
            task: 'summary worker',
            status: 'done',
            startedAt: 1_000,
            endedAt: 12_000,
            steps: [],
            output:
              '<result><status>success</status>' +
              '<summary>Finished checkpoints security review</summary>' +
              '<details>ok</details></result>'
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="S1" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle?.textContent ?? '').toBe(
      'Finished checkpoints security review \u00b7 done in 11s'
    );
  });

  it('uses snap.message as subtitle once settled with a message', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          F1: makeSnap({
            id: 'F1',
            task: 'failed worker',
            status: 'failed',
            endedAt: 2_500,
            message: 'Tool budget exceeded after 12 calls'
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="F1" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent ?? '').toBe('Tool budget exceeded after 12 calls');
  });

  it('falls back to a quiet "done in Xs" subtitle when settled with no message', async () => {
    await act(async () => {
      useChatStore.setState({
        subagents: {
          Q1: makeSnap({
            id: 'Q1',
            task: 'quiet success',
            status: 'done',
            startedAt: 1_000,
            endedAt: 4_000
          })
        }
      });
    });
    const { container } = render(<SubAgentTrace subagentId="Q1" />);
    const subtitle = container.querySelector('[aria-label="Sub-agent status"]');
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent ?? '').toMatch(/done in 3\.0s/);
  });
});
