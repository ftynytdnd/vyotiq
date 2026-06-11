/**
 * Per-file change card — icon, basename, stats header + optional body.
 */

import type { ReactNode } from 'react';
import { ArrowUpRight, FileCode, FileJson, FileText } from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import { timelineActionPillClassName } from '../timeline/shared/rowStyles.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';

interface FileChangeCardProps {
  filePath: string;
  additions: number;
  deletions: number;
  variant: DiffViewVariant;
  pending?: boolean;
  statusLabel?: string;
  children?: ReactNode;
  className?: string;
  onOpen?: () => void;
}

function fileIconForPath(filePath: string) {
  const base = basenameFromPath(filePath).toLowerCase();
  if (base.endsWith('.json')) {
    return <FileJson className={cn(SHELL_ROW_ICON_CLASS, 'text-accent')} strokeWidth={SHELL_ACTION_ICON_STROKE} />;
  }
  if (base.endsWith('.md') || base.endsWith('.mdx') || base.endsWith('.txt')) {
    return <FileText className={cn(SHELL_ROW_ICON_CLASS, 'text-accent')} strokeWidth={SHELL_ACTION_ICON_STROKE} />;
  }
  return <FileCode className={cn(SHELL_ROW_ICON_CLASS, 'text-accent')} strokeWidth={SHELL_ACTION_ICON_STROKE} />;
}

export function FileChangeCard({
  filePath,
  additions,
  deletions,
  variant,
  pending,
  statusLabel,
  children,
  className,
  onOpen
}: FileChangeCardProps) {
  const name = basenameFromPath(filePath);
  const settle = variant === 'authoritative';

  return (
    <div
      className={cn(
        'vx-file-change-card group/file-card',
        settle && 'vyotiq-file-change-settle',
        className
      )}
      data-variant={variant}
      data-file-change-card
    >
      <div className="vx-file-change-card__header flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        {fileIconForPath(filePath)}
        <span
          className="min-w-0 flex-1 truncate font-mono text-row text-text-primary"
          title={filePath}
        >
          {name}
        </span>
        {statusLabel ? (
          <span className="shrink-0 text-meta text-text-faint">{statusLabel}</span>
        ) : null}
        <DiffStatsBadge
          additions={additions}
          deletions={deletions}
          pending={pending}
          className="shrink-0"
        />
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              timelineActionPillClassName,
              'shrink-0 opacity-0 group-hover/file-card:opacity-100 group-focus-within/file-card:opacity-100 focus-visible:opacity-100'
            )}
          >
            Open
            <ArrowUpRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          </button>
        ) : null}
      </div>
      {children ? (
        <div className="vx-file-change-card__body border-t border-chrome-subtle">{children}</div>
      ) : null}
    </div>
  );
}
