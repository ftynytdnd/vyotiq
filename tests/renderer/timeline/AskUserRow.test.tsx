import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserRow } from '@renderer/components/timeline/rows/AskUserRow.js';

describe('AskUserRow', () => {
  it('renders compact summary without plain-text preview details', () => {
    const { container } = render(
      <AskUserRow
        payload={{
          questions: [
            {
              id: 'q1',
              prompt: 'Pick one',
              options: [{ id: 'a', label: 'Alpha' }]
            }
          ]
        }}
        displayText="Pick one\n  - Alpha (a)"
        promptEventId="prompt-1"
        toolCallId="tc-1"
        runId="run-1"
        status="pending"
      />
    );
    expect(screen.getByText('Clarifying questions')).toBeTruthy();
    expect(screen.getByText(/panel above the composer/i)).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[data-ask-user-overlay]')).toBeNull();
  });
});
