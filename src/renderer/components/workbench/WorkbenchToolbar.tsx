/**
 * Adaptive contextual toolbar — one row (plus optional sub-row) under the
 * workbench tabs. Dispatches per active companion: editor breadcrumbs,
 * terminal actions, browser chrome, attachment preview.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ClipboardCopy,
  Columns2,
  Eraser,
  ExternalLink,
  Camera,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  ChevronsDown,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  selectActiveEditorTab,
  selectEditorDirty,
  useEditorStore,
} from "../../store/useEditorStore.js";
import { useTerminalStore } from "../../store/useTerminalStore.js";
import { useBrowserStore } from "../../store/useBrowserStore.js";
import { useAttachmentPreviewStore } from "../../store/useAttachmentPreviewStore.js";
import { getTerminalEntry } from "../terminal/terminalPool.js";
import { vyotiq } from "../../lib/ipc.js";
import { useToastStore } from "../../store/useToastStore.js";
import { openAttachmentExternal } from "../../lib/openAttachment.js";
import { useWorkspaceStore } from "../../store/useWorkspaceStore.js";
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
} from "../../lib/shellIcons.js";
import type { CompanionTab } from "./workbenchShared.js";
import {
  closeEditorPanel,
  closeTerminalPanel,
  closeBrowserPanel,
  shellBasename,
} from "./workbenchShared.js";
import { cn } from "../../lib/cn.js";
import { registerBrowserUrlDomFocus } from "../../lib/workbenchFocusDom.js";
import { revealFileInDockTree } from "../../lib/revealFileInDockTree.js";
import { dockTreeRelativePath } from "../dock/dockFileTreeModel.js";

import {
  WORKBENCH_ACTION_GROUP_CLASS,
  WORKBENCH_ACTIONS_TRAY_CLASS,
  WORKBENCH_ICON_BTN_CLASS,
  WORKBENCH_PANEL_HEADING_CLASS,
  WORKBENCH_TOOLBAR_CLASS,
  workbenchToolbarToggleClass,
} from "./workbenchChrome.js";

export function WorkbenchToolbar({ tab }: { tab: CompanionTab }) {
  switch (tab) {
    case "editor":
      return <EditorToolbar />;
    case "terminal":
      return <TerminalToolbar />;
    case "browser":
      return <BrowserToolbar />;
    case "preview":
      return <PreviewToolbar />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function editorBreadcrumbSegments(
  workspacePath: string | null,
  filePath: string,
): string[] {
  if (!workspacePath) {
    return dockTreeRelativePath(filePath, "").split("/").filter(Boolean);
  }
  return dockTreeRelativePath(filePath, workspacePath)
    .split("/")
    .filter(Boolean);
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
  const workspacePath = useWorkspaceStore((s) => {
    const id = workspaceId ?? s.activeId;
    const entry = id ? s.list.find((w) => w.id === id) : undefined;
    return entry?.path ?? s.info.path ?? null;
  });

  const onOpenExternal = useCallback(async () => {
    if (!filePath) return;
    try {
      await vyotiq.tools.openPath(filePath, workspaceId ?? undefined);
    } catch (err) {
      useToastStore
        .getState()
        .show(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [filePath, workspaceId]);

  if (tabs.length === 0 || !filePath) {
    return (
      <header className={cn(WORKBENCH_TOOLBAR_CLASS, 'justify-between')}>
        <span className="text-row text-text-muted">No file open</span>
        <button
          type="button"
          className={WORKBENCH_ICON_BTN_CLASS}
          title="Close editor"
          aria-label="Close editor"
          onClick={() => closeEditorPanel()}
        >
          <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      </header>
    );
  }

  const segments = editorBreadcrumbSegments(workspacePath, filePath);

  return (
    <header className={cn(WORKBENCH_TOOLBAR_CLASS, "justify-between")}>
      <nav
        className="vx-editor-breadcrumbs flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden font-mono text-meta text-text-faint"
        title={filePath}
        aria-label="File path"
      >
        {segments.map((seg, i) => {
          const last = i === segments.length - 1;
          const relPath = segments.slice(0, i + 1).join("/");
          return (
            <span
              key={`${seg}-${i}`}
              className="flex min-w-0 items-center gap-0.5"
            >
              {i > 0 ? (
                <ChevronRight
                  className="h-3 w-3 shrink-0 text-text-faint/60"
                  strokeWidth={2}
                />
              ) : null}
              {last ? (
                <span className="truncate text-text-secondary">{seg}</span>
              ) : (
                <button
                  type="button"
                  className="truncate rounded px-0.5 hover:bg-chrome-hover-soft hover:text-text-primary"
                  onClick={() => revealFileInDockTree(relPath)}
                >
                  {seg}
                </button>
              )}
            </span>
          );
        })}
      </nav>
      <div className={WORKBENCH_ACTIONS_TRAY_CLASS}>
        <div className={WORKBENCH_ACTION_GROUP_CLASS}>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            onClick={() => void reloadFromDisk()}
            disabled={loading}
            title="Reload from disk"
            aria-label="Reload from disk"
          >
            <RotateCcw
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            onClick={() => void onOpenExternal()}
            title="Open in default app"
            aria-label="Open in default app"
          >
            <ExternalLink
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={cn(
              WORKBENCH_ICON_BTN_CLASS,
              "relative",
              dirty &&
                "bg-warning-soft text-warning hover:bg-warning-soft hover:text-warning",
            )}
            onClick={() => void save()}
            disabled={!dirty || saving || loading}
            title="Save (Ctrl+S)"
            aria-label="Save"
          >
            <Save
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
            {dirty ? (
              <span
                className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-warning"
                aria-hidden
              />
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}

function TerminalToolbar() {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const splitSessionId = useTerminalStore((s) => s.splitSessionId);
  const searchOpen = useTerminalStore((s) => s.searchOpen);
  const attaching = useTerminalStore((s) => s.attaching);
  const toggleSplit = useTerminalStore((s) => s.toggleSplit);
  const restart = useTerminalStore((s) => s.restart);
  const createSession = useTerminalStore((s) => s.createSession);
  const setSearchOpen = useTerminalStore((s) => s.setSearchOpen);
  const activeSession = sessions.find((session) => session.sessionId === activeSessionId);
  const shellLabel = activeSession ? shellBasename(activeSession.shell) : null;
  const showNewShellInToolbar = sessions.length <= 1;

  const withActiveEntry = useCallback(
    (fn: (entry: ReturnType<typeof getTerminalEntry>) => void) => {
      if (!activeSessionId) return;
      fn(getTerminalEntry(activeSessionId));
    },
    [activeSessionId],
  );

  const onCopy = useCallback(() => {
    withActiveEntry((entry) => {
      const selection = entry.term.getSelection();
      if (selection) {
        void navigator.clipboard.writeText(selection).catch(() => {
          useToastStore.getState().show('Could not copy to clipboard', 'danger');
        });
      }
    });
  }, [withActiveEntry]);

  return (
    <header className={cn(WORKBENCH_TOOLBAR_CLASS, "justify-between gap-1")}>
      <div className={WORKBENCH_PANEL_HEADING_CLASS} title="Terminal">
        <TerminalSquare
          className={SHELL_ROW_ICON_CLASS}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
        <span>Terminal</span>
        {shellLabel ? (
          <>
            <span className="text-text-faint/50" aria-hidden>
              ·
            </span>
            <span className="truncate text-text-muted">{shellLabel}</span>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {showNewShellInToolbar ? (
          <div className={WORKBENCH_ACTION_GROUP_CLASS}>
            <button
              type="button"
              className={WORKBENCH_ICON_BTN_CLASS}
              title="New shell"
              aria-label="New shell"
              onClick={() => void createSession()}
              disabled={attaching}
            >
              <Plus
                className={SHELL_ROW_ICON_CLASS}
                strokeWidth={SHELL_ACTION_ICON_STROKE}
              />
            </button>
          </div>
        ) : null}
        <div className={WORKBENCH_ACTION_GROUP_CLASS}>
          <button
            type="button"
            className={cn(
              WORKBENCH_ICON_BTN_CLASS,
              workbenchToolbarToggleClass(searchOpen),
            )}
            title="Find in terminal"
            aria-label="Find in terminal"
            onClick={() => setSearchOpen(!searchOpen)}
            disabled={!activeSessionId || attaching}
          >
            <Search
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={cn(
              WORKBENCH_ICON_BTN_CLASS,
              workbenchToolbarToggleClass(!!splitSessionId),
            )}
            title={splitSessionId ? "Unsplit" : "Split terminal"}
            aria-label="Split terminal"
            onClick={() => void toggleSplit()}
            disabled={!activeSessionId || attaching}
          >
            <Columns2
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
        </div>
        <div className={WORKBENCH_ACTION_GROUP_CLASS}>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Copy selection"
            aria-label="Copy selection"
            onClick={onCopy}
            disabled={!activeSessionId}
          >
            <ClipboardCopy
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
            onClick={() =>
              withActiveEntry((entry) => entry.term.scrollToBottom())
            }
            disabled={!activeSessionId}
          >
            <ChevronsDown
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
        </div>
        <div className={WORKBENCH_ACTION_GROUP_CLASS}>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Clear"
            aria-label="Clear"
            onClick={() => withActiveEntry((entry) => entry.term.clear())}
            disabled={!activeSessionId}
          >
            <Eraser
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Restart shell"
            aria-label="Restart shell"
            onClick={() => activeSessionId && void restart(activeSessionId)}
            disabled={!activeSessionId || attaching}
          >
            <RotateCcw
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Close terminal (Ctrl+`)"
            aria-label="Close terminal"
            onClick={() => closeTerminalPanel()}
          >
            <X
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
        </div>
      </div>
    </header>
  );
}

function BrowserToolbar() {
  const url = useBrowserStore((s) => s.url);
  const loading = useBrowserStore((s) => s.loading);
  const hasLoaded = useBrowserStore((s) => s.hasLoaded);
  const canGoBack = useBrowserStore((s) => s.canGoBack);
  const canGoForward = useBrowserStore((s) => s.canGoForward);
  const findOpen = useBrowserStore((s) => s.findOpen);
  const navigate = useBrowserStore((s) => s.navigate);
  const back = useBrowserStore((s) => s.back);
  const forward = useBrowserStore((s) => s.forward);
  const reload = useBrowserStore((s) => s.reload);
  const stop = useBrowserStore((s) => s.stop);
  const setFindOpen = useBrowserStore((s) => s.setFindOpen);

  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return registerBrowserUrlDomFocus(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    if (!editing) setDraft(url);
  }, [url, editing]);

  const onCapture = useCallback(async () => {
    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!workspaceId) {
      useToastStore.getState().show("Open a workspace before capturing.", "danger");
      return;
    }
    try {
      const result = await vyotiq.capture.browser({ workspaceId });
      useToastStore
        .getState()
        .show(`Browser capture saved → ${result.relPath}`, "success");
    } catch (err) {
      useToastStore
        .getState()
        .show(err instanceof Error ? err.message : String(err), "danger");
    }
  }, []);

  const onOpenExternal = useCallback(async () => {
    if (!url) return;
    try {
      await vyotiq.browser.openExternal({ url });
    } catch (err) {
      useToastStore
        .getState()
        .show(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [url]);

  return (
    <header
      className={cn(WORKBENCH_TOOLBAR_CLASS, "relative justify-between gap-1")}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <button
          type="button"
          className={WORKBENCH_ICON_BTN_CLASS}
          title="Back"
          aria-label="Back"
          onClick={back}
          disabled={!canGoBack}
        >
          <ArrowLeft
            className={SHELL_ROW_ICON_CLASS}
            strokeWidth={SHELL_ACTION_ICON_STROKE}
          />
        </button>
        <button
          type="button"
          className={WORKBENCH_ICON_BTN_CLASS}
          title="Forward"
          aria-label="Forward"
          onClick={forward}
          disabled={!canGoForward}
        >
          <ArrowRight
            className={SHELL_ROW_ICON_CLASS}
            strokeWidth={SHELL_ACTION_ICON_STROKE}
          />
        </button>
        <button
          type="button"
          className={WORKBENCH_ICON_BTN_CLASS}
          title={loading ? "Stop" : "Reload"}
          aria-label={loading ? "Stop" : "Reload"}
          onClick={loading ? stop : reload}
          disabled={!hasLoaded && !loading}
        >
          {loading ? (
            <X
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          ) : (
            <RotateCw
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          )}
        </button>
        <form
          className="min-w-0 flex-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) navigate(draft.trim());
            (
              e.currentTarget.querySelector("input") as HTMLInputElement | null
            )?.blur();
          }}
        >
          <input
            ref={urlInputRef}
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
      </div>
      <div className={WORKBENCH_ACTIONS_TRAY_CLASS}>
        <div className={WORKBENCH_ACTION_GROUP_CLASS}>
          <button
            type="button"
            className={cn(
              WORKBENCH_ICON_BTN_CLASS,
              workbenchToolbarToggleClass(findOpen),
            )}
            title="Find in page"
            aria-label="Find in page"
            onClick={() => setFindOpen(!findOpen)}
            disabled={!hasLoaded}
          >
            <Search
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Capture page screenshot"
            aria-label="Capture page screenshot"
            onClick={() => void onCapture()}
            disabled={!hasLoaded || loading}
          >
            <Camera
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Open in system browser"
            aria-label="Open in system browser"
            onClick={() => void onOpenExternal()}
            disabled={!url}
          >
            <ExternalLink
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className={WORKBENCH_ICON_BTN_CLASS}
            title="Close browser (Ctrl+W)"
            aria-label="Close browser"
            onClick={() => closeBrowserPanel()}
          >
            <X
              className={SHELL_ROW_ICON_CLASS}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
          </button>
        </div>
      </div>
      {loading ? <div className="vx-browser-progress" aria-hidden /> : null}
    </header>
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
    <header className={cn(WORKBENCH_TOOLBAR_CLASS, "justify-between")}>
      <p
        className="min-w-0 truncate text-row text-text-secondary"
        title={attachment?.name}
      >
        {attachment?.name ?? "Preview"}
      </p>
      {attachment ? (
        <div className={WORKBENCH_ACTIONS_TRAY_CLASS}>
          <div className={WORKBENCH_ACTION_GROUP_CLASS}>
            <button
              type="button"
              className={WORKBENCH_ICON_BTN_CLASS}
              onClick={onOpenExternal}
              title="Open externally"
              aria-label="Open externally"
            >
              <ExternalLink
                className={SHELL_ROW_ICON_CLASS}
                strokeWidth={SHELL_ACTION_ICON_STROKE}
              />
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
