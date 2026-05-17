import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { ComposerToolbar } from './ComposerToolbar.js';
import { TokenUsagePill } from './TokenUsagePill.js';
import { useComposerTokenEstimate } from './useComposerTokenEstimate.js';
import { detectAtToken } from './atToken.js';
import { RunningElsewhereHint } from './runningElsewhere/index.js';
import { useComposerHistory } from './useComposerHistory.js';
import { Chip } from '../ui/Chip.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import {
  useProviderStore,
  selectEffectiveContextWindow
} from '../../store/useProviderStore.js';
import { cn } from '../../lib/cn.js';
import { AGENT_NAME } from '@shared/constants.js';

const TEXTAREA_MAX_HEIGHT = 168;

interface ComposerProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
}

export function Composer({ model, onModelChange, onOpenProviders }: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Active `@`-mention token. When non-null, the AttachmentPicker is
   * rendered controlled-mode (filter driven by `query`) and a successful
   * pick splices the `@…` span out of the textarea while adding the
   * picked path to attachments. The `+` button flow remains untouched.
   */
  const [atMention, setAtMention] = useState<{ start: number; query: string } | null>(null);
  /**
   * Drives the composer's accent-halo elevation. Flipped by the textarea's
   * focus/blur handlers so the card subtly breathes when the user is
   * composing — no ring on the textarea itself (would read as a double
   * affordance), just a single halo on the enclosing card.
   */
  const [textareaFocused, setTextareaFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** Tracks whether the current `text` came from history recall so
   *  ArrowDown can walk back toward the tail. Reset on any user
   *  keystroke that isn't history navigation. */
  const fromHistoryRef = useRef(false);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const send = useChatStore((s) => s.send);
  const abort = useChatStore((s) => s.abort);
  const totalRunUsage = useChatStore((s) => s.totalRunUsage);
  const events = useChatStore((s) => s.events);
  const conversationId = useChatStore((s) => s.conversationId);
  const runId = useChatStore((s) => s.runId);
  const storeDraft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const providers = useProviderStore((s) => s.providers);
  const setContextOverride = useProviderStore((s) => s.setContextOverride);
  // Effective permissions resolve through three layers:
  // DEFAULT_PERMISSIONS → settings.permissions (global) → per-workspace
  // override (if any). Driven by the active workspace id; switching
  // workspaces immediately re-resolves the menu / send pipeline so the
  // user can see the chosen folder's policy without a reload.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);

  // Pre-flight BPE estimate (main process). Runs while the user types.
  // Swapped out for the provider's actual `usage.promptTokens +
  // completionTokens` once the first streamed turn reports usage.
  const estimate = useComposerTokenEstimate({
    modelId: model?.modelId ?? '',
    prompt: text,
    attachments
  });
  const ceiling = model
    ? selectEffectiveContextWindow(providers, model.providerId, model.modelId)
    : undefined;
  const hasActualUsage = totalRunUsage !== undefined;
  const usedTokens = hasActualUsage
    ? totalRunUsage!.latest.promptTokens + totalRunUsage!.latest.completionTokens
    : estimate.tokens;

  const history = useComposerHistory(events);

  /** Debounced draft persistence. A single `requestAnimationFrame`
   *  coalesces rapid keystrokes into one store write per frame so
   *  sibling subscribers (sidebar, ChatPage) don't re-render on every
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

  const handleSend = async () => {
    if (isProcessing) {
      await abort();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed || !model) return;
    const toSend = attachments;
    setText('');
    setAttachments([]);
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
    await send(trimmed, model, permissions, toSend.length > 0 ? { attachments: toSend } : undefined);
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
      setAttachments((cur) => (cur.includes(path) ? cur : [...cur, path]));
      return;
    }
    const before = text.slice(0, atMention.start);
    const after = text.slice(atMention.start + 1 + atMention.query.length);
    // Collapse a duplicate space that may now appear if the token was
    // sandwiched between two spaces.
    const collapsed =
      before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after;
    setText(collapsed);
    setAttachments((cur) => (cur.includes(path) ? cur : [...cur, path]));
    setAtMention(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(atMention.start, atMention.start);
    });
  };

  const sendState: 'idle' | 'ready' | 'processing' = isProcessing
    ? 'processing'
    : text.trim().length > 0 && model
      ? 'ready'
      : 'idle';
  // Inspector entry point: the pill's primary click opens the
  // Context Inspector slide-over for either the in-flight run
  // (when one is bound) or the persisted-initial-messages view
  // of the conversation (when idle). Bound id is preferred in
  // priority order: live runId → conversationId. The Inspector
  // store handles the live-vs-idle mode switch internally.
  const openInspector = (() => {
    const id = runId ?? conversationId;
    if (!id) return undefined;
    const mode: 'live' | 'idle' = runId ? 'live' : 'idle';
    return () => {
      void useContextSummaryStore.getState().open(id, mode);
    };
  })();
  const tokenUsageSlot = model ? (
    <TokenUsagePill
      used={usedTokens}
      {...(typeof ceiling === 'number' ? { ceiling } : {})}
      estimated={!hasActualUsage && !estimate.exact}
      onCeilingChange={(value) =>
        setContextOverride(model.providerId, model.modelId, value)
      }
      {...(openInspector ? { onOpenInspector: openInspector } : {})}
    />
  ) : null;

  return (
    <div className="w-full">
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-card bg-surface-overlay p-1',
          textareaFocused ? 'elev-2-focused' : 'elev-2'
        )}
      >
        {attachments.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-inner bg-surface-raised/80 px-2 py-1">
            {attachments.map((p) => (
              <Chip
                key={p}
                as="button"
                tone="secondary"
                onClick={() => setAttachments((cur) => cur.filter((x) => x !== p))}
                title={`Remove ${p}`}
              >
                <span className="max-w-[240px] truncate font-mono">{p}</span>
                <X className="h-2.5 w-2.5 shrink-0" strokeWidth={2.25} />
              </Chip>
            ))}
          </div>
        )}
        {/*
          Self-hiding when no other slices are streaming. Sits between
          the chips row and the textarea so background work is visible
          in the natural reading flow without ever taking layout space
          in the idle case.
        */}
        <RunningElsewhereHint className="px-3 pb-0.5 pt-1" />
        <textarea
          ref={taRef}
          value={text}
          aria-label={`Message ${AGENT_NAME}`}
          onChange={(e) => onTextChange(e.target.value)}
          onFocus={() => setTextareaFocused(true)}
          onBlur={() => setTextareaFocused(false)}
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
              return;
            }
          }}
          rows={1}
          placeholder={`Message ${AGENT_NAME}`}
          className={cn(
            'w-full resize-none bg-transparent px-3 pb-2 pt-2.5 text-body leading-6 text-text-primary',
            'placeholder:text-text-faint',
            'outline-none focus:outline-none'
          )}
          style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
        />
        <ComposerToolbar
          model={model}
          onModelChange={onModelChange}
          sendState={sendState}
          onSend={() => void handleSend()}
          canSend={text.trim().length > 0 && !!model}
          attachments={attachments}
          // Picker is open whenever the `+` button toggled it OR the
          // user is mid-`@`-mention. The two flows route to different
          // close/pick handlers below.
          attachmentPickerOpen={pickerOpen || !!atMention}
          onOpenAttachments={() => setPickerOpen(true)}
          onCloseAttachments={() => {
            setPickerOpen(false);
            setAtMention(null);
          }}
          onPickAttachment={atMention ? onMentionPick : (p) =>
            setAttachments((cur) => (cur.includes(p) ? cur : [...cur, p]))
          }
          {...(atMention ? { attachmentFilter: atMention.query } : {})}
          {...(atMention ? { onAttachmentFilterChange: onMentionFilterChange } : {})}
          tokenUsageSlot={tokenUsageSlot}
          onOpenProviders={onOpenProviders}
        />
      </div>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
}
