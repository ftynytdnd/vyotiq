/**
 * Contenteditable composer with inline `@` file mention chips.
 * Unpicked `@` tokens remain literal plain text.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject
} from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { Popover } from '../../ui/Popover.js';
import { AGENT_NAME } from '@shared/constants.js';
import type { MentionRef } from '@shared/types/mention.js';
import { detectAtToken } from '../atToken.js';
import { cn } from '../../../lib/cn.js';
import { appComposerTextareaClassName } from '../../ui/SurfaceShell.js';
import {
  documentToPlainText,
  emptyMentionDocument,
  extractMentions,
  hasComposerContent,
  createFileMentionRef,
  createSymbolMentionRef,
  createConversationMentionRef,
  insertMentionAt,
  replaceAtTokenWithMentionRef,
  insertPlainTextAtOffset,
  parseMentionDocument,
  serializeMentionDocument,
  type MentionDocument
} from './mentionDocument.js';
import { getPlainCaretOffset, placeCaretAtPlainOffset } from './mentionCaret.js';
import { MentionPicker } from './MentionPicker.js';
import { useMentionPicker, type MentionPickerRow } from './useMentionPicker.js';
import { removeComposerGhost, renderComposerGhost } from './composerGhost.js';
import { useInlineCompletion } from '../../../lib/useInlineCompletion.js';

const TEXTAREA_MAX_HEIGHT = 168;
const TEXTAREA_MIN_HEIGHT = 28;
const CHIP_CLASS = 'vx-mention-chip';

export interface MentionComposerProps {
  value: string;
  onChange: (serialized: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  ariaKeyshortcuts?: string;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** Focus the editor on mount (empty-chat landing). */
  requestFocus?: boolean;
  /** Changes re-trigger focus (e.g. switching empty conversations). */
  focusSession?: string | null;
  /** Inline prompt continuation (Tab to accept). */
  inlineCompletion?: {
    enabled: boolean;
    debounceMs: number;
    model: ModelSelection | null;
    workspaceId?: string | null;
  };
}

export function MentionComposer({
  value,
  onChange,
  placeholder,
  className,
  style,
  disabled,
  ariaKeyshortcuts,
  onPaste,
  onKeyDown,
  requestFocus,
  focusSession,
  inlineCompletion
}: MentionComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<MentionDocument>(emptyMentionDocument());
  const atTokenRef = useRef<{ start: number; query: string } | null>(null);
  const syncingRef = useRef(false);

  const parsed = parseMentionDocument(value);
  const mentionedPaths = extractMentions(parsed)
    .map((m) => m.workspacePath ?? m.label)
    .filter(Boolean);

  const plainForToken = documentToPlainText(parsed);
  const caret = getPlainCaretOffset(editorRef.current, extractMentions(parsed));
  const atToken = caret !== null ? detectAtToken(plainForToken, caret) : null;
  const pickerOpen = atToken !== null;

  const {
    rows,
    loading,
    activeIndex,
    setActiveIndex,
    moveActive,
    selectActive
  } = useMentionPicker({
    open: pickerOpen,
    query: atToken?.query ?? '',
    mentionedPaths
  });

  atTokenRef.current = atToken;

  const completion = useInlineCompletion({
    kind: 'composer',
    enabled: inlineCompletion?.enabled === true && inlineCompletion.model !== null,
    debounceMs: inlineCompletion?.debounceMs ?? 450,
    model: inlineCompletion?.model ?? null,
    workspaceId: inlineCompletion?.workspaceId
  });

  const {
    schedule: scheduleCompletion,
    clearGhost: clearCompletionGhost,
    acceptGhost: acceptCompletionGhost,
    setOnGhost: setCompletionOnGhost,
    pendingContextRef: completionContextRef
  } = completion;

  useEffect(() => {
    setCompletionOnGhost((ghost) => {
      const pending = completionContextRef.current;
      if (ghost && pending?.caretOffset !== undefined) {
        const caret =
          getPlainCaretOffset(editorRef.current, extractMentions(docRef.current)) ??
          documentToPlainText(docRef.current).length;
        if (caret !== pending.caretOffset) return;
      }
      renderComposerGhost(editorRef.current, ghost);
    });
    return () => {
      removeComposerGhost(editorRef.current);
      clearCompletionGhost();
    };
  }, [clearCompletionGhost, completionContextRef, setCompletionOnGhost]);

  const scheduleComposerCompletion = useCallback(() => {
    if (!inlineCompletion?.enabled || !inlineCompletion.model || pickerOpen) {
      clearCompletionGhost();
      return;
    }
    const plain = documentToPlainText(docRef.current);
    const caretOffset =
      getPlainCaretOffset(editorRef.current, extractMentions(docRef.current)) ?? plain.length;
    const prefix = plain.slice(0, caretOffset);
    if (prefix.trim().length < 3) {
      clearCompletionGhost();
      return;
    }
    scheduleCompletion(prefix, { caretOffset });
  }, [clearCompletionGhost, inlineCompletion, pickerOpen, scheduleCompletion]);

  useEffect(() => {
    if (inlineCompletion?.enabled) return;
    removeComposerGhost(editorRef.current);
    clearCompletionGhost();
  }, [clearCompletionGhost, inlineCompletion?.enabled]);

  useLayoutEffect(() => {
    if (!requestFocus || disabled) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
  }, [requestFocus, disabled, focusSession]);

  const syncDomFromDoc = useCallback((doc: MentionDocument) => {
    const el = editorRef.current;
    if (!el) return;
    syncingRef.current = true;
    el.innerHTML = '';
    if (!hasComposerContent(doc)) {
      syncingRef.current = false;
      return;
    }
    for (const seg of doc.segments) {
      if (seg.type === 'text') {
        el.appendChild(document.createTextNode(seg.value));
      } else {
        const chip = document.createElement('span');
        chip.className = CHIP_CLASS;
        chip.contentEditable = 'false';
        chip.dataset.mentionId = seg.ref.id;
        chip.dataset.mentionKind = seg.ref.kind;
        chip.textContent = `@${seg.ref.label}`;
        el.appendChild(chip);
      }
    }
    syncingRef.current = false;
  }, []);

  const readDocFromDom = useCallback((): MentionDocument => {
    const el = editorRef.current;
    if (!el) return emptyMentionDocument();
    const known = extractMentions(docRef.current);
    const segments: MentionDocument['segments'] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent ?? '';
        if (t.length > 0) {
          const last = segments[segments.length - 1];
          if (last?.type === 'text') last.value += t;
          else segments.push({ type: 'text', value: t });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const elem = node as HTMLElement;
      if (elem.classList.contains(CHIP_CLASS) && elem.dataset.mentionId) {
        const existing = known.find((m) => m.id === elem.dataset.mentionId);
        if (existing) segments.push({ type: 'mention', ref: existing });
        return;
      }
      elem.childNodes.forEach(walk);
    };
    el.childNodes.forEach(walk);
    if (segments.length === 0) return emptyMentionDocument();
    return { segments };
  }, []);

  const emitChange = useCallback(
    (doc: MentionDocument) => {
      docRef.current = doc;
      onChange(serializeMentionDocument(doc));
    },
    [onChange]
  );

  const updateFromDom = useCallback(() => {
    if (syncingRef.current) return;
    removeComposerGhost(editorRef.current);
    const doc = readDocFromDom();
    docRef.current = doc;
    emitChange(doc);
    scheduleComposerCompletion();
  }, [emitChange, readDocFromDom, scheduleComposerCompletion]);

  useLayoutEffect(() => {
    const next = parseMentionDocument(value);
    const currentSerialized = serializeMentionDocument(docRef.current);
    const el = editorRef.current;
    const domPlain = el?.textContent ?? '';
    const propPlain = documentToPlainText(next);
    const domDrifted =
      el !== null &&
      (domPlain !== propPlain ||
        (!value && domPlain.length > 0 && currentSerialized === value));
    if (currentSerialized === value && !domDrifted) return;
    docRef.current = next;
    removeComposerGhost(editorRef.current);
    syncDomFromDoc(next);
  }, [value, syncDomFromDoc]);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.max(TEXTAREA_MIN_HEIGHT, Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT));
    el.style.height = `${next}px`;
  }, [value, pickerOpen]);

  const applyMentionRef = useCallback(
    (ref: MentionRef) => {
      const plain = documentToPlainText(docRef.current);
      const caretOffset =
        getPlainCaretOffset(editorRef.current, extractMentions(docRef.current)) ??
        plain.length;
      const token = atTokenRef.current;
      let next: MentionDocument;
      if (token) {
        next = replaceAtTokenWithMentionRef(docRef.current, token.start, caretOffset, ref);
      } else {
        next = insertMentionAt(docRef.current, caretOffset, ref);
      }
      docRef.current = next;
      syncDomFromDoc(next);
      emitChange(next);
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        placeCaretAtPlainOffset(
          editorRef.current,
          documentToPlainText(next).length,
          next
        );
      });
    },
    [emitChange, syncDomFromDoc]
  );

  const handlePickerPick = (row: MentionPickerRow) => {
    if (row.kind === 'workspace-file' && row.path) {
      applyMentionRef(createFileMentionRef(row.path));
      return;
    }
    if (row.kind === 'symbol' && row.path && row.line != null) {
      applyMentionRef(createSymbolMentionRef(row.label, row.path, row.line));
      return;
    }
    if (row.kind === 'conversation' && row.conversationId) {
      applyMentionRef(createConversationMentionRef(row.conversationId, row.label));
    }
  };

  const acceptComposerGhost = useCallback(() => {
    const ghost = acceptCompletionGhost();
    if (!ghost) return false;
    removeComposerGhost(editorRef.current);
    const caret =
      getPlainCaretOffset(editorRef.current, extractMentions(docRef.current)) ??
      documentToPlainText(docRef.current).length;
    const next = insertPlainTextAtOffset(docRef.current, caret, ghost);
    docRef.current = next;
    syncDomFromDoc(next);
    emitChange(next);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      placeCaretAtPlainOffset(editorRef.current, caret + ghost.length, next);
    });
    return true;
  }, [acceptCompletionGhost, emitChange, syncDomFromDoc]);

  const handlePickerKey = (e: KeyboardEvent<HTMLDivElement>): boolean => {
    if (!pickerOpen) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      return true;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const row = selectActive();
      if (row) handlePickerPick(row);
      return true;
    }
    return false;
  };

  const editorTriggerRef = editorRef as RefObject<HTMLElement | null>;

  return (
    <div className="relative min-w-0 flex-1">
      <Popover
        open={pickerOpen}
        onClose={() => {
          /* closes when @ token ends */
        }}
        triggerRef={editorTriggerRef}
        preferSide="top"
        align="start"
        offset={6}
        zIndex={60}
      >
        <MentionPicker
          open={pickerOpen}
          query={atToken?.query ?? ''}
          rows={rows}
          loading={loading}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onPick={handlePickerPick}
          onClose={() => {
            /* picker closes when @ token ends */
          }}
        />
      </Popover>
      {!hasComposerContent(parsed) && placeholder ? (
        <div className="vx-mention-composer-placeholder" aria-hidden>
          {placeholder}
        </div>
      ) : null}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={`Message ${AGENT_NAME}`}
        {...(ariaKeyshortcuts ? { 'aria-keyshortcuts': ariaKeyshortcuts } : {})}
        contentEditable={!disabled}
        spellCheck={false}
        suppressContentEditableWarning
        className={cn(
          appComposerTextareaClassName,
          'vx-mention-composer',
          'min-h-[2.5rem] outline-none',
          className
        )}
        style={style}
        onInput={updateFromDom}
        onPaste={(e) => {
          onPaste?.(e);
          requestAnimationFrame(updateFromDom);
        }}
        onKeyUp={updateFromDom}
        onClick={updateFromDom}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !e.shiftKey && !pickerOpen) {
            if (acceptComposerGhost()) {
              e.preventDefault();
              return;
            }
          }
          if (e.key === 'Escape') {
            clearCompletionGhost();
            removeComposerGhost(editorRef.current);
          }
          if (handlePickerKey(e)) return;
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}
