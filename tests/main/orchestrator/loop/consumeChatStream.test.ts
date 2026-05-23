/**
 * `consumeChatStream` tests. We feed it a hand-rolled async iterable
 * mimicking real provider deltas and assert the accumulated state
 * matches what the orchestrator and sub-agent rely on.
 */

import { describe, expect, it, vi } from 'vitest';
import { consumeChatStream } from '@main/orchestrator/loop/consumeChatStream';
import type { ChatStreamDelta } from '@main/providers/chatClient';

async function* makeStream(deltas: ChatStreamDelta[]): AsyncIterable<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

describe('consumeChatStream', () => {
  it('accumulates assistant text deltas', async () => {
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: 'Hello' },
        { contentDelta: ', ' },
        { contentDelta: 'world.' },
        { finishReason: 'stop' }
      ])
    );
    expect(out.assistantText).toBe('Hello, world.');
    expect(out.hadText).toBe(true);
    expect(out.hadReasoning).toBe(false);
    expect(out.partialToolCalls).toEqual([]);
    expect(out.finishReason).toBe('stop');
  });

  it('accumulates reasoning deltas separately from text', async () => {
    const out = await consumeChatStream(
      makeStream([
        { reasoningDelta: 'thinking ' },
        { reasoningDelta: 'about it' },
        { contentDelta: 'answer' }
      ])
    );
    expect(out.reasoningText).toBe('thinking about it');
    expect(out.assistantText).toBe('answer');
    expect(out.hadReasoning).toBe(true);
  });

  it('splices tool-call fragments into per-index buffers', async () => {
    const out = await consumeChatStream(
      makeStream([
        { toolCallDelta: { index: 0, id: 'call-1', name: 'bash' } },
        { toolCallDelta: { index: 0, argumentsDelta: '{"command":' } },
        { toolCallDelta: { index: 0, argumentsDelta: '"ls"}' } },
        { toolCallDelta: { index: 1, id: 'call-2', name: 'read', argumentsDelta: '{}' } }
      ])
    );
    expect(out.partialToolCalls).toHaveLength(2);
    expect(out.partialToolCalls[0]).toEqual({
      id: 'call-1',
      name: 'bash',
      argumentsBuf: '{"command":"ls"}'
    });
    expect(out.partialToolCalls[1]).toEqual({
      id: 'call-2',
      name: 'read',
      argumentsBuf: '{}'
    });
  });

  /**
   * Regression: some OpenAI-compat providers (DeepSeek-class parallel
   * tool rounds, Ollama-Cloud-style chunking) emit each parallel call
   * in its own delta frame while reusing `index: 0`. Without slot
   * reassignment, `consumeChatStream` merges unrelated calls into
   * slot 0 — only the last survives execution and orphan partial UI
   * rows render as "Unknown tool: (unspecified)".
   */
  it('routes parallel tool calls that reuse index 0 into separate slots', async () => {
    const out = await consumeChatStream(
      makeStream([
        {
          toolCallDelta: {
            index: 0,
            id: 'call-a',
            name: 'read',
            argumentsDelta: '{"path":"index.html"}'
          }
        },
        {
          toolCallDelta: {
            index: 0,
            id: 'call-b',
            name: 'read',
            argumentsDelta: '{"path":"package.json"}'
          }
        }
      ])
    );
    expect(out.partialToolCalls).toHaveLength(2);
    expect(out.partialToolCalls[0]).toEqual({
      id: 'call-a',
      name: 'read',
      argumentsBuf: '{"path":"index.html"}'
    });
    expect(out.partialToolCalls[1]).toEqual({
      id: 'call-b',
      name: 'read',
      argumentsBuf: '{"path":"package.json"}'
    });
  });

  it('still splices argument fragments for the same call id at one index', async () => {
    const out = await consumeChatStream(
      makeStream([
        { toolCallDelta: { index: 0, id: 'call-1', name: 'bash' } },
        { toolCallDelta: { index: 0, argumentsDelta: '{"command":' } },
        { toolCallDelta: { index: 0, id: 'call-1', argumentsDelta: '"ls"}' } }
      ])
    );
    expect(out.partialToolCalls).toHaveLength(1);
    expect(out.partialToolCalls[0]).toEqual({
      id: 'call-1',
      name: 'bash',
      argumentsBuf: '{"command":"ls"}'
    });
  });

  it('invokes onTextDelta and onReasoningDelta hooks with running totals', async () => {
    const onText = vi.fn();
    const onReasoning = vi.fn();
    await consumeChatStream(
      makeStream([
        { contentDelta: 'a' },
        { contentDelta: 'b' },
        { reasoningDelta: 'r1' }
      ]),
      { onTextDelta: onText, onReasoningDelta: onReasoning }
    );
    expect(onText).toHaveBeenCalledTimes(2);
    expect(onText.mock.calls[0]).toEqual(['a', 'a']);
    expect(onText.mock.calls[1]).toEqual(['b', 'ab']);
    expect(onReasoning).toHaveBeenCalledOnce();
    expect(onReasoning.mock.calls[0]).toEqual(['r1', 'r1']);
  });

  it('propagates errors thrown by the underlying iterator', async () => {
    async function* failing(): AsyncIterable<ChatStreamDelta> {
      yield { contentDelta: 'x' };
      throw new Error('upstream broke');
    }
    await expect(consumeChatStream(failing())).rejects.toThrow(/upstream broke/);
  });

  it('surfaces the final usage frame via result.usage and the onUsage hook', async () => {
    const onUsage = vi.fn();
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: 'hi' },
        { finishReason: 'stop' },
        {
          usage: {
            promptTokens: 120,
            completionTokens: 4,
            totalTokens: 124
          }
        }
      ]),
      { onUsage }
    );
    expect(out.usage).toEqual({ promptTokens: 120, completionTokens: 4, totalTokens: 124 });
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage.mock.calls[0]?.[0]).toEqual({
      promptTokens: 120,
      completionTokens: 4,
      totalTokens: 124
    });
  });

  it('leaves result.usage undefined when the provider drops include_usage', async () => {
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: 'hi' },
        { finishReason: 'stop' }
      ])
    );
    expect(out.usage).toBeUndefined();
  });

  // Regression for the `<thinking>` rendering bug. Some models prompted
  // to reason emit chain-of-thought as inline `<thinking>` blocks on the
  // *content* channel — without the inline-reasoning router those tags
  // leaked into the markdown body. The consumer must reclassify the
  // block into the reasoning channel transparently.
  it('reclassifies inline <thinking> content into the reasoning channel', async () => {
    const onText = vi.fn();
    const onReasoning = vi.fn();
    const onReasoningEnd = vi.fn();
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: '<thinking>The user said hi. ' },
        { contentDelta: 'I should greet back.</thinking>' },
        { contentDelta: 'Hello! How can I help?' },
        { finishReason: 'stop' }
      ]),
      {
        onTextDelta: onText,
        onReasoningDelta: onReasoning,
        onReasoningEnd
      }
    );
    expect(out.assistantText).toBe('Hello! How can I help?');
    expect(out.reasoningText).toBe(
      'The user said hi. I should greet back.'
    );
    expect(out.hadText).toBe(true);
    expect(out.hadReasoning).toBe(true);
    // Reasoning end fires on the transition from thinking to text.
    expect(onReasoningEnd).toHaveBeenCalledOnce();
    // Hooks see the post-router slices, never the raw `<thinking>` tags.
    expect(onText).toHaveBeenCalled();
    for (const call of onText.mock.calls) {
      expect(call[0]).not.toContain('<thinking');
      expect(call[0]).not.toContain('</thinking');
    }
  });

  it('handles a <thinking> opener split across content deltas', async () => {
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: '<thi' },
        { contentDelta: 'nking>secret</thinking>visible' },
        { finishReason: 'stop' }
      ])
    );
    expect(out.assistantText).toBe('visible');
    expect(out.reasoningText).toBe('secret');
  });

  // Regression for the second screenshot: same model, same prompt, but
  // wrapped in `<reasoning>` instead of `<thinking>`. Both variants
  // must reach the reasoning panel — extending only the `<thinking>`
  // path was the original gap that left this leak in place.
  it('reclassifies inline <reasoning> content into the reasoning channel', async () => {
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: '<reasoning>The user has sent a simple greeting "hi". ' },
        { contentDelta: 'I should acknowledge politely.</reasoning>' },
        { contentDelta: 'Hello! How can I help today?' },
        { finishReason: 'stop' }
      ])
    );
    expect(out.assistantText).toBe('Hello! How can I help today?');
    expect(out.reasoningText).toBe(
      'The user has sent a simple greeting "hi". I should acknowledge politely.'
    );
  });

  it('reclassifies inline <reflection> content into the reasoning channel', async () => {
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: '<reflection>review my last answer' },
        { contentDelta: '</reflection>Revised: …' },
        { finishReason: 'stop' }
      ])
    );
    expect(out.assistantText).toBe('Revised: …');
    expect(out.reasoningText).toBe('review my last answer');
  });

  it('leaves <thinking> inside a code fence untouched', async () => {
    const out = await consumeChatStream(
      makeStream([
        { contentDelta: 'Example:\n```xml\n' },
        { contentDelta: '<thinking>quoted</thinking>\n' },
        { contentDelta: '```\nDone.' },
        { finishReason: 'stop' }
      ])
    );
    expect(out.assistantText).toBe(
      'Example:\n```xml\n<thinking>quoted</thinking>\n```\nDone.'
    );
    expect(out.reasoningText).toBe('');
  });
});
