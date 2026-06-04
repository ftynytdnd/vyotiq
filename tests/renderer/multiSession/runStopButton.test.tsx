/**
 * `RunStopButton` invokes `useChatStore.abortRun(runId)` on click and
 * carries an accessible label.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useChatStore } from '@renderer/store/useChatStore';
import { RunStopButton } from '@renderer/components/runIndicators/RunStopButton';

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

describe('RunStopButton', () => {
  it('calls abortRun with the supplied runId on click', () => {
    const abortSpy = vi.fn(async () => undefined);
    useChatStore.setState({ abortRun: abortSpy } as never);

    render(<RunStopButton runId="run-A" conversationTitle="Live chat" />);
    const button = screen.getByRole('button', { name: /stop run in live chat/i });
    fireEvent.click(button);

    expect(abortSpy).toHaveBeenCalledWith('run-A');
  });

  it('stops event propagation so the row\'s click handler does not fire', () => {
    const abortSpy = vi.fn(async () => undefined);
    useChatStore.setState({ abortRun: abortSpy } as never);
    const rowOnClick = vi.fn();

    render(
      <div onClick={rowOnClick} role="presentation">
        <RunStopButton runId="run-A" conversationTitle="Chat" />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /stop run in chat/i }));

    expect(abortSpy).toHaveBeenCalled();
    expect(rowOnClick).not.toHaveBeenCalled();
  });

  it('renders a Stop (square) glyph, not a Trash one', () => {
    const { container } = render(
      <RunStopButton runId="run-A" conversationTitle="Chat" />
    );
    // lucide-react Square renders an svg with an embedded rect.
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelector('rect')).not.toBeNull();
  });
});
