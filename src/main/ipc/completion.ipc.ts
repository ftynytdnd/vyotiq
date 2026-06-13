/**
 * Inline completion IPC — editor FIM + composer prompt continuation.
 */

import { IPC } from '@shared/constants.js';
import type { CompletionInput, CompletionReply } from '@shared/types/completion.js';
import { requestInlineCompletion } from '../providers/completionClient.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertEnum,
  assertNumber,
  assertObject,
  assertOptionalString,
  assertString
} from './validate.js';

const inflight = new Map<string, AbortController>();

function slotKey(kind: CompletionInput['kind'], workspaceId?: string): string {
  return `${kind}:${workspaceId ?? '_'}`;
}

function cancelPrior(slot: string): AbortController {
  inflight.get(slot)?.abort();
  const ac = new AbortController();
  inflight.set(slot, ac);
  return ac;
}

export function registerCompletionIpc(): void {
  wrapIpcHandler(
    IPC.COMPLETION_REQUEST,
    async (_event, input: CompletionInput): Promise<CompletionReply> => {
      assertObject('completion:request', 'input', input);
      assertEnum('completion:request', 'kind', input.kind, ['editor', 'composer'] as const);
      assertNumber('completion:request', 'requestId', input.requestId, { min: 0 });
      assertString('completion:request', 'providerId', input.providerId);
      assertString('completion:request', 'model', input.model);
      assertString('completion:request', 'prefix', input.prefix, { maxBytes: 64_000 });
      assertOptionalString('completion:request', 'suffix', input.suffix, { maxBytes: 32_000 });
      assertOptionalString('completion:request', 'filePath', input.filePath, { maxBytes: 4096 });
      assertOptionalString('completion:request', 'workspaceId', input.workspaceId);

      const slot = slotKey(input.kind, input.workspaceId);
      const ac = cancelPrior(slot);
      try {
        const text = await requestInlineCompletion(input, ac.signal);
        return { requestId: input.requestId, text };
      } finally {
        if (inflight.get(slot) === ac) inflight.delete(slot);
      }
    }
  );

  wrapIpcHandler(IPC.COMPLETION_CANCEL, async (_event, kind: CompletionInput['kind'], workspaceId?: string) => {
    assertEnum('completion:cancel', 'kind', kind, ['editor', 'composer'] as const);
    assertOptionalString('completion:cancel', 'workspaceId', workspaceId);
    inflight.get(slotKey(kind, workspaceId))?.abort();
    inflight.delete(slotKey(kind, workspaceId));
  });
}

export function teardownCompletionIpc(): void {
  for (const ac of inflight.values()) ac.abort();
  inflight.clear();
}
