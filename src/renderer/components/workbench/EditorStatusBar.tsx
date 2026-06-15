/**
 * Editor status bar — line/col, selection, language, EOL, encoding, dirty.
 */

import type { EditorEncoding, EditorEol } from '@shared/types/editor.js';
import { languageFromPath } from '@shared/text/languageFromPath.js';
import { useEditorCursorStore } from '../../store/useEditorCursorStore.js';
import { cn } from '../../lib/cn.js';

const ENCODING_LABEL: Record<EditorEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'utf-32le': 'UTF-32 LE',
  'utf-32be': 'UTF-32 BE'
};

function eolLabel(eol: EditorEol): string {
  return eol === 'crlf' ? 'CRLF' : 'LF';
}

function languageLabel(filePath: string): string {
  const lang = languageFromPath(filePath);
  if (!lang) return 'Plain Text';
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

export interface EditorStatusBarProps {
  filePath: string;
  eol: EditorEol;
  encoding: EditorEncoding;
  utf8Bom?: boolean;
  dirty: boolean;
  lspStatus?: { connected: boolean; lastError?: string | null } | null;
  lspEnabled?: boolean;
  onLspClick?: () => void;
}

export function EditorStatusBar({
  filePath,
  eol,
  encoding,
  utf8Bom,
  dirty,
  lspStatus,
  lspEnabled,
  onLspClick
}: EditorStatusBarProps) {
  const line = useEditorCursorStore((s) => s.line);
  const col = useEditorCursorStore((s) => s.col);
  const selection = useEditorCursorStore((s) => s.selection);

  return (
    <footer className="vx-editor-statusbar flex h-6 shrink-0 items-center gap-3 border-t border-border-subtle/20 bg-surface-raised/40 px-3 text-meta text-text-faint">
      <span className="tabular-nums">
        Ln {line}, Col {col}
        {selection > 0 ? ` (${selection} sel)` : ''}
      </span>
      <span className="ml-auto flex items-center gap-3">
        {lspEnabled ? (
          <button
            type="button"
            className={cn(
              'vx-caption hover:text-text-secondary',
              lspStatus?.connected ? 'text-text-faint' : 'text-warning'
            )}
            onClick={onLspClick}
          >
            LSP · {lspStatus?.connected ? 'connected' : lspStatus?.lastError ? 'error' : 'off'}
          </button>
        ) : null}
        <span>{languageLabel(filePath)}</span>
        <span>{eolLabel(eol)}</span>
        <span>
          {ENCODING_LABEL[encoding]}
          {utf8Bom ? ' BOM' : ''}
        </span>
        <span className={cn('inline-flex items-center gap-1', dirty ? 'text-warning' : 'text-text-faint')}>
          <span
            className={cn('h-1.5 w-1.5 rounded-full', dirty ? 'bg-warning' : 'bg-success/70')}
            aria-hidden
          />
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
      </span>
    </footer>
  );
}
