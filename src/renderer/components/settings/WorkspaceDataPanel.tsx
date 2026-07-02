import { FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { Button } from '../ui/Button.js';
import { ShellCaption, ShellRow, ShellSection } from '../ui/ShellSection.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { openWorkspaceLauncher } from '../../store/useWorkspaceLauncherStore.js';
import { cn } from '../../lib/cn.js';

export function WorkspaceDataPanel() {
  const workspaces = useWorkspaceStore((s) => s.list);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const remove = useWorkspaceStore((s) => s.remove);

  return (
    <ShellSection>
      <ShellRow className="pt-0">
        <ShellCaption>
          Agent tools are sandboxed inside each workspace root. Switch workspaces from the dock
          or manage roots here.
        </ShellCaption>
      </ShellRow>

      <ShellRow className="flex flex-wrap gap-2 py-0">
        <Button variant="accentFill" size="sm" onClick={() => openWorkspaceLauncher('local', 'elevated')}>
          <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          Add workspace…
        </Button>
        <Button variant="secondary" size="sm" onClick={() => openWorkspaceLauncher('github', 'elevated')}>
          From GitHub…
        </Button>
      </ShellRow>

      {workspaces.length === 0 ? (
        <div className="vx-settings-empty w-full">
          <p className="text-row text-text-primary">
            No workspaces yet — open a folder to start chatting with Agent V.
          </p>
          <Button variant="accentFill" size="sm" onClick={() => openWorkspaceLauncher('local', 'elevated')}>
            <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            Add workspace…
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {workspaces.map((ws) => {
            const active = ws.id === activeId;
            return (
              <li
                key={ws.id}
                className={cn(
                  'surface-shell flex items-center gap-2 rounded-md px-2 py-1.5',
                  active && 'ring-1 ring-accent/40'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void setActive(ws.id)}
                >
                  <div className="truncate text-row text-text-primary">{ws.label}</div>
                  <div className="truncate font-mono text-meta text-text-faint" title={ws.path}>
                    {ws.path}
                  </div>
                </button>
                {ws.unreachable ? (
                  <span className="shrink-0 text-meta text-warning">Unreachable</span>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${ws.label}`}
                  title="Remove workspace"
                  onClick={() => void remove(ws.id, { deleteConversations: false })}
                >
                  <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ShellRow className="pt-2">
        <ShellCaption>
          <Pencil className="mr-1 inline size-3 opacity-60" aria-hidden />
          Rename workspaces from the dock flyout. Conversation data stays tied to each workspace id.
        </ShellCaption>
      </ShellRow>
    </ShellSection>
  );
}
