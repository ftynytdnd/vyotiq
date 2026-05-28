/**
 * TimelineDividerRow — gold headline for persisted Exploring dividers.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TimelineDividerRow } from '@renderer/components/timeline/rows/TimelineDividerRow';

describe('TimelineDividerRow', () => {
  it('renders Exploring phase dividers with gold headline', () => {
    const { container } = render(<TimelineDividerRow label="Exploring" variant="phase" />);
    expect(container.textContent ?? '').toContain('Exploring');
    expect(container.innerHTML).toContain('text-accent-gold');
  });

  it('keeps non-exploring phase labels muted', () => {
    const { container } = render(
      <TimelineDividerRow label="Delegating 2 sub-tasks" variant="phase" />
    );
    expect(container.innerHTML).toContain('text-text-muted');
    expect(container.innerHTML).not.toContain('text-accent-gold-strong');
  });

  it('renders no horizontal hairline rules around the label (May 2026 restyle)', () => {
    // The earlier hairline+label+hairline interstitial fragmented the
    // reading column. Both phase and run-complete variants now render
    // the centered label only.
    const { container: phase } = render(
      <TimelineDividerRow label="Exploring" variant="phase" />
    );
    expect(phase.innerHTML).not.toMatch(/h-px[^"]*flex-1[^"]*bg-border-divider/);

    const { container: rc } = render(
      <TimelineDividerRow label="Run complete" variant="run-complete" />
    );
    expect(rc.innerHTML).not.toMatch(/h-px[^"]*flex-1[^"]*bg-border-divider/);
  });
});
