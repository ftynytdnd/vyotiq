/**
 * Review-mode diff line pick — click sets highlight and fires onPick.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiffHunk } from '@shared/types/tool.js';
import { EditDiffView } from '@renderer/components/timeline/tools/edit/EditDiffView.js';

const hunks: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: ' ', text: 'unchanged' },
      { kind: '+', text: 'added' }
    ]
  }
];

describe('EditDiffView linePick', () => {
  it('calls onPick with new line number when a row is clicked', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();

    render(
      <EditDiffView
        hunks={hunks}
        variant="authoritative"
        linePick={{ highlightLine: null, onPick }}
      />
    );

    const addedRow = screen.getByRole('button', { name: /added/i });
    await user.click(addedRow);

    expect(onPick).toHaveBeenCalledWith(2);
  });
});
