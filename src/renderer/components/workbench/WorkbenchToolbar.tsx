/**
 * Adaptive contextual toolbar — one row (plus optional sub-row) under the
 * workbench tabs. Dispatches per active companion: editor breadcrumbs,
 * terminal session strip + actions, browser chrome, attachment preview.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ClipboardCopy,
  Columns2,
  Eraser,
  ExternalLink,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  ChevronsDown,
  X
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import {
  selectActiveEditorTab,
  selectEditorDirty,
  useEditorStore
} from '../../store/useEditorStore.js';
import { selectTerminalShellLabel, useTerminalStore } from '../../store/useTerminalStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { getTerminalEntry } from '../terminal/terminalPool.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { openAttachmentExternal } from '../../lib/openAttachment.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import type { CompanionTab } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';

const TOOLBAR_CLASS =
  'vx-workbench-toolbar flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle/20 px-2';

const ICON_BTN_CLASS =
  'flex items-center justify-center rounded p-1 text-text-muted transition-colors hover:bg-chrome-hover-soft hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

export function WorkbenchToolbar({ tab }: { tab: CompanionTab }) {
  switch (tab) {
    case 'editor':
      return <EditorToolbar />;
    case 'terminal':
      return <TerminalToolbar />;
    case 'browser':
      return <BrowserToolbar />;
    case 'preview':
      return <PreviewToolbar />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function editorBreadcrumbSegments(workspacePath: string | null, filePath: string): string[] {
  const normFile = filePath.replace(/\\/g, '/');
  if (!workspacePath) return normFile.split('/').filter(Boolean);
  const normRoot = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
  const prefix = `${normRoot.toLowerCase()}/`;
  const rel = normFile.toLowerCase().startsWith(prefix)
    ? normFile.slice(normRoot.length + 1)
    : normFile;
  return rel.split('/').filter(Boolean);
}

function EditorToolbar() {
  const activeTab = useEditorStore(selectActiveEditorTab);
  const filePath = activeTab?.filePath ?? null;
  const workspaceId = activeTab?.workspaceId ?? null;
  const loading = activeTab?.loading ?? false;
  const saving = activeTab?.saving ?? false;
  const dirty = useEditorStore(selectEditorDirty);
  const save = useEditorStore((s) => s.save);
  const reloadFromDisk = useEditorStore((s) => s.reloadFromDisk);
  const tabs = useEditorStore((s) => s.tabs);
  const workspacePath = useWorkspaceStore((s) => s.info.path);

  const onOpenExternal = useCallback(async () => {
    if (!filePath) return;
    try {
      await vyotiq.tools.openPath(filePath, workspaceId ?? undefined);
    } catch (err) {
      useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
    }
  }, [filePath, workspaceId]);

  if (tabs.length === 0 || !filePath) {
    return (
      <header className={TOOLBAR_CLASS}>
        <p className="text-row text-text-faint">Editor</p>
      </header>
    );
  }

  const segments = editorBreadcrumbSegments(workspacePath, filePath);

  return (
    <header className={TOOLBAR_CLASS}>
      <nav
        className="vx-editor-breadcrumbs flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden font-mono text-meta text-text-faint"
        title={filePath}
        aria-label="File path"
      >
        {segments.map((seg, i) => {
          const last = i === segments.length - 1;
          return (
            <span key={`${seg}-${i}`} className="flex min-w-0 items-center gap-0.5">
              {i > 0 ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-text-faint/60" strokeWidth={2} />
              ) : null}
              <span className={cn('truncate', last && 'text-text-secondary')}>{seg}</span>
            </span>
          );
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reloadFromDisk()}
          disabled={loading}
          title="Reload from disk"
        >
          <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void onOpenExternal()} title="Open in default app">
          <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </Button>
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving || loading}
          title="Save (Ctrl+S)"
        >
          <Save className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          Save
        </Button>
      </div>
    </header>
  );
}

function TerminalToolbar() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const splitSessionId = useTerminalStore((s) => s.splitSessionId);
  const searchOpen = useTerminalStore((s) => s.searchOpen);
  const attaching = useTerminalStore((s) => s.attaching);
  const shellLabel = useTerminalStore(selectTerminalShellLabel);
  const selectSession = useTerminalStore((s) => s.selectSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const createSession = useTerminalStore((s) => s.createSession);
  const toggleSplit = useTerminalStore((s) => s.toggleSplit);
  const restart = useTerminalStore((s) => s.restart);
  const setSearchOpen = useTerminalStore((s) => s.setSearchOpen);

  const withActiveEntry = useCallback(
    (fn: (entry: ReturnType<typeof getTerminalEntry>) => void) => {
      if (!activeSessionId) return;
      fn(getTerminalEntry(activeSessionId));
    },
    [activeSessionId]
  );

  const onCopy = useCallback(() => {
    withActiveEntry((entry) => {
      const selection = entry.term.getSelection();
      if (selection) void navigator.clipboard.writeText(selection).catch(() => {});
    });
  }, [withActiveEntry]);

  return (
    <header className={cn(TOOLBAR_CLASS, 'justify-between')}>
      <div className="vx-terminal-strip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-stealth">
        {sessions.map((session, i) => {
          const active = session.sessionId === activeSessionId;
          const isSplit = session.sessionId === splitSessionId;
          return (
            <div
              key={session.sessionId}
              className={cn(
                'vx-terminal-chip group flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-meta transition-colors',
                active || isSplit
                  ? 'border-border-strong/40 bg-surface-raised text-text-primary'
                  : 'border-transparent text-text-muted hover:bg-chrome-hover-soft'
              )}
            >
              <button
                type="button"
                className="flex items-center gap-1 font-mono"
                title={session.shell}
                onClick={() => selectSession(session.sessionId)}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-accent' : 'bg-text-faint/50')} />
                Shell {i + 1}
              </button>
              {sessions.length > 1 ? (
                <button
                  type="button"
                  className="rounded p-0.5 opacity-50 hover:bg-chrome-hover-soft group-hover:opacity-100"
                  aria-label={`Close shell ${i + 1}`}
                  onClick={() => void closeSession(session.sessionId)}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="New shell"
          aria-label="New shell"
          onClick={() => void createSession()}
          disabled={attaching}
        >
          <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <span className="mr-1 hidden truncate font-mono text-meta text-text-faint sm:inline" title={shellLabel ?? undefined}>
          {shellLabel}
        </span>
        <button
          type="button"
          className={cn(ICON_BTN_CLASS, searchOpen && 'bg-chrome-hover-soft text-text-primary')}
          title="Find in terminal"
          aria-label="Find in terminal"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={cn(ICON_BTN_CLASS, splitSessionId && 'bg-chrome-hover-soft text-text-primary')}
          title={splitSessionId ? 'Unsplit' : 'Split terminal'}
          aria-label="Split terminal"
          onClick={() => void toggleSplit()}
        >
          <Columns2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Copy selection"
          aria-label="Copy selection"
          onClick={onCopy}
        >
          <ClipboardCopy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
          onClick={() => withActiveEntry((entry) => entry.term.scrollToBottom())}
        >
          <ChevronsDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Clear"
          aria-label="Clear"
          onClick={() => withActiveEntry((entry) => entry.term.clear())}
        >
          <Eraser className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Restart shell"
          aria-label="Restart shell"
          onClick={() => activeSessionId && void restart(activeSessionId)}
          disabled={!activeSessionId}
        >
          <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      </div>
    </header>
  );
}

function BrowserToolbar() {
  const url = useBrowserStore((s) => s.url);
  const loading = useBrowserStore((s) => s.loading);
  const canGoBack = useBrowserStore((s) => s.canGoBack);
  const canGoForward = useBrowserStore((s) => s.canGoForward);
  const navigate = useBrowserStore((s) => s.navigate);
  const back = useBrowserStore((s) => s.back);
  const forward = useBrowserStore((s) => s.forward);
  const reload = useBrowserStore((s) => s.reload);
  const stop = useBrowserStore((s) => s.stop);

  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');

  useEffect(() => {
    if (!editing) setDraft(url);
  }, [url, editing]);

  const onOpenExternal = useCallback(() => {
    if (url) window.open(url, '_blank');
  }, [url]);

  const runFind = useCallback(
    (forwardDir: boolean) => {
      if (!findText) return;
      void vyotiq.browser.find({ text: findText, forward: forwardDir, findNext: true });
    },
    [findText]
  );

  return (
    <div className="vx-browser-toolbar-wrap relative shrink-0">
      <header className={cn(TOOLBAR_CLASS, 'gap-1')}>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Back"
          aria-label="Back"
          onClick={back}
          disabled={!canGoBack}
        >
          <ArrowLeft className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Forward"
          aria-label="Forward"
          onClick={forward}
          disabled={!canGoForward}
        >
          <ArrowRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title={loading ? 'Stop' : 'Reload'}
          aria-label={loading ? 'Stop' : 'Reload'}
          onClick={loading ? stop : reload}
        >
          {loading ? (
            <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <RotateCw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )}
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) navigate(draft.trim());
            (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur();
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.target.select();
            }}
            onBlur={() => setEditing(false)}
            placeholder="Search or type a URL"
            spellCheck={false}
            className="vx-input vx-browser-address w-full font-mono text-meta"
          />
        </form>
        <button
          type="button"
          className={cn(ICON_BTN_CLASS, findOpen && 'bg-chrome-hover-soft text-text-primary')}
          title="Find in page"
          aria-label="Find in page"
          onClick={() => setFindOpen((v) => !v)}
        >
          <Search className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={ICON_BTN_CLASS}
          title="Open in system browser"
          aria-label="Open in system browser"
          onClick={onOpenExternal}
          disabled={!url}
        >
          <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      </header>
      {loading ? <div className="vx-browser-progress" aria-hidden /> : null}
      {findOpen ? (
        <div className="vx-browser-find flex items-center gap-1 border-b border-border-subtle/20 bg-surface-raised/60 px-2 py-1">
          <input
            type="text"
            autoFocus
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runFind(!e.shiftKey);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setFindOpen(false);
                void vyotiq.browser.stopFind();
              }
            }}
            placeholder="Find in page…"
            className="vx-input min-w-0 flex-1 text-meta"
          />
          <button type="button" className={ICON_BTN_CLASS} title="Previous" onClick={() => runFind(false)}>
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button type="button" className={ICON_BTN_CLASS} title="Next" onClick={() => runFind(true)}>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={ICON_BTN_CLASS}
            title="Close"
            onClick={() => {
              setFindOpen(false);
              void vyotiq.browser.stopFind();
            }}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PreviewToolbar() {
  const attachment = useAttachmentPreviewStore((s) => s.attachment);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  const onOpenExternal = useCallback(() => {
    if (!attachment) return;
    void openAttachmentExternal(attachment, workspaceId);
  }, [attachment, workspaceId]);

  return (
    <header className={cn(TOOLBAR_CLASS, 'justify-between')}>
      <p className="min-w-0 truncate text-row text-text-secondary" title={attachment?.name}>
        {attachment?.name ?? 'Preview'}
      </p>
      {attachment ? (
        <Button variant="ghost" size="sm" onClick={onOpenExternal} title="Open externally">
          <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </Button>
      ) : null}
    </header>
  );
}
