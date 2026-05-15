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
});
