/**
 * `InvocationShell` contract tests. Covers:
 *   - `aria-expanded` reflects the open state of an expandable row
 *   - dense mode inlines `errorHint` next to the summary (screenshot §4
 *     fix — 7×"no match" pile becomes 7×1-line)
 *   - non-dense mode still renders `errorHint` below the row
 */

import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { InvocationShell } from '@renderer/components/timeline/tools/shared/InvocationShell';
import { Terminal } from 'lucide-react';

describe('InvocationShell', () => {
  it('exposes aria-expanded that flips on click for expandable rows', () => {
    const { container } = render(
      <InvocationShell
        Icon={Terminal}
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
      <InvocationShell
        Icon={Terminal}
        title="bash"
        summary="echo hi"
        ok={true}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBeNull();
  });

  it('renders dense errorHint inline next to the summary (one visual line)', () => {
    const { container } = render(
      <InvocationShell
        Icon={Terminal}
        title="edit"
        summary="storage/database.py"
        ok={false}
        errorHint="no match"
        dense
        detail={<div>error detail</div>}
      />
    );
    const btn = container.querySelector('button')!;
    // The dense errorHint chip lives INSIDE the trigger button, not as
    // a sibling line below it.
    expect(btn.textContent).toContain('no match');
    // No ml-7 below-the-line errorHint sibling rendered.
    const belowLine = container.querySelector('.ml-7');
    expect(belowLine).toBeNull();
  });

  it('renders non-dense errorHint below the row (two visual lines)', () => {
    const { container } = render(
      <InvocationShell
        Icon={Terminal}
        title="bash"
        summary="rm -rf /"
        ok={false}
        errorHint="permission denied"
        detail={<div>error detail</div>}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.textContent ?? '').not.toContain('permission denied');
    // Non-dense keeps the original below-the-row treatment.
    const belowLine = container.querySelector('.ml-7');
    expect(belowLine).not.toBeNull();
    expect(belowLine!.textContent).toContain('permission denied');
  });

  it('hides the inline errorHint chip once the dense row is expanded', () => {
    const { container } = render(
      <InvocationShell
        Icon={Terminal}
        title="edit"
        summary="storage/database.py"
        ok={false}
        errorHint="no match"
        dense
        detail={<div>error detail</div>}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.textContent).toContain('no match');
    fireEvent.click(btn);
    // When expanded the detail pane carries the actionable error, so
    // the inline chip retreats to avoid duplicating the signal.
    expect(btn.textContent ?? '').not.toContain('no match');
  });
});
