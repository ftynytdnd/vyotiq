/**
 * Prospective context-window evaluation for the composer meter when no live
 * run is active. Builds the same cache-layered message array the orchestrator
 * would send on the next iteration and runs it through {@link evaluateContextBudget}.
 */

import type { ChatMessage, PromptAttachmentMeta } from '@shared/types/chat.js';
import type { ContextManagementSettings } from '@shared/settings/agentBehaviorSettings.js';
import type { ContextUsageSummary } from '@shared/context/contextLevel.js';
import { buildOrchestratorSystemPrompt } from '../../harness/harnessLoader.js';
import { refreshEnvelopes } from '../contextManager.js';
import { replayTranscript } from '../replay/replayTranscript.js';
import { readConversation } from '../../conversations/conversationStore.js';
import { requireWorkspaceById } from '../../workspace/workspaceState.js';
import { resolveAttachmentsForInline } from '../../attachments/resolveAttachmentsForInline.js';
import { wrapXml } from '../envelope/index.js';
import { toolSchemasFor } from '../../tools/registry.js';
import { AGENT_TOOLS } from '../../tools/policy/index.js';
import {
  applyCacheLayers,
  seedCacheLayeredMessages
} from './buildContextLayers.js';
import { buildHostEnvironmentXml } from '../loop/buildHostEnvironment.js';
import {
  buildRunStateXml,
  createRunStateAccumulator,
  snapshotRunState
} from '../loop/buildRunState.js';
import { createSpinSignatureBuffer } from '../loop/toolSpinSignature.js';
import { evaluateContextBudget } from './contextBudget.js';

export interface EvaluateConversationContextInput {
  conversationId?: string;
  workspaceId: string;
  modelId: string;
  providerId: string;
  settings: ContextManagementSettings;
  /** Composer draft — folded into the turn slot when present. */
  draftPrompt?: string;
  draftAttachmentMeta?: PromptAttachmentMeta[];
  calibrationRatio?: number;
}

async function buildTurnEnvelope(
  draftPrompt: string,
  attachmentMeta: PromptAttachmentMeta[] | undefined,
  workspacePath: string
): Promise<string> {
  const trimmed = draftPrompt.trim();
  const userMessageXml = wrapXml(
    'user_message',
    trimmed.length > 0 ? trimmed : '',
    undefined,
    { escape: true }
  );
  const attachmentBlocks =
    attachmentMeta && attachmentMeta.length > 0
      ? await resolveAttachmentsForInline({
          attachmentMeta,
          workspacePath
        })
      : '';
  const attachmentsXml =
    attachmentBlocks.length > 0
      ? wrapXml('attached_files', attachmentBlocks, undefined, { escape: true })
      : '';
  const turnBody = attachmentsXml ? `${userMessageXml}\n${attachmentsXml}` : userMessageXml;
  return wrapXml('turn', turnBody);
}

async function buildProspectiveMessages(
  input: EvaluateConversationContextInput,
  workspacePath: string
): Promise<ChatMessage[]> {
  let replayed: ChatMessage[] = [];
  if (input.conversationId) {
    const conv = await readConversation(input.conversationId);
    if (conv) {
      replayed = replayTranscript(conv.events);
    }
  }

  const turnEnvelope = await buildTurnEnvelope(
    input.draftPrompt ?? '',
    input.draftAttachmentMeta,
    workspacePath
  );
  const messages = seedCacheLayeredMessages(replayed, turnEnvelope);

  const harness = buildOrchestratorSystemPrompt();
  const query = input.draftPrompt?.trim() ?? '';
  const env = await refreshEnvelopes(
    query,
    input.conversationId,
    workspacePath,
    input.workspaceId
  );
  const runStateAcc = createRunStateAccumulator();
  const runStateXml = buildRunStateXml(
    snapshotRunState(runStateAcc, createSpinSignatureBuffer(), 0)
  );
  applyCacheLayers(messages, {
    harness,
    env,
    runStateXml,
    hostEnvironmentXml: buildHostEnvironmentXml()
  });
  return messages;
}

/** Evaluate how full the next request would be for the given conversation + model. */
export async function evaluateConversationContext(
  input: EvaluateConversationContextInput
): Promise<ContextUsageSummary> {
  const workspacePath = await requireWorkspaceById(input.workspaceId);
  const messages = await buildProspectiveMessages(input, workspacePath);
  return evaluateContextBudget({
    messages,
    modelId: input.modelId,
    providerId: input.providerId,
    settings: input.settings,
    tools: toolSchemasFor(AGENT_TOOLS),
    skipRemoteRefine: true,
    ...(input.calibrationRatio !== undefined ? { calibrationRatio: input.calibrationRatio } : {})
  });
}
