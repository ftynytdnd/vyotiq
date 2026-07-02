/**
 * PromptDialog — controlled text input rendered as a mini
 * {@link ComposerDialog} above the chat composer. Replaces
 * `window.prompt`.
 *
 * `variant="workspacePath"` — folder picker primary, recent workspace
 * paths list, paste field secondary (round 3 path prompt spec).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from './Button.js';
import { ComposerDialog } from './ComposerDialog.js';
import { ComposerDialogPortal } from './ComposerDialogAnchor.js';
import { TextField } from './TextField.js';
import { ShellCaption, ShellFieldActions, ShellFieldLabel } from './ShellSection.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

export interface PromptDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `workspacePath` — browse + recent paths + paste field. */
  variant?: 'text' | 'workspacePath';
  /** Recent paths for `workspacePath` (defaults to workspace registry). */
  recentPaths?: string[];
  validate?: (value: string) => string | null;
  /** Portal above full-screen surfaces (e.g. Settings) when the composer anchor is unmounted. */
  elevated?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title = 'Enter a value',
  message,
  placeholder,
  initialValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'text',
  recentPaths: recentPathsProp,
  validate,
  elevated = false,
  onSubmit,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [err, setErr] = useState<string | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const workspaceList = useWorkspaceStore((s) => s.list);

  const recentPaths = useMemo(() => {
    if (recentPathsProp) return recentPathsProp;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ws of workspaceList) {
      const p = ws.path?.trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  }, [recentPathsProp, workspaceList]);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setErr(null);
    const raf = requestAnimationFrame(() => {
      if (variant === 'workspacePath') browseRef.current?.focus();
      else inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, initialValue, variant]);

  const submit = (raw?: string) => {
    const trimmed = (raw ?? value).trim();
    if (validate) {
      const message = validate(trimmed);
      if (message) {
        setErr(message);
        return;
      }
    }
    onSubmit(trimmed);
  };

  const onBrowse = async () => {
    setBrowseBusy(true);
    try {
      const picked = await vyotiq.workspace.pickDirectory();
      if (picked) submit(picked);
    } finally {
      setBrowseBusy(false);
    }
  };

  if (!open) return null;

  const isWorkspacePath = variant === 'workspacePath';
  const enterPrimaryRef = isWorkspacePath ? browseRef : submitRef;

  return (
    <ComposerDialogPortal elevated={elevated}>
      <ComposerDialog
        open={open}
        onClose={onCancel}
        title={title}
        size="compact"
        enterPrimaryRef={enterPrimaryRef}
      >
        <div className="flex flex-col gap-3">
          {message && (
            <ShellCaption className="whitespace-pre-wrap text-body leading-relaxed text-text-secondary">
              {message}
            </ShellCaption>
          )}

          {isWorkspacePath ? (
            <>
              <Button
                ref={browseRef}
                variant="accentFill"
                className="w-full justify-center"
                onClick={() => void onBrowse()}
                disabled={browseBusy}
              >
                <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                {browseBusy ? 'Opening picker…' : 'Browse folder'}
              </Button>

              {recentPaths.length > 0 && (
                <div className="flex flex-col gap-1">
                  <ShellFieldLabel>Recent workspaces</ShellFieldLabel>
                  <ul
                    className={cn(
                      'scrollbar-stealth max-h-28 overflow-y-auto rounded-[var(--radius-inner)]',
                      'border border-border-subtle/30 bg-surface-sunken/30'
                    )}
                  >
                    {recentPaths.map((path) => (
                      <li key={path}>
                        <button
                          type="button"
                          className="vx-btn-text w-full truncate px-2 py-1.5 text-left font-mono text-row text-text-secondary hover:bg-chrome-hover/40"
                          title={path}
                          onClick={() => submit(path)}
                        >
                          {path}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <ShellFieldLabel htmlFor="prompt-dialog-workspace-path">Or paste a path</ShellFieldLabel>
                <TextField
                  id="prompt-dialog-workspace-path"
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    if (err) setErr(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={placeholder}
                  size="lg"
                  tone="base"
                  className="w-full font-mono"
                />
              </div>
            </>
          ) : (
            <TextField
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (err) setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder}
              size="lg"
              tone="base"
              className="w-full"
            />
          )}

          {err && <div className="vx-caption text-danger">{err}</div>}
          <ShellFieldActions>
            <Button variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              ref={submitRef}
              variant={isWorkspacePath ? 'secondary' : 'primary'}
              onClick={() => submit()}
              disabled={value.trim().length === 0}
            >
              {confirmLabel}
            </Button>
          </ShellFieldActions>
        </div>
      </ComposerDialog>
    </ComposerDialogPortal>
  );
}
