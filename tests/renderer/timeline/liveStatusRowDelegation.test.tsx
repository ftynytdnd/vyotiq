/**
 * LiveStatusRow — visibility during sub-agent runs and delegating click.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { LiveStatusRow } from '@renderer/components/timeline/rows/LiveStatusRow';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';

beforeEach(() => {
  useChatStore.setState({
    isProcessing: false,
    runStartedAt: null,
    conversationId: 'c-test',
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    latestOrchestratorRunStatus: undefined,
    orchestratorUsage: undefined
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

describe('LiveStatusRow — sub-agent delegation UX', () => {
  it('stays visible while sub-agents run and orchestrator streams text', async () => {
    await act(async () => {
      useChatStore.setState({
        isProcessing: true,
        runStartedAt: Date.now(),
        subagents: {
          S1: {
            id: 'S1',
            task: 'work',
            files: [],
            missingFiles: [],
            tools: [],
            status: 'running',
            startedAt: 1,
            steps: [],
            fileEdits: [],
            assistantTexts: {
              t1: { id: 't1', text: 'streaming', done: false, startedAt: Date.now() }
            },
            reasoningTexts: {},
            iterationOrder: [],
            partialToolCallArgs: {}
          }
        },
        assistantTexts: {
          orch: { done: false, text: 'hello', startedAt: Date.now() }
        }
      });
    });
    const { container } = render(<LiveStatusRow />);
    expect(container.innerHTML).not.toBe('');
    expect(container.innerHTML).toContain('Streaming response');
    expect(container.innerHTML).toContain('text-accent-gold');
  });

  it('uses the same Thinking label for live reasoning as the inline reasoning row', async () => {
    await act(async () => {
      useChatStore.setState({
        isProcessing: true,
        runStartedAt: Date.now(),
        assistantTexts: {},
        reasoningTexts: {
          orch: { id: 'orch', done: false, text: 'planning', startedAt: Date.now() }
        }
      });
    });

    const { container } = render(<LiveStatusRow />);

    expect(container.textContent ?? '').toContain('Thinking');
    expect(container.textContent ?? '').not.toContain('Reasoning');
  });

  it('delegating phase click expands and scrolls to latest sub-agent row', async () => {
    const scrollIntoView = vi.fn();
    const setExpanded = vi.fn();
    useTimelineUiStore.setState({ setExpanded });

    await act(async () => {
      useChatStore.setState({
        isProcessing: true,
        runStartedAt: Date.now(),
        subagents: {
          S1: {
            id: 'S1',
            task: 'work',
            files: [],
            missingFiles: [],
            tools: [],
            status: 'running',
            startedAt: 1,
            steps: [],
            fileEdits: [],
            assistantTexts: {},
            reasoningTexts: {},
            iterationOrder: [],
            partialToolCallArgs: {}
          }
        },
        latestOrchestratorRunStatus: {
          kind: 'run-status',
          id: 'rs1',
          ts: 100,
          phase: 'delegating',
          label: 'Delegating to sub-agents…'
        }
      });
    });

    const target = document.createElement('div');
    target.setAttribute('data-subagent-id', 'S1');
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    const { container } = render(<LiveStatusRow />);
    const btn = container.querySelector('button[aria-label="Scroll to latest sub-agent"]');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);

    expect(setExpanded).toHaveBeenCalledWith('c-test', 'sub:S1', true);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(scrollIntoView).toHaveBeenCalled();

    target.remove();
  });

  it('shows batch stats in delegating label', async () => {
    await act(async () => {
      useChatStore.setState({
        isProcessing: true,
        runStartedAt: Date.now(),
        subagents: {
          S1: {
            id: 'S1',
            task: 'work',
            files: [],
            missingFiles: [],
            tools: [],
            status: 'running',
            startedAt: 1,
            steps: [],
            fileEdits: [],
            assistantTexts: {},
            reasoningTexts: {},
            iterationOrder: [],
            partialToolCallArgs: {}
          }
        },
        latestOrchestratorRunStatus: {
          kind: 'run-status',
          id: 'rs1',
          ts: 100,
          phase: 'delegating',
          label: 'Delegating to sub-agents…'
        }
      });
    });

    const { container } = render(<LiveStatusRow />);
    expect(container.textContent ?? '').toContain('1 running');
  });
});
