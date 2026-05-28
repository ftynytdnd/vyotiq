/**
 * `InvocationShell` contract tests.
 */

import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders dense errorHint inline next to the summary (one visual line)', () => {
    const { container } = render(
      <InvocationShell
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
    const belowLine = container.querySelector('.ml-5');
    expect(belowLine).toBeNull();
  });

  it('renders non-dense errorHint inline in the trailing slot (one visual line)', () => {
    const { container } = render(
      <InvocationShell
        title="bash"
        summary="rm -rf /"
        ok={false}
        errorHint="permission denied"
        detail={<div>error detail</div>}
      />
    );
    const header = container.querySelector('[class*="max-w-[14rem]"]');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('permission denied');
    expect(container.querySelector('.ml-5')).toBeNull();
  });

  it('hides the inline errorHint chip once the dense row is expanded', () => {
    const { container } = render(
      <InvocationShell
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
    expect(btn.textContent ?? '').not.toContain('no match');
  });

  it('uses gold title while a tool call is pending', () => {
    const { container } = render(
      <InvocationShell title="read" summary="src/main.ts" ok={null} />
    );
    expect(container.innerHTML).toContain('text-accent-gold-strong');
  });
});
