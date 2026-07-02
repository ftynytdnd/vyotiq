/**
 * Inline GitHub connect section in the workspace launcher results area.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderGit2, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { ModelPickerSectionHeader } from '../composer/modelPicker/ModelPickerSectionHeader.js';
import type { UseWorkspaceLauncherModelResult } from './useWorkspaceLauncherModel.js';

type ConnectProps = Pick<
  UseWorkspaceLauncherModelResult,
  | 'gheHost'
  | 'setGheHost'
  | 'patToken'
  | 'setPatToken'
  | 'patBusy'
  | 'connectWithToken'
  | 'openTokenPage'
  | 'deviceBusy'
  | 'deviceCode'
  | 'oauthConfigured'
  | 'startDeviceFlow'
  | 'oauthSignInDisabled'
  | 'patFocusSignal'
> & {
  activeAction?: 'sign-in' | 'token' | null;
};

export function WorkspaceLauncherConnect(props: ConnectProps) {
  const patInputRef = useRef<HTMLInputElement>(null);
  const [tokenExpanded, setTokenExpanded] = useState(props.oauthConfigured === false);

  useEffect(() => {
    if (props.oauthConfigured === false) {
      setTokenExpanded(true);
    }
  }, [props.oauthConfigured]);

  useEffect(() => {
    if (props.patFocusSignal <= 0) return;
    setTokenExpanded(true);
    const raf = requestAnimationFrame(() => patInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [props.patFocusSignal]);

  return (
    <div className="py-0.5">
      <ModelPickerSectionHeader label="Connect" variant="category" />
      <div className="flex flex-col gap-2 px-2 py-1">
        <ShellCaption>Connect a GitHub account to browse repositories.</ShellCaption>
        <TextField
          value={props.gheHost}
          onChange={(e) => props.setGheHost(e.target.value)}
          placeholder="github.com or github.mycompany.com"
          aria-label="GitHub host"
        />
        {props.oauthConfigured !== false ? (
          <Button
            variant="accentFill"
            size="sm"
            disabled={props.oauthSignInDisabled}
            className={cn(props.activeAction === 'sign-in' && 'ring-1 ring-accent/50')}
            onClick={() => void props.startDeviceFlow(props.gheHost)}
          >
            {props.deviceBusy ? (
              <Loader2 className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin')} aria-hidden />
            ) : (
              <FolderGit2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
            )}
            {props.deviceCode ? `Enter code ${props.deviceCode}` : 'Sign in with GitHub'}
          </Button>
        ) : null}
        <button
          type="button"
          className="vx-btn vx-btn-quiet flex items-center gap-1 px-0 text-row text-text-muted"
          aria-expanded={tokenExpanded}
          onClick={() => setTokenExpanded((v) => !v)}
        >
          {tokenExpanded ? (
            <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
          ) : (
            <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
          )}
          Or paste a token
        </button>
        {tokenExpanded ? (
          <div className="flex flex-col gap-2 pl-4">
            <ShellCaption>
              No OAuth App setup needed.{' '}
              <button
                type="button"
                className="text-text-secondary underline decoration-border-subtle underline-offset-2 hover:text-text-primary"
                onClick={props.openTokenPage}
              >
                Create token on GitHub
              </button>
            </ShellCaption>
            <TextField
              ref={patInputRef}
              type="password"
              value={props.patToken}
              onChange={(e) => props.setPatToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              aria-label="GitHub token"
            />
            <Button
              variant={props.oauthConfigured === false ? 'accentFill' : 'secondary'}
              size="sm"
              disabled={props.patBusy || !props.patToken.trim()}
              className={cn(props.activeAction === 'token' && 'ring-1 ring-accent/50')}
              onClick={() => void props.connectWithToken()}
            >
              {props.patBusy ? (
                <Loader2 className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin')} aria-hidden />
              ) : null}
              Connect with token
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
