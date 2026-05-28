/**
 * `CodeBlock` truncation hard cap (8000 chars).
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CodeBlock } from '@renderer/components/timeline/tools/shared/CodeBlock';

describe('CodeBlock', () => {
  it('renders short bodies verbatim', () => {
    const { container } = render(<CodeBlock body="hello" />);
    expect(container.textContent).toBe('hello');
  });

  it('truncates bodies over 8000 chars and appends a marker', () => {
    const big = 'a'.repeat(20_000);
    const { container } = render(<CodeBlock body={big} />);
    expect(container.textContent).toContain('…[truncated]');
    // Visible content is 8000 chars + the marker line.
    expect(container.textContent?.length ?? 0).toBeLessThan(big.length);
  });

  it('respects the maxHeight prop', () => {
    const { container } = render(<CodeBlock body="hi" maxHeight={123} />);
    const pre = container.querySelector('pre');
    expect(pre?.style.maxHeight).toBe('123px');
  });

  it('applies the chromeCodeSurface chrome (overflow / background / font / radius)', () => {
    // Regression guard for the 2026-05 bug where `chromeCodeSurfaceClassName`
    // was passed to `cn()` as a function reference instead of being invoked.
    // `clsx` silently coerces function arguments to "", which stripped the
    // `<pre>` of its background, overflow clipping, rounded corners, font-
    // mono declaration, and stealth scrollbar — producing the visible
    // overlap between long tool outputs and subsequent timeline rows.
    // Pinning the four critical surface tokens makes the same shape fail
    // loudly if it ever recurs.
    const { container } = render(<CodeBlock body="hi" />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const cls = pre!.className;
    expect(cls).toContain('overflow-auto');
    expect(cls).toContain('bg-surface-overlay');
    expect(cls).toContain('font-mono');
    expect(cls).toContain('rounded-inner');
  });

  it('exposes a hover-revealed copy button by default', () => {
    const { getByLabelText } = render(<CodeBlock body="copy me" />);
    const btn = getByLabelText('Copy output');
    expect(btn.className).toMatch(/opacity-0/);
  });

  it('suppresses copy when copyable=false', () => {
    const { queryByLabelText } = render(<CodeBlock body="copy me" copyable={false} />);
    expect(queryByLabelText('Copy output')).toBeNull();
  });

  it('supports nowrap for column-aligned terminal output', () => {
    const { container } = render(<CodeBlock body="col1    col2" wrap="nowrap" />);
    expect(container.querySelector('pre')?.className).toContain('whitespace-pre');
    expect(container.querySelector('pre')?.className).not.toContain('whitespace-pre-wrap');
  });
});
