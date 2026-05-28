/**
 * File menu action callbacks — shared by HamburgerMenu and global shortcuts.
 */

export interface FileMenuActions {
  newConversation: () => void;
  openWorkspace: () => void;
  setWorkspacePath: () => void;
  openSettings: () => void;
  openCheckpoints: () => void;
  openContextInspector: () => void;
  quit: () => void;
}
