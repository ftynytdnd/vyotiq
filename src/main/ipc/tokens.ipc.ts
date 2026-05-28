/**
 * Token-estimation IPC. Single channel that counts BPE tokens for a
 * composer draft (prompt + attachment contents). The renderer calls
 * this on a debounce while the user types so the composer's usage pill
 * reflects the actual to-be-sent payload.
 *
 * Phase 2 (2026) added the optional `conversationId` field on the wire.
 * When supplied, the handler tokenizes the FULL prospective `messages[]`
 * (system prompt + harness + envelopes + replayed history + tool
 * schemas) and returns a per-part breakdown alongside the draft tokens
 * the legacy shape carried. Callers that don't pass `conversationId`
 * keep getting the legacy shape unchanged.
 */

import { IPC, MAX_CHAT_ATTACHMENTS, MAX_USER_PROMPT_BYTES } from '@shared/constants.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import {
  estimateTokens,
  tokenizeMessages,
  type MessagesEstimateResult
} from '../providers/tokenCounter.js';
import { getWorkspace, requireWorkspaceById } from '../workspace/workspaceState.js';
import { getProspectiveMessages } from '../orchestrator/prospectiveMessages.js';
import { getConversationMeta } from '../conversations/conversationStore.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertObject,
  assertOptionalString,
  assertStringArray
} from './validate.js';

const log = logger.child('ipc/tokens');

const MAX_ATTACHMENT_PATH_BYTES = 4096;

/**
 * Wire shape of the renderer's `vyotiq.tokens.estimate(...)` argument.
 * All fields are optional on the wire because the renderer pre-flight
 * call sometimes fires with a partial draft (e.g. before a model is
 * selected). The handler defaults each missing field below — invalid
 * shapes never throw.
 *
 * Strictly a subset of `EstimateInput` from `providers/tokenCounter.ts`
 * (which adds the resolved `workspacePath`). We don't import that type
 * directly here because the IPC boundary is `unknown`-shaped; this
 * local interface documents the contract the renderer is expected to
 * meet without coupling the wire shape to the implementation type.
 */
interface EstimateInputWire {
  modelId?: string;
  prompt?: string;
  attachments?: string[];
  attachmentMeta?: PromptAttachmentMeta[];
  /**
   * Phase 2: when present, the handler tokenizes the full prospective
   * `messages[]` for this conversation and returns the per-part
   * breakdown alongside the draft. Omit to get the legacy draft-only
   * shape (no `baseline` field on the response).
   */
  conversationId?: string;
}

/**
 * Per-conversation baseline cache. The harness + envelopes + replayed
 * history + tool schemas don't change between keystrokes; only the
 * user's draft does. We tokenize the baseline ONCE per
 * `(conversationId, modelId, eventCountAtCacheTime)` tuple and let
 * every keystroke add just the draft estimate on top.
 *
 * TTL keeps a stale baseline from surviving a new turn landing on the
 * same conversation. 2 seconds is enough to absorb a burst of keystrokes
 * but expires before the next assistant turn could meaningfully grow
 * the history. The cache is also wiped on every fresh `conversationId`
 * the IPC sees, so switching conversations forces a fresh build.
 */
const BASELINE_TTL_MS = 2_000;
const BASELINE_CACHE_MAX = 8;

interface BaselineEntry {
  expiresAt: number;
  result: MessagesEstimateResult;
}
const baselineCache = new Map<string, BaselineEntry>();

function baselineCacheKey(conversationId: string, modelId: string): string {
  return `${conversationId}\u0000${modelId}`;
}

/**
 * Tokenize the full prospective payload for `conversationId` against
 * `modelId`. Caches the result per `(conversationId, modelId)` for
 * `BASELINE_TTL_MS` so a burst of keystroke pre-flight calls hits
 * warm cache.
 *
 * Falls back to a zero-baseline shape on any error — pre-flight is
 * best-effort UI, never an error surface.
 */
async function getBaselineEstimate(
  conversationId: string,
  modelId: string
): Promise<MessagesEstimateResult> {
  const now = Date.now();
  const key = baselineCacheKey(conversationId, modelId);
  const hit = baselineCache.get(key);
  if (hit && hit.expiresAt > now) {
    // Re-insert so this key floats to the tail (LRU). Mirrors the
    // pattern used in `contextManager.envelopeCache`.
    baselineCache.delete(key);
    baselineCache.set(key, hit);
    return hit.result;
  }
  if (hit) baselineCache.delete(key);

  let result: MessagesEstimateResult;
  try {
    const prospect = await getProspectiveMessages(conversationId);
    result = tokenizeMessages(modelId, prospect.messages, prospect.tools);
  } catch (err: unknown) {
    log.debug('getBaselineEstimate failed; returning zero baseline', {
      conversationId,
      modelId,
      err: err instanceof Error ? err.message : String(err)
    });
    result = {
      total: 0,
      exact: false,
      byPart: { systemPrompt: 0, history: 0, tools: 0 }
    };
  }

  baselineCache.set(key, { expiresAt: now + BASELINE_TTL_MS, result });
  if (baselineCache.size > BASELINE_CACHE_MAX) {
    for (const oldest of baselineCache.keys()) {
      baselineCache.delete(oldest);
      break;
    }
  }
  return result;
}

/**
 * Test-only escape hatch. Clears the per-conversation baseline cache
 * so per-test state can't leak. Never imported from production code.
 */
export function __resetTokensIpcCacheForTests(): void {
  baselineCache.clear();
}

/** Resolve the sandbox root for attachment inlining / draft estimates. */
async function resolveWorkspacePathForEstimate(
  conversationId?: string
): Promise<string | undefined> {
  if (conversationId) {
    const meta = await getConversationMeta(conversationId).catch(() => null);
    if (meta?.workspaceId) {
      try {
        return await requireWorkspaceById(meta.workspaceId);
      } catch (err: unknown) {
        log.debug('requireWorkspaceById failed; falling back to active workspace', {
          workspaceId: meta.workspaceId,
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  const ws = await getWorkspace();
  return ws.path ?? undefined;
}

const estimateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const ESTIMATE_RATE_PER_SEC = 8;
const ESTIMATE_BURST = 16;

function takeEstimateToken(key: string): boolean {
  const now = Date.now();
  let b = estimateBuckets.get(key);
  if (!b) {
    b = { tokens: ESTIMATE_BURST, lastRefill: now };
    estimateBuckets.set(key, b);
  }
  const elapsed = (now - b.lastRefill) / 1000;
  if (elapsed > 0) {
    b.tokens = Math.min(ESTIMATE_BURST, b.tokens + elapsed * ESTIMATE_RATE_PER_SEC);
    b.lastRefill = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function registerTokensIpc(): void {
  wrapIpcHandler(IPC.TOKENS_ESTIMATE, async (_event, input: EstimateInputWire) => {
    if (!takeEstimateToken('global')) {
      throw new Error('tokens:estimate rate limit exceeded — retry shortly');
    }
    assertObject('tokens:estimate', 'input', input ?? {});
    const wire = input ?? {};
    assertOptionalString('tokens:estimate', 'modelId', wire.modelId, { nonEmpty: false });
    assertOptionalString('tokens:estimate', 'prompt', wire.prompt, {
      nonEmpty: false,
      maxBytes: MAX_USER_PROMPT_BYTES
    });
    assertOptionalString('tokens:estimate', 'conversationId', wire.conversationId);
    if (wire.attachments !== undefined) {
      assertStringArray('tokens:estimate', 'attachments', wire.attachments, {
        nonEmpty: false,
        maxBytes: MAX_ATTACHMENT_PATH_BYTES,
        maxItems: MAX_CHAT_ATTACHMENTS
      });
    }
    if (wire.attachmentMeta !== undefined) {
      if (!Array.isArray(wire.attachmentMeta)) {
        throw new Error('tokens:estimate: attachmentMeta must be an array');
      }
      if (wire.attachmentMeta.length > MAX_CHAT_ATTACHMENTS) {
        throw new Error(`tokens:estimate: attachmentMeta exceeds max ${MAX_CHAT_ATTACHMENTS}`);
      }
    }

    const modelId = typeof wire.modelId === 'string' ? wire.modelId : '';
    const prompt = typeof wire.prompt === 'string' ? wire.prompt : '';
    const attachments = Array.isArray(wire.attachments)
      ? wire.attachments.filter((p): p is string => typeof p === 'string')
      : [];
    const attachmentMeta = Array.isArray(wire.attachmentMeta)
      ? (wire.attachmentMeta as PromptAttachmentMeta[])
      : undefined;
    const conversationId =
      typeof wire.conversationId === 'string' && wire.conversationId.length > 0
        ? wire.conversationId
        : undefined;
    const workspacePath = await resolveWorkspacePathForEstimate(conversationId);
    const draft = await estimateTokens({
      modelId,
      prompt,
      attachments,
      ...(attachmentMeta ? { attachmentMeta } : {}),
      ...(workspacePath ? { workspacePath } : {})
    });

    // Legacy callers — no `conversationId` → legacy shape (just the
    // draft estimate). Field-additive on the wire so existing renderer
    // code paths see the exact same response.
    if (!conversationId || !modelId) {
      return { tokens: draft.tokens, exact: draft.exact };
    }

    // Phase 2 callers — include the baseline breakdown.
    const baseline = await getBaselineEstimate(conversationId, modelId);
    return {
      tokens: draft.tokens + baseline.total,
      exact: draft.exact && baseline.exact,
      draftTokens: draft.tokens,
      baseline: {
        total: baseline.total,
        systemPrompt: baseline.byPart.systemPrompt,
        history: baseline.byPart.history,
        tools: baseline.byPart.tools
      }
    };
  });
}
