/**
 * Single workspace folder row — chats nested directly when active + expanded.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderGit2,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import { workspaceGitHubSubtitle } from '@shared/github/workspaceGitHubLabel.js';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_COMPACT_ICON_CLASS,
  SHELL_COMPACT_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useWorkspaceHasActiveRun } from '../../hooks/chat/index.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { CONV_DRAG_MIME, DOCK_TAB_ICON_STROKE, workspacePathVisible } from './dockShared.js';
import { countWorkspaceChats } from './countWorkspaceChats.js';
import { DockChatStrip } from './DockChatStrip.js';
import type { WorkspacePendingAction } from './WorkspacePendingBanner.js';

function rowIconClassName(): string {
  return cn(chromeToolbarButtonClassName(), 'h-5 w-5 shrink-0 px-0 text-text-faint hover:text-text-secondary');
}

export interface DockWorkspaceFolderProps {
  workspace: WorkspaceEntry;
  active: boolean;
  expanded: boolean;
  pending?: boolean;
  onSetWorkspacePath: () => void;
  onRequestPending?: (action: WorkspacePendingAction) => void;
  onToggleExpanded: () => void;
  onActivate: () => void;
}

export function DockWorkspaceFolder({
  workspace,
  active,
  expanded,
  pending = false,
  onSetWorkspacePath,
  onRequestPending,
  onToggleExpanded,
  onActivate
}: DockWorkspaceFolderProps) {
  const renameWorkspace = useWorkspaceStore((s) => s.rename);
  const moveConversation = useConversationsStore((s) => s.move);
  const newConversationFor = useConversationsStore((s) => s.newConversationFor);
  const chatCount = useConversationsStore((s) => countWorkspaceChats(s.list, workspace.id));
  const hasActiveRun = useWorkspaceHasActiveRun(workspace.id);
  const isUnreachable = workspace.unreachable === true;

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.label);
  const [dragOver, setDragOver] = useState(false);
  const folderRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const path = workspace.path ?? '';
  const githubBinding = workspace.github;
  const isGitHub = workspace.source === 'github' || githubBinding != null;
  const githubSubtitle = githubBinding ? workspaceGitHubSubtitle(githubBinding) : null;
  const showPath = !githubSubtitle && workspacePathVisible(workspace.label, path);
  const rowTitle = githubSubtitle ? `${workspace.label} — ${githubSubtitle}` : path || workspace.label;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = folderRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!editing) setDraft(workspace.label);
  }, [workspace.label, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== workspace.label) {
      void renameWorkspace(workspace.id, trimmed);
    } else {
      setDraft(workspace.label);
    }
  };

  const onNewChat = () => {
    onActivate();
    void newConversationFor(workspace.id);
  };

  const revealFolder = () => {
    setMenuOpen(false);
    void vyotiq.workspace.revealPath({ workspaceId: workspace.id, path: '.' });
  };

  const setPath = () => {
    setMenuOpen(false);
    onActivate();
    onSetWorkspacePath();
  };

  return (
    <section
      ref={folderRef}
      className={cn(
        'vx-dock-folder',
        active && 'vx-dock-folder--active',
        pending && 'vx-dock-folder--pending'
      )}
      data-workspace-id={workspace.id}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CONV_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const conversationId = e.dataTransfer.getData(CONV_DRAG_MIME);
        if (conversationId.length === 0) return;
        void moveConversation(conversationId, workspace.id);
      }}
    >
      <div
        className={cn(
          'vx-dock-folder-row group flex min-w-0 items-center gap-0.5',
          active && 'vx-dock-folder-row--active',
          !active && 'vx-dock-folder-row--inactive cursor-pointer',
          dragOver && 'ring-1 ring-border-subtle/60',
          hasActiveRun && 'vyotiq-shimmer-pill'
        )}
        onClick={(e) => {
          if (active || editing) return;
          const target = e.target as HTMLElement;
          if (target.closest('button')) return;
          onActivate();
        }}
      >
        {active ? (
          <button
            type="button"
            className="vx-btn vx-btn-quiet h-5 w-5 shrink-0 px-0 text-text-faint"
            aria-label={expanded ? `Collapse ${workspace.label}` : `Expand ${workspace.label}`}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <ChevronRight
              className={cn(
                SHELL_COMPACT_ICON_CLASS,
                'transition-transform duration-150',
                expanded && 'rotate-90'
              )}
              strokeWidth={SHELL_COMPACT_ICON_STROKE}
            />
          </button>
        ) : (
          <span className="vx-dock-folder-chevron-spacer shrink-0" aria-hidden />
        )}

        {isGitHub ? (
          <FolderGit2
            className={cn(
              SHELL_ROW_ICON_CLASS,
              'shrink-0',
              active ? 'text-text-muted' : 'text-text-faint'
            )}
            strokeWidth={DOCK_TAB_ICON_STROKE}
            aria-hidden
          />
        ) : active ? (
          <FolderOpen
            className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-muted')}
            strokeWidth={DOCK_TAB_ICON_STROKE}
            aria-hidden
          />
        ) : (
          <Folder
            className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}
            strokeWidth={DOCK_TAB_ICON_STROKE}
            aria-hidden
          />
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(workspace.label);
                setEditing(false);
              }
            }}
            className="vx-input min-w-0 flex-1 py-0 font-mono text-row"
            aria-label="Rename workspace"
          />
        ) : (
          <button
            type="button"
            className={cn(
              'vx-dock-folder-label min-w-0 flex-1 truncate text-left text-row',
              active ? 'text-text-primary' : 'text-text-secondary'
            )}
            title={rowTitle}
            onClick={() => {
              onActivate();
            }}
          >
            {workspace.label}
          </button>
        )}

        {!active && githubSubtitle && githubBinding ? (
          <span className="vx-dock-meta max-w-[5rem] truncate" title={githubSubtitle}>
            {githubBinding.branch}
          </span>
        ) : null}

        {!active && chatCount > 0 ? (
          <span
            className="vx-dock-meta"
            aria-label={`${chatCount} chat${chatCount === 1 ? '' : 's'}`}
          >
            {chatCount}
          </span>
        ) : null}

        {isUnreachable ? (
          <button
            type="button"
            aria-label="Workspace unreachable"
            title="Path unreachable — click to retry"
            onClick={() => onRequestPending?.({ kind: 'retry', workspace })}
            className="shrink-0 px-0.5 text-warning"
          >
            <AlertTriangle className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          </button>
        ) : null}

        {!editing ? (
          menuOpen ? (
            <div
              role="menu"
              aria-label={`Actions for ${workspace.label}`}
              className="vx-dock-folder-actions flex shrink-0 items-center gap-0"
            >
              <MenuIcon
                icon={Pencil}
                label="Rename"
                onClick={() => {
                  setMenuOpen(false);
                  setEditing(true);
                }}
              />
              <MenuIcon
                icon={Trash2}
                label="Remove"
                danger
                onClick={() => {
                  setMenuOpen(false);
                  onRequestPending?.({ kind: 'remove-confirm', workspace });
                }}
              />
              <MenuIcon icon={ExternalLink} label="Reveal in Explorer" onClick={revealFolder} />
              <MenuIcon icon={Link2} label="Set path" onClick={setPath} />
              <button
                type="button"
                className={cn(rowIconClassName(), 'opacity-100')}
                title="Close workspace actions"
                aria-label="Close workspace actions"
                onClick={() => setMenuOpen(false)}
              >
                <MoreHorizontal
                  className={SHELL_COMPACT_ICON_CLASS}
                  strokeWidth={SHELL_COMPACT_ICON_STROKE}
                />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={cn(
                  rowIconClassName(),
                  !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
                title={`New chat in ${workspace.label}`}
                aria-label={`New chat in ${workspace.label}`}
                onClick={onNewChat}
              >
                <Plus className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              </button>
              <button
                type="button"
                className={cn(
                  rowIconClassName(),
                  !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
                title="Workspace actions"
                aria-label="Workspace actions"
                aria-expanded={false}
                onClick={() => setMenuOpen(true)}
              >
                <MoreHorizontal
                  className={SHELL_COMPACT_ICON_CLASS}
                  strokeWidth={SHELL_COMPACT_ICON_STROKE}
                />
              </button>
            </>
          )
        ) : null}
      </div>

      {githubSubtitle && !editing && active ? (
        <p
          className="vx-dock-folder-path truncate font-mono text-meta text-text-faint"
          title={githubSubtitle}
        >
          {githubSubtitle}
        </p>
      ) : showPath && !editing && active ? (
        <p className="vx-dock-folder-path truncate font-mono text-meta text-text-faint" title={path}>
          {basenameFromPath(path)}
        </p>
      ) : null}

      {expanded ? (
        <div className="vx-dock-folder-body min-w-0">
          <DockChatStrip workspaceId={workspace.id} nested />
        </div>
      ) : null}
    </section>
  );
}

function MenuIcon({
  icon: Icon,
  label,
  danger = false,
  onClick
}: {
  icon: typeof Pencil;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={label}
      aria-label={label}
      className={cn(
        'vx-dock-folder-action vx-btn vx-btn-quiet h-6 w-6 px-0',
        danger ? 'text-danger hover:text-danger' : 'text-text-faint hover:text-text-secondary'
      )}
      onClick={onClick}
    >
      <Icon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
    </button>
  );
}
