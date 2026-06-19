import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ModelSelection } from '@shared/types/provider.js';
import type { FollowUpMessage } from '@shared/types/followUp.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerStatusStrip } from './ComposerStatusStrip.js';
import { ComposerCacheStatPill } from './ComposerCacheStatPill.js';
import { CaptureScreenButton } from './CaptureScreenButton.js';
import { AttachmentButton } from './AttachmentButton.js';
import { SendButton } from './SendButton.js';
import { StopButton } from './StopButton.js';
import { FollowUpTrayHost } from './followUps/index.js';
import { ModelPicker } from './modelPicker/index.js';
import { TokenUsagePill } from './TokenUsagePill.js';
import { ContextWindowMeter } from './ContextWindowMeter.js';
import { PromptAttachmentCards } from './PromptAttachmentCards.js';
import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import { modelSupportsVision, modelSupportsAudioNative, modelSupportsPdfNative, modelSupportsVideoNative } from '@shared/providers/visionCapabilities.js';
import { findProviderModel } from './modelPicker/modelPickerContext.js';
import { useComposerAttachments } from './useComposerAttachments.js';
import { useComposerHistory } from './useComposerHistory.js';
import { MentionComposer } from './mention/MentionComposer.js';
import {
  documentToPlainText,
  documentTrimmedPlain,
  extractMentions,
  hasComposerContent,
  parseMentionDocument,
  serializeMentionDocument,
  type MentionDocument,
  type MentionSegment
} from './mention/mentionDocument.js';
import { appComposerShellClassName } from '../ui/SurfaceShell.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { cn } from '../../lib/cn.js';
import { useToastStore } from '../../store/useToastStore.js';
import { findPendingAskUserEvent } from '../../lib/pendingAskUser.js';
import { useAskUserDraftStore } from '../../store/askUserDraft.js';
import { useRevertPrompt } from '../timeline/revert/RevertPromptContext.js';
import { useComposerTokenEstimate } from './useComposerTokenEstimate.js';
import { resolveComposerPlaceholder } from './composerPlaceholder.js';
import { useProviderAccountPollSource } from '../../lib/useProviderAccountPollSource.js';
import { resolveKeybindings, isMacPlatform } from '../../lib/resolveKeybindings.js';
import { eventMatchesCombo } from '@shared/keybindings/defaultKeybindings.js';
import { composerEditAriaKeyshortcuts } from './mention/composerEditShortcuts.js';
import {
  resolveCompletionModelSelection,
  resolveInlineCompletionSettings
} from '@shared/settings/inlineCompletionSettings.js';

const TEXTAREA_MAX_HEIGHT = 168;

function followUpToComposerDraft(item: FollowUpMessage): string {
  if (!item.mentions?.length) return item.prompt;
  const segments: MentionSegment[] = item.mentions.map((ref) => ({ type: 'mention', ref }));
  const plain = item.prompt.trim();
  if (plain) segments.push({ type: 'text', value: plain });
  const doc: MentionDocument = { segments };
  return serializeMentionDocument(doc);
}

interface ComposerProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  /** Empty-chat landing — wider shell and landing placeholder copy. */
  landing?: boolean;
  /** Focus the message field (empty-chat landing). */
  requestFocus?: boolean;
  /** Changes re-trigger focus (e.g. switching empty conversations). */
  focusSession?: string | null;
}

export function Composer({
  model,
  onModelChange,
  onOpenProviders,
  landing = false,
  requestFocus,
  focusSession
}: ComposerProps) {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const fromHistoryRef = useRef(false);
  const revertPrompt = useRevertPrompt();
  const {
    isProcessing,
    awaitingAskUser,
    runId,
    send,
    abort,
    submitPendingAskUser,
    events,
    conversationId,
    storeDraft,
    storeAttachmentDraft,
    setDraft,
    setAttachmentDraft,
    totalRunUsage,
    orchestratorUsage,
    followUps,
    enqueueFollowUp,
    updateFollowUp,
    removeFollowUp,
    sendFollowUpNow
  } = useChatStore(
    useShallow((s) => ({
      isProcessing: s.isProcessing,
      awaitingAskUser: s.awaitingAskUser,
      runId: s.runId,
      send: s.send,
      abort: s.abort,
      submitPendingAskUser: s.submitPendingAskUser,
      events: s.events,
      conversationId: s.conversationId,
      storeDraft: s.draft,
      storeAttachmentDraft: s.attachmentDraft,
      setDraft: s.setDraft,
      setAttachmentDraft: s.setAttachmentDraft,
      totalRunUsage: s.totalRunUsage,
      orchestratorUsage: s.orchestratorUsage,
      followUps: s.followUps,
      enqueueFollowUp: s.enqueueFollowUp,
      updateFollowUp: s.updateFollowUp,
      removeFollowUp: s.removeFollowUp,
      sendFollowUpNow: s.sendFollowUpNow
    }))
  );
  const activeWorkspaceIdForAttach = useWorkspaceStore((s) => s.activeId);
  const workspacePath = useWorkspaceStore((s) => {
    const entry = s.activeId ? s.list.find((w) => w.id === s.activeId) : undefined;
    return entry?.path ?? s.info.path ?? '';
  });
  const persistAttachmentDraft = useCallback(
    (items: Parameters<typeof setAttachmentDraft>[1]) => {
      if (!conversationId) return;
      setAttachmentDraft(conversationId, items);
    },
    [conversationId, setAttachmentDraft]
  );
  const {
    attachments,
    setAttachments,
    pickFromComputer,
    remove: removeAttachment,
    clearAttachments,
    peekPendingMessageId,
    onDrop,
    onDragOver,
    onPaste
  } = useComposerAttachments({
    conversationId,
    workspaceId: activeWorkspaceIdForAttach,
    initialAttachments: storeAttachmentDraft,
    onAttachmentsChange: persistAttachmentDraft
  });
  const settings = useSettingsStore((s) => s.settings);
  const composerKeybindings = useMemo(
    () => resolveKeybindings(settings.ui?.keybindings, isMacPlatform()),
    [settings.ui?.keybindings]
  );
  const composerAriaKeyshortcuts = useMemo(
    () => composerEditAriaKeyshortcuts(composerKeybindings),
    [composerKeybindings]
  );

  const history = useComposerHistory(events);

  const draftRafRef = useRef<number | null>(null);
  const pendingDraftRef = useRef('');
  const selfDraftRef = useRef<string | null>(null);

  const flushDraft = (textToWrite: string) => {
    if (!conversationId) return;
    if (draftRafRef.current !== null) {
      cancelAnimationFrame(draftRafRef.current);
    }
    pendingDraftRef.current = textToWrite;
    selfDraftRef.current = textToWrite;
    draftRafRef.current = requestAnimationFrame(() => {
      draftRafRef.current = null;
      setDraft(conversationId, pendingDraftRef.current);
    });
  };

  useEffect(() => {
    if (draftRafRef.current !== null) {
      cancelAnimationFrame(draftRafRef.current);
      draftRafRef.current = null;
    }
    if (storeDraft === selfDraftRef.current) return;
    selfDraftRef.current = storeDraft;
    setText(storeDraft);
    fromHistoryRef.current = false;
    history.reset();
  }, [conversationId, storeDraft]);

  useEffect(() => {
    return () => {
      if (draftRafRef.current !== null) {
        cancelAnimationFrame(draftRafRef.current);
        draftRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setEditingQueuedId(null);
  }, [conversationId]);

  useEffect(() => {
    if (!editingQueuedId) return;
    const stillQueued = followUps.queued.some((m) => m.id === editingQueuedId);
    if (!stillQueued) setEditingQueuedId(null);
  }, [editingQueuedId, followUps.queued]);

  const clearComposerAfterSubmit = useCallback(() => {
    setText('');
    clearAttachments();
    fromHistoryRef.current = false;
    history.reset();
    if (conversationId) {
      if (draftRafRef.current !== null) {
        cancelAnimationFrame(draftRafRef.current);
        draftRafRef.current = null;
      }
      selfDraftRef.current = '';
      setDraft(conversationId, '');
      setAttachmentDraft(conversationId, []);
    }
  }, [clearAttachments, conversationId, history, setAttachmentDraft, setDraft]);

  const showToast = useToastStore((s) => s.show);

  const pendingAskUser = useMemo(
    () => findPendingAskUserEvent(events, awaitingAskUser),
    [events, awaitingAskUser]
  );

  useProviderAccountPollSource(
    'composer',
    composerFocused || isProcessing || Boolean(pendingAskUser)
  );

  const composerInlineCompletion = useMemo(() => {
    const ic = resolveInlineCompletionSettings(settings.ui);
    const completionModel = resolveCompletionModelSelection(ic, model);
    const enabled =
      ic.enabled &&
      ic.composerEnabled &&
      composerFocused &&
      !isProcessing &&
      !awaitingAskUser;
    return {
      enabled,
      debounceMs: ic.debounceMs,
      model: enabled ? completionModel : null,
      workspaceId: activeWorkspaceIdForAttach
    };
  }, [
    activeWorkspaceIdForAttach,
    awaitingAskUser,
    composerFocused,
    isProcessing,
    model,
    settings.ui
  ]);

  const handleSend = async () => {
    const doc = parseMentionDocument(text);
    const trimmed = documentTrimmedPlain(doc);
    const mentions = extractMentions(doc);
    if (awaitingAskUser && pendingAskUser && conversationId && runId) {
      const draftReady = useAskUserDraftStore
        .getState()
        .hasAnyAnswer(pendingAskUser.id, pendingAskUser.payload, trimmed);
      if (!draftReady && !trimmed && attachments.length === 0) {
        showToast('Select answers in the panel above or type a reply before sending.', 'danger');
        return;
      }
      const toSendMeta = attachments;
      setText('');
      clearAttachments();
      fromHistoryRef.current = false;
      history.reset();
      if (conversationId) {
        if (draftRafRef.current !== null) {
          cancelAnimationFrame(draftRafRef.current);
          draftRafRef.current = null;
        }
        selfDraftRef.current = '';
        setDraft(conversationId, '');
        setAttachmentDraft(conversationId, []);
      }
      await submitPendingAskUser({
        supplementText: trimmed || undefined,
        attachmentMeta: toSendMeta.length > 0 ? toSendMeta : undefined
      });
      return;
    }
    if (!trimmed && attachments.length === 0) return;
    if (!model) return;

    const toSendMeta = attachments;
    const promptEventId =
      toSendMeta.length > 0 ? peekPendingMessageId() : undefined;

    if (isProcessing && !awaitingAskUser) {
      revertPrompt?.closeSession();
      clearComposerAfterSubmit();
      const steerOpts: Parameters<typeof enqueueFollowUp>[3] = {};
      if (toSendMeta.length > 0) {
        steerOpts.attachmentMeta = toSendMeta;
        if (promptEventId) steerOpts.promptEventId = promptEventId;
      }
      if (mentions.length > 0) steerOpts.mentions = mentions;
      await enqueueFollowUp(
        'steering',
        trimmed || 'See attached files.',
        model,
        steerOpts
      );
      return;
    }

    revertPrompt?.closeSession();
    clearComposerAfterSubmit();
    const sendOpts: Parameters<typeof send>[2] = {};
    if (toSendMeta.length > 0) {
      sendOpts.attachmentMeta = toSendMeta;
      if (promptEventId) sendOpts.promptEventId = promptEventId;
    }
    if (mentions.length > 0) sendOpts.mentions = mentions;
    await send(trimmed || 'See attached files.', model, sendOpts);
  };

  const handleQueue = async () => {
    const doc = parseMentionDocument(text);
    const trimmed = documentTrimmedPlain(doc);
    const mentions = extractMentions(doc);
    if (!trimmed && attachments.length === 0) return;
    if (!model) return;
    if (!isProcessing && !awaitingAskUser) return;

    const toSendMeta = attachments;
    const promptEventId =
      toSendMeta.length > 0 ? peekPendingMessageId() : undefined;

    if (editingQueuedId) {
      clearComposerAfterSubmit();
      await updateFollowUp(editingQueuedId, {
        prompt: trimmed || 'See attached files.',
        selection: model,
        attachmentMeta: toSendMeta,
        ...(mentions.length > 0 ? { mentions } : { mentions: [] })
      });
      setEditingQueuedId(null);
      return;
    }

    clearComposerAfterSubmit();
    const queueOpts: Parameters<typeof enqueueFollowUp>[3] = {};
    if (toSendMeta.length > 0) {
      queueOpts.attachmentMeta = toSendMeta;
      if (promptEventId) queueOpts.promptEventId = promptEventId;
    }
    if (mentions.length > 0) queueOpts.mentions = mentions;
    await enqueueFollowUp('queue', trimmed || 'See attached files.', model, queueOpts);
  };

  const handleEditQueued = useCallback(
    (item: FollowUpMessage) => {
      const draft = followUpToComposerDraft(item);
      setEditingQueuedId(item.id);
      setText(draft);
      if (conversationId) {
        setDraft(conversationId, draft);
        const nextAttachments = item.attachmentMeta ?? [];
        setAttachmentDraft(conversationId, nextAttachments);
        setAttachments(nextAttachments);
      }
      onModelChange(item.selection);
    },
    [conversationId, onModelChange, setAttachmentDraft, setAttachments, setDraft]
  );

  const handleRemoveFollowUp = useCallback(
    (id: string) => {
      if (editingQueuedId === id) setEditingQueuedId(null);
      void removeFollowUp(id);
    },
    [editingQueuedId, removeFollowUp]
  );

  const onTextChange = (next: string) => {
    setText(next);
    fromHistoryRef.current = false;
    history.reset();
    flushDraft(next);
  };

  const composerDoc = parseMentionDocument(text);
  const draftTokenEstimate = useComposerTokenEstimate({
    model,
    prompt: documentToPlainText(composerDoc),
    attachmentMeta: attachments,
    workspacePath,
    enabled: !isProcessing && !awaitingAskUser
  });
  const draftHasAnswer = useAskUserDraftStore((s) =>
    pendingAskUser
      ? s.hasAnyAnswer(
          pendingAskUser.id,
          pendingAskUser.payload,
          documentTrimmedPlain(composerDoc)
        )
      : false
  );
  const canSendContent =
    hasComposerContent(composerDoc) ||
    attachments.length > 0 ||
    (awaitingAskUser && draftHasAnswer);
  const showFollowUpTray =
    followUps.steering.length > 0 || followUps.queued.length > 0;
  const isRunActive = isProcessing || awaitingAskUser;
  const showProcessingRunHint = isProcessing && !awaitingAskUser;
  const providers = useProviderStore((s) => s.providers);
  const visionWarning = useMemo(() => {
    const hasImages = attachments.some(
      (m) => (m.mediaKind ?? mediaKindFromMeta(m)) === 'image'
    );
    if (!hasImages || !model) return false;
    const provider = providers.find((p) => p.id === model.providerId);
    const info = provider ? findProviderModel(provider, model.modelId) : undefined;
    return !modelSupportsVision(info?.inputModalities);
  }, [attachments, model, providers]);
  const audioWarning = useMemo(() => {
    const hasAudio = attachments.some(
      (m) => (m.mediaKind ?? mediaKindFromMeta(m)) === 'audio'
    );
    if (!hasAudio || !model) return false;
    const provider = providers.find((p) => p.id === model.providerId);
    const info = provider ? findProviderModel(provider, model.modelId) : undefined;
    return !modelSupportsAudioNative(info?.inputModalities);
  }, [attachments, model, providers]);
  const pdfWarning = useMemo(() => {
    const hasPdf = attachments.some((m) => (m.mediaKind ?? mediaKindFromMeta(m)) === 'pdf');
    if (!hasPdf || !model) return false;
    const provider = providers.find((p) => p.id === model.providerId);
    const info = provider ? findProviderModel(provider, model.modelId) : undefined;
    return !modelSupportsPdfNative(info?.inputModalities);
  }, [attachments, model, providers]);
  const videoWarning = useMemo(() => {
    const hasVideo = attachments.some((m) => (m.mediaKind ?? mediaKindFromMeta(m)) === 'video');
    if (!hasVideo || !model) return false;
    const provider = providers.find((p) => p.id === model.providerId);
    const info = provider ? findProviderModel(provider, model.modelId) : undefined;
    return !modelSupportsVideoNative(info?.inputModalities);
  }, [attachments, model, providers]);
  const sendState: 'idle' | 'ready' | 'processing' =
    (canSendContent || awaitingAskUser) && model ? 'ready' : 'idle';
  const sendDisabled = !canSendContent && !awaitingAskUser;
  const showStop = isProcessing && !awaitingAskUser;
  const showQueueBtn =
    (isProcessing || awaitingAskUser) && canSendContent && Boolean(model);

  const metricsStreamCompact = isRunActive && !composerFocused;

  const canAttach = Boolean(conversationId && activeWorkspaceIdForAttach);

  const placeholder = resolveComposerPlaceholder({
    landing,
    storeDraft,
    editorPlain: documentTrimmedPlain(composerDoc),
    eventsLength: events.length,
    isProcessing: isProcessing && !awaitingAskUser,
    awaitingAskUser,
    editingQueued: Boolean(editingQueuedId)
  });

  const shellRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative w-full">
      <div
        ref={shellRef}
        data-e2e-can-attach={canAttach ? 'true' : 'false'}
        className={cn(
          appComposerShellClassName,
          'flex flex-col overflow-hidden transition-[background] duration-150',
          landing && 'vx-composer-shell--landing',
          dragOver && 'vx-composer-shell--drag-over'
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!canAttach) return;
          if (e.dataTransfer.types.includes('Files')) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        }}
        onDragOver={onDragOver}
        onFocusCapture={() => setComposerFocused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setComposerFocused(false);
          }
        }}
        onDrop={(e) => {
          setDragOver(false);
          onDrop(e);
        }}
      >
        <FollowUpTrayHost
          steering={followUps.steering}
          queued={followUps.queued}
          visible={showFollowUpTray}
          isRunActive={isRunActive}
          editingQueuedId={editingQueuedId}
          onEditQueued={handleEditQueued}
          onRemove={handleRemoveFollowUp}
          onSendNow={(id) => void sendFollowUpNow(id)}
        />
        <div className="vx-composer-input-zone">
          <div className="vx-composer-chip-row">
            <ModelPicker
              value={model}
              onChange={onModelChange}
              onOpenProviders={onOpenProviders}
              landing={landing}
              anchorRef={shellRef}
            />
            <AttachmentButton
              onPickFromComputer={() => void pickFromComputer()}
              disabled={!canAttach}
            />
            <CaptureScreenButton
              disabled={!canAttach}
              conversationId={conversationId}
              messageId={peekPendingMessageId()}
              onIngested={(meta) =>
                setAttachments((cur) =>
                  [...cur.filter((a) => a.workspacePath !== meta.workspacePath), meta].slice(
                    0,
                    MAX_CHAT_ATTACHMENTS
                  )
                )
              }
            />
            {attachments.length > 0 ? (
              <PromptAttachmentCards
                items={attachments}
                editable
                onRemove={removeAttachment}
                className="min-w-0 flex-1"
              />
            ) : null}
            {attachments.length > 0 && (
              <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
                {attachments.length}/{MAX_CHAT_ATTACHMENTS}
              </span>
            )}
            <ComposerStatusStrip
              pendingAskUser={pendingAskUser}
              model={model}
              processingRun={showProcessingRunHint}
              visionWarning={visionWarning}
              pdfWarning={pdfWarning}
              videoWarning={videoWarning}
              audioWarning={audioWarning}
            />
            {showQueueBtn ? (
              <button
                type="button"
                className="vx-btn vx-btn-quiet vx-composer-queue-btn shrink-0 px-2"
                onClick={() => void handleQueue()}
              >
                {editingQueuedId ? 'Save' : 'Queue'}
              </button>
            ) : null}
          </div>
          <div className="vx-composer-editor-slot">
            <MentionComposer
              value={text}
              onChange={onTextChange}
              onPaste={onPaste}
              requestFocus={requestFocus}
              focusSession={focusSession}
              inlineCompletion={composerInlineCompletion}
              editKeybindings={composerKeybindings}
              globalKeybindings={composerKeybindings}
              ariaKeyshortcuts={composerAriaKeyshortcuts}
              placeholder={placeholder}
              className={cn(
                'min-w-0 flex-1',
                landing ? 'min-h-[3.25rem]' : 'min-h-[2.5rem]',
                'transition-[height] duration-150 ease-out motion-reduce:transition-none'
              )}
              style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
              onKeyDown={(e) => {
                const ne = e.nativeEvent as unknown as {
                  isComposing?: boolean;
                  keyCode?: number;
                };
                if (ne.isComposing || ne.keyCode === 229) return;
                if (
                  eventMatchesCombo(e, composerKeybindings.composerQueue) &&
                  showQueueBtn
                ) {
                  e.preventDefault();
                  void handleQueue();
                  return;
                }
                if (e.key === 'Escape' && editingQueuedId) {
                  e.preventDefault();
                  setEditingQueuedId(null);
                  clearComposerAfterSubmit();
                  return;
                }
                if (
                  eventMatchesCombo(e, composerKeybindings.composerStop) &&
                  showStop &&
                  !editingQueuedId &&
                  !e.defaultPrevented
                ) {
                  e.preventDefault();
                  void abort();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (editingQueuedId) {
                    if (!canSendContent || !model) return;
                    void handleQueue();
                    return;
                  }
                  if (!canSendContent && !isProcessing && !awaitingAskUser) return;
                  if (!awaitingAskUser && !model) return;
                  if (isProcessing && !awaitingAskUser && !canSendContent) return;
                  void handleSend();
                  return;
                }
                if (e.key === 'ArrowUp' && !documentToPlainText(composerDoc).length) {
                  e.preventDefault();
                  const recalled = history.recall('up');
                  if (recalled !== null) {
                    setText(recalled);
                    fromHistoryRef.current = true;
                  }
                  return;
                }
                if (e.key === 'ArrowDown' && fromHistoryRef.current) {
                  e.preventDefault();
                  const recalled = history.recall('down');
                  setText(recalled ?? '');
                  if (recalled === null) fromHistoryRef.current = false;
                }
              }}
            />
          </div>
          <div className="vx-composer-send-cluster vx-composer-send-slot">
            {showStop ? <StopButton onClick={() => void abort()} /> : null}
            <SendButton
              onClick={() => void (editingQueuedId ? handleQueue() : handleSend())}
              state={sendState}
              disabled={sendDisabled}
              actionLabel={
                editingQueuedId
                  ? 'Save queued follow-up'
                  : isProcessing && !awaitingAskUser
                    ? 'Steer mid-run'
                    : 'Send'
              }
            />
          </div>
          <div
            className={cn(
              'vx-composer-metrics-row',
              metricsStreamCompact && 'vx-composer-metrics-row--stream-compact'
            )}
            title={metricsStreamCompact ? 'Hover or focus for full run metrics' : undefined}
          >
            <div className="vx-composer-metrics-row__context">
              <ComposerCacheStatPill model={model} compact={metricsStreamCompact} />
              <ContextWindowMeter
                model={model}
                conversationId={conversationId}
                workspaceId={activeWorkspaceIdForAttach}
                draftPrompt={documentToPlainText(composerDoc)}
                attachmentDraft={attachments}
                disabled={isProcessing || awaitingAskUser}
                isRunActive={isProcessing}
              />
            </div>
            <div className="vx-composer-metrics-row__usage">
              <TokenUsagePill
                model={model}
                total={totalRunUsage}
                orchestrator={orchestratorUsage}
                draftEstimate={draftTokenEstimate}
                compact={metricsStreamCompact}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
