/**
 * File menu — workspace-level actions plus app exit.
 *
 * The menu is composition-only: each item resolves to a callback the host
 * passes in. This keeps menu items free of cross-feature imports and lets
 * higher levels (App, TitleBar) decide which features are wired.
 */

import { MenuItem } from '../MenuItem.js';
import { MenuSeparator } from '../MenuSeparator.js';
import { formatPlatformShortcut } from '../../../shortcuts/ShortcutsPanel.js';

export interface FileMenuActions {
  newConversation: () => void;
  openWorkspace: () => void;
  /** Opens a prompt dialog so the user can paste an absolute workspace path
   *  directly (useful when the folder picker is cumbersome, e.g. deep
   *  network paths). */
  setWorkspacePath: () => void;
  openSettings: () => void;
  openCheckpoints: () => void;
  openContextInspector: () => void;
  quit: () => void;
}

export function FileMenu({ actions, onAfterAction }: { actions: FileMenuActions; onAfterAction: () => void }) {
  return (
    <>
      <MenuItem
        label="New Conversation"
        shortcut={formatPlatformShortcut('Ctrl+N')}
        onSelect={actions.newConversation}
        onAfterAction={onAfterAction}
      />
      <MenuItem
        label="Open Workspace…"
        shortcut={formatPlatformShortcut('Ctrl+O')}
        onSelect={actions.openWorkspace}
        onAfterAction={onAfterAction}
      />
      <MenuItem
        label="Set Workspace by Path…"
        onSelect={actions.setWorkspacePath}
        onAfterAction={onAfterAction}
      />
      <MenuSeparator />
      <MenuItem
        label="Settings…"
        shortcut={formatPlatformShortcut('Ctrl+,')}
        onSelect={actions.openSettings}
        onAfterAction={onAfterAction}
      />
      <MenuItem
        label="Checkpoint history…"
        shortcut={formatPlatformShortcut('Ctrl+Shift+H')}
        onSelect={actions.openCheckpoints}
        onAfterAction={onAfterAction}
      />
      <MenuItem
        label="Context Inspector"
        shortcut={formatPlatformShortcut('Ctrl+Shift+C')}
        onSelect={actions.openContextInspector}
        onAfterAction={onAfterAction}
      />
      <MenuSeparator />
      <MenuItem label="Exit" onSelect={actions.quit} onAfterAction={onAfterAction} />
    </>
  );
}
