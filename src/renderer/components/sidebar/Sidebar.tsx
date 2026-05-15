/**
 * Sidebar — Codex-style layout.
 *
 *   +-----------------------------+
 *   | [<]                         |  SidebarToolbar (collapse chevron)
 *   +-----------------------------+
 *   | +  New chat                 |
 *   | o  Search                   |  SidebarNav (3 primary rows;
 *   | /  Workspace: <label>       |   Search row morphs into an input)
 *   +-----------------------------+
 *   | Chats                       |  ChatsSection (label + scrollable
 *   |  > <conversation 1>         |   filtered list, stealth scrollbar,
 *   |  ...                        |   mask-image fades top/bottom)
 *   +-----------------------------+
 *   | *  Settings                 |  SidebarFooter (only Settings;
 *   +-----------------------------+  scroll-shadow border when overflowing)
 *
 * `useSidebarShortcuts` is mounted here so its window-level handlers run
 * for the whole app while the sidebar exists in the tree. The keyboard
 * hook reads/writes the same stores the components do, so no prop wiring
 * is needed.
 */

import { useRef } from 'react';
import { SidebarToolbar } from './SidebarToolbar.js';
import { SidebarNav } from './SidebarNav.js';
import { ChatsSection } from './ChatsSection.js';
import { SidebarFooter } from './SidebarFooter.js';
import { useSidebarShortcuts } from './useSidebarShortcuts.js';

interface SidebarProps {
  onOpenSettings: () => void;
  /** Open the Checkpoints view modal. Wired through the sidebar footer. */
  onOpenCheckpoints: () => void;
}

export function Sidebar({ onOpenSettings, onOpenCheckpoints }: SidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useSidebarShortcuts();

  return (
    <aside className="flex h-full w-[250px] min-w-0 shrink-0 flex-col bg-surface-base">
      <SidebarToolbar />
      <SidebarNav />
      <ChatsSection scrollRef={scrollRef} />
      <SidebarFooter
        onOpenSettings={onOpenSettings}
        onOpenCheckpoints={onOpenCheckpoints}
        scrollContainerRef={scrollRef}
      />
    </aside>
  );
}
