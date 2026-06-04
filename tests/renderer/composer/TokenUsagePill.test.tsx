/**
 * `TokenUsagePill` — run usage display (prompt / completion split).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenUsagePill } from '@renderer/components/composer/TokenUsagePill';
import type { TokenUsageAggregate } from '@renderer/components/timeline/reducer/types.js';

function aggregate(
  promptTokens: number,
  completionTokens: number
): TokenUsageAggregate {
  const latest = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
  return { latest, total: latest };
}

describe('TokenUsagePill', () => {
  it('returns null when total is missing', () => {
    const { container } = render(<TokenUsagePill />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when usage is all zeros', () => {
    const { container } = render(<TokenUsagePill total={aggregate(0, 0)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders prompt and completion counts', () => {
    render(
      <TokenUsagePill
        total={aggregate(12_000, 3_400)}
        orchestrator={aggregate(10_000, 2_000)}
      />
    );
    expect(screen.getByText(/12k/)).toBeTruthy();
    expect(screen.getByText(/3\.4k/)).toBeTruthy();
  });

  it('exposes breakdown on title for hover', () => {
    const { container } = render(
      <TokenUsagePill
        total={aggregate(500, 100)}
        orchestrator={aggregate(400, 80)}
      />
    );
    const pill = container.querySelector('.vx-composer-token-pill');
    expect(pill?.getAttribute('title')).toMatch(/Prompt:/);
    expect(pill?.getAttribute('title')).toMatch(/Orchestrator:/);
  });
});
