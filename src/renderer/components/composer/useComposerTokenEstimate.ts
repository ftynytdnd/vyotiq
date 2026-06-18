/**
 * Debounced pre-flight token estimate via main-process IPC.
 * Falls back to the shared chars/3.8 heuristic when IPC fails.
 */

import { useEffect, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { tokenizeForModel } from '@shared/text/tokenizeForModel.js';
import { vyotiq } from '../../lib/ipc.js';

export interface ComposerTokenEstimate {
  tokens: number;
  exact: boolean;
}

interface UseComposerTokenEstimateInput {
  model: ModelSelection | null;
  prompt: string;
  attachmentMeta: PromptAttachmentMeta[];
  workspacePath: string;
  enabled: boolean;
}

const DEBOUNCE_MS = 280;

export function useComposerTokenEstimate({
  model,
  prompt,
  attachmentMeta,
  workspacePath,
  enabled
}: UseComposerTokenEstimateInput): ComposerTokenEstimate | null {
  const [estimate, setEstimate] = useState<ComposerTokenEstimate | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !model || prompt.trim().length === 0) {
      setEstimate(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await vyotiq.tokens.estimate({
            modelId: model.modelId,
            prompt,
            attachmentMeta,
            workspacePath: workspacePath || undefined,
            selection: model
          });
          if (requestIdRef.current !== requestId) return;
          setEstimate({ tokens: result.tokens, exact: result.exact });
        } catch {
          if (requestIdRef.current !== requestId) return;
          setEstimate({
            tokens: tokenizeForModel(model.modelId, prompt),
            exact: false
          });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [enabled, model, prompt, attachmentMeta, workspacePath]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  return estimate;
}
