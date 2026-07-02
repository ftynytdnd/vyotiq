/**
 * Setup CTAs and interactive workspace context for the centered empty-chat landing.
 */

import { Button } from '../components/ui/Button.js';
import { FolderGit2, FolderOpen } from 'lucide-react';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../lib/shellIcons.js';
import { WorkspaceContextBar } from '../components/workspace/WorkspaceContextBar.js';

interface ChatLandingSetupProps {
  hasWorkspace: boolean;
  hasProviders: boolean;
  /** Empty-chat landing — show git context when ready. */
  landing?: boolean;
  workspaceId: string | null;
  workspaceLabel: string | null;
  onPickWorkspace: () => void;
  onConnectGitHub: () => void;
  onOpenProviders: () => void;
}

export function ChatLandingSetup({
  hasWorkspace,
  hasProviders,
  landing = false,
  workspaceId,
  workspaceLabel,
  onPickWorkspace,
  onConnectGitHub,
  onOpenProviders
}: ChatLandingSetupProps) {
  if (!hasWorkspace || !hasProviders) {
    return (
      <div className="mb-8 text-center">
        {!hasWorkspace ? (
          <>
            <p className="text-hero font-medium text-text-primary">Open a workspace to begin</p>
            <p className="mx-auto mt-2 max-w-md text-row text-text-muted">
              Agent V runs inside a folder on your machine. Pick one to sandbox tools and memory.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button variant="accentFill" onClick={onPickWorkspace}>
                <FolderOpen
                  className={SHELL_ROW_ICON_CLASS}
                  strokeWidth={SHELL_ROW_ICON_STROKE}
                  aria-hidden
                />
                Open workspace…
              </Button>
              <Button variant="secondary" onClick={onConnectGitHub}>
                <FolderGit2
                  className={SHELL_ROW_ICON_CLASS}
                  strokeWidth={SHELL_ROW_ICON_STROKE}
                  aria-hidden
                />
                Connect GitHub
              </Button>
            </div>
            <p className="mx-auto mt-3 max-w-md text-meta text-text-faint">
              Clone a repo from GitHub or open a local folder.
            </p>
          </>
        ) : (
          <>
            <p className="text-hero font-medium text-text-primary">Configure an AI provider</p>
            <p className="mx-auto mt-2 max-w-md text-row text-text-muted">
              Connect a local or remote model before Agent V can respond.
            </p>
            <div className="mt-5 flex justify-center">
              <Button variant="accentFill" onClick={onOpenProviders}>
                Configure provider
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!landing || !workspaceId) return null;

  return (
    <div className="mb-3">
      <WorkspaceContextBar
        workspaceId={workspaceId}
        workspaceLabel={workspaceLabel ?? 'workspace'}
        variant="landing"
      />
    </div>
  );
}
