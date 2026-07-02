/**
 * Source control commit dock — compact message + actions (placed above changes).
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Ellipsis, Sparkles } from 'lucide-react';
import { commitMessageSubject } from '@shared/git/normalizeCommitMessage.js';
import { Button } from '../ui/Button.js';
import { Popover } from '../ui/Popover.js';
import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { WORKBENCH_ICON_BTN_CLASS, workbenchToolbarToggleClass } from '../workbench/workbenchChrome.js';
import { cn } from '../../lib/cn.js';
import { registerSourceControlDomFocus } from '../../lib/workbenchFocusDom.js';

interface SourceControlCommitDockProps {
  commitMessage: string;
  generateWarnings?: string[];
  busy: boolean;
  generateLoading?: boolean;
  commitLoading?: boolean;
  canGenerateMessage: boolean;
  generateDisabledTitle: string;
  commitMessageModelLabel?: string | null;
  canSync: boolean;
  syncDisabledTitle?: string;
  canCommit: boolean;
  commitDisabledTitle: string;
  canPush: boolean;
  canAmend: boolean;
  hasUnstaged: boolean;
  hasChanges: boolean;
  hasStash: boolean;
  onCommitMessageChange: (value: string) => void;
  onGenerate: () => void;
  onCommit: () => void;
  onCommitPush: () => void;
  onPush: () => void;
  onAmend: () => void;
  onStageAll: () => void;
  onDiscardAll: () => void;
  onStash: () => void;
  onStashPop: () => void;
}

export function SourceControlCommitDock({
  commitMessage,
  generateWarnings = [],
  busy,
  generateLoading = false,
  commitLoading = false,
  canGenerateMessage,
  generateDisabledTitle,
  commitMessageModelLabel = null,
  canSync,
  syncDisabledTitle,
  canCommit,
  commitDisabledTitle,
  canPush,
  canAmend,
  hasUnstaged,
  hasChanges,
  hasStash,
  onCommitMessageChange,
  onGenerate,
  onCommit,
  onCommitPush,
  onPush,
  onAmend,
  onStageAll,
  onDiscardAll,
  onStash,
  onStashPop
}: SourceControlCommitDockProps) {
  const commitRef = useRef<HTMLTextAreaElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const commitMenuRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);

  useEffect(() => {
    return registerSourceControlDomFocus(() => {
      commitRef.current?.focus();
    });
  }, []);

  const runMore = (fn: () => void) => {
    setMoreOpen(false);
    fn();
  };

  const runCommitMenu = (fn: () => void) => {
    setCommitMenuOpen(false);
    fn();
  };

  const generateTitle = commitMessageModelLabel
    ? `${generateDisabledTitle} · ${commitMessageModelLabel}`
    : generateDisabledTitle;

  const subject = commitMessageSubject(commitMessage);
  const subjectLen = subject.length;
  const subjectOver = subjectLen > 72;

  return (
    <section className="vx-sc-commit-dock">
      <textarea
        id="source-control-commit-message"
        ref={commitRef}
        value={commitMessage}
        onChange={(e) => onCommitMessageChange(e.target.value)}
        placeholder={
          generateLoading
            ? 'Analyzing staged changes…'
            : 'feat(scope): short summary\n\nExplain what changed and why, in plain sentences.'
        }
        rows={4}
        className={cn(
          'vx-sc-commit-input app-no-drag',
          generateLoading && 'vx-sc-commit-input--generating'
        )}
        aria-label="Commit message"
        aria-live="polite"
        aria-busy={generateLoading || undefined}
        readOnly={generateLoading}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit && !busy) {
            e.preventDefault();
            onCommit();
          }
        }}
      />

      {generateWarnings.length > 0 ? (
        <div className="vx-sc-commit-warnings" role="status" aria-live="polite">
          {generateWarnings.map((warning) => (
            <p key={warning} className="vx-sc-commit-warning-line">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="vx-sc-commit-bar">
        <div className="vx-sc-commit-bar-meta">
          {subject ? (
            <span
              className={cn('vx-sc-commit-subject-len', subjectOver && 'vx-sc-commit-subject-len--over')}
              aria-live="polite"
              title="Subject line length (max 72)"
            >
              {subjectLen}/72
            </span>
          ) : (
            <span className="vx-sc-commit-format-hint">Subject + narrative body</span>
          )}
        </div>

        <div className="vx-sc-commit-bar-actions">
          <Button
            variant="accent"
            size="sm"
            className="vx-sc-generate-btn"
            disabled={busy || !canGenerateMessage}
            loading={generateLoading}
            title={generateTitle}
            aria-label={generateLoading ? 'Generating commit message' : 'AI generate commit message'}
            onClick={onGenerate}
          >
            <Sparkles className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
            <span className="vx-sc-generate-btn-label">Generate</span>
          </Button>

          <div className="vx-sc-commit-primary">
            <Button
              variant="accentFill"
              size="sm"
              className="vx-sc-commit-btn"
              disabled={busy || !canCommit}
              loading={commitLoading}
              title={
                commitLoading
                  ? 'Committing…'
                  : canCommit
                    ? 'Commit (Ctrl+Enter)'
                    : commitDisabledTitle
              }
              onClick={onCommit}
            >
              {commitLoading ? '…' : 'Commit'}
            </Button>
            <button
              ref={commitMenuRef}
              type="button"
              className={cn('vx-sc-commit-caret app-no-drag', workbenchToolbarToggleClass(commitMenuOpen))}
              disabled={busy || !canCommit}
              aria-label="More commit actions"
              aria-expanded={commitMenuOpen}
              aria-haspopup="menu"
              onClick={() => setCommitMenuOpen((v) => !v)}
            >
              <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            </button>
            <Popover
              open={commitMenuOpen}
              onClose={() => setCommitMenuOpen(false)}
              triggerRef={commitMenuRef}
              align="end"
              preferSide="bottom"
              anchorStrict
              widthMode="content"
              fitMaxWidth={200}
              zIndex={60}
            >
              <div
                role="menu"
                aria-label="Commit actions"
                className={cn(chromePopoverPanelClassName, 'vx-sc-menu min-w-[10rem] p-1')}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="vx-sc-menu-item"
                  disabled={busy || !canCommit || !canSync}
                  title={!canSync ? syncDisabledTitle : undefined}
                  onClick={() => runCommitMenu(onCommitPush)}
                >
                  Commit &amp; push
                </button>
                {!hasChanges ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="vx-sc-menu-item"
                    disabled={busy || !canPush}
                    title={!canPush ? syncDisabledTitle : undefined}
                    onClick={() => runCommitMenu(onPush)}
                  >
                    Push
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="vx-sc-menu-item"
                  disabled={busy || !canAmend}
                  onClick={() => runCommitMenu(onAmend)}
                >
                  Amend last commit
                </button>
              </div>
            </Popover>
          </div>

          <button
            ref={moreRef}
            type="button"
            className={cn(WORKBENCH_ICON_BTN_CLASS, workbenchToolbarToggleClass(moreOpen))}
            disabled={busy}
            aria-label="More git actions"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <Ellipsis className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          </button>
          <Popover
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            triggerRef={moreRef}
            align="end"
            preferSide="bottom"
            anchorStrict
            widthMode="content"
            fitMaxWidth={220}
            zIndex={60}
          >
            <div
              role="menu"
              aria-label="More git actions"
              className={cn(chromePopoverPanelClassName, 'vx-sc-menu min-w-[11rem] p-1')}
            >
              <button
                type="button"
                role="menuitem"
                className="vx-sc-menu-item"
                disabled={busy || !hasUnstaged}
                onClick={() => runMore(onStageAll)}
              >
                Stage all
              </button>
              <button
                type="button"
                role="menuitem"
                className="vx-sc-menu-item"
                disabled={busy || !hasChanges}
                onClick={() => runMore(onStash)}
              >
                Stash changes
              </button>
              <button
                type="button"
                role="menuitem"
                className="vx-sc-menu-item"
                disabled={busy || !hasStash}
                onClick={() => runMore(onStashPop)}
              >
                Pop latest stash
              </button>
              <button
                type="button"
                role="menuitem"
                className="vx-sc-menu-item vx-sc-menu-item--danger"
                disabled={busy || !hasChanges}
                onClick={() => runMore(onDiscardAll)}
              >
                Discard all…
              </button>
            </div>
          </Popover>
        </div>
      </div>
    </section>
  );
}
