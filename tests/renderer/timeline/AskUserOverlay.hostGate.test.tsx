import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserOverlay } from '@renderer/components/timeline/askUser/AskUserOverlay';

describe('AskUserOverlay host report gate', () => {
  it('shows Vyotiq badge and token note for host-report-gate', () => {
    render(
      <AskUserOverlay
        pending={{
          kind: 'ask-user-prompt',
          id: 'p1',
          ts: 1,
          displayText: 'Generate?',
          payload: {
            title: 'Generate HTML report?',
            questions: [
              {
                id: 'q1',
                prompt: 'Generate?',
                options: [
                  { id: 'yes', label: 'Yes' },
                  { id: 'no', label: 'No' }
                ]
              }
            ]
          },
          toolCallId: 'tc1',
          runId: 'r1',
          source: 'host-report-gate'
        }}
      />
    );

    expect(screen.getByText('Vyotiq')).toBeInTheDocument();
    expect(screen.getByText(/Uses agent tokens only if you choose Yes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.queryByText('1Q')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});
