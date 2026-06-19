/**
 * Workbench tab bar — on-demand unified row: terminal, browser, preview,
 * and file tabs (only surfaces that are open appear).
 */

import { useCallback, useState, type DragEvent, type ReactNode } from 'react';
import { Image as ImageIcon, TerminalSquare, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { normalizePath } from '../../lib/normalizePath.js';
import {
  closeEditorPanel,
  closePreviewPanel,
  resolveCompanionTab,
  shellBasename
} from './workbenchShared.js';
import {
  WORKBENCH_TAB_CLASS,
  workbenchTabActiveClass
} from './workbenchChrome.js';
import { TerminalSessionStrip } from './TerminalSessionStrip.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_COMPACT_ICON_CLASS,
  SHELL_COMPACT_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';
import { FileIconForPath } from '../../lib/fileIconForPath.js';
import { EDITOR_TAB_DRAG_MIME } from '../dock/dockShared.js';

function CompanionTabButton({
  active,
  label,
  icon,
  onSelect,
  onClose,
  closeLabel,
  mono,
  tabId,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  dropTarget,
  alwaysShowClose
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  onClose?: () => void;
  closeLabel?: string;
  mono?: boolean;
  tabId?: string;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  dropTarget?: boolean;
  /** Keep the close affordance visible (multi terminal sessions). */
  alwaysShowClose?: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        WORKBENCH_TAB_CLASS,
        workbenchTabActiveClass(active),
        dropTarget && 'bg-accent/10 ring-1 ring-inset ring-accent/30'
      )}
    >
      <button
        type="button"
        role="tab"
        id={tabId}
        aria-selected={active}
        className={cn('app-no-drag flex min-w-0 flex-1 items-center gap-1.5', mono && 'font-mono')}
        title={label}
        onClick={onSelect}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          className={cn(
            'app-no-drag shrink-0 rounded p-0.5 transition-opacity hover:bg-chrome-hover-soft focus-visible:opacity-100',
            alwaysShowClose
              ? 'opacity-55 hover:opacity-100'
              : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'
          )}
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

function WorkbenchTabSeparator() {
  return (
    <div
      className="vx-workbench-tab-separator mx-0.5 w-px shrink-0 self-stretch bg-border-subtle/25"
      aria-hidden
    />
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
  const reorderWorkspaceTabs = useEditorStore((s) => s.reorderWorkspaceTabs);

  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const terminalOpen = useTerminalStore((s) => s.open);
  const terminalSessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const selectSession = useTerminalStore((s) => s.selectSession);
  const closeSession = useTerminalStore((s) => s.closeSession);

  const previewAttachment = useAttachmentPreviewStore((s) => s.attachment);
  const previewOpen = previewAttachment !== null;

  const showTerminalSessionTabs = terminalOpen && terminalSessions.length > 1;
  const showPrimitiveTabs = showTerminalSessionTabs || previewOpen;
  const hasTabStripContent = showPrimitiveTabs || tabs.length > 0;

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

  if (!hasTabStripContent) return null;

  return (
    <div
      className="vx-workbench-tabs app-no-drag flex shrink-0 items-stretch overflow-hidden border-b border-border-subtle/25 bg-surface-base"
      role="tablist"
      aria-label="Workbench panels"
    >
      <div
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden scrollbar-stealth"
        data-workbench-tab-scroll
      >
        {showTerminalSessionTabs
          ? terminalSessions.map((session, i) => {
                const label = shellBasename(session.shell) || `Shell ${i + 1}`;
                return (
                  <CompanionTabButton
                    key={session.sessionId}
                    active={
                      activeTab === 'terminal' && activeSessionId === session.sessionId
                    }
                    label={label}
                    tabId={`vx-workbench-tab-terminal-${session.sessionId}`}
                    icon={
                      <TerminalSquare
                        className={SHELL_ROW_ICON_CLASS}
                        strokeWidth={SHELL_ACTION_ICON_STROKE}
                      />
                    }
                    onSelect={() => {
                      setTab('terminal');
                      selectSession(session.sessionId);
                    }}
                    onClose={() => void closeSession(session.sessionId)}
                    closeLabel={`Close ${label}`}
                    alwaysShowClose
                  />
                );
              })
          : null}
        {previewOpen ? (
          <CompanionTabButton
            active={activeTab === 'preview'}
            label={previewAttachment?.name ?? 'Preview'}
            tabId="vx-workbench-tab-preview"
            icon={<ImageIcon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
            onSelect={() => setTab('preview')}
            onClose={closePreviewPanel}
            closeLabel="Close preview"
          />
        ) : null}
        {showPrimitiveTabs && tabs.length > 0 ? <WorkbenchTabSeparator /> : null}
        {tabs.map((fileTab) => {
          const name = basenameFromPath(fileTab.filePath);
          const dirty = fileTab.content !== fileTab.savedContent;
          const active = activeTab === 'editor' && activeFilePath === fileTab.filePath;
          const isDropTarget =
            dropTargetPath === fileTab.filePath && dragPath !== fileTab.filePath;
          return (
            <CompanionTabButton
              key={fileTab.filePath}
              active={active}
              label={dirty ? `${name} •` : name}
              mono
              draggable
              dropTarget={isDropTarget}
              tabId={`vx-workbench-tab-file-${normalizePath(fileTab.filePath)}`}
              icon={<FileIconForPath filePath={fileTab.filePath} />}
              onSelect={() => onSelectFileTab(fileTab.filePath)}
              onClose={() => onCloseFileTab(fileTab.filePath)}
              closeLabel={`Close ${name}`}
              onDragStart={(event) => {
                event.dataTransfer.setData(EDITOR_TAB_DRAG_MIME, fileTab.filePath);
                event.dataTransfer.effectAllowed = 'move';
                setDragPath(fileTab.filePath);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(EDITOR_TAB_DRAG_MIME)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTargetPath(fileTab.filePath);
              }}
              onDragLeave={() => {
                if (dropTargetPath === fileTab.filePath) setDropTargetPath(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const fromPath = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME);
                if (fileTab.workspaceId && fromPath && fromPath !== fileTab.filePath) {
                  reorderWorkspaceTabs(fileTab.workspaceId, fromPath, fileTab.filePath);
                }
                setDragPath(null);
                setDropTargetPath(null);
              }}
              onDragEnd={() => {
                setDragPath(null);
                setDropTargetPath(null);
              }}
            />
          );
        })}
      </div>
      {showTerminalSessionTabs ? <TerminalSessionStrip /> : null}
    </div>
  );
}
