/**
 * Workbench tab bar — unified scroll row: terminal, globe, and file tabs.
 * Agent chat lives in the left column; not a tab here.
 */

import { useCallback, type ReactNode } from 'react';
import { FileCode2, Globe, Terminal, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { normalizePath } from '../../lib/normalizePath.js';
import {
  closeEditorPanel,
  closeGlobePanel,
  closeTerminalPanel,
  focusWorkbenchTab,
  resolveCompanionTab,
  type CompanionTab
} from './workbenchShared.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_COMPACT_ICON_CLASS,
  SHELL_COMPACT_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

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
        'group flex max-w-[11rem] shrink-0 items-center gap-1 border-b-2 px-2.5 py-1.5 text-meta transition-colors',
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
  const closeTab = useEditorStore((s) => s.closeTab);
  const terminalOpen = useTerminalStore((s) => s.open);
  const shellLabel = useTerminalStore((s) => s.shellLabel);
  const openTerminal = useTerminalStore((s) => s.openPanel);
  const previewAttachment = useAttachmentPreviewStore((s) => s.attachment);
  const previewOpen = previewAttachment !== null;
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const terminalTabLabel = shellLabel ?? 'Terminal';

  const onSelectTab = useCallback(
    (next: CompanionTab) => {
      if (next === 'terminal' && !terminalOpen && activeWorkspaceId) {
        void openTerminal(activeWorkspaceId);
      }
      setTab(next);
      if (next === 'editor' && activeFilePath) {
        setActiveTab(activeFilePath);
      }
    },
    [activeFilePath, activeWorkspaceId, openTerminal, setActiveTab, setTab, terminalOpen]
  );

  const onCloseFileTab = useCallback(
    (filePath: string) => {
      const id = normalizePath(filePath);
      const remaining = tabs.filter((t) => normalizePath(t.filePath) !== id);
      closeTab(filePath);
      if (remaining.length === 0) {
        closeEditorPanel();
        return;
      }
      if (activeTab === 'editor' && activeFilePath && normalizePath(activeFilePath) === id) {
        const next = remaining[remaining.length - 1]!;
        setActiveTab(next.filePath);
      }
    },
    [activeFilePath, activeTab, closeTab, setActiveTab, tabs]
  );

  const onSelectFileTab = useCallback(
    (filePath: string) => {
      setActiveTab(filePath);
      setTab('editor');
    },
    [setActiveTab, setTab]
  );

  const onCloseTerminal = useCallback(() => {
    closeTerminalPanel();
  }, []);

  const onCloseGlobe = useCallback(() => {
    if (previewOpen) {
      closeGlobePanel();
      return;
    }
    if (activeTab === 'globe') {
      focusWorkbenchTab(resolveCompanionTab('agent'));
    }
  }, [activeTab, previewOpen]);

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
        <CompanionTabButton
          active={activeTab === 'terminal'}
          label={terminalTabLabel}
          icon={<Terminal className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          onSelect={() => onSelectTab('terminal')}
          onClose={terminalOpen ? onCloseTerminal : undefined}
          closeLabel="Close terminal"
        />
        <CompanionTabButton
          active={activeTab === 'globe'}
          label={previewAttachment?.name ?? 'Globe'}
          icon={<Globe className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          onSelect={() => onSelectTab('globe')}
          onClose={activeTab === 'globe' || previewOpen ? onCloseGlobe : undefined}
          closeLabel="Close preview"
        />
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
    </div>
  );
}
