import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ModelSelection } from '@shared/types/provider.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerStatusStrip } from './ComposerStatusStrip.js';
import { AttachmentButton } from './AttachmentButton.js';
import { SendButton } from './SendButton.js';
import { ModelPicker } from './modelPicker/index.js';
import { TokenUsagePill } from './TokenUsagePill.js';
import { ContextWindowMeter } from './ContextWindowMeter.js';
import { AttachmentChipRow } from './AttachmentChipRow.js';
import { useComposerAttachments } from './useComposerAttachments.js';
import { useComposerHistory } from './useComposerHistory.js';
import { MentionComposer } from './mention/MentionComposer.js';
import {
  documentToPlainText,
  documentTrimmedPlain,
  extractMentions,
  hasComposerContent,
  parseMentionDocument
} from './mention/mentionDocument.js';
import { appComposerShellClassName } from '../ui/SurfaceShell.js';
import { useChatStore } from '../../store/useChatStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';
import { useToastStore } from '../../store/useToastStore.js';
import { findPendingAskUserEvent } from '../../lib/pendingAskUser.js';
import { useAskUserDraftStore } from '../../store/askUserDraft.js';
import { useRevertPrompt } from '../timeline/revert/RevertPromptContext.js';
import { useComposerTokenEstimate } from './useComposerTokenEstimate.js';
import { resolveComposerPlaceholder } from './composerPlaceholder.js';
import { useProviderAccountPollSource } from '../../lib/useProviderAccountPollSource.js';

const TEXTAREA_MAX_HEIGHT = 168;

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
    orchestratorUsage
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
      orchestratorUsage: s.orchestratorUsage
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
  const permissions = selectEffectivePermissions(activeWorkspaceIdForAttach, settings);

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

  const showToast = useToastStore((s) => s.show);

  const pendingAskUser = useMemo(
    () => findPendingAskUserEvent(events, awaitingAskUser),
    [events, awaitingAskUser]
  );

  useProviderAccountPollSource(
    'composer',
    composerFocused || isProcessing || Boolean(pendingAskUser)
  );

  const handleSend = async () => {
    if (isProcessing && !awaitingAskUser) {
      await abort();
      return;
    }
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
    revertPrompt?.closeSession();
    const toSendMeta = attachments;
    const promptEventId =
      toSendMeta.length > 0 ? peekPendingMessageId() : undefined;
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
    const sendOpts: Parameters<typeof send>[3] = {};
    if (toSendMeta.length > 0) {
      sendOpts.attachmentMeta = toSendMeta;
      if (promptEventId) sendOpts.promptEventId = promptEventId;
    }
    if (mentions.length > 0) sendOpts.mentions = mentions;
    await send(trimmed || 'See attached files.', model, permissions, sendOpts);
  };

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
  const sendState: 'idle' | 'ready' | 'processing' = isProcessing
    ? 'processing'
    : (canSendContent || awaitingAskUser) && model
      ? 'ready'
      : 'idle';
  const sendDisabled =
    !canSendContent && sendState !== 'processing' && !awaitingAskUser;

  const canAttach = Boolean(conversationId && activeWorkspaceIdForAttach);

  const sendButtonProps = {
    onClick: () => void handleSend(),
    state: sendState,
    disabled: sendDisabled
  } as const;

  const placeholder = resolveComposerPlaceholder({
    landing,
    storeDraft,
    editorPlain: documentTrimmedPlain(composerDoc),
    eventsLength: events.length
  });

  const shellRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative w-full">
      <div
        ref={shellRef}
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
            <AttachmentChipRow items={attachments} onRemove={removeAttachment} />
            {attachments.length > 0 && (
              <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
                {attachments.length}/{MAX_CHAT_ATTACHMENTS}
              </span>
            )}
            <ComposerStatusStrip pendingAskUser={pendingAskUser} model={model} />
          </div>
          <div className="vx-composer-editor-slot">
            <MentionComposer
              value={text}
              onChange={onTextChange}
              onPaste={onPaste}
              requestFocus={requestFocus}
              focusSession={focusSession}
              ariaKeyshortcuts="Enter Shift+Enter ArrowUp ArrowDown Escape"
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
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!canSendContent && !isProcessing && !awaitingAskUser) return;
                  if (!isProcessing && !awaitingAskUser && !model) return;
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
          <div className="vx-composer-token-slot">
            <ContextWindowMeter
              model={model}
              conversationId={conversationId}
              disabled={isProcessing || awaitingAskUser}
            />
            <TokenUsagePill
              total={totalRunUsage}
              orchestrator={orchestratorUsage}
              draftEstimate={draftTokenEstimate}
            />
          </div>
          <SendButton {...sendButtonProps} className="vx-composer-send-slot" />
        </div>
      </div>
    </div>
  );
}
