/**
 * TurnActivitySummary — collapsed one-line summary after run (§6 / Phase 6).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TurnActivitySummary } from '@renderer/components/timeline/activity/TurnActivitySummary';
import { useChatStore } from '@renderer/store/useChatStore';
import type { DisplayRow } from '@renderer/components/timeline/shared/projectSubagentRows';

const activityRows: DisplayRow[] = [
  { kind: 'agent-thought', key: 't1', content: 'Scan repository' },
  { kind: 'agent-thought', key: 't2', content: 'Apply fixes' }
];

beforeEach(() => {
  useChatStore.setState({
    isProcessing: false,
    latestOrchestratorRunStatus: undefined
  });
});

describe('TurnActivitySummary', () => {
  it('renders a collapsed one-line summary when the turn is not live', () => {
    render(<TurnActivitySummary activityRows={activityRows} live={false} />);

    const summary = screen.getByRole('button', { expanded: false });
    expect(summary.textContent).toMatch(/2 steps · Apply fixes/);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('expands to the step list on click after the run', async () => {
    render(<TurnActivitySummary activityRows={activityRows} live={false} />);

    await userEvent.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText('Scan repository')).toBeTruthy();
    expect(screen.getByText('Apply fixes')).toBeTruthy();
  });

  it('shows live steps while processing', () => {
    useChatStore.setState({ isProcessing: true });
    render(<TurnActivitySummary activityRows={activityRows} live />);

    expect(screen.getByText('Scan repository')).toBeTruthy();
    expect(screen.getByText('Apply fixes')).toBeTruthy();
  });

  it('shows Starting… instead of the raw awaiting-response label', () => {
    useChatStore.setState({
      isProcessing: true,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        phase: 'awaiting-response',
        label: 'Awaiting first token from gemma4:31b…',
        ts: Date.now()
      } as never
    });
    render(<TurnActivitySummary activityRows={[]} live />);

    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByText(/Awaiting first token/i)).toBeNull();
  });

  it('hides Starting… once assistant text begins streaming', () => {
    useChatStore.setState({
      isProcessing: true,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        phase: 'streaming-text',
        label: 'Streaming response…',
        ts: Date.now()
      } as never
    });
    render(<TurnActivitySummary activityRows={[]} live />);

    expect(screen.queryByText('Starting…')).toBeNull();
  });
});
