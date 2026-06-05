import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ModelSelection } from '@shared/types/provider.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerFooter } from './ComposerFooter.js';
import { ComposerRunRecovery } from './ComposerRunRecovery.js';
import { ComposerStatusStrip } from './ComposerStatusStrip.js';
import { AttachmentButton } from './AttachmentButton.js';
import { SendButton } from './SendButton.js';
import { ModelPicker } from './modelPicker/index.js';
import { TokenUsagePill } from './TokenUsagePill.js';
import { AttachmentCollapsible } from './AttachmentCollapsible.js';
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
import { pickComputerFileMention } from './mention/useMentionComputerPick.js';
import { appComposerShellClassName } from '../ui/SurfaceShell.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useFloatingLiveDiffStore } from '../../store/useFloatingLiveDiffStore.js';
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

const TEXTAREA_MAX_HEIGHT = 168;

interface ComposerProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  /** `footer` — flush inside the unified chat footer card. */
  variant?: 'card' | 'footer';
}

export function Composer({
  model,
  onModelChange,
  onOpenProviders,
  variant = 'card'
}: ComposerProps) {
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** Tracks whether the current `text` came from history recall so
   *  ArrowDown can walk back toward the tail. Reset on any user
   *  keystroke that isn't history navigation. */
  const fromHistoryRef = useRef(false);
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
  const persistAttachmentDraft = useCallback(
    (items: Parameters<typeof setAttachmentDraft>[1]) => {
      if (!conversationId) return;
      setAttachmentDraft(conversationId, items);
    },
    [conversationId, setAttachmentDraft]
  );
  const {
    attachments,
    addPaths,
    addFolder,
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
  const selectedPaths = attachments.map(
    (a) => a.workspacePath ?? a.storedPath ?? a.name
  );
  // Effective permissions resolve through three layers:
  // DEFAULT_PERMISSIONS → settings.permissions (global) → per-workspace
  // override (if any). Driven by the active workspace id; switching
  // workspaces immediately re-resolves the menu / send pipeline so the
  // user can see the chosen folder's policy without a reload.
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceIdForAttach, settings);

  const history = useComposerHistory(events);

  /** Debounced draft persistence. A single `requestAnimationFrame`
   *  coalesces rapid keystrokes into one store write per frame so
   *  sibling subscribers (dock, ChatPage) don't re-render on every
   *  character. */
  const draftRafRef = useRef<number | null>(null);
  const pendingDraftRef = useRef('');
  /**
   * Mirrors the most recent value this composer wrote to
   * `storeDraft` (via `flushDraft` or the post-send synchronous
   * clear). The hydration effect compares incoming `storeDraft`
   * against this and short-circuits when they match — that
   * guarantees the effect's `history.reset()` and
   * `fromHistoryRef = false` side-effects only fire on EXTERNAL
   * draft changes (i.e. a conversation switch landing the next
   * slice's persisted draft into the textarea). Audit fix §3.1.1.
   */
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

  // Hydrate `text` from the active slice's draft on mount and whenever
  // the active conversation (or its draft) changes.
  //
  // The `selfDraftRef` guard skips the effect when `storeDraft` flips
  // because of OUR OWN `flushDraft` write — the incoming value is
  // already what `text` holds, and re-running `history.reset()` on
  // every keystroke would silently break a held-ArrowUp history walk.
  // Conversation switches still hydrate because the new slice's
  // draft can never match what this instance just wrote into the
  // previous slice. Audit fix §3.1.1.
  useEffect(() => {
    if (storeDraft === selfDraftRef.current) return;
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
    if (!model) {
      showToast('Select a model before sending.', 'danger');
      return;
    }
    revertPrompt?.closeSession();
    const toSendMeta = attachments;
    const promptEventId =
      toSendMeta.length > 0 ? peekPendingMessageId() : undefined;
    setText('');
    clearAttachments();
    fromHistoryRef.current = false;
    history.reset();
    // Clear the store draft synchronously so a post-send switch away
    // and back doesn't resurrect the just-sent text.
    if (conversationId) {
      if (draftRafRef.current !== null) {
        cancelAnimationFrame(draftRafRef.current);
        draftRafRef.current = null;
      }
      // Mirror the synchronous clear into `selfDraftRef` so the
      // hydration effect (which observes the resulting `storeDraft`
      // = '' transition) recognises it as our own write and
      // short-circuits, leaving `text` already-cleared. Audit fix
      // §3.1.1.
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

  const pendingAskUser = useMemo(
    () => findPendingAskUserEvent(events, awaitingAskUser),
    [events, awaitingAskUser]
  );
  const composerDoc = parseMentionDocument(text);
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
  const footerMode = variant === 'footer';
  const zoneOpen =
    useAttachmentPreviewStore((s) => s.attachment !== null) ||
    useFloatingLiveDiffStore((s) => s.target !== null);
  const revertPrompt = useRevertPrompt();

  const attachmentButton = (
    <AttachmentButton
      open={pickerOpen}
      onOpen={() => setPickerOpen(true)}
      onClose={() => setPickerOpen(false)}
      selected={selectedPaths}
      onPick={(p) => void addPaths([p])}
      onPickFolder={(p) => void addFolder(p)}
      onPickFromComputer={() => void pickFromComputer()}
    />
  );

  const chipRow = (
    <div className="vx-composer-chip-row">
      {attachmentButton}
      <ModelPicker
        value={model}
        onChange={onModelChange}
        onOpenProviders={onOpenProviders}
      />
      <ComposerStatusStrip />
      <TokenUsagePill total={totalRunUsage} orchestrator={orchestratorUsage} />
      {footerMode && attachments.length > 0 && (
        <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
          {attachments.length}/{MAX_CHAT_ATTACHMENTS}
        </span>
      )}
    </div>
  );

  const mentionInput = (
    <MentionComposer
      value={text}
      onChange={onTextChange}
      onPaste={onPaste}
      onPickFromComputer={async () => {
        if (!conversationId || !activeWorkspaceIdForAttach) return null;
        return pickComputerFileMention({
          conversationId,
          workspaceId: activeWorkspaceIdForAttach,
          messageId: peekPendingMessageId()
        });
      }}
      ariaKeyshortcuts="Enter Shift+Enter ArrowUp ArrowDown Escape"
      placeholder="@ to mention files, or describe your task…"
      className={cn(
        footerMode ? 'min-h-[1.75rem] leading-5' : 'min-h-[2.5rem]',
        footerMode && 'min-w-0 flex-1',
        'transition-[height] duration-150 ease-out motion-reduce:transition-none'
      )}
      style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
      onKeyDown={(e) => {
        const ne = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
        if (ne.isComposing || ne.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (canSendContent && !model) {
            showToast('Select a model before sending.', 'danger');
            return;
          }
          if (!canSendContent && !isProcessing && !awaitingAskUser) return;
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
  );

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    setDragOver(false);
    onDrop(e);
  };

  return (
    <div className="relative w-full">
      <div
        className={cn(
          'flex flex-col overflow-hidden transition-shadow duration-150',
          footerMode
            ? 'bg-transparent'
            : appComposerShellClassName,
          dragOver && 'ring-2 ring-accent/35 ring-offset-0'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={onDragOver}
        onDrop={handleDrop}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 flex-1 flex-col">
            {pendingAskUser ? (
              <div
                className="mb-2 rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-meta text-text-secondary"
                role="status"
                aria-live="polite"
              >
                <span className="font-medium text-text-primary">Reply needed</span>
                {' — '}
                {pendingAskUser.payload.title?.trim() ||
                  'Answer in the panel above the composer, or type here and press Send.'}
              </div>
            ) : null}
            <ComposerRunRecovery model={model} onOpenProviders={onOpenProviders} />
            <AttachmentCollapsible
              items={attachments}
              editable
              onRemove={removeAttachment}
            />
            <div
              className={cn(
                'vx-composer-input-zone',
                footerMode && 'vx-composer-input-zone--footer'
              )}
            >
              {chipRow}
              {footerMode ? (
                <div className="vx-composer-input-row">
                  {mentionInput}
                  <SendButton
                    onClick={() => void handleSend()}
                    state={sendState}
                    disabled={!canSendContent && sendState !== 'processing' && !awaitingAskUser}
                  />
                </div>
              ) : (
                <>
                  {mentionInput}
                  <ComposerFooter
                    attachmentCount={attachments.length}
                    sendState={sendState}
                    onSend={() => void handleSend()}
                    canSend={(canSendContent || awaitingAskUser) && !!model}
                    compact={zoneOpen}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
