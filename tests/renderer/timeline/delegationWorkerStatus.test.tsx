/**
 * Delegation worker status suffixes — failed / running.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DelegationWorker } from '@renderer/components/timeline/delegation/DelegationWorker';
import { DelegationWorkerOutline } from '@renderer/components/timeline/delegation/DelegationWorkerOutline';
import { workerFailureLine } from '@renderer/components/timeline/delegation/DelegationWorkerFailed';
import { workerStatusSuffix } from '@renderer/components/timeline/delegation/delegationHelpers';
import { useChatStore } from '@renderer/store/useChatStore';

describe('workerStatusSuffix', () => {
  it('returns failed for terminal failure statuses', () => {
    expect(workerStatusSuffix('failed')).toBe('failed');
  });

  it('returns running for live workers', () => {
    expect(workerStatusSuffix('running')).toBe('running');
  });

  it('returns partial for partially completed workers', () => {
    expect(workerStatusSuffix('partial')).toBe('partial');
  });
});

describe('workerFailureLine', () => {
  it('prefers snap.message over output', () => {
    expect(
      workerFailureLine({
        message: 'Permission denied.\nMore detail',
        output: 'ignored'
      } as never)
    ).toBe('Permission denied.');
  });
});

describe('DelegationWorker status chrome', () => {
  it('renders nothing for queued workers (summary-only)', () => {
    useChatStore.setState({
      subagents: {
        Q1: {
          id: 'Q1',
          task: 'wait in pool',
          files: [],
          missingFiles: [],
          tools: ['read'],
          status: 'queued',
          startedAt: 1,
          steps: [],
          fileEdits: [],
          assistantTexts: {},
          reasoningTexts: {},
          iterationOrder: [],
          partialToolCallArgs: {}
        }
      }
    } as never);

    const { container } = render(
      <DelegationWorker
        subagentId="Q1"
        rows={[]}
        renderRow={() => null}
      />
    );
    expect(container.querySelector('[data-row-kind="delegation-worker"]')).toBeNull();
  });

  it('renders failed suffix on failed workers', () => {
    useChatStore.setState({
      subagents: {
        A1: {
          id: 'A1',
          task: 'dir',
          files: [],
          missingFiles: [],
          tools: ['bash'],
          status: 'failed',
          startedAt: 1,
          steps: [],
          fileEdits: [],
          assistantTexts: {
            t1: { id: 't1', text: 'Permission denied.', done: true }
          },
          reasoningTexts: {},
          iterationOrder: [],
          partialToolCallArgs: {},
          output: 'Permission denied.'
        }
      }
    } as never);

    const { container } = render(
      <DelegationWorker
        subagentId="A1"
        rows={[
          {
            kind: 'assistant-text',
            key: 'at1',
            id: 't1',
            subagentId: 'A1'
          }
        ]}
        renderRow={() => null}
      />
    );

    const worker = container.querySelector('[data-row-kind="delegation-worker"]');
    expect(worker?.getAttribute('data-worker-status')).toBe('failed');
    expect(container.textContent ?? '').toMatch(/A1.*failed/);
    expect(container.textContent ?? '').toContain('Permission denied');
  });

  it('expands failed worker trace on Show details', async () => {
    useChatStore.setState({
      subagents: {
        A1: {
          id: 'A1',
          task: 'dir',
          files: [],
          missingFiles: [],
          tools: ['bash'],
          status: 'failed',
          startedAt: 1,
          steps: [{ callId: 'c1', startedAt: 1 }],
          fileEdits: [],
          assistantTexts: {},
          reasoningTexts: {},
          iterationOrder: [],
          partialToolCallArgs: {},
          output: 'Permission denied.'
        }
      }
    } as never);

    render(
      <DelegationWorker
        subagentId="A1"
        rows={[
          {
            kind: 'assistant-text',
            key: 'at1',
            id: 't1',
            subagentId: 'A1'
          }
        ]}
        renderRow={() => <span data-testid="thread-row">trace</span>}
      />
    );

    expect(screen.queryByTestId('thread-row')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Show details/i }));
    expect(screen.getByTestId('thread-row')).toBeInTheDocument();
  });

  it('shows model delegate id as the worker tag', () => {
    useChatStore.setState({
      subagents: {
        ui_scan: {
          id: 'ui_scan',
          task: 'Scan UI',
          files: [],
          missingFiles: [],
          tools: ['read'],
          status: 'running',
          startedAt: 2,
          steps: [],
          fileEdits: [],
          assistantTexts: {},
          reasoningTexts: {},
          iterationOrder: [],
          partialToolCallArgs: {}
        }
      }
    } as never);

    const { container } = render(
      <DelegationWorker subagentId="ui_scan" rows={[]} renderRow={() => null} live />
    );

    expect(container.textContent ?? '').toContain('ui_scan');
    expect(container.textContent ?? '').not.toMatch(/\bW1\b/);
  });

  it('de-clutters the worker outline — no scope chips, file pills, or model badge', () => {
    useChatStore.setState({
      subagents: {
        arch: {
          id: 'arch',
          task: 'Review auth',
          files: ['src/auth.ts'],
          missingFiles: ['core/agent.py'],
          unknownTools: ['webfetch'],
          tools: ['read'],
          status: 'partial',
          startedAt: 1,
          steps: [],
          fileEdits: [],
          assistantTexts: {},
          reasoningTexts: {},
          iterationOrder: [],
          partialToolCallArgs: {},
          model: { providerId: 'openai', modelId: 'gpt-4.1-mini' }
        }
      }
    } as never);

    const { container } = render(
      <DelegationWorkerOutline
        snap={useChatStore.getState().subagents.arch!}
      />
    );

    // Chips block is gone entirely.
    expect(container.querySelector('[data-testid="delegation-worker-chips"]')).toBeNull();
    // None of the former chip content leaks into the row.
    expect(container.textContent ?? '').not.toContain('auth.ts');
    expect(container.textContent ?? '').not.toContain('agent.py');
    expect(container.textContent ?? '').not.toContain('webfetch');
    expect(container.textContent ?? '').not.toContain('gpt-4.1-mini');
    // Tag + status remain.
    expect(container.textContent ?? '').toMatch(/arch.*partial/);
    expect(container.innerHTML).toContain('text-warning');
    // Task text still renders.
    expect(container.textContent ?? '').toContain('Review auth');
  });
});
