/**
 * Setup CTAs for the centered empty-chat landing when workspace or
 * provider is not ready yet.
 */

import { Button } from '../components/ui/Button.js';
import { FolderOpen } from 'lucide-react';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../lib/shellIcons.js';

interface ChatLandingSetupProps {
  hasWorkspace: boolean;
  hasProviders: boolean;
  onPickWorkspace: () => void;
  onOpenProviders: () => void;
}

export function ChatLandingSetup({
  hasWorkspace,
  hasProviders,
  onPickWorkspace,
  onOpenProviders
}: ChatLandingSetupProps) {
  if (hasWorkspace && hasProviders) return null;

  return (
    <div className="mb-6 text-center">
      {!hasWorkspace ? (
        <>
          <p className="text-body font-medium text-text-primary">Open a workspace to begin</p>
          <p className="mx-auto mt-2 max-w-md text-row text-text-muted">
            Agent V runs inside a folder on your machine. Pick one to sandbox tools and memory.
          </p>
          <div className="mt-5 flex justify-center">
            <Button variant="link" size="sm" onClick={onPickWorkspace}>
              <FolderOpen
                className={SHELL_ROW_ICON_CLASS}
                strokeWidth={SHELL_ROW_ICON_STROKE}
                aria-hidden
              />
              Open workspace…
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body font-medium text-text-primary">Configure an AI provider</p>
          <p className="mx-auto mt-2 max-w-md text-row text-text-muted">
            Connect a local or remote model before Agent V can respond.
          </p>
          <div className="mt-5 flex justify-center">
            <Button variant="link" size="sm" onClick={onOpenProviders}>
              Configure provider
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
