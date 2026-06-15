/**
 * Workbench tab bar — on-demand unified row: terminal, browser, preview,
 * and file tabs (only surfaces that are open appear). Trailing launchers
 * open a terminal or the web browser. Agent chat lives in the left column.
 */

import { useCallback, type ReactNode } from 'react';
import { FileCode2, Globe, Image as ImageIcon, TerminalSquare, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { selectTerminalShellLabel, useTerminalStore } from '../../store/useTerminalStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { normalizePath } from '../../lib/normalizePath.js';
import {
  closeBrowserPanel,
  closeEditorPanel,
  closePreviewPanel,
  closeTerminalPanel,
  resolveCompanionTab
} from './workbenchShared.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_COMPACT_ICON_CLASS,
  SHELL_COMPACT_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

function browserTabLabel(title: string, url: string): string {
  if (title.trim()) return title;
  try {
    if (url) return new URL(url).hostname || 'Browser';
  } catch {
    /* not a URL yet */
  }
  return 'Browser';
}

function CompanionTabButton({
  active,
  label,
  icon,
  onSelect,
  onClose,
  closeLabel,
  mono
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  onClose?: () => void;
  closeLabel?: string;
  mono?: boolean;
}) {
  return (
    <div
      className={cn(
        'vx-workbench-tab group flex max-w-[12rem] shrink-0 items-center gap-1 border-b-2 px-2.5 py-1.5 text-meta transition-colors',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-muted hover:bg-chrome-hover-soft'
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={cn('flex min-w-0 flex-1 items-center gap-1.5', mono && 'font-mono')}
        title={label}
        onClick={onSelect}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 opacity-60 hover:bg-chrome-hover-soft group-hover:opacity-100"
          aria-label={closeLabel ?? `Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        </button>
      ) : null}
    </div>
  );
}

export function WorkbenchTabBar() {
  const { tab, setTab } = useUiStore(
    useShallow((s) => ({ tab: s.workbenchTab, setTab: s.setWorkbenchTab }))
  );
  const activeTab = resolveCompanionTab(tab);

  const tabs = useEditorStore((s) => s.tabs);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  const terminalOpen = useTerminalStore((s) => s.open);
  const terminalLabel = useTerminalStore(selectTerminalShellLabel);
  const openTerminal = useTerminalStore((s) => s.openPanel);

  const browserOpen = useBrowserStore((s) => s.open);
  const browserTitle = useBrowserStore((s) => s.title);
  const browserUrl = useBrowserStore((s) => s.url);
  const openBrowser = useBrowserStore((s) => s.openPanel);

  const previewAttachment = useAttachmentPreviewStore((s) => s.attachment);
  const previewOpen = previewAttachment !== null;

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const onSelectFileTab = useCallback(
    (filePath: string) => {
      setActiveTab(filePath);
      setTab('editor');
    },
    [setActiveTab, setTab]
  );

  const onCloseFileTab = useCallback(
    (filePath: string) => {
      const id = normalizePath(filePath);
      const remaining = tabs.filter((t) => normalizePath(t.filePath) !== id);
      const closed = useEditorStore.getState().requestCloseTab(filePath);
      if (!closed) return;
      if (remaining.length === 0) {
        closeEditorPanel();
        return;
      }
      if (activeTab === 'editor' && activeFilePath && normalizePath(activeFilePath) === id) {
        const next = remaining[remaining.length - 1]!;
        setActiveTab(next.filePath);
      }
    },
    [activeFilePath, activeTab, setActiveTab, tabs]
  );

  const onLaunchTerminal = useCallback(() => {
    if (terminalOpen) {
      setTab('terminal');
    } else if (activeWorkspaceId) {
      void openTerminal(activeWorkspaceId);
    }
  }, [activeWorkspaceId, openTerminal, setTab, terminalOpen]);

  const onLaunchBrowser = useCallback(() => {
    if (browserOpen) {
      setTab('browser');
    } else {
      void openBrowser();
    }
  }, [browserOpen, openBrowser, setTab]);

  return (
    <div
      className="vx-workbench-tabs flex shrink-0 items-stretch overflow-hidden border-b border-border-subtle/25"
      role="tablist"
      aria-label="Workbench panels"
    >
      <div
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-stealth"
        data-workbench-tab-scroll
      >
        {terminalOpen ? (
          <CompanionTabButton
            active={activeTab === 'terminal'}
            label={terminalLabel ?? 'Terminal'}
            icon={
              <TerminalSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            }
            onSelect={() => setTab('terminal')}
            onClose={closeTerminalPanel}
            closeLabel="Close terminal"
          />
        ) : null}
        {browserOpen ? (
          <CompanionTabButton
            active={activeTab === 'browser'}
            label={browserTabLabel(browserTitle, browserUrl)}
            icon={<Globe className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
            onSelect={() => setTab('browser')}
            onClose={closeBrowserPanel}
            closeLabel="Close browser"
          />
        ) : null}
        {previewOpen ? (
          <CompanionTabButton
            active={activeTab === 'preview'}
            label={previewAttachment?.name ?? 'Preview'}
            icon={<ImageIcon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
            onSelect={() => setTab('preview')}
            onClose={closePreviewPanel}
            closeLabel="Close preview"
          />
        ) : null}
        {tabs.map((fileTab) => {
          const name = basenameFromPath(fileTab.filePath);
          const dirty = fileTab.content !== fileTab.savedContent;
          const active = activeTab === 'editor' && activeFilePath === fileTab.filePath;
          return (
            <CompanionTabButton
              key={fileTab.filePath}
              active={active}
              label={dirty ? `${name} •` : name}
              mono
              icon={
                <FileCode2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              }
              onSelect={() => onSelectFileTab(fileTab.filePath)}
              onClose={() => onCloseFileTab(fileTab.filePath)}
              closeLabel={`Close ${name}`}
            />
          );
        })}
      </div>
      <div className="vx-workbench-tab-launchers flex shrink-0 items-center gap-0.5 border-l border-border-subtle/25 px-1">
        <button
          type="button"
          className="flex items-center rounded p-1 text-text-muted hover:bg-chrome-hover-soft hover:text-text-primary"
          title="New terminal (Ctrl+`)"
          aria-label="New terminal"
          onClick={onLaunchTerminal}
        >
          <TerminalSquare className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="flex items-center rounded p-1 text-text-muted hover:bg-chrome-hover-soft hover:text-text-primary"
          title="Open browser"
          aria-label="Open browser"
          onClick={onLaunchBrowser}
        >
          <Globe className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        </button>
      </div>
    </div>
  );
}
