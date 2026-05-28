import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

describe('MarkdownBody link policy', () => {
  it('sets referrerPolicy=no-referrer on external links', () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              referrerPolicy="no-referrer"
              {...rest}
            >
              {children}
            </a>
          )
        }}
      >
        {'[Vyotiq](https://example.com)'}
      </ReactMarkdown>
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('referrerPolicy')).toBe('no-referrer');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });
});
