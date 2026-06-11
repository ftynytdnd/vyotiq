import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditDiffView } from '@renderer/components/timeline/tools/edit/EditDiffView';
import type { DiffHunk } from '@shared/types/tool';

const HUNKS: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: '+', text: 'export const APP = true;' },
      { kind: '+', text: 'export function run() {}' }
    ]
  }
];

describe('File change card diff', () => {
  it('renders a per-file card with basename, stats, and highlighted snippet', () => {
    const { container } = render(
      <EditDiffView
        hunks={HUNKS}
        variant="authoritative"
        filePath="src/components/App.tsx"
        additions={2}
        deletions={0}
      />
    );

    expect(container.querySelector('[data-file-change-card]')).not.toBeNull();
    expect(container.querySelector('[data-snippet-diff]')).not.toBeNull();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(container.textContent ?? '').toContain('export const APP');
    expect(container.querySelector('.vx-snippet-diff-line--add')).not.toBeNull();
    expect(container.textContent ?? '').not.toContain('@@');
  });
});
