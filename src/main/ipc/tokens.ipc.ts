/**
 * Token-estimation IPC. Single channel that counts BPE tokens for a
 * composer draft (prompt + attachment contents). The renderer calls
 * this on a debounce while the user types so the composer's usage pill
 * reflects the actual to-be-sent payload.
 */

import { IPC } from '@shared/constants.js';
import { estimateTokens } from '../providers/tokenCounter.js';
import { getWorkspace } from '../workspace/workspaceState.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

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
}

export function registerTokensIpc(): void {
  wrapIpcHandler(IPC.TOKENS_ESTIMATE, async (_event, input: EstimateInputWire) => {
    const modelId = typeof input?.modelId === 'string' ? input.modelId : '';
    const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
    // F-023: drop the prior `input!.attachments!.filter(...)` non-null
    // assertions. The `Array.isArray(input?.attachments)` guard already
    // proves both `input` and `input.attachments` are defined; the `!`
    // operators were TypeScript noise that misleadingly suggested the
    // narrowing was incomplete.
    const attachments = Array.isArray(input?.attachments)
      ? input.attachments.filter((p): p is string => typeof p === 'string')
      : [];
    const ws = await getWorkspace();
    return estimateTokens({
      modelId,
      prompt,
      attachments,
      ...(ws.path ? { workspacePath: ws.path } : {})
    });
  });
}
