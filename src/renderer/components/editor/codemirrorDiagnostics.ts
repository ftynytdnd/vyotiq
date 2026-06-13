/**
 * CodeMirror 6 diagnostic underlines from LSP publishDiagnostics.
 */

import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import type { LspDiagnostic } from '@shared/types/lsp.js';

export const setLspDiagnostics = StateEffect.define<LspDiagnostic[]>();

const severityClass: Record<LspDiagnostic['severity'], string> = {
  error: 'vx-cm-diagnostic-error',
  warning: 'vx-cm-diagnostic-warning',
  info: 'vx-cm-diagnostic-info'
};

function buildDecorations(doc: EditorView['state']['doc'], diags: LspDiagnostic[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of diags) {
    const from = doc.line(d.line + 1).from + d.character;
    const toLine = doc.line(Math.min(d.endLine + 1, doc.lines));
    const to = toLine.from + Math.min(d.endCharacter, toLine.length);
    if (from >= to) continue;
    builder.add(
      from,
      to,
      Decoration.mark({
        class: severityClass[d.severity],
        attributes: { title: d.message }
      })
    );
  }
  return builder.finish();
}

const diagnosticField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setLspDiagnostics)) {
        return buildDecorations(tr.state.doc, e.value);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f)
});

export function lspDiagnosticsExtension(
  onGoToDefinition?: (line: number, character: number) => void
) {
  const mods = [
    diagnosticField,
    EditorView.baseTheme({
      '.vx-cm-diagnostic-error': {
        textDecoration: 'underline wavy',
        textDecorationColor: 'var(--color-danger)'
      },
      '.vx-cm-diagnostic-warning': {
        textDecoration: 'underline wavy',
        textDecorationColor: 'var(--color-warning)'
      },
      '.vx-cm-diagnostic-info': {
        textDecoration: 'underline dotted',
        textDecorationColor: 'var(--color-text-faint)'
      }
    })
  ];
  if (onGoToDefinition) {
    mods.push(
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (!event.altKey) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          onGoToDefinition(line.number - 1, pos - line.from);
          return true;
        }
      })
    );
  }
  return mods;
}
