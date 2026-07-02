/**
 * Prospective context-window evaluation for the composer meter when no live
 * run is active. Builds the same cache-layered message array the orchestrator
 * would send on the next iteration and runs it through {@link evaluateContextBudget}.
 */

import type { ChatMessage, PromptAttachmentMeta } from '@shared/types/chat.js';
import type { ContextManagementSettings } from '@shared/settings/agentBehaviorSettings.js';
import type { ContextUsageSummary } from '@shared/context/contextLevel.js';
import { DEFAULT_MAX_TOTAL_ITERATIONS } from '@shared/constants.js';
import { buildOrchestratorSystemPrompt } from '../../harness/harnessLoader.js';
import { refreshEnvelopes } from '../contextManager.js';
import { replayTranscript } from '../replay/replayTranscript.js';
import { readConversation } from '../../conversations/conversationStore.js';
import { requireWorkspaceById } from '../../workspace/workspaceState.js';
import { listCatalogueSkillNames } from '../../skills/skillRegistry.js';
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
import {
  buildUserTurnMessage,
  enrichReplayedVisionMessages,
  resolveInputModalitiesForSelection
} from '../buildUserTurnMessage.js';
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

async function buildProspectiveMessages(
  input: EvaluateConversationContextInput,
  workspacePath: string
): Promise<ChatMessage[]> {
  const selection = { providerId: input.providerId, modelId: input.modelId };
  const modalities = await resolveInputModalitiesForSelection(selection);

  let replayed: ChatMessage[] = [];
  if (input.conversationId) {
    const conv = await readConversation(input.conversationId);
    if (conv) {
      replayed = replayTranscript(conv.events);
      replayed = await enrichReplayedVisionMessages(replayed, conv.events, {
        selection,
        workspacePath,
        inputModalities: modalities
      });
    }
  }

  const built = await buildUserTurnMessage({
    prompt: input.draftPrompt ?? '',
    selection,
    workspacePath,
    attachmentMeta: input.draftAttachmentMeta,
    inputModalities: modalities
  });
  const turnEnvelope = built.message.content ?? '';
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
    snapshotRunState(runStateAcc, createSpinSignatureBuffer(), 0, DEFAULT_MAX_TOTAL_ITERATIONS)
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
  const skillNames = await listCatalogueSkillNames(workspacePath);
  return evaluateContextBudget({
    messages,
    modelId: input.modelId,
    providerId: input.providerId,
    settings: input.settings,
    tools: toolSchemasFor(AGENT_TOOLS, { contextSkillNames: skillNames }),
    skipRemoteRefine: true,
    ...(input.calibrationRatio !== undefined ? { calibrationRatio: input.calibrationRatio } : {})
  });
}
