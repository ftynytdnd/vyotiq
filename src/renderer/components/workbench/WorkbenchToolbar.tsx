/**
 * Adaptive contextual toolbar — one row under workbench tabs.
 */

import { useCallback } from 'react';
import { ExternalLink, List, RotateCcw, Save } from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { Button } from '../ui/Button.js';
import {
  selectActiveEditorTab,
  selectEditorDirty,
  useEditorStore
} from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { openAttachmentExternal } from '../../lib/openAttachment.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import type { CompanionTab } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';

export function WorkbenchToolbar({ tab }: { tab: CompanionTab }) {
  if (tab === 'editor') {
    return <EditorToolbar />;
  }
  if (tab === 'terminal') {
    return <TerminalToolbar />;
  }
  if (tab === 'globe') {
    return <GlobeToolbar />;
  }
  return null;
}

function editorPathLabel(workspacePath: string | null, filePath: string): string {
  if (!workspacePath) return filePath;
  const normRoot = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
  const normFile = filePath.replace(/\\/g, '/');
  const rootLower = normRoot.toLowerCase();
  const fileLower = normFile.toLowerCase();
  if (fileLower === rootLower) return basenameFromPath(filePath);
  const prefix = `${rootLower}/`;
  if (fileLower.startsWith(prefix)) {
    return normFile.slice(normRoot.length + 1);
  }
  return filePath;
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
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(msg, 'danger');
    }
  }, [filePath, workspaceId]);

  if (tabs.length === 0) {
    return (
      <header className="vx-workbench-toolbar flex h-8 shrink-0 items-center border-b border-border-subtle/20 px-3">
        <p className="text-row text-text-faint">Editor</p>
      </header>
    );
  }

  return (
    <header className="vx-workbench-toolbar flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle/20 px-2">
      <p
        className="min-w-0 flex-1 truncate px-1 font-mono text-meta text-text-faint"
        title={filePath ?? undefined}
      >
        {filePath ? editorPathLabel(workspacePath, filePath) : 'Editor'}
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reloadFromDisk()}
          disabled={loading || !filePath}
          title="Reload from disk"
        >
          <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onOpenExternal()}
          disabled={!filePath}
          title="Open in default app"
        >
          <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </Button>
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving || loading || !filePath}
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
  const shellLabel = useTerminalStore((s) => s.shellLabel);
  const workspaceId = useTerminalStore((s) => s.workspaceId);
  const attaching = useTerminalStore((s) => s.attaching);

  const onRestart = useCallback(async () => {
    if (!workspaceId) return;
    try {
      await vyotiq.terminal.restart(workspaceId);
      await vyotiq.terminal.attach({ workspaceId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(msg, 'danger');
    }
  }, [workspaceId]);

  return (
    <header className="vx-workbench-toolbar flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border-subtle/20 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <List className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        <p className="min-w-0 truncate text-row text-text-secondary">
          {shellLabel ? `Shell · ${shellLabel}` : 'Workspace shell'}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void onRestart()}
        disabled={!workspaceId || attaching}
        title="Restart shell"
      >
        <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </Button>
    </header>
  );
}

function GlobeToolbar() {
  const attachment = useAttachmentPreviewStore((s) => s.attachment);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  const onOpenExternal = useCallback(() => {
    if (!attachment) return;
    void openAttachmentExternal(attachment, workspaceId);
  }, [attachment, workspaceId]);

  return (
    <header className="vx-workbench-toolbar flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border-subtle/20 px-3">
      <p className="min-w-0 truncate text-row text-text-secondary">
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
