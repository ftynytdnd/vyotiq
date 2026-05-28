import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { UnifiedDiffBody as DiffViewer } from '@renderer/components/diff/UnifiedDiffBody';
import type { DiffHunk } from '@shared/types/tool';

const HUNKS: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [{ kind: '+', text: 'hello' }]
  }
];

describe('DiffViewer line wrap toggle', () => {
  it('toggles aria-pressed and label on the wrap control', () => {
    const { getByRole } = render(
      <DiffViewer hunks={HUNKS} variant="authoritative" />
    );
    const btn = getByRole('button', { name: /wrap/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.textContent).toMatch(/no wrap/i);
  });
});
