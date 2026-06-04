/**
 * PhaseLogRow — subtle persisted phase meta lines in wire order.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PhaseLogRow } from '@renderer/components/timeline/rows/PhaseLogRow';

describe('PhaseLogRow', () => {
  it('renders Exploring labels with gold headline styling', () => {
    const { container } = render(<PhaseLogRow label="Exploring" />);
    expect(container.textContent ?? '').toContain('Exploring');
    expect(container.innerHTML).toContain('vx-timeline-phase');
  });

  it('keeps non-exploring phase labels muted', () => {
    const { container } = render(
      <PhaseLogRow label="Delegating 2 sub-tasks" tooltip="raw detail" />
    );
    expect(container.innerHTML).toContain('vx-caption');
    expect(container.innerHTML).not.toContain('vx-timeline-phase-live');
    expect(container.querySelector('[title="raw detail"]')).not.toBeNull();
  });

  it('renders as a plain meta row without divider hairlines', () => {
    const { container } = render(<PhaseLogRow label="Run complete" />);
    expect(container.innerHTML).not.toMatch(/h-px[^"]*flex-1[^"]*bg-border-divider/);
    expect(container.querySelector('[data-row-kind="phase"]')).not.toBeNull();
  });
});
