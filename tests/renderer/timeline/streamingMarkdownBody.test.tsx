/**
 * StreamingMarkdownBody — live partial renderer + settle handoff.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StreamingMarkdownBody } from '@renderer/components/timeline/markdown/StreamingMarkdownBody.js';

describe('StreamingMarkdownBody', () => {
  it('renders stream headings and inline code while streaming', () => {
    const { container } = render(
      <StreamingMarkdownBody
        text={'# Exploring\n\nCheck `backdrop-blur` usage.'}
        done={false}
      />
    );
    expect(container.querySelector('h1')?.className).toMatch(/vx-timeline-stream-heading/);
    expect(container.querySelector('code')?.textContent).toBe('backdrop-blur');
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });

  it('hands off to full markdown when done', () => {
    const { container } = render(
      <StreamingMarkdownBody text={'**Done**'} done={true} />
    );
    expect(container.querySelector('.vyotiq-md')).not.toBeNull();
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });

  // A1 — bullets must render as a real <ul> while streaming, not as a
  // paragraph with literal `- ` prefixes (the audit screenshot bug).
  it('renders unordered lists as <ul> while streaming', () => {
    const { container } = render(
      <StreamingMarkdownBody
        text={'- Async wiring: fixed\n- Loop intelligence: replaced'}
        done={false}
      />
    );
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/^- /);
  });

  // A2 — same for `1. ` numbered lists.
  it('renders ordered lists as <ol> while streaming', () => {
    const { container } = render(
      <StreamingMarkdownBody
        text={'1. Wiring phase\n2. Reliability phase'}
        done={false}
      />
    );
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll('li')).toHaveLength(2);
  });

  // A3 — full integration: an open `**` at the live tail must not paint
  // literal asterisks into the rendered tree.
  it('does not paint literal ** for an open bold span at the live tail', () => {
    const { container } = render(
      <StreamingMarkdownBody
        text={'1. Done\n2. **streaming bold tail'}
        done={false}
      />
    );
    expect(container.textContent).not.toContain('**streaming');
    expect(container.querySelector('strong')).not.toBeNull();
  });

  it('renders blockquotes, horizontal rules, links, strike, and task lists while streaming', () => {
    const { container } = render(
      <StreamingMarkdownBody
        text={
          '> quoted wisdom\n\n---\n\nSee [docs](https://example.com) and ~~old~~.\n\n- [x] done\n- [ ] todo'
        }
        done={false}
      />
    );
    expect(container.querySelector('blockquote')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
    const link = container.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('referrerPolicy')).toBe('no-referrer');
    expect(container.querySelector('s')).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="Completed"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="Not completed"]')).toHaveLength(1);
  });

  it('renders a staged table preview before the separator row arrives', () => {
    const { container } = render(
      <StreamingMarkdownBody text={'| File | Change |'} done={false} />
    );
    const wrap = container.querySelector('.vx-timeline-md-table-preview');
    expect(wrap).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('keeps a single prose wrapper at settle (embedded markdown body)', () => {
    const { container } = render(
      <StreamingMarkdownBody text={'**Done**'} done={true} />
    );
    const scopes = container.querySelectorAll('.vyotiq-md');
    expect(scopes).toHaveLength(1);
  });

  it('renders nested lists and tables while streaming', () => {
    const { container } = render(
      <StreamingMarkdownBody
        text={'- parent\n  - nested\n\n| H | V |\n|---|---|\n| a | b |'}
        done={false}
      />
    );
    expect(container.textContent).toContain('nested');
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
  });

  it('exposes copy on streamed fenced code blocks', () => {
    const { getByLabelText } = render(
      <StreamingMarkdownBody text={'```ts\nconst x = 1\n```'} done={false} />
    );
    expect(getByLabelText('Copy code')).not.toBeNull();
  });
});
