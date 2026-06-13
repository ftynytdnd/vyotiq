/**
 * CodeMirror 6 editing surface for workspace files.
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { cn } from '../../lib/cn.js';
import { shellMonoEditorBase } from './codemirrorTheme.js';
import { codemirrorLanguageForPath } from './codemirrorLanguage.js';
import {
  inlineCompletionExtension,
  type InlineCompletionFetchContext
} from './codemirrorInlineCompletion.js';
import { lspDiagnosticsExtension, setLspDiagnostics } from './codemirrorDiagnostics.js';
import type { LspDiagnostic } from '@shared/types/lsp.js';
import { vyotiq } from '../../lib/ipc.js';

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
  className?: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  inlineCompletion?: CodeEditorInlineCompletionConfig | null;
  diagnostics?: LspDiagnostic[];
  onGoToDefinition?: (line: number, character: number) => void;
}

const inlineCompletionCompartment = new Compartment();

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

export function CodeEditor({
  value,
  filePath,
  readOnly = false,
  className,
  onChange,
  onSave,
  inlineCompletion,
  diagnostics = [],
  onGoToDefinition
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const inlineCompletionRef = useRef(inlineCompletion);

  const onGoToDefRef = useRef(onGoToDefinition);
  onGoToDefRef.current = onGoToDefinition;

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  inlineCompletionRef.current = inlineCompletion;

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
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveBinding,
      ...codemirrorLanguageForPath(filePath),
      inlineCompletionCompartment.of(inlineCompletionExtensions(inlineCompletionRef.current)),
      ...lspDiagnosticsExtension((line, character) => {
        onGoToDefRef.current?.(line, character);
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        onChangeRef.current?.(update.state.doc.toString());
      }),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly)
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

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
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setLspDiagnostics.of(diagnostics) });
  }, [diagnostics]);

  return (
    <div
      ref={hostRef}
      className={cn('vx-code-editor min-h-0 flex-1 overflow-hidden', className)}
      data-readonly={readOnly ? true : undefined}
    />
  );
}
