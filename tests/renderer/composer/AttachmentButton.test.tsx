/**
 * `AttachmentButton` — opens the system file dialog for external files.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentButton } from '@renderer/components/composer/AttachmentButton';

describe('AttachmentButton', () => {
  it('opens the computer file picker on click', async () => {
    const onPickFromComputer = vi.fn();
    render(
      <AttachmentButton onPickFromComputer={onPickFromComputer} />
    );
    await userEvent.click(screen.getByRole('button', { name: /from computer/i }));
    expect(onPickFromComputer).toHaveBeenCalledOnce();
  });

  it('is disabled when attach is unavailable', () => {
    render(<AttachmentButton onPickFromComputer={() => {}} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
