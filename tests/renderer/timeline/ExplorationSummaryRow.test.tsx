import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExplorationSummaryRow } from '@renderer/components/timeline/rows/ExplorationSummaryRow';

describe('ExplorationSummaryRow', () => {
  const samples = [
    { toolName: 'read' as const, path: 'src/main/index.ts' },
    { toolName: 'search' as const, path: 'orchestrator' }
  ];

  it('renders a static line when there are no samples', () => {
    const { container } = render(
      <ExplorationSummaryRow rowKey="expl-1" fileCount={2} searchCount={1} />
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('Explored 2 files, 1 search');
  });

  it('hides sample list until expanded', () => {
    render(
      <ExplorationSummaryRow
        rowKey="expl-2"
        fileCount={2}
        searchCount={0}
        samples={samples}
      />
    );
    expect(screen.queryByText('src/main/index.ts')).toBeNull();
    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('exploration-summary-expl-2');
  });

  it('shows sample list when expanded', () => {
    render(
      <ExplorationSummaryRow
        rowKey="expl-3"
        fileCount={2}
        searchCount={0}
        samples={samples}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('index.ts')).toBeTruthy();
    expect(screen.getByTitle('src/main/index.ts')).toBeTruthy();
    expect(screen.getByText('orchestrator')).toBeTruthy();
  });
});
