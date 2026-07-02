/**
 * Collapsible OAuth App registration steps for GitHub Device Flow (advanced / GHE).
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { GITHUB_OAUTH_CALLBACK_PLACEHOLDER } from '@shared/github/oauthConstants.js';
import { ShellRow } from '../ui/ShellSection.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { safeCopy } from '../../lib/clipboard.js';
import { useToastStore } from '../../store/useToastStore.js';
import { cn } from '../../lib/cn.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';

type GitHubOAuthSetupGuideProps = {
  /** When true, omit outer border — parent advanced panel provides chrome. */
  embedded?: boolean;
};

export function GitHubOAuthSetupGuide({ embedded = false }: GitHubOAuthSetupGuideProps) {

  const [open, setOpen] = useState(false);



  const onCopyCallbackUrl = async () => {

    const ok = await safeCopy(GITHUB_OAUTH_CALLBACK_PLACEHOLDER, { context: 'github-oauth-callback' });

    if (ok) useToastStore.getState().show('Callback URL copied', 'success');

  };



  return (
    <ShellRow className={cn('flex flex-col gap-2', !embedded && 'border-t border-border-subtle/30 pt-3')}>

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

        How to register a GitHub OAuth App

      </button>

      {open ? (

        <ol className="list-decimal space-y-2 pl-5 text-meta text-text-muted">

          <li>

            Open{' '}

            <span className="font-mono text-text-faint">

              github.com → Settings → Developer settings → OAuth Apps

            </span>{' '}

            (or the equivalent on your GitHub Enterprise host).

          </li>

          <li>

            Click <strong className="font-medium text-text-secondary">New OAuth App</strong>. Set

            any name and homepage URL.

          </li>

          <li>

            For <strong className="font-medium text-text-secondary">Authorization callback URL</strong>, use

            a placeholder — Device Flow does not redirect back to Vyotiq:

            <span className="mt-1 flex items-center gap-1">

              <code className="min-w-0 flex-1 truncate rounded-inner bg-chrome-hover-soft px-1.5 py-0.5 font-mono text-text-faint">

                {GITHUB_OAUTH_CALLBACK_PLACEHOLDER}

              </code>

              <button

                type="button"

                className={cn(chromeToolbarButtonClassName(), 'h-7 w-7 shrink-0')}

                title="Copy callback URL"

                aria-label="Copy OAuth callback URL"

                onClick={() => void onCopyCallbackUrl()}

              >

                <Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />

              </button>

            </span>

          </li>

          <li>

            Enable <strong className="font-medium text-text-secondary">Device Flow</strong> on the

            app (required for browser sign-in without a redirect).

          </li>

          <li>Copy the <strong className="font-medium text-text-secondary">Client ID</strong>.</li>
          <li>Paste it in the override field above, or set it in the shipped build constant.</li>

        </ol>

      ) : null}

    </ShellRow>

  );

}


