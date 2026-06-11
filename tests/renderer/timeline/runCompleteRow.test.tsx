import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunCompleteRow } from '@renderer/components/timeline/rows/RunCompleteRow';

describe('RunCompleteRow', () => {
  it('includes edit, file, and command stats when provided', () => {
    render(
      <RunCompleteRow
        promptId="p1"
        durationMs={12_400}
        completedAt={1_700_000_000_000}
        editCount={5}
        fileCount={3}
        commandCount={2}
      />
    );
    expect(screen.getByText(/5 edits/i)).toBeInTheDocument();
    expect(screen.getByText(/3 files/i)).toBeInTheDocument();
    expect(screen.getByText(/2 commands/i)).toBeInTheDocument();
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

  it('shows cached and cache-write token counts when present', () => {
    const { container } = render(
      <RunCompleteRow
        promptId="p1"
        durationMs={5_000}
        completedAt={1_700_000_000_000}
        usage={{
          cumulative: {
            totalTokens: 50_000,
            promptTokens: 40_000,
            completionTokens: 10_000,
            cachedPromptTokens: 32_000,
            cacheCreationTokens: 8_000
          },
          latest: {
            totalTokens: 50_000,
            promptTokens: 40_000,
            completionTokens: 10_000,
            cachedPromptTokens: 32_000,
            cacheCreationTokens: 8_000
          },
          peak: {
            totalTokens: 50_000,
            promptTokens: 40_000,
            completionTokens: 10_000,
            cachedPromptTokens: 32_000,
            cacheCreationTokens: 8_000
          },
          samples: 2
        }}
      />
    );
    const text = container.querySelector('[data-row-kind="run-complete"]')?.textContent ?? '';
    expect(text).toMatch(/32k.*cached/i);
    expect(text).toMatch(/8k.*cache write/i);
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
