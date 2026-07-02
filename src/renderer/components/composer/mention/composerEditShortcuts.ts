/**
 * Composer editing shortcuts — clipboard + undo/redo for the mention editor.
 */

import {
  defaultKeybindingsRecord,
  eventMatchesCombo,
  type KeybindingId,
  type KeyComboEvent
} from '@shared/keybindings/defaultKeybindings.js';
import { isMacPlatform } from '../../../lib/resolveKeybindings.js';
import type { MentionDocument } from './mentionDocument.js';
import { documentToPlainText, extractMentions } from './mentionDocument.js';
import { getPlainSelectionRange } from './mentionCaret.js';

export type ComposerEditKeybindingId = Extract<
  KeybindingId,
  | 'composerPaste'
  | 'composerCopy'
  | 'composerCut'
  | 'composerSelectAll'
  | 'composerUndo'
  | 'composerRedo'
  | 'composerRedoAlt'
>;

export type ComposerEditKeybindings = Pick<
  Record<KeybindingId, string>,
  ComposerEditKeybindingId
>;

export type ComposerAriaKeybindings = ComposerEditKeybindings &
  Pick<Record<KeybindingId, string>, 'composerQueue' | 'composerStop'>;

const GLOBAL_WIN_IDS = [
  'toggleDock',
  'openSearch',
  'prevChat',
  'nextChat',
  'nextWorkspace',
  'prevWorkspace',
  'newConversation',
  'openWorkspace',
  'openSettings',
  'saveEditor',
  'toggleTerminal',
  'companionPanels',
  'sourceControl',
  'closeWorkbenchTab',
  'cycleWorkbenchTabPrev',
  'cycleWorkbenchTabNext',
  'reload',
  'toggleDevTools',
  'timelineFind'
] as const satisfies readonly KeybindingId[];

export function matchesGlobalShortcut(
  e: KeyComboEvent,
  globalBindings: Record<KeybindingId, string>
): boolean {
  for (const id of GLOBAL_WIN_IDS) {
    if (eventMatchesCombo(e, globalBindings[id])) return true;
  }
  return false;
}

export function tryExecCommand(command: string, value?: string): boolean {
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/** True when the resolved binding still matches the platform default combo. */
export function composerBindingIsDefault(
  bindings: ComposerEditKeybindings,
  id: ComposerEditKeybindingId,
  isMac: boolean = isMacPlatform()
): boolean {
  const defaults = defaultKeybindingsRecord(isMac);
  return bindings[id] === defaults[id];
}

export function copyPlainSelection(root: HTMLElement, doc: MentionDocument): boolean {
  const range = getPlainSelectionRange(root, extractMentions(doc));
  if (!range || range.collapsed) return false;
  const plain = documentToPlainText(doc);
  const text = plain.slice(range.start, range.end);
  if (!text) return false;
  void navigator.clipboard.writeText(text);
  return true;
}

export interface ComposerEditKeyDownInput {
  e: KeyComboEvent & { preventDefault(): void };
  root: HTMLElement | null;
  doc: MentionDocument;
  bindings: ComposerEditKeybindings;
  globalBindings?: Record<KeybindingId, string>;
  disabled?: boolean;
  isMac?: boolean;
  onAfterEdit?: () => void;
  onCutFallback?: (range: { start: number; end: number }) => void;
  /** Keydown fallback when the native paste event does not fire (remapped Mod+V). */
  onPasteFallback?: () => void | Promise<void>;
}

/** Returns true when the shortcut was handled. */
export function handleComposerEditKeyDown(input: ComposerEditKeyDownInput): boolean {
  const {
    e,
    root,
    doc,
    bindings,
    globalBindings,
    disabled,
    isMac = isMacPlatform(),
    onAfterEdit,
    onCutFallback,
    onPasteFallback
  } = input;
  if (disabled || !root) return false;

  if (globalBindings && matchesGlobalShortcut(e, globalBindings)) {
    return false;
  }

  const finish = () => {
    onAfterEdit?.();
  };

  const deferToNative = (id: ComposerEditKeybindingId): boolean =>
    composerBindingIsDefault(bindings, id, isMac);

  if (eventMatchesCombo(e, bindings.composerCopy)) {
    if (deferToNative('composerCopy')) return false;
    e.preventDefault();
    if (!tryExecCommand('copy')) {
      copyPlainSelection(root, doc);
    }
    return true;
  }

  if (eventMatchesCombo(e, bindings.composerCut)) {
    if (deferToNative('composerCut')) return false;
    e.preventDefault();
    if (!tryExecCommand('cut')) {
      const range = getPlainSelectionRange(root, extractMentions(doc));
      if (range && !range.collapsed) {
        copyPlainSelection(root, doc);
        onCutFallback?.({ start: range.start, end: range.end });
      }
    } else {
      finish();
    }
    return true;
  }

  if (eventMatchesCombo(e, bindings.composerSelectAll)) {
    if (deferToNative('composerSelectAll')) return false;
    e.preventDefault();
    if (!tryExecCommand('selectAll')) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(root);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return true;
  }

  if (eventMatchesCombo(e, bindings.composerUndo)) {
    if (deferToNative('composerUndo')) return false;
    e.preventDefault();
    tryExecCommand('undo');
    finish();
    return true;
  }

  if (eventMatchesCombo(e, bindings.composerRedo)) {
    if (deferToNative('composerRedo')) return false;
    e.preventDefault();
    tryExecCommand('redo');
    finish();
    return true;
  }

  if (eventMatchesCombo(e, bindings.composerRedoAlt)) {
    if (deferToNative('composerRedoAlt')) return false;
    e.preventDefault();
    tryExecCommand('redo');
    finish();
    return true;
  }

  if (eventMatchesCombo(e, bindings.composerPaste)) {
    if (deferToNative('composerPaste')) return false;
    e.preventDefault();
    if (onPasteFallback) {
      void onPasteFallback();
      return true;
    }
    if (tryExecCommand('paste')) {
      finish();
      return true;
    }
    return false;
  }

  return false;
}

export function composerEditAriaKeyshortcuts(bindings: ComposerAriaKeybindings): string {
  return [
    'Enter',
    'Shift+Enter',
    bindings.composerQueue,
    bindings.composerStop,
    bindings.composerPaste,
    bindings.composerCopy,
    bindings.composerCut,
    bindings.composerSelectAll,
    bindings.composerUndo,
    bindings.composerRedo,
    'ArrowUp',
    'ArrowDown',
    'Tab'
  ]
    .filter(Boolean)
    .join(' ');
}
