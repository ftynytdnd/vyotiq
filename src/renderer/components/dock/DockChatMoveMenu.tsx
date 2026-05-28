/**
 * Move-to-workspace menu for a dock chat tab. Lists every workspace
 * except the chat's current one and calls `useConversationsStore.move`.
 */

import { useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { appPopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';
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
          'vx-btn vx-btn-quiet inline-flex h-4 w-4 items-center justify-center px-0',
          'text-text-faint hover:text-text-primary focus-visible:opacity-100'
        )}
      >
        <ArrowRightLeft className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="end"
        offset={6}
        collisionPadding={{ right: 12 }}
        className={cn(appPopoverPanelClassName, 'min-w-[12rem] p-1')}
      >
        <div className="vx-field-label px-2 py-1 normal-case tracking-normal">
          Move to workspace
        </div>
        <div className="flex flex-col gap-0.5" role="menu">
          {targets.map((ws) => (
            <button
              key={ws.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void move(conversationId, ws.id);
              }}
              className="vx-dropdown-item truncate"
              title={ws.path ?? ws.label}
            >
              {ws.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
