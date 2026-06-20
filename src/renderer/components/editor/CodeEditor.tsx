/**
 * CodeMirror 6 editing surface for workspace files.
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension, Annotation } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { cn } from '../../lib/cn.js';
import { shellMonoEditorBase } from './codemirrorTheme.js';
import { codemirrorLanguageForPath } from './codemirrorLanguage.js';
import {
  inlineCompletionExtension,
  type InlineCompletionFetchContext
} from './codemirrorInlineCompletion.js';
import { lspDiagnosticsExtension } from './codemirrorDiagnostics.js';
import { lspClientExtensions, type LspEditorBridge } from './codemirrorLsp.js';
import { vyotiq } from '../../lib/ipc.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { registerEditorDomFocus } from '../../lib/workbenchFocusDom.js';

export interface CodeEditorInlineCompletionConfig {
  enabled: boolean;
  debounceMs: number;
  providerId: string;
  modelId: string;
  filePath: string;
  workspaceId?: string;
}

export interface CodeEditorProps {
  value: string;
  filePath: string;
  readOnly?: boolean;
  /** When false the view stays mounted but does not receive focus-oriented updates. */
  active?: boolean;
  className?: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  /** Reports the primary cursor position + selection length to the status bar. */
  onCursor?: (line: number, col: number, selection: number) => void;
  inlineCompletion?: CodeEditorInlineCompletionConfig | null;
  onGoToDefinition?: (line: number, character: number) => void;
  lspBridge?: LspEditorBridge | null;
}

const inlineCompletionCompartment = new Compartment();
const lspCompartment = new Compartment();
/** Programmatic buffer sync from Zustand — must not mark the tab dirty. */
const externalDocSync = Annotation.define<boolean>();

function buildInlineCompletionFetch(
  config: CodeEditorInlineCompletionConfig
): (ctx: InlineCompletionFetchContext) => Promise<string | null> {
  let requestSeq = 0;
  return async ({ prefix, suffix }) => {
    const requestId = ++requestSeq;
    try {
      const reply = await vyotiq.completion.request({
        kind: 'editor',
        requestId,
        providerId: config.providerId,
        model: config.modelId,
        prefix,
        suffix,
        filePath: config.filePath,
        workspaceId: config.workspaceId
      });
      if (reply.requestId !== requestId) return null;
      const text = reply.text.trim();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  };
}

function inlineCompletionExtensions(
  config: CodeEditorInlineCompletionConfig | null | undefined
): Extension {
  if (!config) return [];
  return inlineCompletionExtension({
    enabled: config.enabled,
    debounceMs: config.debounceMs,
    fetchCompletion: buildInlineCompletionFetch(config),
    onDispose: () => {
      void vyotiq.completion.cancel('editor', config.workspaceId);
    }
  });
}

function scrollToReveal(view: EditorView, line: number, character: number): void {
  const docLine = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
  const pos = Math.min(docLine.from + character, docLine.to);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' })
  });
}

export function CodeEditor({
  value,
  filePath,
  readOnly = false,
  active = true,
  className,
  onChange,
  onSave,
  onCursor,
  inlineCompletion,
  onGoToDefinition,
  lspBridge = null
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursor);
  const inlineCompletionRef = useRef(inlineCompletion);
  const lspBridgeRef = useRef(lspBridge);

  const onGoToDefRef = useRef(onGoToDefinition);
  onGoToDefRef.current = onGoToDefinition;

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursor;
  inlineCompletionRef.current = inlineCompletion;
  lspBridgeRef.current = lspBridge;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saveBinding = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        }
      }
    ]);

    const extensions: Extension[] = [
      shellMonoEditorBase,
      // Gutter + active-line affordances already styled in codemirrorTheme
      // (.cm-gutters / .cm-activeLineGutter / .cm-activeLine) but never wired.
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
      saveBinding,
      ...codemirrorLanguageForPath(filePath),
      inlineCompletionCompartment.of(inlineCompletionExtensions(inlineCompletionRef.current)),
      lspCompartment.of(lspClientExtensions(lspBridgeRef.current)),
      ...lspDiagnosticsExtension((line, character) => {
        onGoToDefRef.current?.(line, character);
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const external = update.transactions.some((tr) => tr.annotation(externalDocSync) === true);
          if (!external) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }
        if (update.docChanged || update.selectionSet) {
          const sel = update.state.selection.main;
          const lineInfo = update.state.doc.lineAt(sel.head);
          onCursorRef.current?.(
            lineInfo.number,
            sel.head - lineInfo.from + 1,
            Math.abs(sel.to - sel.from)
          );
        }
      }),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly)
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    const reveal = useEditorStore.getState().consumeReveal(filePath);
    if (reveal) scrollToReveal(view, reveal.line, reveal.character);

    return () => {
      void vyotiq.completion.cancel('editor', inlineCompletionRef.current?.workspaceId);
      view.destroy();
      viewRef.current = null;
    };
  }, [filePath, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    void vyotiq.completion.cancel('editor', inlineCompletion?.workspaceId);
    view.dispatch({
      effects: inlineCompletionCompartment.reconfigure(
        inlineCompletionExtensions(inlineCompletion)
      )
    });
  }, [inlineCompletion]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lspCompartment.reconfigure(lspClientExtensions(lspBridge))
    });
  }, [lspBridge]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: externalDocSync.of(true)
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !active) return;
    const reveal = useEditorStore.getState().consumeReveal(filePath);
    if (reveal) scrollToReveal(view, reveal.line, reveal.character);
    const sel = view.state.selection.main;
    const lineInfo = view.state.doc.lineAt(sel.head);
    onCursorRef.current?.(
      lineInfo.number,
      sel.head - lineInfo.from + 1,
      Math.abs(sel.to - sel.from)
    );
    // Remeasure after tab switch — hidden/invisible panes can report wrong layout.
    requestAnimationFrame(() => view.requestMeasure());
  }, [filePath, lspBridge, active]);

  useEffect(() => {
    if (!active) return;
    return registerEditorDomFocus(() => {
      viewRef.current?.focus();
    });
  }, [active, filePath]);

  return (
    <div
      ref={hostRef}
      className={cn('vx-code-editor min-h-0 flex-1 overflow-hidden', className)}
      data-readonly={readOnly ? true : undefined}
    />
  );
}
