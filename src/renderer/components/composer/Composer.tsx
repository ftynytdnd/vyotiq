import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ModelSelection } from '@shared/types/provider.js';
import { AGENT_NAME, MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerFooter } from './ComposerFooter.js';
import { ComposerRunRecovery } from './ComposerRunRecovery.js';
import { ComposerStatusStrip } from './ComposerStatusStrip.js';
import { AttachmentButton } from './AttachmentButton.js';
import { SendButton } from './SendButton.js';
import { ModelPicker } from './modelPicker/index.js';
import { TokenUsagePill } from './TokenUsagePill.js';
import { PromptAttachmentCards } from './PromptAttachmentCards.js';
import { useComposerAttachments } from './useComposerAttachments.js';
import { detectAtToken } from './atToken.js';
import { useComposerHistory } from './useComposerHistory.js';
import {
  appComposerShellClassName,
  appComposerTextareaClassName
} from '../ui/SurfaceShell.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
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
  /**
   * Active `@`-mention token. When non-null, the AttachmentPicker is
   * rendered controlled-mode (filter driven by `query`) and a successful
   * pick splices the `@…` span out of the textarea while adding the
   * picked path to attachments. The `+` button flow remains untouched.
   */
  const [atMention, setAtMention] = useState<{ start: number; query: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
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
    setDraft,
    totalRunUsage,
    orchestratorUsage,
    subagents
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
      setDraft: s.setDraft,
      totalRunUsage: s.totalRunUsage,
      orchestratorUsage: s.orchestratorUsage,
      subagents: s.subagents
    }))
  );
  const activeWorkspaceIdForAttach = useWorkspaceStore((s) => s.activeId);
  const {
    attachments,
    addPaths,
    pickFromComputer,
    remove: removeAttachment,
    clearAttachments,
    peekPendingMessageId,
    onDrop,
    onDragOver
  } = useComposerAttachments({
    conversationId,
    workspaceId: activeWorkspaceIdForAttach
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

  // Auto-focus the textarea when `text` changes from empty to non-empty
  // while the textarea is not focused — catches draft hydration on
  // conversation switch without stealing focus during normal typing.
  const prevTextRef = useRef(text);
  useEffect(() => {
    const prev = prevTextRef.current;
    prevTextRef.current = text;
    if (!prev && text) {
      const el = taRef.current;
      if (el && document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    }
  }, [text]);

  useEffect(() => {
    autosize(taRef.current);
  }, [text]);

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
    const trimmed = text.trim();
    if (awaitingAskUser && pendingAskUser && conversationId && runId) {
      const draftReady = useAskUserDraftStore
        .getState()
        .hasAnyAnswer(pendingAskUser.id, pendingAskUser.payload, trimmed);
      if (!draftReady && !trimmed && attachments.length === 0) {
        showToast('Select answers in the panel above or type a reply before sending.', 'danger');
        return;
      }
      setText('');
      clearAttachments();
      setAtMention(null);
      fromHistoryRef.current = false;
      history.reset();
      if (conversationId) {
        if (draftRafRef.current !== null) {
          cancelAnimationFrame(draftRafRef.current);
          draftRafRef.current = null;
        }
        selfDraftRef.current = '';
        setDraft(conversationId, '');
      }
      await submitPendingAskUser({ supplementText: trimmed || undefined });
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
    setAtMention(null);
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
    }
    await send(
      trimmed || 'See attached files.',
      model,
      permissions,
      toSendMeta.length > 0
        ? { attachmentMeta: toSendMeta, promptEventId }
        : undefined
    );
  };

  const onTextChange = (next: string) => {
    setText(next);
    fromHistoryRef.current = false;
    history.reset();
    flushDraft(next);
    const el = taRef.current;
    const cursor = el ? (el.selectionStart ?? next.length) : next.length;
    setAtMention(detectAtToken(next, cursor));
  };

  /** Selection change inside the textarea can also enter / leave a token
   *  (e.g. arrow keys move into an existing `@foo`). Re-evaluate. */
  const onSelectionUpdate = () => {
    const el = taRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? text.length;
    setAtMention(detectAtToken(text, cursor));
  };

  /** When the user types more chars after `@`, the picker's controlled
   *  filter advances and we splice the new query back into the textarea
   *  at the token position. Symmetric: deleting characters narrows the
   *  query AND shrinks the textarea token. */
  const onMentionFilterChange = (nextQuery: string) => {
    if (!atMention) return;
    const before = text.slice(0, atMention.start + 1); // keep the `@`
    const after = text.slice(atMention.start + 1 + atMention.query.length);
    const merged = before + nextQuery + after;
    setText(merged);
    setAtMention({ start: atMention.start, query: nextQuery });
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      const cursor = atMention.start + 1 + nextQuery.length;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  /** Picking a file in `@`-mode strips the `@token` from the textarea
   *  and adds the picked path to the attachments pill row. */
  const onMentionPick = (path: string) => {
    if (!atMention) {
      void addPaths([path]);
      return;
    }
    const before = text.slice(0, atMention.start);
    const after = text.slice(atMention.start + 1 + atMention.query.length);
    // Collapse a duplicate space that may now appear if the token was
    // sandwiched between two spaces.
    const collapsed =
      before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after;
    setText(collapsed);
    void addPaths([path]);
    setAtMention(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(atMention.start, atMention.start);
    });
  };

  const pendingAskUser = useMemo(
    () => findPendingAskUserEvent(events, awaitingAskUser),
    [events, awaitingAskUser]
  );
  const draftHasAnswer = useAskUserDraftStore((s) =>
    pendingAskUser
      ? s.hasAnyAnswer(pendingAskUser.id, pendingAskUser.payload, text.trim())
      : false
  );
  const canSendContent =
    text.trim().length > 0 ||
    attachments.length > 0 ||
    (awaitingAskUser && draftHasAnswer);
  const sendState: 'idle' | 'ready' | 'processing' = isProcessing
    ? 'processing'
    : (canSendContent || awaitingAskUser) && model
      ? 'ready'
      : 'idle';
  const footerMode = variant === 'footer';
  const zoneOpen = useSecondaryZoneStore((s) => s.panel !== null);
  const revertPrompt = useRevertPrompt();

  const attachmentButton = (
    <AttachmentButton
      open={pickerOpen || !!atMention}
      onOpen={() => setPickerOpen(true)}
      onClose={() => {
        setPickerOpen(false);
        setAtMention(null);
      }}
      selected={selectedPaths}
      onPick={atMention ? onMentionPick : (p) => void addPaths([p])}
      onPickFromComputer={() => void pickFromComputer()}
      workspaceOnly={atMention !== null}
      {...(atMention ? { controlledFilter: atMention.query } : {})}
      {...(atMention ? { onControlledFilterChange: onMentionFilterChange } : {})}
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
      <TokenUsagePill
        total={totalRunUsage}
        orchestrator={orchestratorUsage}
        subagents={Object.fromEntries(
          Object.entries(subagents).map(([id, sa]) => [id, sa.usage])
        )}
      />
      {footerMode && attachments.length > 0 && (
        <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
          {attachments.length}/{MAX_CHAT_ATTACHMENTS}
        </span>
      )}
    </div>
  );

  const textarea = (
    <textarea
      ref={taRef}
      value={text}
      aria-label={`Message ${AGENT_NAME}`}
      aria-keyshortcuts="Enter Shift+Enter ArrowUp ArrowDown Escape"
      onChange={(e) => onTextChange(e.target.value)}
      onKeyUp={onSelectionUpdate}
      onClick={onSelectionUpdate}
      onKeyDown={(e) => {
        const ne = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
        if (ne.isComposing || ne.keyCode === 229) return;
        if (atMention && e.key === 'Escape') {
          e.preventDefault();
          setAtMention(null);
          return;
        }
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
        if (e.key === 'ArrowUp' && text === '') {
          e.preventDefault();
          const recalled = history.recall('up');
          if (recalled !== null) {
            setText(recalled);
            fromHistoryRef.current = true;
            requestAnimationFrame(() => {
              const el = taRef.current;
              if (el) el.setSelectionRange(recalled.length, recalled.length);
            });
          }
          return;
        }
        if (e.key === 'ArrowDown' && fromHistoryRef.current) {
          e.preventDefault();
          const recalled = history.recall('down');
          setText(recalled ?? '');
          if (recalled === null) {
            fromHistoryRef.current = false;
          }
          requestAnimationFrame(() => {
            const el = taRef.current;
            if (el) {
              const pos = recalled?.length ?? 0;
              el.setSelectionRange(pos, pos);
            }
          });
        }
      }}
      rows={1}
      placeholder="@ to mention files, or describe your task…"
      className={cn(
        appComposerTextareaClassName,
        footerMode ? 'min-h-[1.75rem] leading-5' : 'min-h-[2.5rem]',
        footerMode && 'min-w-0 flex-1',
        'transition-[height] duration-150 ease-out motion-reduce:transition-none'
      )}
      style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
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
            {attachments.length > 0 && (
              <PromptAttachmentCards
                items={attachments}
                editable
                onRemove={removeAttachment}
                className="mb-1"
              />
            )}
            <div
              className={cn(
                'vx-composer-input-zone',
                footerMode && 'vx-composer-input-zone--footer'
              )}
            >
              {chipRow}
              {footerMode ? (
                <div className="vx-composer-input-row">
                  {textarea}
                  <SendButton
                    onClick={() => void handleSend()}
                    state={sendState}
                    disabled={!canSendContent && sendState !== 'processing' && !awaitingAskUser}
                  />
                </div>
              ) : (
                <>
                  {textarea}
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

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
}
