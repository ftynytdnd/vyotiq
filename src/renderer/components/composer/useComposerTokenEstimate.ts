/**
 * Pre-flight token estimate for a composer draft. Debounced IPC call
 * to the main-process tokenizer (`gpt-tokenizer`) so the usage pill
 * updates while the user types without triggering a tokenization pass
 * on every keystroke.
 *
 * The hook deliberately returns the LAST known value during loading
 * rather than flipping to `null`, so the pill doesn't blink between
 * each debounced tick. On IPC failure, it silently keeps the previous
 * value and logs through the structured renderer logger — pre-flight is
 * best-effort UI, never an error surface.
 *
 * Phase 2 (2026): when `conversationId` is supplied, the hook asks the
 * main process for the full prospective payload estimate — system
 * prompt + harness + envelopes + replayed history + tool schemas +
 * draft. The pill then reads the AUTHORITATIVE wire size pre-flight,
 * not just the draft. The main process caches the baseline portion
 * for ~2s per `(conversationId, modelId)`, so a burst of keystrokes
 * is a fast lookup.
 */

import { useEffect, useRef, useState } from 'react';
import { vyotiq } from '../../lib/ipc.js';
import { logger } from '../../lib/logger.js';

const log = logger.child('composer/token-estimate');

const DEBOUNCE_MS = 150;

export interface UseComposerTokenEstimateInput {
  /** Active model id. Empty string disables the hook. */
  modelId: string;
  prompt: string;
  attachments: string[];
  /**
   * Active conversation id (Phase 2). When supplied, the estimate
   * includes the full prospective payload (harness + envelopes +
   * tools + replayed history + draft) instead of just the draft.
   * Omit to keep the legacy draft-only behaviour.
   */
  conversationId?: string;
}

export interface ComposerTokenBaseline {
  /** Sum of system + history + tools. */
  total: number;
  /** Harness + envelopes + run-state, tokenized as a chat block. */
  systemPrompt: number;
  /** Replayed history (user / assistant / tool messages). */
  history: number;
  /** Tool-schema JSON, compact-serialized. */
  tools: number;
}

export interface ComposerTokenEstimate {
  /**
   * Best-effort total token count.
   *   - Legacy mode (no conversationId): just the draft + attachments.
   *   - Full mode (conversationId set): `baseline.total + draftTokens`.
   */
  tokens: number;
  /** True when every part used a real BPE tokenizer (no heuristic fallback). */
  exact: boolean;
  /** Draft + attachments alone. Same value as `tokens` in legacy mode. */
  draftTokens: number;
  /** Per-part breakdown of the prospective payload, when available. */
  baseline?: ComposerTokenBaseline;
}

export function useComposerTokenEstimate(
  input: UseComposerTokenEstimateInput
): ComposerTokenEstimate {
  const { modelId, prompt, attachments, conversationId } = input;
  const [value, setValue] = useState<ComposerTokenEstimate>({
    tokens: 0,
    exact: false,
    draftTokens: 0
  });
  // Latest-write-wins: stale IPC replies (e.g. user typed more after the
  // request fired) are discarded via a monotonically-increasing id.
  const reqIdRef = useRef(0);

  // Stringify the attachments list so the effect's dep array compares by
  // content, not by array identity. Cheap — usually 0-3 entries.
  const attachmentsKey = attachments.join('\x00');

  useEffect(() => {
    if (!modelId) {
      setValue({ tokens: 0, exact: false, draftTokens: 0 });
      return;
    }
    const myId = ++reqIdRef.current;
    const handle = setTimeout(() => {
      const wire: Parameters<typeof vyotiq.tokens.estimate>[0] = {
        modelId,
        prompt,
        attachments
      };
      if (conversationId) wire.conversationId = conversationId;
      void vyotiq.tokens
        .estimate(wire)
        .then((result) => {
          if (myId !== reqIdRef.current) return;
          // `draftTokens` is present when the handler tokenized the full
          // payload; otherwise the legacy shape's `tokens` field IS the
          // draft total. Either way we normalize to the new shape so the
          // consumer doesn't branch.
          const draftTokens =
            typeof result.draftTokens === 'number' ? result.draftTokens : result.tokens;
          const next: ComposerTokenEstimate = {
            tokens: result.tokens,
            exact: result.exact,
            draftTokens
          };
          if (result.baseline) next.baseline = result.baseline;
          setValue(next);
        })
        .catch((err: unknown) => {
          // Pre-flight is best-effort. Don't surface; just log so a
          // developer poking at devtools can see it. Routed through
          // the structured logger so `__VYOTIQ_LOG_LEVEL='debug'`
          // gates these messages consistently with everything else.
          log.debug('token estimate failed', { err });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // `attachments` comes through as a joined string so the effect
    // re-fires only when its membership actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, prompt, attachmentsKey, conversationId]);

  return value;
}
