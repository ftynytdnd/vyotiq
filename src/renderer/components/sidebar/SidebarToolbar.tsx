/**
 * SidebarToolbar — top row of the sidebar.
 *
 * Layout:  [ + new chat ] [ search ] ··· spacer ··· [ < collapse ]
 *
 * Promoting "New chat" and "Search" out of the nav list into compact
 * icon buttons here keeps the sidebar visually quieter (matches the
 * Cursor / Cascade resting state) and reclaims a row of vertical space
 * for the Chats list.
 */

import { ChevronLeft, Search, SquarePen } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useSidebarSearchStore } from '../../store/useSidebarSearchStore.js';
import { cn } from '../../lib/cn.js';

export function SidebarToolbar() {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const newConversation = useConversationsStore((s) => s.newConversation);
  const toggleSearch = useSidebarSearchStore((s) => s.toggle);
  const searchOpen = useSidebarSearchStore((s) => s.open);

  return (
    <div className="flex items-center gap-0.5 px-2.5 pb-1.5 pt-2">
      <ToolbarButton
        label="New chat"
        title="New chat"
        onClick={() => void newConversation()}
      >
        <SquarePen className="h-3.5 w-3.5" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        label="Search chats"
        title="Search chats (Ctrl+K)"
        active={searchOpen}
        onClick={toggleSearch}
      >
        <Search className="h-3.5 w-3.5" strokeWidth={2} />
      </ToolbarButton>
      <div className="flex-1" />
      <ToolbarButton
        label="Hide sidebar"
        title="Hide sidebar (Ctrl+B)"
        onClick={() => setSidebarOpen(false)}
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
      </ToolbarButton>
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, title, active, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-inner',
        'text-text-faint transition-colors duration-150',
        'hover:bg-surface-hover hover:text-text-primary',
        active && 'bg-surface-hover text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
