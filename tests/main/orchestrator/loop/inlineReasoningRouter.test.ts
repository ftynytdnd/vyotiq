/**
 * Coverage for `InlineReasoningRouter` — the streaming state machine
 * that reclassifies inline `<think>` / `<thinking>` blocks emitted on
 * the assistant content channel into the reasoning channel.
 *
 * The bug it exists to fix is the `<thinking>` rendering screenshot:
 * a model prompted to think emitted its chain-of-thought wrapped in
 * `<thinking>` tags via the *content* channel (no native
 * `reasoning_content` field), and the orchestrator passed those tags
 * through to the markdown renderer as visible XML.
 */

import { describe, expect, it } from 'vitest';
import { InlineReasoningRouter } from '@main/orchestrator/loop/inlineReasoningRouter';

function feedAll(router: InlineReasoningRouter, chunks: string[]): {
  text: string;
  reasoning: string;
} {
  let text = '';
  let reasoning = '';
  for (const c of chunks) {
    const out = router.feed(c);
    text += out.text;
    reasoning += out.reasoning;
  }
  const flushed = router.flush();
  text += flushed.text;
  reasoning += flushed.reasoning;
  return { text, reasoning };
}

describe('InlineReasoningRouter', () => {
  it('passes through plain content unchanged', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['Hello, ', 'world.']);
    expect(out.text).toBe('Hello, world.');
    expect(out.reasoning).toBe('');
  });

  it('routes a fully-contained <thinking> block to reasoning', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      '<thinking>The user said hi. I should greet back.</thinking>Hello!'
    ]);
    expect(out.reasoning).toBe('The user said hi. I should greet back.');
    expect(out.text).toBe('Hello!');
  });

  it('routes a <think> block to reasoning', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['<think>plan</think>answer']);
    expect(out.reasoning).toBe('plan');
    expect(out.text).toBe('answer');
  });

  it('routes a <reasoning> block to reasoning', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      '<reasoning>The user said hi. I should greet back.</reasoning>Hi!'
    ]);
    expect(out.reasoning).toBe('The user said hi. I should greet back.');
    expect(out.text).toBe('Hi!');
  });

  it('routes a <reflection> block to reasoning', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['<reflection>step back</reflection>final answer']);
    expect(out.reasoning).toBe('step back');
    expect(out.text).toBe('final answer');
  });

  it('handles a <reasoning> opener split across chunks', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['hi <reaso', 'ning>thoughts</reasoning>bye']);
    expect(out.text).toBe('hi bye');
    expect(out.reasoning).toBe('thoughts');
  });

  it('does not let </reasoning> close a <thinking> block', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['<thinking>a</reasoning>b</thinking>c']);
    expect(out.reasoning).toBe('a</reasoning>b');
    expect(out.text).toBe('c');
  });

  it('keeps text before the opener and after the closer', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      'pre <thinking>secret thoughts</thinking> post'
    ]);
    expect(out.text).toBe('pre  post');
    expect(out.reasoning).toBe('secret thoughts');
  });

  it('handles a <thinking> opener split across chunks', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['hi <thi', 'nking>thoughts</thinking>bye']);
    expect(out.text).toBe('hi bye');
    expect(out.reasoning).toBe('thoughts');
  });

  it('handles a closer split across chunks', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['<thinking>tho', 'ughts</thi', 'nking>done']);
    expect(out.text).toBe('done');
    expect(out.reasoning).toBe('thoughts');
  });

  it('handles deltas one character at a time', () => {
    const r = new InlineReasoningRouter();
    const input = '<thinking>abc</thinking>xyz';
    const chunks = input.split('');
    const out = feedAll(r, chunks);
    expect(out.reasoning).toBe('abc');
    expect(out.text).toBe('xyz');
  });

  it('treats the opener case-insensitively', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['<Thinking>x</Thinking>y']);
    expect(out.reasoning).toBe('x');
    expect(out.text).toBe('y');
  });

  it('does not let </thinking> close a <think> block', () => {
    const r = new InlineReasoningRouter();
    // Mismatched closer: the `</thinking>` inside the think block is
    // treated as opaque reasoning text, only `</think>` ends the block.
    const out = feedAll(r, ['<think>a</thinking>b</think>c']);
    expect(out.reasoning).toBe('a</thinking>b');
    expect(out.text).toBe('c');
  });

  it('does not strip stray `<` characters in prose', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['if a < b and c < d then ok']);
    expect(out.text).toBe('if a < b and c < d then ok');
    expect(out.reasoning).toBe('');
  });

  it('does not strip a non-recognised tag like <template>', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, ['<template>x</template>']);
    expect(out.text).toBe('<template>x</template>');
    expect(out.reasoning).toBe('');
  });

  it('passes through <thinking> inside a triple-backtick code fence', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      'Here is an example:\n```xml\n<thinking>quoted</thinking>\n```\n'
    ]);
    expect(out.text).toBe(
      'Here is an example:\n```xml\n<thinking>quoted</thinking>\n```\n'
    );
    expect(out.reasoning).toBe('');
  });

  it('passes through <thinking> inside a tilde fence', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      '~~~\n<thinking>literal</thinking>\n~~~'
    ]);
    expect(out.text).toBe('~~~\n<thinking>literal</thinking>\n~~~');
    expect(out.reasoning).toBe('');
  });

  it('handles fence markers split across chunks', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      'pre ``',
      '`xml\n<thinking>x</thinking>\n``',
      '` post'
    ]);
    expect(out.text).toBe('pre ```xml\n<thinking>x</thinking>\n``` post');
    expect(out.reasoning).toBe('');
  });

  it('flushes a held partial-tag tail at end-of-stream as text', () => {
    const r = new InlineReasoningRouter();
    // Stream ends with what *might* have been an opener but never
    // completed. Route to whichever channel was active (text here).
    const out = feedAll(r, ['done <thi']);
    expect(out.text).toBe('done <thi');
    expect(out.reasoning).toBe('');
  });

  it('flushes an unterminated thinking block to reasoning', () => {
    const r = new InlineReasoningRouter();
    // Provider truncated mid-thought (network drop, abort, etc.). The
    // chain-of-thought bytes still belong in the reasoning panel —
    // don't surface them to the user as raw text.
    const out = feedAll(r, ['<thinking>partial thought, no closer']);
    expect(out.reasoning).toBe('partial thought, no closer');
    expect(out.text).toBe('');
  });

  it('handles multiple consecutive thinking blocks', () => {
    const r = new InlineReasoningRouter();
    const out = feedAll(r, [
      '<thinking>one</thinking>between<thinking>two</thinking>after'
    ]);
    expect(out.reasoning).toBe('onetwo');
    expect(out.text).toBe('betweenafter');
  });

  it('surfaces isInThinking() correctly across chunks', () => {
    const r = new InlineReasoningRouter();
    expect(r.isInThinking()).toBe(false);
    r.feed('<thinking>partial');
    expect(r.isInThinking()).toBe(true);
    r.feed('</thinking>done');
    expect(r.isInThinking()).toBe(false);
  });
});
