/**
 * Build a user-turn `ChatMessage` with XML envelope + optional vision parts.
 */

import type {
  ChatContentPart,
  ChatMessage,
  PromptAttachmentMeta,
  TimelineEvent
} from '@shared/types/chat.js';
import type { MentionRef } from '@shared/types/mention.js';
import type { ModelInputModality, ModelSelection } from '@shared/types/provider.js';
import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import {
  inputModalitiesFromModelId,
  modelSupportsVision
} from '@shared/providers/visionCapabilities.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import { listProviders } from '../providers/providerStore.js';
import { resolveAttachmentsForInline } from '../attachments/resolveAttachmentsForInline.js';
import { resolveMentionsForInline } from '../attachments/resolveMentionsForInline.js';
import { prepareVisionParts } from '../attachments/prepareMediaForVision.js';
import type { PreparedMediaCache } from '../attachments/preparedMediaCache.js';
import { notifyUiToast } from '../ui/uiToast.js';
import { wrapXml } from './envelope/index.js';

export interface BuildUserTurnMessageInput {
  prompt: string;
  selection: ModelSelection;
  workspacePath: string;
  attachmentMeta?: PromptAttachmentMeta[];
  legacyAttachments?: string[];
  mentions?: MentionRef[];
  inputModalities?: ModelInputModality[];
  conversationId?: string;
  runId?: string;
  mediaCache?: PreparedMediaCache;
  signal?: AbortSignal;
}

export interface BuildUserTurnMessageResult {
  message: ChatMessage;
  turnXml: string;
  visionTokenEstimate: number;
  usedVisionParts: boolean;
}

export async function resolveInputModalitiesForSelection(
  selection: ModelSelection
): Promise<ModelInputModality[] | undefined> {
  const providers = await listProviders();
  const provider = providers.find((p) => p.id === selection.providerId);
  if (!provider) {
    return inputModalitiesFromModelId(selection.modelId);
  }
  const model = findProviderModel(provider, selection.modelId);
  return model?.inputModalities ?? inputModalitiesFromModelId(selection.modelId);
}

export async function buildUserTurnMessage(
  input: BuildUserTurnMessageInput
): Promise<BuildUserTurnMessageResult> {
  const modalities =
    input.inputModalities ?? (await resolveInputModalitiesForSelection(input.selection));

  const mergedAttachmentMeta = [...(input.attachmentMeta ?? [])];
  if (input.mentions?.length) {
    for (const ref of input.mentions) {
      if (ref.kind !== 'file' || !ref.workspacePath) continue;
      const meta: PromptAttachmentMeta = {
        id: ref.id,
        name: ref.label,
        workspacePath: ref.workspacePath,
        ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
        mediaKind: mediaKindFromMeta({ name: ref.label, mimeType: ref.mimeType })
      };
      const kind = meta.mediaKind ?? mediaKindFromMeta(meta);
      if (kind !== 'image' && kind !== 'pdf' && kind !== 'video') continue;
      if (mergedAttachmentMeta.some((m) => m.workspacePath === meta.workspacePath)) continue;
      mergedAttachmentMeta.push(meta);
    }
  }

  const userMessageXml = wrapXml('user_message', input.prompt, undefined, { escape: true });
  const attachmentBlocks = await resolveAttachmentsForInline({
    attachmentMeta: input.attachmentMeta,
    legacyAttachments: input.legacyAttachments,
    workspacePath: input.workspacePath,
    signal: input.signal
  });
  const mentionBlocks = await resolveMentionsForInline({
    mentions: input.mentions,
    workspacePath: input.workspacePath,
    signal: input.signal
  });
  const inlineBlocks = [mentionBlocks, attachmentBlocks].filter((p) => p.length > 0).join('\n\n');
  const attachmentsXml =
    inlineBlocks.length > 0
      ? wrapXml('attached_files', inlineBlocks, undefined, { escape: true })
      : '';
  const turnBody = attachmentsXml ? `${userMessageXml}\n${attachmentsXml}` : userMessageXml;
  const turnXml = wrapXml('turn', turnBody);

  let visionParts: ChatContentPart[] = [];
  let visionTokenEstimate = 0;

  if (mergedAttachmentMeta.length) {
    const prepared = await prepareVisionParts({
      attachmentMeta: mergedAttachmentMeta,
      workspacePath: input.workspacePath,
      inputModalities: modalities,
      cache: input.mediaCache,
      cacheKeyPrefix: input.runId,
      signal: input.signal
    });
    visionParts = prepared.parts;
    visionTokenEstimate = prepared.visionTokenEstimate;
  }

  const hasImages = mergedAttachmentMeta.some(
    (m) => (m.mediaKind ?? mediaKindFromMeta(m)) === 'image'
  );
  if (hasImages && !modelSupportsVision(modalities) && input.conversationId) {
    notifyUiToast({
      message:
        'Selected model may not support vision — images sent as path references only.',
      variant: 'info',
      conversationId: input.conversationId
    });
  }

  const usedVisionParts = visionParts.length > 0;
  const message: ChatMessage = usedVisionParts
    ? {
        role: 'user',
        content: [...visionParts, { type: 'text', text: turnXml }]
      }
    : { role: 'user', content: turnXml };

  return { message, turnXml, visionTokenEstimate, usedVisionParts };
}

/**
 * Rebuild replayed user turns that carry attachment metadata so vision
 * parts are re-encoded for the active model.
 */
export async function enrichReplayedVisionMessages(
  messages: ChatMessage[],
  events: TimelineEvent[],
  ctx: Omit<BuildUserTurnMessageInput, 'prompt' | 'attachmentMeta' | 'mentions' | 'legacyAttachments'>
): Promise<ChatMessage[]> {
  const userPrompts = events.filter((e): e is Extract<TimelineEvent, { kind: 'user-prompt' }> => e.kind === 'user-prompt');
  let promptIdx = 0;
  const out = [...messages];
  for (let i = 0; i < out.length; i++) {
    const m = out[i]!;
    if (m.role !== 'user') continue;
    const event = userPrompts[promptIdx];
    promptIdx += 1;
    if (!event) continue;
    if ((!event.attachments || event.attachments.length === 0) && (!event.mentions || event.mentions.length === 0)) {
      continue;
    }
    const built = await buildUserTurnMessage({
      prompt: event.content,
      selection: ctx.selection,
      workspacePath: ctx.workspacePath,
      attachmentMeta: event.attachments,
      mentions: event.mentions,
      inputModalities: ctx.inputModalities,
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      mediaCache: ctx.mediaCache,
      signal: ctx.signal
    });
    out[i] = built.message;
  }
  return out;
}
