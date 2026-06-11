/**
 * File menu action callbacks — shared by HamburgerMenu and global shortcuts.
 */

export interface FileMenuActions {
  newConversation: () => void;
  openWorkspace: () => void;
  setWorkspacePath: () => void;
  openSettings: () => void;
  quit: () => void;
  /** Hide chat/workspace rows while settings (or similar) is open. */
  chatActionsEnabled?: boolean;
}
