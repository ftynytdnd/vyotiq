import { describe, expect, it, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { JumpToLatestChip } from '@renderer/components/timeline/shared/JumpToLatestChip';

describe('JumpToLatestChip', () => {
  it('calls onClick from the primary Latest control', () => {
    let latest = 0;
    const { getByRole } = render(
      <JumpToLatestChip onClick={() => { latest += 1; }} />
    );
    fireEvent.click(getByRole('button', { name: /latest/i }));
    expect(latest).toBe(1);
  });

  it('exposes a separate top control when onJumpToTop is provided', () => {
    let top = 0;
    const { getByLabelText } = render(
      <JumpToLatestChip onClick={() => {}} onJumpToTop={() => { top += 1; }} />
    );
    fireEvent.click(getByLabelText('Scroll to top'));
    expect(top).toBe(1);
  });
});
