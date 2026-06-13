/**
 * Debounced inline completion requests with stale-response guards.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { CompletionKind, CompletionReply } from '@shared/types/completion.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { vyotiq } from './ipc.js';

export interface UseInlineCompletionOptions {
  kind: CompletionKind;
  enabled: boolean;
  debounceMs: number;
  model: ModelSelection | null;
  workspaceId?: string | null;
  filePath?: string;
}

export interface InlineCompletionScheduleContext {
  /** Plain-text caret offset when the request was scheduled (composer). */
  caretOffset?: number;
  suffix?: string;
}

export function useInlineCompletion(options: UseInlineCompletionOptions) {
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostRef = useRef<string | null>(null);
  const onGhostRef = useRef<(text: string | null) => void>(() => {});
  const pendingContextRef = useRef<InlineCompletionScheduleContext | null>(null);

  const setOnGhost = useCallback((cb: (text: string | null) => void) => {
    onGhostRef.current = cb;
  }, []);

  const cancelInFlight = useCallback(() => {
    void vyotiq.completion.cancel(options.kind, options.workspaceId ?? undefined);
  }, [options.kind, options.workspaceId]);

  const clearGhost = useCallback(() => {
    ghostRef.current = null;
    pendingContextRef.current = null;
    onGhostRef.current(null);
    cancelInFlight();
  }, [cancelInFlight]);

  const schedule = useCallback(
    (prefix: string, ctx?: InlineCompletionScheduleContext) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      clearGhost();

      if (!options.enabled || !options.model) return;
      const trimmed = prefix.trim();
      if (trimmed.length < 3) return;

      const snapshot: InlineCompletionScheduleContext = {
        caretOffset: ctx?.caretOffset,
        suffix: ctx?.suffix
      };

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const requestId = ++seqRef.current;
        pendingContextRef.current = snapshot;
        const { providerId, modelId } = options.model!;
        void vyotiq.completion
          .request({
            kind: options.kind,
            requestId,
            providerId,
            model: modelId,
            prefix,
            suffix: snapshot.suffix ?? '',
            workspaceId: options.workspaceId ?? undefined,
            filePath: options.filePath
          })
          .then((reply: CompletionReply) => {
            if (reply.requestId !== seqRef.current) return;
            if (pendingContextRef.current !== snapshot) return;
            const text = reply.text.trim();
            if (!text) return;
            ghostRef.current = text;
            onGhostRef.current(text);
          })
          .catch(() => {
            /* silent — completion is best-effort */
          });
      }, options.debounceMs);
    },
    [
      clearGhost,
      options.debounceMs,
      options.enabled,
      options.filePath,
      options.kind,
      options.model,
      options.workspaceId
    ]
  );

  const acceptGhost = useCallback((): string | null => {
    const text = ghostRef.current;
    if (!text) return null;
    ghostRef.current = null;
    pendingContextRef.current = null;
    onGhostRef.current(null);
    seqRef.current++;
    cancelInFlight();
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return text;
  }, [cancelInFlight]);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    ghostRef.current = null;
    pendingContextRef.current = null;
    onGhostRef.current(null);
    cancelInFlight();
    seqRef.current++;
  }, [
    cancelInFlight,
    options.debounceMs,
    options.enabled,
    options.model?.modelId,
    options.model?.providerId
  ]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      cancelInFlight();
      seqRef.current++;
    };
  }, [cancelInFlight]);

  return { schedule, clearGhost, acceptGhost, setOnGhost, pendingContextRef };
}
