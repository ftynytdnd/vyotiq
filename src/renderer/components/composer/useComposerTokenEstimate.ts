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
}

export interface ComposerTokenEstimate {
  /** Best-effort token count; falls back to chars/3.8 for unknown models. */
  tokens: number;
  /** True when the BPE tokenizer matched the model's encoding. */
  exact: boolean;
}

export function useComposerTokenEstimate(
  input: UseComposerTokenEstimateInput
): ComposerTokenEstimate {
  const { modelId, prompt, attachments } = input;
  const [value, setValue] = useState<ComposerTokenEstimate>({ tokens: 0, exact: false });
  // Latest-write-wins: stale IPC replies (e.g. user typed more after the
  // request fired) are discarded via a monotonically-increasing id.
  const reqIdRef = useRef(0);

  // Stringify the attachments list so the effect's dep array compares by
  // content, not by array identity. Cheap — usually 0-3 entries.
  const attachmentsKey = attachments.join('\x00');

  useEffect(() => {
    if (!modelId) {
      setValue({ tokens: 0, exact: false });
      return;
    }
    const myId = ++reqIdRef.current;
    const handle = setTimeout(() => {
      void vyotiq.tokens
        .estimate({ modelId, prompt, attachments })
        .then((result) => {
          if (myId !== reqIdRef.current) return;
          setValue({ tokens: result.tokens, exact: result.exact });
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
  }, [modelId, prompt, attachmentsKey]);

  return value;
}
