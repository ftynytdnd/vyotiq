import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunCompleteRow } from '@renderer/components/timeline/rows/RunCompleteRow';

describe('RunCompleteRow', () => {
  it('includes edit and file stats when provided', () => {
    render(
      <RunCompleteRow promptId="p1" durationMs={12_400} completedAt={1_700_000_000_000} editCount={5} fileCount={3} />
    );
    expect(screen.getByText(/5 edits/i)).toBeInTheDocument();
    expect(screen.getByText(/3 files/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/done in 12s/i)).toBeInTheDocument();
  });

  it('renders without a top hairline rule (May 2026 restyle)', () => {
    const { container } = render(
      <RunCompleteRow promptId="p1" durationMs={1_000} completedAt={1_700_000_000_000} editCount={1} fileCount={1} />
    );
    const row = container.querySelector('[data-row-kind="run-complete"]');
    expect(row).not.toBeNull();
    expect(row?.className ?? '').not.toMatch(/border-t/);
  });

  it('lays out duration, tokens, and time on a horizontal flex row', () => {
    const { container } = render(
      <RunCompleteRow
        promptId="p1"
        durationMs={10_000}
        completedAt={1_700_000_000_000}
        usage={{
          cumulative: { totalTokens: 38_300, promptTokens: 20_000, completionTokens: 18_300 },
          latest: { promptTokens: 20_000, completionTokens: 18_300, totalTokens: 38_300 },
          peak: { promptTokens: 20_000, completionTokens: 18_300, totalTokens: 38_300 },
          samples: 1
        }}
      />
    );
    const row = container.querySelector('[data-row-kind="run-complete"]');
    expect(row).not.toBeNull();
    expect(row?.className ?? '').toMatch(/flex-row/);
    expect(row?.className ?? '').not.toMatch(/\bflex-col\b/);
    const text = row?.textContent ?? '';
    expect(text).toMatch(/done in/i);
    expect(text).toMatch(/38\.3k/i);
    expect(text.indexOf('done in')).toBeLessThan(text.search(/38\.3k/i));
  });

  it('uses warning tone for very long turn durations', () => {
    const { container } = render(
      <RunCompleteRow promptId="p1" durationMs={500_000} completedAt={1_700_000_000_000} />
    );
    const duration = container.querySelector('.text-warning');
    expect(duration?.textContent ?? '').toMatch(/8m/);
    expect(duration?.getAttribute('title') ?? '').toMatch(/unusually long/i);
  });
});
