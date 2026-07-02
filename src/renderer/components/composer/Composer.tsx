import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ModelSelection } from '@shared/types/provider.js';
import type { FollowUpMessage } from '@shared/types/followUp.js';
import { EMPTY_FOLLOW_UP_STATE } from '@shared/types/followUp.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerStatusStrip } from './ComposerStatusStrip.js';
import { ComposerCacheStatPill } from './ComposerCacheStatPill.js';
import { CaptureScreenButton } from './CaptureScreenButton.js';
import { AttachmentButton } from './AttachmentButton.js';
import { SendButton } from './SendButton.js';
import { StopButton } from './StopButton.js';
import { FollowUpTrayHost } from './followUps/index.js';
import { TaskTrayHost } from './tasks/index.js';
import { ModelPicker } from './modelPicker/index.js';
import { TokenUsagePill } from './TokenUsagePill.js';
import { HeartbeatStatusPill } from './HeartbeatStatusPill.js';
import { ContextWindowMeter } from './ContextWindowMeter.js';
import { PromptAttachmentCards } from './PromptAttachmentCards.js';
import { defaultAttachmentPrompt } from '@shared/attachments/defaultAttachmentPrompt.js';
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
import { cn } from '../../lib/cn.js';
import { useToastStore } from '../../store/useToastStore.js';
import { findPendingAskUserEvent } from '../../lib/pendingAskUser.js';
import { ASK_USER_SUBMIT_LABEL } from '@shared/askUser/askUserCopy.js';
import { useAskUserDraftStore } from '../../store/askUserDraft.js';
import { useRevertPrompt } from '../timeline/revert/RevertPromptContext.js';
import { useComposerTokenEstimate } from './useComposerTokenEstimate.js';
import { resolveComposerPlaceholder } from './composerPlaceholder.js';
import { useProviderAccountPollSource } from '../../lib/useProviderAccountPollSource.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { computeComposerModalityWarnings } from '@shared/attachments/composerModalityWarnings.js';
import { inputModalitiesFromModelId } from '@shared/providers/visionCapabilities.js';
import { findProviderModel } from './modelPicker/modelPickerContext.js';
import { resolveKeybindings, isMacPlatform } from '../../lib/resolveKeybindings.js';
import { eventMatchesCombo } from '@shared/keybindings/defaultKeybindings.js';
import { composerEditAriaKeyshortcuts } from './mention/composerEditShortcuts.js';
import { parseSkillSlashInput, isKnownSkillName } from './skillSlash.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import { vyotiq } from '../../lib/ipc.js';
import {
  resolveCompletionModelSelection,
  resolveInlineCompletionSettings
} from '@shared/settings/inlineCompletionSettings.js';

const TEXTAREA_MAX_HEIGHT = 168;

function followUpToComposerDraft(item: FollowUpMessage): string {
  let text = item.prompt;
  if (item.invokedSkill) {
    const slashOnly = text === `Invoke skill /${item.invokedSkill}`;
    text = slashOnly ? `/${item.invokedSkill}` : `/${item.invokedSkill} ${text}`;
  }
  if (!item.mentions?.length) return text;
  const segments: MentionSegment[] = item.mentions.map((ref) => ({ type: 'mention', ref }));
  const plain = text.trim();
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
  const [unknownSkillPrompt, setUnknownSkillPrompt] = useState<string | null>(null);
  const pendingSkillSendRef = useRef<(() => Promise<void>) | null>(null);
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
    onPaste,
    isIngesting
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

  const history = useComposerHistory(events ?? []);

  const draftRafRef = useRef<number | null>(null);
  const pendingDraftRef = useRef('');
  const selfDraftRef = useRef<string | null>(null);
  const suppressDraftRef = useRef(false);

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

  const followUpLanes = followUps ?? EMPTY_FOLLOW_UP_STATE;
  const steeringFollowUps = followUpLanes.steering ?? [];
  const queuedFollowUps = followUpLanes.queued ?? [];

  useEffect(() => {
    if (!editingQueuedId) return;
    const stillQueued = queuedFollowUps.some((m) => m.id === editingQueuedId);
    if (!stillQueued) setEditingQueuedId(null);
  }, [editingQueuedId, queuedFollowUps]);

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

  const pendingAskUser = useMemo(() => findPendingAskUserEvent(events ?? []), [events]);
  const needsAskUserReply = awaitingAskUser || pendingAskUser !== null;

  const providers = useProviderStore((s) => s.providers);
  const modalityWarnings = useMemo(() => {
    if (!model || attachments.length === 0) {
      return {
        visionWarning: false,
        pdfWarning: false,
        videoWarning: false,
        audioWarning: false
      };
    }
    const provider = providers.find((p) => p.id === model.providerId);
    const modelInfo = provider ? findProviderModel(provider, model.modelId) : undefined;
    const modalities = modelInfo?.inputModalities ?? inputModalitiesFromModelId(model.modelId);
    return computeComposerModalityWarnings(attachments, modalities);
  }, [attachments, model, providers]);

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
      !needsAskUserReply;
    return {
      enabled,
      debounceMs: ic.debounceMs,
      model: enabled ? completionModel : null,
      workspaceId: activeWorkspaceIdForAttach
    };
  }, [
    activeWorkspaceIdForAttach,
    needsAskUserReply,
    composerFocused,
    isProcessing,
    model,
    settings.ui
  ]);

  const handleSend = async () => {
    const doc = parseMentionDocument(text);
    const trimmed = documentTrimmedPlain(doc);
    const mentions = extractMentions(doc);
    const slash = parseSkillSlashInput(trimmed);
    const effectivePrompt = slash.invokedSkill ? slash.prompt : trimmed;

    const continueSend = async () => {
    if (needsAskUserReply && pendingAskUser && conversationId && runId) {
      const draftReady = useAskUserDraftStore
        .getState()
        .hasAnyAnswer(pendingAskUser.id, pendingAskUser.payload, trimmed);
      if (!draftReady && !trimmed && attachments.length === 0) {
        showToast('Select answers in the prompt or type a reply before submitting.', 'danger');
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
    if (!effectivePrompt && attachments.length === 0 && !slash.invokedSkill) return;
    if (!model) return;

    const toSendMeta = attachments;
    const promptText =
      effectivePrompt || (toSendMeta.length > 0 ? defaultAttachmentPrompt(toSendMeta) : '');
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
      if (slash.invokedSkill) steerOpts.invokedSkill = slash.invokedSkill;
      await enqueueFollowUp(
        'steering',
        promptText,
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
    if (slash.invokedSkill) sendOpts.invokedSkill = slash.invokedSkill;
    await send(promptText, model, sendOpts);
    };

    if (
      slash.invokedSkill &&
      activeWorkspaceIdForAttach &&
      !(await isKnownSkillName(activeWorkspaceIdForAttach, slash.invokedSkill))
    ) {
      pendingSkillSendRef.current = continueSend;
      setUnknownSkillPrompt(slash.invokedSkill);
      return;
    }

    await continueSend();
  };

  const handleQueue = async () => {
    const doc = parseMentionDocument(text);
    const trimmed = documentTrimmedPlain(doc);
    const mentions = extractMentions(doc);
    const slash = parseSkillSlashInput(trimmed);
    const effectivePrompt = slash.invokedSkill ? slash.prompt : trimmed;
    if (!effectivePrompt && attachments.length === 0 && !slash.invokedSkill) return;
    if (!model) return;
    if (!isProcessing && !awaitingAskUser) return;

    const toSendMeta = attachments;
    const promptText =
      effectivePrompt || (toSendMeta.length > 0 ? defaultAttachmentPrompt(toSendMeta) : '');
    const promptEventId =
      toSendMeta.length > 0 ? peekPendingMessageId() : undefined;

    if (editingQueuedId) {
      clearComposerAfterSubmit();
      await updateFollowUp(editingQueuedId, {
        prompt: promptText,
        selection: model,
        attachmentMeta: toSendMeta,
        ...(mentions.length > 0 ? { mentions } : { mentions: [] }),
        ...(slash.invokedSkill ? { invokedSkill: slash.invokedSkill } : { invokedSkill: '' })
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
    if (slash.invokedSkill) queueOpts.invokedSkill = slash.invokedSkill;
    await enqueueFollowUp('queue', promptText, model, queueOpts);
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
    if (!suppressDraftRef.current) flushDraft(next);
  };

  const composerDoc = parseMentionDocument(text);
  const invokedSkillDraft = parseSkillSlashInput(documentTrimmedPlain(composerDoc)).invokedSkill;
  const draftTokenEstimate = useComposerTokenEstimate({
    model,
    prompt: documentToPlainText(composerDoc),
    attachmentMeta: attachments,
    workspacePath,
    enabled: !isProcessing && !needsAskUserReply
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
    (needsAskUserReply && draftHasAnswer);
  const showFollowUpTray =
    steeringFollowUps.length > 0 || queuedFollowUps.length > 0;
  const isRunActive = isProcessing || needsAskUserReply;
  const showProcessingRunHint = isProcessing && !needsAskUserReply;
  const sendState: 'idle' | 'ready' | 'processing' =
    (canSendContent || needsAskUserReply) && model ? 'ready' : 'idle';
  const sendDisabled = !canSendContent;
  const showStop = isProcessing || needsAskUserReply;
  const showQueueBtn =
    (isProcessing || needsAskUserReply) && canSendContent && Boolean(model);

  const metricsStreamCompact = isRunActive && !composerFocused;

  const canAttach = Boolean(conversationId && activeWorkspaceIdForAttach) && !isIngesting;

  const placeholder = resolveComposerPlaceholder({
    landing,
    storeDraft,
    editorPlain: documentTrimmedPlain(composerDoc),
    eventsLength: (events ?? []).length,
    isProcessing: isProcessing && !needsAskUserReply,
    needsAskUserReply,
    editingQueued: Boolean(editingQueuedId)
  });

  const shellRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative w-full">
      <div
        ref={shellRef}
        data-composer-shell
        data-e2e-can-attach={canAttach ? 'true' : 'false'}
        aria-busy={isIngesting || undefined}
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
        <TaskTrayHost conversationId={conversationId} />
        <FollowUpTrayHost
          steering={steeringFollowUps}
          queued={queuedFollowUps}
          visible={showFollowUpTray}
          isRunActive={isRunActive}
          awaitingAskUser={needsAskUserReply}
          editingQueuedId={editingQueuedId}
          onEditQueued={handleEditQueued}
          onRemove={handleRemoveFollowUp}
          onSendNow={(id) => void sendFollowUpNow(id)}
        />
        <div className="vx-composer-input-zone">
          <div
            className={cn(
              'vx-composer-chip-row',
              attachments.length > 0 && 'vx-composer-chip-row--has-attachments'
            )}
          >
            {!landing ? (
              <ModelPicker
                value={model}
                onChange={onModelChange}
                onOpenProviders={onOpenProviders}
                landing={landing}
                anchorRef={shellRef}
              />
            ) : null}
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
              <div
                className="vx-composer-attach-zone"
                aria-label={`${attachments.length} attached file${attachments.length === 1 ? '' : 's'}`}
              >
                <div className="vx-composer-attach-chips">
                  <PromptAttachmentCards
                    items={attachments}
                    editable
                    variant="chip"
                    onRemove={removeAttachment}
                  />
                </div>
                <span className="vx-composer-attachment-count" aria-hidden>
                  {attachments.length}/{MAX_CHAT_ATTACHMENTS}
                </span>
              </div>
            ) : null}
            <ComposerStatusStrip
              workspaceId={activeWorkspaceIdForAttach}
              pendingAskUser={pendingAskUser}
              model={model}
              processingRun={showProcessingRunHint}
              invokedSkillDraft={invokedSkillDraft}
              visionWarning={modalityWarnings.visionWarning}
              pdfWarning={modalityWarnings.pdfWarning}
              videoWarning={modalityWarnings.videoWarning}
              audioWarning={modalityWarnings.audioWarning}
            />
          </div>
          <div className="vx-composer-editor-slot">
            <MentionComposer
              value={text}
              onChange={onTextChange}
              onPaste={onPaste}
              requestFocus={requestFocus}
              focusSession={focusSession}
              inlineCompletion={composerInlineCompletion}
              anchorRef={shellRef}
              landing={landing}
              editKeybindings={composerKeybindings}
              globalKeybindings={composerKeybindings}
              ariaKeyshortcuts={composerAriaKeyshortcuts}
              placeholder={placeholder}
              className={cn(
                'min-w-0 flex-1 min-h-[2.5rem]',
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
                  if (!canSendContent && !isProcessing && !needsAskUserReply) return;
                  if (!needsAskUserReply && !model) return;
                  if (isProcessing && !needsAskUserReply && !canSendContent) return;
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
            {landing ? (
              <div className="vx-composer-send-cluster__model mr-auto min-w-0">
                <ModelPicker
                  value={model}
                  onChange={onModelChange}
                  onOpenProviders={onOpenProviders}
                  landing={landing}
                  anchorRef={shellRef}
                />
              </div>
            ) : null}
            {showStop ? <StopButton onClick={() => void abort()} /> : null}
            {showQueueBtn ? (
              <button
                type="button"
                className="vx-btn vx-btn-quiet vx-composer-queue-btn shrink-0 px-2"
                onClick={() => void handleQueue()}
              >
                {editingQueuedId ? 'Save' : 'Queue'}
              </button>
            ) : null}
            <SendButton
              onClick={() => void (editingQueuedId ? handleQueue() : handleSend())}
              state={sendState}
              disabled={sendDisabled}
              actionLabel={
                editingQueuedId
                  ? 'Save queued follow-up'
                  : needsAskUserReply
                    ? ASK_USER_SUBMIT_LABEL
                    : isProcessing
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
                disabled={isProcessing}
                isRunActive={isProcessing || needsAskUserReply}
              />
            </div>
            <div className="vx-composer-metrics-row__usage">
              <HeartbeatStatusPill
                conversationId={conversationId}
                compact={metricsStreamCompact}
              />
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
      <PromptDialog
        open={unknownSkillPrompt !== null}
        title="Create skill?"
        message={
          unknownSkillPrompt
            ? `Skill "/${unknownSkillPrompt}" was not found. Create it under .vyotiq/skills/?`
            : undefined
        }
        initialValue={unknownSkillPrompt ?? ''}
        confirmLabel="Create & send"
        cancelLabel="Cancel"
        onSubmit={async (name) => {
          const trimmed = name.trim();
          const pending = pendingSkillSendRef.current;
          pendingSkillSendRef.current = null;
          setUnknownSkillPrompt(null);
          if (!trimmed || !activeWorkspaceIdForAttach) return;
          try {
            await vyotiq.skills.create(activeWorkspaceIdForAttach, trimmed);
            showToast(`Created skill "${trimmed}"`, 'success');
            await pending?.();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(`Could not create skill: ${msg}`, 'danger');
          }
        }}
        onCancel={() => {
          pendingSkillSendRef.current = null;
          setUnknownSkillPrompt(null);
        }}
      />
    </div>
  );
}
