/**
 * ComposerStatusStrip — ask-user reply hint and mid-run guidance.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { useChatStore } from '@renderer/store/useChatStore';
import { useProviderAccountStore } from '@renderer/store/useProviderAccountStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    isProcessing: false,
    orchestratorUsage: undefined,
    events: []
  });
  useProviderStore.setState({ providers: [] });
  useProviderAccountStore.setState({ snapshots: {} });
});

describe('ComposerStatusStrip', () => {
  it('renders nothing when idle with no ask-user or cache hint', () => {
    useChatStore.setState({
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }]
    });

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
  });

  it('shows ask-user hint when pending inline', () => {
    render(
      <ComposerStatusStrip
        pendingAskUser={{
          kind: 'ask-user-prompt',
          id: 'q1',
          ts: 1,
          status: 'pending',
          displayText: 'Q',
          toolCallId: 'tc-1',
          runId: 'run-1',
          payload: {
            title: 'Choose one',
            questions: [{ id: 'q1', prompt: 'Q', options: [{ id: 'a', label: 'A' }] }]
          }
        }}
      />
    );

    expect(screen.getByText(/Reply needed/i)).toBeInTheDocument();
    expect(screen.getByText(/"Choose one"/i)).toBeInTheDocument();
    expect(screen.getByText(/Submit answers/i)).toBeInTheDocument();
  });

  it('shows only Reply needed when overlay handles the form', () => {
    render(
      <ComposerStatusStrip
        pendingAskUser={{
          kind: 'ask-user-prompt',
          id: 'q1',
          ts: 1,
          status: 'pending',
          displayText: 'Q',
          toolCallId: 'tc-1',
          runId: 'run-1',
          payload: {
            title: 'Refinement',
            questions: [
              { id: 'q1', prompt: 'Q1', options: [{ id: 'a', label: 'A' }] },
              { id: 'q2', prompt: 'Q2', options: [{ id: 'b', label: 'B' }] },
              { id: 'q3', prompt: 'Q3', options: [{ id: 'c', label: 'C' }] }
            ]
          }
        }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Reply needed');
    expect(screen.queryByText(/prompt below/i)).toBeNull();
  });

  it('shows mid-run Send/Queue guidance when processingRun is set', () => {
    render(<ComposerStatusStrip processingRun />);
    const hint = screen.getByRole('status', { name: /Send steers mid-run/i });
    expect(hint).toHaveAttribute('title', 'Send steers mid-run · Queue before finish');
    expect(hint).toHaveTextContent('Send steers mid-run · Queue before finish');
  });

  it('shows vision warning when images may not be analyzed', () => {
    render(<ComposerStatusStrip visionWarning />);
    expect(
      screen.getByText(/Model may not support vision/i)
    ).toBeInTheDocument();
  });

  it('hides healthy claude-code-proxy status in the composer', () => {
    useProviderStore.setState({
      providers: [
        {
          id: 'ccp',
          name: 'Claude Code Proxy',
          baseUrl: 'http://127.0.0.1:18765/v1',
          apiKey: 'cursor-proxy',
          notes: 'claude-code-proxy'
        }
      ]
    });
    useProviderAccountStore.setState({
      snapshots: {
        ccp: {
          providerId: 'ccp',
          fetchedAt: Date.now(),
          status: 'ok',
          hostKind: 'claude-code-proxy',
          message: 'claude-code-proxy 0.0.21 · healthy · auth until 20 Aug 2026'
        }
      }
    });

    const { container } = render(
      <ComposerStatusStrip model={{ providerId: 'ccp', modelId: 'cursor-composer-2.5-fast' }} />
    );
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
    expect(screen.queryByText(/claude-code-proxy/i)).toBeNull();
  });

  it('shows claude-code-proxy offline warning in the composer', () => {
    useProviderStore.setState({
      providers: [
        {
          id: 'ccp',
          name: 'Claude Code Proxy',
          baseUrl: 'http://127.0.0.1:18765/v1',
          apiKey: 'cursor-proxy',
          notes: 'claude-code-proxy'
        }
      ]
    });
    useProviderAccountStore.setState({
      snapshots: {
        ccp: {
          providerId: 'ccp',
          fetchedAt: Date.now(),
          status: 'error',
          hostKind: 'claude-code-proxy',
          message: 'Local proxy offline — run ccp start'
        }
      }
    });

    render(<ComposerStatusStrip model={{ providerId: 'ccp', modelId: 'cursor-composer-2.5-fast' }} />);
    expect(screen.getByText(/Local proxy offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/Task Scheduler/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Start proxy/i })).toBeInTheDocument();
  });

  it('does not show run phase labels', () => {
    useChatStore.setState({
      isProcessing: true,
      runStartedAt: Date.now() - 5000,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: Date.now(),
        phase: 'running-tool',
        label: 'Running tool',
        detail: { toolName: 'read' }
      }
    } as never);

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
    expect(screen.queryByText(/Exploring/i)).toBeNull();
  });
});
