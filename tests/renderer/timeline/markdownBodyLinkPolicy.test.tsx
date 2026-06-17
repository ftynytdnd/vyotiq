import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownBody } from '@renderer/components/timeline/markdown/MarkdownBody.js';

describe('MarkdownBody link policy', () => {
  it('sets referrerPolicy=no-referrer on external links', () => {
    const { container } = render(
      <MarkdownBody text={'[Vyotiq](https://example.com)'} />
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('referrerPolicy')).toBe('no-referrer');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders blocked javascript: links as plain text', () => {
    const { container } = render(
      <MarkdownBody text={'[Evil](javascript:alert(1))'} />
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Evil');
  });
});
