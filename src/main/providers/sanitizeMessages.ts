/**
 * Cross-dialect message sanitizers — invoked by the OpenAI and Ollama
 * transports at the request-edge to strip fields that are only
 * meaningful on a SPECIFIC dialect from persisted assistant
 * `tool_calls`. The fields are persisted because the orchestrator
 * needs them to round-trip on the matching dialect (Phase 9 — 2026,
 * Gemini `thoughtSignature`; DeepSeek-V3.1+ `reasoning_content`),
 * but they MUST NOT leak onto the wire to a different dialect, where
 * they are at best ignored and at worst trigger a 400/422 from
 * strict providers.
 *
 * Sized like Anthropic's wire-shape translator: do NOT mutate the
 * caller's `messages` array — copy on the rare hit so the
 * conversation store and the renderer reducer keep their own
 * canonical references intact.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { isOpenRouterHost } from './attributionHeaders.js';

/**
 * Host-suffix check for DeepSeek's direct API.
 *
 * DeepSeek's official base URL is `https://api.deepseek.com` (no
 * subdomain variants today; the docs only document the single host).
 * We match by suffix so a regional rewrite (`api.deepseek.com.cn`,
 * for instance) wouldn't false-positive while the canonical host
 * still matches. Anything routed through OpenRouter / Together / a
 * gateway counts as NOT DeepSeek-direct for the purposes of this
 * check — those gateways may or may not accept `reasoning_content`,
 * and we prefer the conservative behavior (strip on send; lose
 * chain-of-thought continuity but keep the request well-formed).
 *
 * Exported only so the strict-dialect sanitizer below can consult it;
 * not intended for general use.
 */
function isDeepSeekDirect(baseUrl: string): boolean {
  try {
    // `URL` throws on malformed input; the catch falls back to a
    // string scan that handles the few cases where a provider is
    // persisted with an unusual baseUrl (e.g. a missing scheme).
    return new URL(baseUrl).hostname === 'api.deepseek.com';
  } catch {
    return /(^|\/\/)(www\.)?api\.deepseek\.com(\/|$|:)/i.test(baseUrl);
  }
}

/**
 * DeepSeek reasoning models routed through OpenRouter require
 * `reasoning_content` echoed on follow-up turns (2026). Direct API
 * and OpenRouter+DeepSeek both preserve the field; other gateways
 * still strip it to avoid strict-dialect 422s.
 */
function shouldPreserveReasoningContent(baseUrl: string, modelId?: string): boolean {
  if (isDeepSeekDirect(baseUrl)) return true;
  if (!modelId || !isOpenRouterHost(baseUrl)) return false;
  return /deepseek/i.test(modelId);
}

/**
 * Strip the DeepSeek-only `reasoning_content` field from every
 * outbound assistant message when the destination provider is NOT
 * DeepSeek-direct (or OpenRouter+DeepSeek).
 *
 * Why this exists: DeepSeek-V3.1+ reasoning models REQUIRE the
 * previous turn's `reasoning_content` to be echoed back on the
 * next request, so the orchestrator persists it on every assistant
 * `ChatMessage`. But the field is a DeepSeek vendor extension —
 * Mistral's API hard-422s the request:
 *
 *   {"type":"extra_forbidden",
 *    "loc":["body","messages",2,"assistant","reasoning_content"],
 *    "msg":"Extra inputs are not permitted"}
 *
 * and other strict OpenAI-compat surfaces (Together strict mode,
 * Groq edge routes, vLLM with `--strict`) behave similarly. OpenAI
 * proper drops unknowns silently, so the field has historically
 * appeared safe — but the moment the user switches a conversation
 * from DeepSeek to Mistral mid-flight, every retried request 422s
 * forever until the conversation is manually pruned.
 *
 * The fix sanitizes at the transport edge: the persisted store
 * keeps `reasoning_content` (so a later switch back to DeepSeek
 * still round-trips it correctly), but the wire body never carries
 * the field unless the destination preserves it
 * (DeepSeek-direct or OpenRouter+DeepSeek model id).
 *
 * Identity-preserving on the common path (every non-DeepSeek-sourced
 * conversation): when no assistant message has `reasoning_content`
 * set, the input array reference is returned unchanged so the
 * orchestrator's `messages[]` doesn't fan out unnecessary copies.
 */
export function stripReasoningContentForStrictDialects(
  messages: readonly ChatMessage[],
  baseUrl: string,
  modelId?: string
): ChatMessage[] {
  if (shouldPreserveReasoningContent(baseUrl, modelId)) return messages as ChatMessage[];
  let changed = false;
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (
      m.role !== 'assistant' ||
      typeof m.reasoning_content !== 'string' ||
      m.reasoning_content.length === 0
    ) {
      out.push(m);
      continue;
    }
    changed = true;
    const { reasoning_content: _drop, ...rest } = m;
    void _drop;
    out.push(rest as ChatMessage);
  }
  return changed ? out : (messages as ChatMessage[]);
}

/**
 * Returns a shallow-copied `messages` array with the Gemini-only
 * `thoughtSignature` field stripped from every assistant turn's
 * `tool_calls[i]` entry. Object identity is preserved for messages
 * that need no change so React-equivalent reference-equality stays
 * useful upstream.
 */
export function stripGeminiSignatures(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  let changed = false;
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) {
      out.push(m);
      continue;
    }
    // Walk the tool_calls; only allocate a new array when at least
    // one entry carries the offending field. Common path (every
    // non-Gemini-sourced turn) is identity-preserving.
    let toolCallsChanged = false;
    const nextCalls = m.tool_calls.map((tc) => {
      if (typeof (tc as { thoughtSignature?: string }).thoughtSignature !== 'string') {
        return tc;
      }
      toolCallsChanged = true;
      const { thoughtSignature: _drop, ...rest } = tc as typeof tc & {
        thoughtSignature?: string;
      };
      void _drop;
      return rest;
    });
    if (!toolCallsChanged) {
      out.push(m);
      continue;
    }
    changed = true;
    out.push({ ...m, tool_calls: nextCalls });
  }
  return changed ? out : (messages as ChatMessage[]);
}
