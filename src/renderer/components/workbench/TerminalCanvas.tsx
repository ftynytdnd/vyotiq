/**
 * Terminal canvas — single or split xterm panes plus a find overlay.
 * Session strip + actions live in the contextual toolbar (TerminalToolbar).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { LoadingHint } from '../ui/LoadingHint.js';
import { XtermView } from '../terminal/XtermView.js';
import { getTerminalEntry } from '../terminal/terminalPool.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS } from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

function TerminalPane({ sessionId }: { sessionId: string }) {
  return (
    <div className="vx-terminal-pane flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <XtermView sessionId={sessionId} active />
    </div>
  );
}

function SearchOverlay({ sessionId }: { sessionId: string }) {
  const setSearchOpen = useTerminalStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runFind = useCallback(
    (forward: boolean) => {
      if (!query) return;
      const entry = getTerminalEntry(sessionId);
      const opts = { caseSensitive: false, regex: false, wholeWord: false };
      if (forward) entry.search.findNext(query, opts);
      else entry.search.findPrevious(query, opts);
    },
    [query, sessionId]
  );

  return (
    <div className="vx-terminal-search flex shrink-0 items-center gap-1 border-b border-border-subtle/20 bg-surface-raised/60 px-2 py-1">
      <input
        ref={inputRef}
        type="text"
        className="vx-input min-w-0 flex-1 font-mono text-meta"
        placeholder="Find in terminal…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runFind(!e.shiftKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setSearchOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="rounded p-1 text-text-muted hover:bg-chrome-hover-soft hover:text-text-primary"
        title="Previous match (Shift+Enter)"
        onClick={() => runFind(false)}
      >
        <ArrowUp className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <button
        type="button"
        className="rounded p-1 text-text-muted hover:bg-chrome-hover-soft hover:text-text-primary"
        title="Next match (Enter)"
        onClick={() => runFind(true)}
      >
        <ArrowDown className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <button
        type="button"
        className="rounded p-1 text-text-muted hover:bg-chrome-hover-soft hover:text-text-primary"
        title="Close (Esc)"
        onClick={() => setSearchOpen(false)}
      >
        <X className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
    </div>
  );
}

export function TerminalCanvas() {
  const attaching = useTerminalStore((s) => s.attaching);
  const error = useTerminalStore((s) => s.error);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const splitSessionId = useTerminalStore((s) => s.splitSessionId);
  const searchOpen = useTerminalStore((s) => s.searchOpen);

  const hasSession = activeSessionId !== null && sessions.length > 0;

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-terminal-canvas')}>
      {searchOpen && activeSessionId ? <SearchOverlay sessionId={activeSessionId} /> : null}
      <div className="vx-terminal-surface flex min-h-0 flex-1 flex-col">
        {error ? (
          <p className="px-4 py-6 text-meta text-text-muted">{error}</p>
        ) : attaching || !hasSession ? (
          <LoadingHint message="Starting shell…" className="py-6" />
        ) : splitSessionId ? (
          <PanelGroup direction="horizontal" className="min-h-0 flex-1">
            <Panel defaultSize={50} minSize={20} className="min-h-0">
              <TerminalPane sessionId={activeSessionId} />
            </Panel>
            <PanelResizeHandle className="vx-terminal-split-handle" />
            <Panel defaultSize={50} minSize={20} className="min-h-0">
              <TerminalPane sessionId={splitSessionId} />
            </Panel>
          </PanelGroup>
        ) : (
          <TerminalPane sessionId={activeSessionId} />
        )}
      </div>
    </div>
  );
}
