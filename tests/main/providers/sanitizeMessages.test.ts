/**
 * Phase 9 (2026) — `stripGeminiSignatures`.
 *
 * The Gemini transport relies on the orchestrator persisting
 * `thoughtSignature` on every assistant tool_call so the next request
 * can echo it back on the matching `functionCall` part. But if the
 * user switches dialects mid-conversation (Gemini → OpenAI), that
 * field MUST NOT leak onto the OpenAI wire, where:
 *
 *   - OpenAI itself ignores unknown fields silently.
 *   - SOME OpenAI-compat providers (observed: Together's strict
 *     `meta-llama/*` routes, Groq with its own validation layer)
 *     return a 400 on unknown fields inside `tool_calls[i]`.
 *
 * The sanitizer is invoked at the OpenAI transport's request edge so
 * the chat store's canonical `ChatMessage[]` keeps the signatures for
 * future Gemini turns, while the wire stays compliant.
 *
 * Two correctness properties are locked here:
 *
 *   1. Identity-preserving on the common path — non-Gemini turns
 *      MUST return the same array reference so React-equivalent
 *      reference equality stays useful for downstream callers.
 *
 *   2. Only `thoughtSignature` is dropped; every other field on
 *      `tool_calls[i]` (id / type / function.name / function.arguments)
 *      survives unchanged. This invariant matters because the strip
 *      also runs on turns that were already OpenAI-sourced (no
 *      signature present) — those must round-trip unchanged.
 */

import { describe, expect, it } from 'vitest';
import {
  stripGeminiSignatures,
  stripReasoningContentForStrictDialects
} from '@main/providers/sanitizeMessages';
import type { ChatMessage } from '@shared/types/chat';

describe('stripGeminiSignatures', () => {
  it('returns the same array reference when no message has a thoughtSignature', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'sure',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'calc', arguments: '{"x":1}' }
          }
        ]
      },
      { role: 'tool', content: '{"answer":42}', tool_call_id: 'tc_1', name: 'calc' }
    ];
    expect(stripGeminiSignatures(messages)).toBe(messages);
  });

  it('returns the same reference for a conversation with no tool_calls at all', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ];
    expect(stripGeminiSignatures(messages)).toBe(messages);
  });

  it('strips thoughtSignature from a Gemini-sourced tool_call', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'gem_0',
            type: 'function',
            function: { name: 'calc', arguments: '{"x":1}' },
            thoughtSignature: 'OPAQUE_SIG'
          }
        ]
      }
    ];
    const out = stripGeminiSignatures(messages);
    expect(out).not.toBe(messages);
    const tc = out[0]!.tool_calls![0]!;
    expect(tc).toEqual({
      id: 'gem_0',
      type: 'function',
      function: { name: 'calc', arguments: '{"x":1}' }
    });
    expect((tc as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
  });

  it('preserves every non-signature field on the stripped tool_call', () => {
    // Smoke-test that the strip is field-targeted, not a full
    // reconstruction. If a refactor accidentally rebuilds the
    // tool_call object from a subset of fields, this test catches
    // it.
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'one moment',
        tool_calls: [
          {
            id: 'gem_0',
            type: 'function',
            function: { name: 'do_thing', arguments: '{"key":"value"}' },
            thoughtSignature: 'SIG'
          }
        ]
      }
    ];
    const stripped = stripGeminiSignatures(messages)[0]!.tool_calls![0]!;
    expect(stripped.id).toBe('gem_0');
    expect(stripped.type).toBe('function');
    expect(stripped.function).toEqual({
      name: 'do_thing',
      arguments: '{"key":"value"}'
    });
  });

  it('only copies messages that actually need a change (mixed conversation)', () => {
    // Realistic mid-conversation dialect-switch scenario: the first
    // assistant turn was OpenAI (no signature); the second was
    // Gemini (with signature). The sanitizer must only allocate a
    // new ChatMessage for the second turn.
    const openaiTurn: ChatMessage = {
      role: 'assistant',
      content: 'first answer',
      tool_calls: [
        {
          id: 'oai_0',
          type: 'function',
          function: { name: 'tool_a', arguments: '{}' }
        }
      ]
    };
    const geminiTurn: ChatMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'gem_0',
          type: 'function',
          function: { name: 'tool_b', arguments: '{}' },
          thoughtSignature: 'SIG'
        }
      ]
    };
    const messages = [openaiTurn, geminiTurn];
    const out = stripGeminiSignatures(messages);
    expect(out).not.toBe(messages);
    // First turn identity-preserved (no allocation).
    expect(out[0]).toBe(openaiTurn);
    // Second turn copied.
    expect(out[1]).not.toBe(geminiTurn);
    expect((out[1]!.tool_calls![0] as { thoughtSignature?: string }).thoughtSignature)
      .toBeUndefined();
  });

  it('strips signatures from every offending entry inside a single multi-call turn', () => {
    // Parallel function-calling: a single Gemini turn can emit
    // multiple `functionCall` parts; each carries its own
    // signature. Sanitizer must strip ALL of them.
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'gem_0',
            type: 'function',
            function: { name: 'a', arguments: '{}' },
            thoughtSignature: 'SIG_A'
          },
          {
            id: 'gem_1',
            type: 'function',
            function: { name: 'b', arguments: '{}' },
            thoughtSignature: 'SIG_B'
          }
        ]
      }
    ];
    const calls = stripGeminiSignatures(messages)[0]!.tool_calls!;
    for (const c of calls) {
      expect((c as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
    }
  });
});

/**
 * `stripReasoningContentForStrictDialects` — strips DeepSeek's
 * vendor `reasoning_content` field from outbound assistant messages
 * when the destination provider is NOT `api.deepseek.com`.
 *
 * Root-cause regression (2026): a conversation started on DeepSeek
 * (thinking-mode) carries `reasoning_content` on every assistant
 * turn. Switching to Mistral mid-conversation caused the OpenAI
 * transport to forward those messages verbatim → Mistral 422'd with
 * `{type:"extra_forbidden", loc:["body","messages",N,"assistant","reasoning_content"]}`
 * and the orchestrator's retry loop hit the same 422 three times in
 * a row before surfacing the error. The fix strips the field at
 * the transport edge based on `provider.baseUrl`.
 */
describe('stripReasoningContentForStrictDialects', () => {
  it('strips reasoning_content on a non-DeepSeek baseUrl (Mistral 422 root-cause scenario)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Hello!',
        reasoning_content:
          'The user just said "hi" — this is a simple greeting. I should respond warmly.'
      }
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://api.mistral.ai'
    );
    expect(out).not.toBe(messages);
    expect(out[1]).toEqual({ role: 'assistant', content: 'Hello!' });
    expect((out[1] as { reasoning_content?: string }).reasoning_content).toBeUndefined();
    // The user turn is identity-preserved (no rewrite was needed).
    expect(out[0]).toBe(messages[0]);
  });

  it('keeps reasoning_content on a DeepSeek-direct baseUrl (thinking-mode round-trip)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Hello!',
        reasoning_content: 'simple greeting — respond warmly.'
      }
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://api.deepseek.com'
    );
    // DeepSeek direct: pass through verbatim, identity preserved so
    // we don't pay for a copy on the hottest provider.
    expect(out).toBe(messages);
    expect((out[1] as { reasoning_content?: string }).reasoning_content).toBe(
      'simple greeting — respond warmly.'
    );
  });

  it('returns the same array reference when no assistant message has reasoning_content', () => {
    // The common path for OpenAI / Anthropic-sourced conversations:
    // no reasoning_content present, no allocation should happen.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'tell me a joke' },
      { role: 'assistant', content: 'Why did the chicken …' }
    ];
    expect(
      stripReasoningContentForStrictDialects(messages, 'https://api.mistral.ai')
    ).toBe(messages);
  });

  it('preserves identity for messages without the field while stripping those that have it', () => {
    // Mixed conversation: an early DeepSeek turn (with reasoning_content)
    // and a later OpenAI turn (without it). The later turn must keep
    // its object identity so React-equivalent reference-equality
    // upstream stays effective.
    const cleanTurn: ChatMessage = { role: 'assistant', content: 'No CoT.' };
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a' },
      {
        role: 'assistant',
        content: 'first',
        reasoning_content: 'thinking…'
      },
      { role: 'user', content: 'b' },
      cleanTurn
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://api.openai.com'
    );
    expect(out).not.toBe(messages);
    // Clean turn keeps its object identity (the stripper only
    // allocates a copy for the message that actually had the field).
    expect(out[3]).toBe(cleanTurn);
    // Dirty turn loses the field.
    expect((out[1] as { reasoning_content?: string }).reasoning_content).toBeUndefined();
    // And keeps every other field.
    expect(out[1]).toEqual({ role: 'assistant', content: 'first' });
  });

  it('treats empty-string reasoning_content as a no-op (defensive)', () => {
    // A persisted message with an empty `reasoning_content: ''` would
    // serialize to the wire as the field with the empty string, which
    // strict providers would also 422 on (same `extra_forbidden`
    // rule). Pin that empty values are filtered out of the copy.
    // Identity-preserving because no work was needed.
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'a', reasoning_content: '' }
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://api.mistral.ai'
    );
    // Empty-string is treated as "nothing to strip" by the inner
    // check (`.length === 0`). The message still has the field set
    // to `''`, which strict providers might still reject — but the
    // host transport never PERSISTS empty-string reasoning_content
    // (the streamer only assigns the field when it has accumulated
    // a non-empty body). Pin the no-op so a regression that
    // introduced empty-string persistence is visible here.
    expect(out).toBe(messages);
  });

  it('handles DeepSeek detection across baseUrl variants (trailing slash, path suffix, case)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        reasoning_content: 'thinking…'
      }
    ];
    // Trailing slash.
    expect(
      stripReasoningContentForStrictDialects(
        messages,
        'https://api.deepseek.com/'
      )[0]
    ).toBe(messages[0]);
    // With v1 path (real-world: providerStore persists baseUrl without
    // a trailing /v1, but defensively).
    expect(
      stripReasoningContentForStrictDialects(
        messages,
        'https://api.deepseek.com/v1'
      )[0]
    ).toBe(messages[0]);
    // Uppercase host — URL parsing normalizes case so this still
    // matches as DeepSeek-direct.
    expect(
      stripReasoningContentForStrictDialects(
        messages,
        'https://API.DeepSeek.COM'
      )[0]
    ).toBe(messages[0]);
  });

  it('falls back to regex when the baseUrl is malformed', () => {
    // Defensive: a provider persisted with a missing scheme (legacy
    // record) would fail `new URL()`. The catch clause uses a regex
    // fallback that still recognises DeepSeek's host suffix.
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        reasoning_content: 'thinking…'
      }
    ];
    // Bareword host — no scheme. URL constructor throws; regex
    // fallback should match the substring.
    const malformedDeepSeek = 'api.deepseek.com';
    expect(
      stripReasoningContentForStrictDialects(messages, malformedDeepSeek)[0]
    ).toBe(messages[0]);
    // Bareword non-DeepSeek host — regex fallback rejects.
    const malformedMistral = 'api.mistral.ai';
    expect(
      (
        stripReasoningContentForStrictDialects(
          messages,
          malformedMistral
        )[0] as { reasoning_content?: string }
      ).reasoning_content
    ).toBeUndefined();
  });

  it('strips tool-call assistant messages that also have reasoning_content', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'I should look up the file.',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"README.md"}' }
          }
        ]
      }
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://api.mistral.ai'
    );
    expect((out[0] as { reasoning_content?: string }).reasoning_content).toBeUndefined();
    expect(out[0]!.tool_calls).toEqual([
      {
        id: 'tc_1',
        type: 'function',
        function: { name: 'read', arguments: '{"path":"README.md"}' }
      }
    ]);
  });

  it('keeps reasoning_content on OpenRouter when model id is DeepSeek (2026 tool-turn round-trip)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'Need to read the file first.',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"a.ts"}' }
          }
        ]
      }
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://openrouter.ai/api',
      'deepseek/deepseek-v4-flash'
    );
    expect(out).toBe(messages);
    expect(out[0]!.reasoning_content).toBe('Need to read the file first.');
  });

  it('strips reasoning_content on OpenRouter for non-DeepSeek models', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'hi',
        reasoning_content: 'greeting'
      }
    ];
    const out = stripReasoningContentForStrictDialects(
      messages,
      'https://openrouter.ai/api',
      'anthropic/claude-sonnet-4'
    );
    expect((out[0] as { reasoning_content?: string }).reasoning_content).toBeUndefined();
  });
});
