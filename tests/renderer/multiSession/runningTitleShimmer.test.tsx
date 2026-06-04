/**
 * `RunningTitle` toggles the existing `vyotiq-shimmer-text` utility
 * when the conversation's slice is processing. When idle, no shimmer
 * class is applied.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useChatStore } from '@renderer/store/useChatStore';
import { RunningTitle } from '@renderer/components/runIndicators/RunningTitle';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('RunningTitle', () => {
  it('renders without shimmer when slice is idle', () => {
    const { container } = render(<RunningTitle id="conv-A" title="Idle chat" />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.className).not.toContain('vyotiq-shimmer-text');
    expect(span!.textContent).toBe('Idle chat');
  });

  it('applies vyotiq-shimmer-text + a per-instance shimmer-offset when processing', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { container } = render(<RunningTitle id="conv-A" title="Live chat" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('vyotiq-shimmer-text');
    // The inline style sets the per-instance phase offset CSS variable.
    expect(span.getAttribute('style') ?? '').toMatch(/--shimmer-offset:\s*-\d+ms/);
  });

  it('preserves caller-provided extra classes alongside the shimmer utility', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { container } = render(
      <RunningTitle id="conv-A" title="Live" className="text-text-primary" />
    );
    const span = container.querySelector('span')!;
    expect(span.className).toContain('vyotiq-shimmer-text');
    expect(span.className).toContain('text-text-primary');
    expect(span.className).toContain('truncate');
  });
});
