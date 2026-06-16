/**
 * Terminal canvas — single or split xterm panes plus a find overlay.
 * Session strip + actions live in the contextual toolbar (TerminalToolbar).
 */

import { useCallback, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { LoadingHint } from '../ui/LoadingHint.js';
import { TerminalEmptyState } from './TerminalEmptyState.js';
import { XtermView } from '../terminal/XtermView.js';
import { getTerminalEntry } from '../terminal/terminalPool.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { WorkbenchFindBar } from './WorkbenchFindBar.js';
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
    <WorkbenchFindBar
      placeholder="Find in terminal…"
      value={query}
      onChange={setQuery}
      onFind={runFind}
      onClose={() => setSearchOpen(false)}
      mono
    />
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <TerminalEmptyState message={error} />
        ) : attaching ? (
          <LoadingHint message="Starting shell…" className="py-6" />
        ) : !hasSession ? (
          <TerminalEmptyState message="No shell session is active. Use + in the tab bar to open one." />
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
