/**
 * CodeMirror 6 theme aligned with Shell Mono stealth-dark tokens.
 */

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { shellMonoSyntaxHighlighting } from './codemirrorShellMonoHighlight.js';

export const shellMonoEditorTheme: Extension = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--color-text-primary)',
      fontSize: '0.8125rem',
      fontFamily: 'var(--font-mono)'
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      lineHeight: '1.55'
    },
    '.cm-content': {
      caretColor: 'var(--color-accent)',
      padding: '0.75rem 0'
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--color-text-faint)',
      border: 'none',
      paddingRight: '0.5rem',
      minWidth: '2.75rem'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent'
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in oklch, var(--color-chrome-hover) 35%, transparent)'
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: 'var(--color-accent)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'color-mix(in oklch, var(--color-accent) 22%, transparent) !important'
    },
    '.cm-line': {
      padding: '0 0.75rem'
    }
  },
  { dark: true }
);

export const shellMonoEditorBase: Extension = [
  shellMonoEditorTheme,
  shellMonoSyntaxHighlighting,
  EditorView.lineWrapping
];
