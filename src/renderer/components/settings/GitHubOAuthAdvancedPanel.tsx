/**
 * Advanced GitHub OAuth App override — GHE or custom client ID (not required for github.com).
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { ShellCaption, ShellFieldLabel, ShellRow } from '../ui/ShellSection.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { GitHubOAuthSetupGuide } from './GitHubOAuthSetupGuide.js';

type GitHubOAuthAdvancedPanelProps = {
  oauthClientId: string;
  onOauthClientIdChange: (value: string) => void;
  onSaveOAuthClientId: () => void;
};

export function GitHubOAuthAdvancedPanel({
  oauthClientId,
  onOauthClientIdChange,
  onSaveOAuthClientId
}: GitHubOAuthAdvancedPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <ShellRow className="flex flex-col gap-2 border-t border-border-subtle/30 pt-3">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-row text-text-secondary hover:text-text-primary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
        ) : (
          <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
        )}
        Advanced — custom OAuth App (GitHub Enterprise)
      </button>
      {open ? (
        <div className="flex flex-col gap-2">
          <ShellCaption>
            Only needed for GitHub Enterprise or when overriding the built-in Vyotiq OAuth App. Most
            users can sign in with GitHub or paste a token — no app registration required.
          </ShellCaption>
          <GitHubOAuthSetupGuide embedded />
          <ShellFieldLabel>OAuth App client ID override</ShellFieldLabel>
          <TextField
            value={oauthClientId}
            onChange={(e) => onOauthClientIdChange(e.target.value)}
            placeholder="Leave empty to use the built-in Vyotiq OAuth App"
            aria-label="GitHub OAuth client ID override"
          />
          <Button variant="secondary" size="sm" onClick={() => void onSaveOAuthClientId()}>
            Save client ID override
          </Button>
        </div>
      ) : null}
    </ShellRow>
  );
}
