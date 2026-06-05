/**
 * Shared rewind preview + confirm logic for inline prompt edit / revert.
 */

import { useEffect, useMemo, useState } from 'react';
import type { RewindPreview, RewindPreviewResult } from '@shared/types/checkpoint.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import type { MentionRef } from '@shared/types/mention.js';
import {
  documentTrimmedPlain,
  hasComposerContent,
  parseMentionDocument
} from '../../composer/mention/mentionDocument.js';
import { useCheckpointsStore } from '../../../store/useCheckpointsStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../../store/useSettingsStore.js';
import { useConversationProcessing } from '../../../hooks/chat/index.js';
import type { RevertIntent } from './RevertPromptContext.js';
import { explainPreviewError } from './rewindPreviewErrors.js';
import { computeRewindImpactTotals } from './RewindImpactSummary.js';

export type RewindSessionPhase =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: RewindPreview }
  | { kind: 'error'; message: string }
  | { kind: 'reverting' }
  | { kind: 'sending' };

interface UseRewindPromptSessionInput {
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
  intent: RevertIntent;
  model: ModelSelection | null;
  attachmentCount?: number;
  onComplete: () => void;
}

export function useRewindPromptSession({
  conversationId,
  workspaceId,
  promptEventId,
  intent,
  model,
  attachmentCount = 0,
  onComplete
}: UseRewindPromptSessionInput) {
  const previewRewind = useCheckpointsStore((s) => s.previewRewind);
  const rewindToPrompt = useCheckpointsStore((s) => s.rewindToPrompt);
  const send = useChatStore((s) => s.send);
  const settings = useSettingsStore((s) => s.settings);
  const showToast = useToastStore((s) => s.show);
  const { isProcessing } = useConversationProcessing(conversationId);

  const isEdit = intent.kind === 'edit';
  const initialEditContent = isEdit ? intent.originalContent : '';

  const [phase, setPhase] = useState<RewindSessionPhase>({ kind: 'loading' });
  const [editText, setEditText] = useState(initialEditContent);

  useEffect(() => {
    setEditText(initialEditContent);
  }, [promptEventId, intent.kind, initialEditContent]);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    void (async () => {
      const result: RewindPreviewResult = await previewRewind({
        conversationId,
        workspaceId,
        promptEventId
      });
      if (cancelled) return;
      if (result.ok === false) {
        setPhase({ kind: 'error', message: explainPreviewError(result.error) });
        return;
      }
      setPhase({ kind: 'ready', preview: result });
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, workspaceId, promptEventId, previewRewind]);

  const totals = useMemo(() => {
    if (phase.kind !== 'ready') return null;
    return computeRewindImpactTotals(phase.preview.files, phase.preview.runIds.length);
  }, [phase]);

  const editDoc = parseMentionDocument(editText);
  const trimmedEdit = documentTrimmedPlain(editDoc);
  const hasEditContent = hasComposerContent(editDoc) || attachmentCount > 0;
  const editConfirmDisabled = isEdit && (!hasEditContent || model === null);
  const primaryDisabled = phase.kind !== 'ready' || (isEdit && editConfirmDisabled);
  const isBusy = phase.kind === 'reverting' || phase.kind === 'sending';

  const confirm = async (
    attachmentMeta?: PromptAttachmentMeta[],
    attachmentPromptEventId?: string,
    mentions?: MentionRef[]
  ) => {
    if (phase.kind !== 'ready') return;
    const hasAttachments = (attachmentMeta?.length ?? 0) > 0;
    if (isEdit) {
      const hasMentions = (mentions?.length ?? 0) > 0;
      if (trimmedEdit.length === 0 && !hasAttachments && !hasMentions) return;
      if (!model) {
        showToast('Select a model before resending.', 'danger');
        return;
      }
    }

    setPhase({ kind: 'reverting' });
    const result = await rewindToPrompt({ conversationId, workspaceId, promptEventId });
    if (result.ok === false) {
      const msg = explainPreviewError(result.error);
      showToast(`Revert failed: ${msg}`, 'danger');
      setPhase({ kind: 'error', message: msg });
      return;
    }
    const failedCount = result.failedFiles.length;
    if (failedCount > 0) {
      showToast(
        `Rewind failed for ${failedCount} file${failedCount === 1 ? '' : 's'} (see logs).`,
        'danger'
      );
    } else if (result.removedTranscriptEvents > 0) {
      showToast(
        `Removed ${result.removedTranscriptEvents} transcript event${result.removedTranscriptEvents === 1 ? '' : 's'} (files on disk unchanged).`,
        isEdit ? 'info' : 'success'
      );
    } else if (!isEdit) {
      showToast('Conversation rewound (no transcript events removed).', 'info');
    }

    if (!isEdit) {
      onComplete();
      return;
    }

    setPhase({ kind: 'sending' });
    try {
      const permissions = selectEffectivePermissions(workspaceId, settings);
      const meta = hasAttachments ? attachmentMeta : undefined;
      const hasMentions = (mentions?.length ?? 0) > 0;
      const prompt =
        trimmedEdit.length > 0
          ? trimmedEdit
          : hasAttachments || hasMentions
            ? 'See attached files.'
            : trimmedEdit;
      const sendOpts: Parameters<typeof send>[3] = {};
      if (meta?.length) {
        sendOpts.attachmentMeta = meta;
        if (attachmentPromptEventId) sendOpts.promptEventId = attachmentPromptEventId;
      }
      if (hasMentions && mentions) sendOpts.mentions = mentions;
      await send(prompt, model!, permissions, Object.keys(sendOpts).length > 0 ? sendOpts : undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not resend the edited message: ${msg}`, 'danger');
    }
    onComplete();
  };

  return {
    isEdit,
    isProcessing,
    phase,
    totals,
    editText,
    setEditText,
    trimmedEdit,
    primaryDisabled,
    isBusy,
    confirm
  };
}
