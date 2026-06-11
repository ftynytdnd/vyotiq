/**
 * TurnStickyFooter — live telemetry + sticky footer shell.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TurnStickyFooter } from '@renderer/components/timeline/shared/TurnStickyFooter.js';
import { useChatStore } from '@renderer/store/useChatStore.js';

describe('TurnStickyFooter', () => {
  it('shows running elapsed while live and processing', () => {
    useChatStore.setState({
      isProcessing: true,
      events: [
        {
          kind: 'user-prompt',
          id: 'p1',
          ts: Date.now() - 5000,
          content: 'hi',
          runId: 'r1'
        }
      ]
    } as never);

    render(
      <TurnStickyFooter live promptId="p1">
        <div>footer child</div>
      </TurnStickyFooter>
    );

    expect(
      screen.getByText(/Running|Exploring|Writing|Thinking|Waiting|Connecting|Reading|Editing/)
    ).toBeTruthy();
    expect(screen.getByText('footer child')).toBeTruthy();
  });

  it('hides live bar when not processing', () => {
    useChatStore.setState({
      isProcessing: false,
      events: [
        {
          kind: 'user-prompt',
          id: 'p1',
          ts: Date.now() - 5000,
          content: 'hi',
          runId: 'r1'
        }
      ]
    } as never);

    render(
      <TurnStickyFooter live promptId="p1">
        <div>done</div>
      </TurnStickyFooter>
    );

    expect(screen.queryByText(/Running/)).toBeNull();
    expect(screen.getByText('done')).toBeTruthy();
  });
});
