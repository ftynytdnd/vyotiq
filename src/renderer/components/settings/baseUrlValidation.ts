/**
 * Pure, unit-testable validators + normalizers for the Add/Edit Provider
 * form's Base URL field. Kept out of `AddProviderForm.tsx` so the rules
 * can be covered directly in vitest without mounting React, mirroring
 * the pattern used in `endpointWarning.ts` for provider URL hints.
 *
 * Rules (in order):
 *   1. Empty / whitespace-only       → error (block submit).
 *   2. Missing scheme / bad scheme   → error (must be http:// or https://).
 *   3. Trailing dialect-specific suffix → normalize + inform. The chat
 *                                      client appends its own suffix at
 *                                      runtime (`/v1/...` for OpenAI
 *                                      dialect, `/api/...` for Ollama
 *                                      native), so a user-pasted match
 *                                      would yield `…/v1/v1/chat/…` or
 *                                      `…/api/api/tags`. We strip ONLY
 *                                      the suffix that the *current*
 *                                      dialect would append: under
 *                                      `'openai'` we strip `/v1` only
 *                                      (so OpenRouter's required `/api`
 *                                      path segment is preserved),
 *                                      under `'ollama-native'` we strip
 *                                      `/api` only.
 *   4. `ollama.com` with `dialect:openai`   → warn (cloud requires the
 *                                              `ollama-native` dialect).
 *   5. Non-Ollama host with `ollama-native` → warn (mismatched dialect).
 *
 * The rules must stay in lockstep with `src/main/providers/modelDiscovery.ts`
 * and `src/main/providers/chatClient/*` — drift would mean the UI says
 * "looks good" while the tool refuses at runtime. The single source of
 * truth for the strip rule itself is `@shared/providers/normalizeBaseUrl`,
 * which the persisted-store hardener and the dialect-detection probe
 * also consume — keeping all three call sites identical by import.
 */

import type { ProviderDialect } from '@shared/types/provider.js';
import { describeStrippedSuffix } from '@shared/providers/normalizeBaseUrl.js';

type BaseUrlSeverity = 'error' | 'warn' | 'info';

export interface BaseUrlValidation {
  severity: BaseUrlSeverity;
  message: string;
  /**
   * When non-null, the caller should SILENTLY replace the field value
   * with this normalized form. Currently used to strip a trailing `/v1`.
   */
  normalized: string | null;
}

/** Returns null iff the URL is acceptable with no user-visible message. */
export function describeBaseUrl(
  rawUrl: string,
  dialect: ProviderDialect
): BaseUrlValidation | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return {
      severity: 'error',
      message: 'Base URL is required.',
      normalized: null
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      severity: 'error',
      message: `"${trimmed}" is not a valid URL. Include the scheme (http:// or https://).`,
      normalized: null
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      severity: 'error',
      message: `Only http:// and https:// are supported. "${parsed.protocol}" is not.`,
      normalized: null
    };
  }

  // Normalize trailing dialect-specific suffix — the chat client
  // already appends it at runtime, so a user-pasted match would
  // double up. The strip is dialect-aware on purpose: OpenRouter's
  // canonical base is `https://openrouter.ai/api`, and that `/api`
  // segment is part of the path the upstream gateway needs. Under
  // the OpenAI dialect we therefore strip `/v1` only; under the
  // Ollama-native dialect we strip `/api` only. The single source of
  // truth for the strip rule is the shared normalizer.
  const stripped = describeStrippedSuffix(trimmed, dialect);
  if (stripped) {
    return {
      severity: 'info',
      message: `Stripped trailing ${stripped.suffix} — Vyotiq appends it automatically.`,
      normalized: stripped.stripped
    };
  }

  const host = parsed.hostname.toLowerCase();
  const isOllamaCloud = host === 'ollama.com' || host === 'www.ollama.com';
  const isAnthropic = host === 'api.anthropic.com';
  const isGemini = host === 'generativelanguage.googleapis.com';

  // Cloud hosts the native API at /api only — no /v1 shim.
  if (isOllamaCloud && dialect === 'openai') {
    return {
      severity: 'warn',
      message:
        'Ollama Cloud does not speak the OpenAI dialect. Switch dialect to "Ollama native" to use https://ollama.com.',
      normalized: null
    };
  }

  if (!isOllamaCloud && dialect === 'ollama-native') {
    // Local daemons and a few custom deployments legitimately use the
    // native dialect, so this is info (not an error) — the user may
    // know something we don't.
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    if (!localHosts.has(host)) {
      return {
        severity: 'warn',
        message:
          'Ollama native dialect is usually paired with localhost:11434 or ollama.com. Double-check this host.',
        normalized: null
      };
    }
  }

  // Phase 8 (2026): Anthropic's `api.anthropic.com` does NOT speak
  // the OpenAI dialect — `/v1/chat/completions` returns 404 (the
  // canonical endpoint is `/v1/messages` with a structured-blocks
  // wire format). Steer users onto the dedicated dialect so
  // thinking signatures round-trip correctly.
  if (isAnthropic && dialect !== 'anthropic-native') {
    return {
      severity: 'warn',
      message:
        'api.anthropic.com requires the "Anthropic native" dialect. The OpenAI shim path does not preserve thinking signatures and breaks multi-turn extended thinking.',
      normalized: null
    };
  }

  // Phase 9 (2026): Gemini's `generativelanguage.googleapis.com` has
  // an OpenAI-compat surface but it does NOT round-trip
  // `thoughtSignature`, so multi-call function-calling 400s on the
  // second turn. Steer users onto the dedicated dialect.
  if (isGemini && dialect !== 'gemini-native') {
    return {
      severity: 'warn',
      message:
        'generativelanguage.googleapis.com requires the "Gemini native" dialect for thoughtSignature round-trip. The OpenAI shim breaks multi-turn function calling on Gemini 3.x.',
      normalized: null
    };
  }

  // The reverse — flag a non-Anthropic / non-Gemini host that's
  // configured for the native dialect, since 99% of those are typos.
  if (dialect === 'anthropic-native' && !isAnthropic) {
    return {
      severity: 'warn',
      message:
        'Anthropic native dialect is usually paired with api.anthropic.com. Double-check this host.',
      normalized: null
    };
  }
  if (dialect === 'gemini-native' && !isGemini) {
    return {
      severity: 'warn',
      message:
        'Gemini native dialect is usually paired with generativelanguage.googleapis.com. Double-check this host.',
      normalized: null
    };
  }

  return null;
}
