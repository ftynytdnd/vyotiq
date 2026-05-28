/**
 * PendingEntryDot — timeline indicator for pending checkpoint rows.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingEntryDot } from '@renderer/components/checkpoints/shared/PendingEntryDot';

describe('PendingEntryDot', () => {
  it('exposes an accessible label', () => {
    render(<PendingEntryDot />);
    expect(screen.getByLabelText(/awaiting review in pending changes/i)).toBeTruthy();
  });
});
