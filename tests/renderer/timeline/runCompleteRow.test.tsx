import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunCompleteRow } from '@renderer/components/timeline/rows/RunCompleteRow';

describe('RunCompleteRow', () => {
  it('includes edit and file stats when provided', () => {
    render(
      <RunCompleteRow durationMs={12_400} completedAt={1_700_000_000_000} editCount={5} fileCount={3} />
    );
    expect(screen.getByText(/5 edits/i)).toBeInTheDocument();
    expect(screen.getByText(/3 files/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/completed in 12s/i)).toBeInTheDocument();
  });

  it('renders without a top hairline rule (May 2026 restyle)', () => {
    const { container } = render(
      <RunCompleteRow durationMs={1_000} completedAt={1_700_000_000_000} editCount={1} fileCount={1} />
    );
    const row = container.querySelector('[data-row-kind="run-complete"]');
    expect(row).not.toBeNull();
    expect(row?.className ?? '').not.toMatch(/border-t/);
  });
});
