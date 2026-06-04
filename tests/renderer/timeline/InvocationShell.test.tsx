/**
 * `InvocationShell` contract tests.
 */

import { describe, expect, it } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { InvocationShell } from '@renderer/components/timeline/tools/shared/InvocationShell';

describe('InvocationShell', () => {
  it('exposes aria-expanded that flips on click for expandable rows', () => {
    const { container } = render(
      <InvocationShell
        title="bash"
        summary="echo hi"
        ok={true}
        detail={<div>stdout: hi</div>}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('omits aria-expanded when the row has no detail to expand', () => {
    const { container } = render(
      <InvocationShell title="bash" summary="echo hi" ok={true} />
    );
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('failed rows offer Show details instead of inline trailing chip', () => {
    render(
      <InvocationShell
        title="edit"
        summary="storage/database.py"
        ok={false}
        errorHint="no match"
        dense
        detail={<div>error detail</div>}
      />
    );
    expect(screen.getByRole('button', { name: /Show details/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show details/i }));
    expect(screen.getByText('error detail')).toBeTruthy();
  });

  it('uses primary title while a tool call is pending', () => {
    const { container } = render(
      <InvocationShell title="read" summary="src/main.ts" ok={null} />
    );
    expect(container.innerHTML).toContain('text-text-primary');
    expect(container.innerHTML).not.toContain('vx-timeline-phase-live');
  });
});
