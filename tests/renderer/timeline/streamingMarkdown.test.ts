import { describe, expect, it } from 'vitest';
import {
  parseInlineSpans,
  parseStreamingBlocks
} from '@renderer/components/timeline/markdown/streamingMarkdown.js';
import {
  resolveLivePhaseHeadline,
  isPhaseHeadlineLabel,
  isGoldLivePhase,
  toolTitleClassName,
  reasoningHeadlineClassName,
  timelineLiveTurnClassName
} from '@renderer/components/timeline/shared/rowStyles.js';

describe('parseInlineSpans', () => {
  it('parses inline code without transparent-fill hazards', () => {
    const spans = parseInlineSpans('Use `backdrop-blur` here');
    expect(spans).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'backdrop-blur' },
      { kind: 'text', text: ' here' }
    ]);
  });

  it('parses bold and italic', () => {
    const spans = parseInlineSpans('**bold** and *em*');
    expect(spans[0]).toEqual({
      kind: 'strong',
      children: [{ kind: 'text', text: 'bold' }]
    });
    expect(spans[2]).toEqual({
      kind: 'em',
      children: [{ kind: 'text', text: 'em' }]
    });
  });

  // A3 — mid-document unmatched `**` (partial=false) must emit the
  // asterisks as literal text. Only the tail block opts into the
  // streaming-open behaviour.
  it('keeps unmatched ** as literal text when partial is false', () => {
    const spans = parseInlineSpans('hello **mid sentence', false);
    const flattened = spans
      .map((s) => (s.kind === 'text' ? s.text : ''))
      .join('');
    expect(flattened).toContain('**');
  });

  // A3 — at the streaming tail, an unmatched `**` must consume the
  // rest of the line as an open `<strong>` (no literal asterisks).
  it('treats unmatched ** at the tail as a streaming-open strong span', () => {
    const spans = parseInlineSpans('hello **tail', true);
    expect(spans[0]).toEqual({ kind: 'text', text: 'hello ' });
    expect(spans[1]).toMatchObject({ kind: 'strong' });
    expect(spans[1]).not.toMatchObject({ kind: 'text' });
    // No literal asterisks anywhere in the output.
    const flat = JSON.stringify(spans);
    expect(flat).not.toContain('"text":"**"');
    expect(flat).not.toContain('"text":"**tail"');
  });

  it('treats unmatched single * at the tail as streaming-open em', () => {
    const spans = parseInlineSpans('start *tail', true);
    expect(spans[1]).toMatchObject({ kind: 'em' });
  });

  it('treats unmatched backtick at the tail as streaming-open code', () => {
    const spans = parseInlineSpans('see `partial', true);
    expect(spans.some((s) => s.kind === 'code' && s.text === 'partial')).toBe(true);
  });
});

describe('parseStreamingBlocks', () => {
  it('splits headings, paragraphs, and fenced code', () => {
    const text = `# Exploring\n\nHello **world**\n\n\`\`\`ts\nconst x = 1\n\`\`\``;
    const blocks = parseStreamingBlocks(text);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' });
    expect(blocks[2]).toMatchObject({ kind: 'code', partial: false });
  });

  it('marks trailing fence as partial while streaming', () => {
    const blocks = parseStreamingBlocks('```ts\npartial');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'code', partial: true });
  });

  // A1 — unordered lists during streaming.
  it('parses unordered list items as a single list block', () => {
    const blocks = parseStreamingBlocks(
      '- Core async: fixed\n- State immutability: patched\n- Loop intelligence: replaced'
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    if (blocks[0]!.kind !== 'list') throw new Error('expected list block');
    expect(blocks[0].items).toHaveLength(3);
    expect(blocks[0].items[0]!.spans[0]).toMatchObject({
      kind: 'text',
      text: 'Core async: fixed'
    });
  });

  // A2 — ordered lists during streaming.
  it('parses ordered list items as a single list block', () => {
    const blocks = parseStreamingBlocks(
      '1. Wiring phase\n2. Reliability phase\n3. Clean-up phase'
    );
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
    if (blocks[0]!.kind !== 'list') throw new Error('expected list block');
    expect(blocks[0].items).toHaveLength(3);
  });

  // List should interrupt the prior paragraph (no blank line needed).
  it('lets a list interrupt a paragraph', () => {
    const blocks = parseStreamingBlocks(
      'Summary heading text\n- first\n- second'
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: false });
  });

  // Marker change should terminate the list.
  it('terminates a list when the marker style switches between ul and ol', () => {
    const blocks = parseStreamingBlocks('- a\n- b\n1. c');
    const lists = blocks.filter((b) => b.kind === 'list');
    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(lists[1]).toMatchObject({ kind: 'list', ordered: true });
  });

  // A3 — the audit's signature regression: `**4. UI/UX` at the live
  // tail must not paint literal asterisks. The list parser claims the
  // line first (it matches the ordered-list prefix `4. `), and the
  // partial-tail re-parse of the trailing item must wrap the unmatched
  // `**` as a streaming-open strong span.
  it('does not leak literal ** at the live tail of an ordered list', () => {
    const blocks = parseStreamingBlocks('1. Done\n2. **streaming bold tail');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
    if (blocks[0]!.kind !== 'list') throw new Error('expected list block');
    const tailItem = blocks[0].items[blocks[0].items.length - 1]!;
    const flat = JSON.stringify(tailItem.spans);
    expect(flat).not.toContain('"text":"**streaming bold tail"');
    expect(tailItem.spans.some((s) => s.kind === 'strong')).toBe(true);
  });

  // A3 — same regression in paragraph form.
  it('does not leak literal ** at the live tail of a paragraph', () => {
    const blocks = parseStreamingBlocks('Final paragraph **opening bold');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    if (blocks[0]!.kind !== 'paragraph') throw new Error('expected paragraph');
    const flat = JSON.stringify(blocks[0].spans);
    expect(flat).not.toContain('"text":"**opening bold"');
    expect(blocks[0].spans.some((s) => s.kind === 'strong')).toBe(true);
  });

  // The tail-block rule only applies to the LAST block. A mid-document
  // unmatched `**` (e.g. user wrote literal asterisks in an early
  // paragraph) must survive verbatim.
  it('preserves literal ** in a non-tail paragraph', () => {
    const blocks = parseStreamingBlocks('Early **literal\n\nLater paragraph');
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    if (blocks[0]!.kind !== 'paragraph') throw new Error('expected paragraph');
    const flat = JSON.stringify(blocks[0].spans);
    expect(flat).toContain('*');
  });

  it('parses blockquotes and horizontal rules', () => {
    const blocks = parseStreamingBlocks('> line one\n> line two\n\n---\n\nAfter');
    expect(blocks[0]).toMatchObject({ kind: 'blockquote' });
    expect(blocks[1]).toMatchObject({ kind: 'hr' });
    expect(blocks[2]).toMatchObject({ kind: 'paragraph' });
  });

  it('parses links, strike, and GFM task lists', () => {
    const spans = parseInlineSpans('Visit [Vyotiq](https://vyotiq.dev) and ~~strike~~');
    expect(spans.some((s) => s.kind === 'link')).toBe(true);
    expect(spans.some((s) => s.kind === 'strike')).toBe(true);

    const blocks = parseStreamingBlocks('- [x] shipped\n- [ ] pending');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    if (blocks[0]!.kind !== 'list') throw new Error('expected list');
    expect(blocks[0].items[0]).toMatchObject({ task: true, checked: true });
    expect(blocks[0].items[1]).toMatchObject({ task: true, checked: false });
  });

  it('parses nested lists via indent', () => {
    const blocks = parseStreamingBlocks('- parent\n  - child\n  - sibling');
    expect(blocks[0]).toMatchObject({ kind: 'list' });
    if (blocks[0]!.kind !== 'list') throw new Error('expected list');
    expect(blocks[0].items[0]?.nested?.items).toHaveLength(2);
  });

  it('parses GFM pipe tables', () => {
    const blocks = parseStreamingBlocks('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(blocks[0]).toMatchObject({ kind: 'table' });
    if (blocks[0]!.kind !== 'table') throw new Error('expected table');
    expect(blocks[0].headers).toHaveLength(2);
    expect(blocks[0].rows).toHaveLength(1);
  });
});

describe('phase headline helpers', () => {
  it('maps running-tool to Exploring', () => {
    expect(resolveLivePhaseHeadline('running-tool', 'Running tool: read…')).toBe(
      'Exploring'
    );
  });

  it('detects persisted Exploring dividers', () => {
    expect(isPhaseHeadlineLabel('Exploring')).toBe(true);
    expect(isPhaseHeadlineLabel('Delegating 2 sub-tasks')).toBe(false);
  });

  it('identifies gold live phases', () => {
    expect(isGoldLivePhase('running-tool')).toBe(true);
    expect(isGoldLivePhase('streaming-reasoning')).toBe(true);
    expect(isGoldLivePhase('awaiting-response')).toBe(false);
  });

  it('styles in-flight tool titles with gold', () => {
    expect(toolTitleClassName(true)).toContain('text-accent-gold-strong');
    expect(toolTitleClassName(false)).toContain('text-text-primary');
  });

  it('does not add live-turn chrome', () => {
    expect(timelineLiveTurnClassName(true)).toBe('');
    expect(timelineLiveTurnClassName(false)).toBe('');
  });

  it('styles streaming reasoning headlines consistently', () => {
    expect(reasoningHeadlineClassName(true, 'orchestrator')).toContain('text-accent-gold');
    expect(reasoningHeadlineClassName(false, 'subagent')).toContain('text-text-muted');
  });
});
