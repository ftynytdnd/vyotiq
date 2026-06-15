/**
 * Collapsible open editors list above the workspace file tree.
 */

import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { revealFileInDockTree } from '../../lib/revealFileInDockTree.js';
import { focusWorkbenchTab } from '../workbench/workbenchShared.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

export interface DockOpenEditorsSectionProps {
  workspaceId: string;
}

export function DockOpenEditorsSection({ workspaceId }: DockOpenEditorsSectionProps) {
  const tabs = useEditorStore(
    useShallow((s) => s.tabs.filter((t) => t.workspaceId === workspaceId))
  );
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const requestCloseTab = useEditorStore((s) => s.requestCloseTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  const collapsed = useSettingsStore(
    (s) => s.settings.ui?.openEditorsCollapsedByWorkspace?.[workspaceId] === true
  );

  const setCollapsed = useCallback(
    (next: boolean) => {
      const settings = useSettingsStore.getState().settings;
      const prev = settings.ui?.openEditorsCollapsedByWorkspace ?? {};
      void vyotiq.settings.set({
        ui: { openEditorsCollapsedByWorkspace: { ...prev, [workspaceId]: next } }
      });
      useSettingsStore.setState({
        settings: {
          ...settings,
          ui: {
            ...settings.ui,
            openEditorsCollapsedByWorkspace: { ...prev, [workspaceId]: next }
          }
        }
      });
    },
    [workspaceId]
  );

  const rows = useMemo(
    () =>
      tabs.map((tab) => ({
        filePath: tab.filePath,
        name: basenameFromPath(tab.filePath),
        dirty: tab.content !== tab.savedContent,
        active: activeFilePath === tab.filePath
      })),
    [tabs, activeFilePath]
  );

  if (rows.length === 0) return null;

  return (
    <section className="shrink-0 border-b border-border-subtle/20 px-1.5 pb-1.5 pt-1">
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left font-mono text-meta text-text-faint hover:bg-chrome-hover-soft hover:text-text-secondary"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        ) : (
          <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        )}
        <span>Open editors</span>
        <span className="ml-auto tabular-nums">{rows.length}</span>
      </button>
      {!collapsed ? (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {rows.map((row) => (
            <li key={row.filePath} className="group flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 pl-5 pr-1 text-left font-mono text-row hover:bg-chrome-hover-soft',
                  row.active ? 'text-text-primary' : 'text-text-secondary'
                )}
                onClick={() => {
                  setActiveTab(row.filePath);
                  focusWorkbenchTab('editor');
                }}
                onDoubleClick={() => revealFileInDockTree(row.filePath)}
                title={row.filePath}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    row.dirty ? 'bg-warning' : 'bg-transparent'
                  )}
                  aria-hidden
                />
                <span className="truncate">{row.name}</span>
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-text-faint opacity-0 hover:bg-chrome-hover-soft hover:text-text-secondary group-hover:opacity-100"
                aria-label={`Close ${row.name}`}
                onClick={() => requestCloseTab(row.filePath)}
              >
                <X className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
