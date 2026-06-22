/**
 * Contenteditable composer with inline `@` file mention chips.
 * Unpicked `@` tokens remain literal plain text.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
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
  splicePlainTextRange,
  type MentionDocument
} from './mentionDocument.js';
import { getPlainCaretOffset, getPlainSelectionRange, placeCaretAtPlainOffset } from './mentionCaret.js';
import { MentionPicker } from './MentionPicker.js';
import { useMentionPicker, type MentionPickerRow } from './useMentionPicker.js';
import { removeComposerGhost, renderComposerGhost } from './composerGhost.js';
import { useInlineCompletion } from '../../../lib/useInlineCompletion.js';
import { useModelPickerCollisionPadding } from '../modelPicker/useModelPickerCollisionPadding.js';
import { useUiStore } from '../../../store/useUiStore.js';
import { isMacPlatform } from '../../../lib/resolveKeybindings.js';
import { defaultKeybindingsRecord, type KeybindingId } from '@shared/keybindings/defaultKeybindings.js';
import {
  handleComposerEditKeyDown,
  tryExecCommand,
  type ComposerEditKeybindings
} from './composerEditShortcuts.js';
import { sanitizeComposerHtml } from '../sanitizeComposerHtml.js';
import { buildClipboardDataTransfer } from '../buildClipboardDataTransfer.js';
import { scheduleDomFocus } from '../../../lib/focusComposer.js';
import { PANEL_IDS } from '@shared/panels/panelWidths.js';

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
  editKeybindings?: ComposerEditKeybindings;
  globalKeybindings?: Record<KeybindingId, string>;
  /** Composer shell — sizes the mention popover to the chat column. */
  anchorRef?: RefObject<HTMLElement | null>;
  landing?: boolean;
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
  inlineCompletion,
  editKeybindings,
  globalKeybindings,
  anchorRef,
  landing = false
}: MentionComposerProps) {
  const resolvedEditKeybindings =
    editKeybindings ?? defaultKeybindingsRecord(isMacPlatform());
  const resolvedGlobalKeybindings =
    globalKeybindings ?? defaultKeybindingsRecord(isMacPlatform());
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
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const pickerOpen = atToken !== null && !pickerDismissed;

  const atTokenKey = atToken ? `${atToken.start}:${atToken.query}` : null;
  useEffect(() => {
    setPickerDismissed(false);
  }, [atTokenKey]);

  const {
    rows,
    groups,
    loading,
    treeTruncated,
    activeIndex,
    activeRow,
    setActiveIndex,
    moveActive,
    selectActive,
    activateRow,
    toggleFolder,
    setFolderExpandedState,
    scrollFromKeyboardRef
  } = useMentionPicker({
    open: pickerOpen,
    query: atToken?.query ?? '',
    mentionedPaths
  });

  atTokenRef.current = atToken;

  const collisionPadding = useModelPickerCollisionPadding();
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);
  const [popoverRevision, setPopoverRevision] = useState(0);

  useEffect(() => {
    if (!pickerOpen) return;
    let frame = 0;
    let pass = 0;
    const remeasure = () => {
      setPopoverRevision((r) => r + 1);
      pass += 1;
      if (pass < 3) frame = requestAnimationFrame(remeasure);
    };
    frame = requestAnimationFrame(remeasure);
    return () => cancelAnimationFrame(frame);
  }, [pickerOpen, dockExpanded, dockWidth, landing, rows.length, groups.length]);

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

  useEffect(() => {
    if (!requestFocus || disabled) return;
    const el = editorRef.current;
    if (!el) return;
    return scheduleDomFocus(el, { caretAtEnd: true });
  }, [requestFocus, disabled, focusSession]);

  const focusEditorFromPointer = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const el = editorRef.current;
    if (!el || document.activeElement === el) return;
    if (e.button !== 0) return;
    el.focus({ preventScroll: true });
  }, [disabled]);

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
    const hadFocus = el === document.activeElement;
    const caret =
      hadFocus && el
        ? getPlainCaretOffset(el, extractMentions(docRef.current))
        : null;
    docRef.current = next;
    removeComposerGhost(editorRef.current);
    syncDomFromDoc(next);
    if (hadFocus && el) {
      scheduleDomFocus(el);
      if (caret !== null) {
        placeCaretAtPlainOffset(el, caret, docRef.current);
      }
    }
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
      setPickerDismissed(true);
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
    if (activeRow?.kind === 'workspace-folder' && activeRow.path) {
      if (e.key === 'ArrowRight' && !activeRow.isExpanded) {
        e.preventDefault();
        scrollFromKeyboardRef.current = true;
        setFolderExpandedState(activeRow.path, true);
        return true;
      }
      if (e.key === 'ArrowLeft' && activeRow.isExpanded) {
        e.preventDefault();
        scrollFromKeyboardRef.current = true;
        setFolderExpandedState(activeRow.path, false);
        return true;
      }
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const action = activateRow();
      if (action === 'picked') {
        const row = selectActive();
        if (row) handlePickerPick(row);
      }
      return true;
    }
    return false;
  };

  const applyPlainTextPaste = useCallback(
    (text: string) => {
      const root = editorRef.current;
      const mentions = extractMentions(docRef.current);
      const range = root ? getPlainSelectionRange(root, mentions) : null;
      const start = range?.start ?? documentToPlainText(docRef.current).length;
      const end = range?.end ?? start;
      const next = splicePlainTextRange(docRef.current, start, end, text);
      docRef.current = next;
      syncDomFromDoc(next);
      emitChange(next);
      const caret = start + text.length;
      requestAnimationFrame(() => {
        placeCaretAtPlainOffset(editorRef.current, caret, next);
      });
    },
    [emitChange, syncDomFromDoc]
  );

  const applySanitizedHtmlPaste = useCallback(
    (html: string) => {
      const safe = sanitizeComposerHtml(html);
      if (!safe) return false;
      if (tryExecCommand('insertHTML', safe)) {
        requestAnimationFrame(updateFromDom);
        return true;
      }
      const plain = safe.replace(/<[^>]+>/g, ' ');
      applyPlainTextPaste(plain);
      return true;
    },
    [applyPlainTextPaste, updateFromDom]
  );

  const runPasteFallback = useCallback(async () => {
    if (onPaste) {
      const clipboardData = await buildClipboardDataTransfer();
      if (clipboardData) {
        const event = new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true
        });
        onPaste(event as unknown as ClipboardEvent<HTMLDivElement>);
        if (event.defaultPrevented) {
          requestAnimationFrame(updateFromDom);
          return;
        }
        const html = clipboardData.getData('text/html');
        if (html && applySanitizedHtmlPaste(html)) return;
        const plain = clipboardData.getData('text/plain');
        if (plain) {
          applyPlainTextPaste(plain);
          return;
        }
      }
    }
    if (tryExecCommand('paste')) {
      requestAnimationFrame(updateFromDom);
    }
  }, [applyPlainTextPaste, applySanitizedHtmlPaste, onPaste, updateFromDom]);

  const editorTriggerRef = editorRef as RefObject<HTMLElement | null>;

  return (
    <div className="relative min-w-0 flex-1">
      <Popover
        open={pickerOpen}
        onClose={() => {
          setPickerDismissed(true);
        }}
        triggerRef={editorTriggerRef}
        anchorRef={anchorRef}
        preferSide={landing ? 'auto' : 'top'}
        align={anchorRef ? 'fit' : 'start'}
        anchorStrict={Boolean(anchorRef)}
        collisionPadding={collisionPadding}
        revision={popoverRevision}
        offset={6}
        zIndex={60}
        fitMaxWidth={480}
        widthMode="panel"
        panelId={PANEL_IDS.MENTION_PICKER}
        containScroll
        className="vx-mention-picker-popover"
      >
        <MentionPicker
          open={pickerOpen}
          query={atToken?.query ?? ''}
          groups={groups}
          rows={rows}
          activeRow={activeRow}
          loading={loading}
          treeTruncated={treeTruncated}
          activeIndex={activeIndex}
          scrollFromKeyboardRef={scrollFromKeyboardRef}
          onActiveIndexChange={setActiveIndex}
          onPick={handlePickerPick}
          onToggleFolder={toggleFolder}
          onClose={() => {
            setPickerDismissed(true);
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
        data-composer-editor
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
        onMouseDown={focusEditorFromPointer}
        onInput={updateFromDom}
        onPaste={(e) => {
          onPaste?.(e);
          if (e.defaultPrevented) {
            requestAnimationFrame(updateFromDom);
            return;
          }
          const html = e.clipboardData.getData('text/html');
          if (html.trim()) {
            e.preventDefault();
            applySanitizedHtmlPaste(html);
            return;
          }
          const text = e.clipboardData.getData('text/plain');
          if (text) {
            e.preventDefault();
            applyPlainTextPaste(text);
            return;
          }
          requestAnimationFrame(updateFromDom);
        }}
        onCopy={() => {
          requestAnimationFrame(updateFromDom);
        }}
        onCut={() => {
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
          if (
            handleComposerEditKeyDown({
              e,
              root: editorRef.current,
              doc: docRef.current,
              bindings: resolvedEditKeybindings,
              globalBindings: resolvedGlobalKeybindings,
              disabled,
              onAfterEdit: updateFromDom,
              onPasteFallback: runPasteFallback,
              onCutFallback: ({ start, end }) => {
                const next = splicePlainTextRange(docRef.current, start, end);
                docRef.current = next;
                syncDomFromDoc(next);
                emitChange(next);
                requestAnimationFrame(() => {
                  placeCaretAtPlainOffset(editorRef.current, start, next);
                });
              }
            })
          ) {
            return;
          }
          if (handlePickerKey(e)) return;
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}
