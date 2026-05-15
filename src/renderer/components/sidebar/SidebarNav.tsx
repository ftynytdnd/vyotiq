/**
 * SidebarNav — host for the inline search input. The legacy
 * `Workspace: …` / `Open workspace…` NavItem was removed: the
 * Workspaces tree below already lists every workspace, and its `+`
 * button opens the same `pickWorkspace` picker, so the row was a
 * redundant second affordance for the same action.
 *
 * When search is closed there is nothing to paint, so the component
 * returns `null` to avoid an empty `<nav>` taking up vertical space.
 */

import { SidebarSearch } from './SidebarSearch.js';
import { useSidebarSearchStore } from '../../store/useSidebarSearchStore.js';

export function SidebarNav() {
  const searchOpen = useSidebarSearchStore((s) => s.open);
  if (!searchOpen) return null;
  return (
    <nav className="flex flex-col gap-0.5 px-2 pt-1">
      <SidebarSearch />
    </nav>
  );
}
