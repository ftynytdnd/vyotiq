/**
 * Move-to-workspace menu for a dock chat tab. Lists every workspace
 * except the chat's current one and calls `useConversationsStore.move`.
 */

import { useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { cn } from '../../lib/cn.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

interface DockChatMoveMenuProps {
  conversationId: string;
  currentWorkspaceId: string;
}

export function DockChatMoveMenu({ conversationId, currentWorkspaceId }: DockChatMoveMenuProps) {
  const move = useConversationsStore((s) => s.move);
  const workspaces = useWorkspaceStore((s) => s.list);
  const targets = workspaces.filter((w) => w.id !== currentWorkspaceId);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (targets.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Move chat to another workspace"
        title="Move to workspace…"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-inner',
          'text-text-faint hover:text-text-primary focus-visible:opacity-100'
        )}
      >
        <ArrowRightLeft className="h-3 w-3" strokeWidth={2} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="start"
        offset={6}
        className="elev-1 min-w-[12rem] rounded-card bg-surface-overlay p-1"
      >
        <div className="px-2 py-1 text-meta text-text-faint">Move to workspace</div>
        {targets.map((ws) => (
          <button
            key={ws.id}
            type="button"
            onClick={() => {
              setOpen(false);
              void move(conversationId, ws.id);
            }}
            className={cn(
              'app-no-drag flex w-full truncate rounded-inner px-2 py-1.5 text-left text-row',
              'text-text-secondary transition-colors duration-150',
              'hover:bg-surface-hover hover:text-text-primary'
            )}
            title={ws.path ?? ws.label}
          >
            {ws.label}
          </button>
        ))}
      </Popover>
    </>
  );
}
