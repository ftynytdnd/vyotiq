/**
 * Cross-surface consistency invariants for `getInspectorSnapshot`.
 *
 * Pre-fix, the Context Inspector's wire breakdown for an idle
 * conversation reported `systemPromptTokens: 0` and a `Total` that
 * disagreed with the composer pill by ~15-20k tokens — the gap was
 * the harness + envelopes the orchestrator's `runLoop` injects on
 * every iteration but `replayTranscript` (the inspector's
 * pre-fix data source) doesn't surface.
 *
 * The fix routes the idle inspector path through
 * `getProspectiveMessages` (the SAME builder the composer pill
 * uses) and adds an optional `tools[]` parameter on
 * `getInspectorSnapshot` so both surfaces tokenize the EXACT same
 * bytes. These tests pin the two contracts that keep them aligned:
 *
 *   1. `framing.total` for `(messages, tools, modelId)` must equal
 *      `tokenizeMessages(modelId, messages, tools).total` — i.e.
 *      the inspector and the composer pill compute the same total
 *      from the same input.
 *
 *   2. `totalTokens` (the headline "% of context window used"
 *      reading) must equal `framing.total`. Pre-fix it was
 *      `sum(tokensByIndex)` which omitted tool-schema bytes — the
 *      Inspector header badge therefore read low by ~tools-tokens
 *      relative to the composer pill.
 *
 *   3. When `messages[0]` is a system message with non-empty
 *      content, `framing.systemPromptTokens > 0`. This is the bug
 *      that produced the user-visible `System prompt + envelopes:
 *      0` line.
 *
 * Pure unit test of `getInspectorSnapshot` — no IPC, no electron,
 * no fs. The tokenizer is real (`gpt-tokenizer`) so the assertions
 * exercise the real BPE path for OpenAI / DeepSeek / Grok and the
 * chars/3.8 heuristic for Anthropic / Gemini.
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/types/chat';
import {
  DEFAULT_CONTEXT_SUMMARY_RULES,
  type ContextSummaryRules
} from '@shared/types/contextSummary';
import {
  tokenizeMessages,
  type TokenizableToolSchema
} from '@main/providers/tokenCounter';
import { getInspectorSnapshot } from '@main/orchestrator/contextSummarizer/index';

const RULES: ContextSummaryRules = DEFAULT_CONTEXT_SUMMARY_RULES;

function fakeTools(): TokenizableToolSchema[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a file from the workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Apply an exact-match edit to a file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' }
          },
          required: ['path', 'old_string', 'new_string']
        }
      }
    }
  ];
}

function realisticMessages(): ChatMessage[] {
  // Mimics the shape the orchestrator's `runLoop` carries on the
  // wire: system prompt + envelopes at index 0, then a small
  // tool-using exchange.
  return [
    {
      role: 'system',
      content:
        '<harness>You are Agent V, a senior pair-programmer.</harness>\n' +
        '<session_context>workspace=/repo</session_context>\n' +
        '<run_state>iteration=0/24</run_state>'
    },
    { role: 'user', content: 'Show me the README.' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c-1',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"README.md"}' }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'c-1',
      name: 'read',
      content: '# Vyotiq\n\nElectron-based agentic coding companion.'
    },
    { role: 'assistant', content: 'Here is the README contents.' }
  ];
}

describe('getInspectorSnapshot — cross-surface consistency', () => {
  it('framing.total equals tokenizeMessages.total for the same (messages, tools, modelId)', async () => {
    const messages = realisticMessages();
    const tools = fakeTools();
    const modelId = 'gpt-5';

    const snap = await getInspectorSnapshot({
      conversationId: 'c-1',
      workspaceId: 'ws-1',
      messages,
      tools,
      rules: RULES,
      workspaceOverridePresent: false,
      modelId
    });

    const wireEstimate = tokenizeMessages(modelId, messages, tools);
    expect(snap.framing.total).toBe(wireEstimate.total);
    expect(snap.framing.systemPromptTokens).toBe(wireEstimate.byPart.systemPrompt);
    expect(snap.framing.bodyTokens).toBe(wireEstimate.byPart.history);
    expect(snap.framing.toolSchemaTokens).toBe(wireEstimate.byPart.tools);
  });

  it('totalTokens equals framing.total (anchor on wire-authoritative count)', async () => {
    const snap = await getInspectorSnapshot({
      conversationId: 'c-1',
      workspaceId: 'ws-1',
      messages: realisticMessages(),
      tools: fakeTools(),
      rules: RULES,
      workspaceOverridePresent: false,
      modelId: 'gpt-5'
    });
    expect(snap.totalTokens).toBe(snap.framing.total);
  });

  it('reports systemPromptTokens > 0 when messages[0] is a populated system message', async () => {
    // Regression for the Inspector idle-path bug: pre-fix this read
    // 0 because `replayTranscript` doesn't surface the system
    // message (system prompts are synthesized per-iteration, not
    // persisted in the JSONL).
    const snap = await getInspectorSnapshot({
      conversationId: 'c-1',
      workspaceId: 'ws-1',
      messages: realisticMessages(),
      tools: fakeTools(),
      rules: RULES,
      workspaceOverridePresent: false,
      modelId: 'gpt-5'
    });
    expect(snap.framing.systemPromptTokens).toBeGreaterThan(0);
  });

  it('uses the caller-supplied tools[] catalogue (not the bundled allowlist)', async () => {
    // The two tools in `fakeTools()` are tiny relative to the full
    // ORCHESTRATOR_TOOLS allowlist. If the snapshot ignored the
    // passed tools and tokenized the bundled allowlist instead, the
    // toolSchemaTokens count would be much larger than the
    // standalone tokenization of the test's own tools.
    const messages = realisticMessages();
    const tools = fakeTools();
    const modelId = 'gpt-5';

    const snap = await getInspectorSnapshot({
      conversationId: 'c-2',
      workspaceId: 'ws-1',
      messages,
      tools,
      rules: RULES,
      workspaceOverridePresent: false,
      modelId
    });

    const standalone = tokenizeMessages(modelId, [], tools);
    expect(snap.framing.toolSchemaTokens).toBe(standalone.byPart.tools);
  });

  it('falls back to the bundled allowlist when tools[] is omitted', async () => {
    // Legacy callers (and tests) that don't supply `tools[]` should
    // still get a non-zero `toolSchemaTokens` from the orchestrator's
    // bundled `ORCHESTRATOR_TOOLS`. This guards the back-compat
    // contract on the `tools` parameter.
    const snap = await getInspectorSnapshot({
      conversationId: 'c-3',
      workspaceId: 'ws-1',
      messages: realisticMessages(),
      rules: RULES,
      workspaceOverridePresent: false,
      modelId: 'gpt-5'
    });
    expect(snap.framing.toolSchemaTokens).toBeGreaterThan(0);
  });

  it('currentRatio equals totalTokens / ceiling when ceiling is supplied', async () => {
    const ceiling = 1_000_000;
    const snap = await getInspectorSnapshot({
      conversationId: 'c-4',
      workspaceId: 'ws-1',
      messages: realisticMessages(),
      tools: fakeTools(),
      rules: RULES,
      workspaceOverridePresent: false,
      modelId: 'gpt-5',
      ceiling
    });
    expect(snap.ceiling).toBe(ceiling);
    expect(snap.currentRatio).toBeCloseTo(snap.totalTokens / ceiling, 6);
    // The pill renders at percent precision; a fresh idle conversation
    // sits well under 1% of a 1M-token window.
    expect(snap.currentRatio!).toBeLessThan(0.5);
  });

  it('produces consistent counts for DeepSeek (o200k) — same dialect family as GPT-5', async () => {
    // DeepSeek V4 routes through `o200k_base` in `resolveEncoding`.
    // The cross-surface invariant must hold for it too — the user's
    // bug report was filed on a DeepSeek-V4-Flash run.
    const messages = realisticMessages();
    const tools = fakeTools();
    const modelId = 'deepseek-v4-flash';

    const snap = await getInspectorSnapshot({
      conversationId: 'c-deepseek',
      workspaceId: 'ws-1',
      messages,
      tools,
      rules: RULES,
      workspaceOverridePresent: false,
      modelId
    });

    const wire = tokenizeMessages(modelId, messages, tools);
    expect(snap.framing.total).toBe(wire.total);
    expect(snap.framing.systemPromptTokens).toBeGreaterThan(0);
  });

  it('produces consistent counts for xAI Grok (now routed to o200k via resolveEncoding fix)', async () => {
    // Grok 4.x was previously falling through to the chars/3.8
    // heuristic because `resolveEncoding` had no `grok` pattern.
    // The Phase-5 doc-block already promised o200k routing; the
    // implementation now matches it.
    const messages = realisticMessages();
    const tools = fakeTools();
    const modelId = 'grok-4-fast';

    const snap = await getInspectorSnapshot({
      conversationId: 'c-grok',
      workspaceId: 'ws-1',
      messages,
      tools,
      rules: RULES,
      workspaceOverridePresent: false,
      modelId
    });

    const wire = tokenizeMessages(modelId, messages, tools);
    expect(snap.framing.total).toBe(wire.total);
  });

  it('produces consistent counts for Anthropic Claude (chars/3.8 heuristic path)', async () => {
    // The heuristic path returns `exact: false` but the
    // cross-surface invariant must STILL hold — both surfaces use
    // the same heuristic, so they must produce the same number even
    // when that number is approximate.
    const messages = realisticMessages();
    const tools = fakeTools();
    const modelId = 'claude-sonnet-4.6';

    const snap = await getInspectorSnapshot({
      conversationId: 'c-claude',
      workspaceId: 'ws-1',
      messages,
      tools,
      rules: RULES,
      workspaceOverridePresent: false,
      modelId
    });

    const wire = tokenizeMessages(modelId, messages, tools);
    expect(snap.framing.total).toBe(wire.total);
    expect(snap.framing.systemPromptTokens).toBeGreaterThan(0);
  });

  /**
   * Per-envelope breakdown contract (Phase 12 follow-up, 2026).
   *
   * `getInspectorSnapshot` populates `framing.envelopes` by splitting
   * the first system message into named parts and tokenizing each.
   * The renderer's `WireBreakdown` uses this field to drive the
   * foldable sub-row list under "System prompt + envelopes".
   *
   * The four assertions pin the contract end-to-end:
   *   1. A snapshot with a realistic system prompt produces an
   *      `envelopes[]` array whose first row is "Harness body" and
   *      whose remaining rows are the canonical envelope labels in
   *      wire order.
   *   2. Each row carries a non-negative `tokens` count.
   *   3. The sum of row tokens is approximately the
   *      `systemPromptTokens` total — small drift is expected (the
   *      chat-format role-marker tokens that `tokenizeMessages`
   *      counts alongside the body don't get attributed to a
   *      specific row), but the sum is bounded above and below by
   *      sensible factors.
   *   4. An idle snapshot with no system message produces no
   *      `envelopes` field — the renderer falls back to the
   *      non-foldable row in that case.
   */
  it('populates framing.envelopes for a realistic system prompt with envelope tags', async () => {
    const fullPrompt = [
      '# Prime Directives — Inviolable Rules',
      'The orchestrator must never delegate write actions without confirmation.',
      '',
      '<meta_rules>- prefer terse output\n- never use emoji</meta_rules>',
      '<host_environment>now_utc: 2026-05-19T03:00:00.000Z\nplatform: win32\nlocale: en-US</host_environment>',
      '<workspace_context>src/\n  index.ts\n  README.md</workspace_context>',
      '<session_context>title="planning"\nprior_turn_count=3</session_context>',
      '<run_state>iteration: 1 of 14\nlast_action: none</run_state>',
      '<prior_conversations>(none yet)</prior_conversations>',
      '<recent_memory>(no persistent notes matched)</recent_memory>'
    ].join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: fullPrompt },
      { role: 'user', content: 'Read me the README.' }
    ];
    const snap = await getInspectorSnapshot({
      conversationId: 'c-envelopes',
      workspaceId: 'ws-1',
      messages,
      tools: fakeTools(),
      rules: RULES,
      workspaceOverridePresent: false,
      modelId: 'gpt-5'
    });
    expect(snap.framing.envelopes).toBeDefined();
    const envs = snap.framing.envelopes!;
    expect(envs.map((e) => e.label)).toEqual([
      'Harness body',
      'Meta rules',
      'Host environment',
      'Workspace context',
      'Session context',
      'Run state',
      'Prior conversations',
      'Recent memory'
    ]);
    // Every row tokenizes to a non-negative count.
    for (const e of envs) {
      expect(e.tokens).toBeGreaterThanOrEqual(0);
    }
    // Sum-of-rows is approximately systemPromptTokens. The relation
    // is bounded — never way over (a 2x ceiling catches a regression
    // where the splitter double-counted some text) and never way
    // under (a 0.3x floor catches a regression where the splitter
    // dropped most of the content). Mid-range tolerance because the
    // chat-format role-marker tokens that `tokenizeMessages`
    // includes in `systemPromptTokens` aren't attributed to a
    // specific row.
    const sumTokens = envs.reduce((acc, e) => acc + e.tokens, 0);
    expect(sumTokens).toBeGreaterThan(snap.framing.systemPromptTokens * 0.3);
    expect(sumTokens).toBeLessThan(snap.framing.systemPromptTokens * 2);
  });

  it('omits framing.envelopes for a snapshot with no system message', async () => {
    // Idle / pre-iteration: the orchestrator hasn't built a system
    // prompt yet. The Inspector's foldable surface falls back to a
    // plain non-foldable row.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello.' }
    ];
    const snap = await getInspectorSnapshot({
      conversationId: 'c-idle',
      workspaceId: 'ws-1',
      messages,
      tools: fakeTools(),
      rules: RULES,
      workspaceOverridePresent: false,
      modelId: 'gpt-5'
    });
    expect(snap.framing.envelopes).toBeUndefined();
  });
});
