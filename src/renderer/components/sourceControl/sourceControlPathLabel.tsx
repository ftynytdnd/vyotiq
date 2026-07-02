/**
 * Path label for source-control file rows — basename or full path with dirname.
 */

import { cn } from '../../lib/cn.js';
import type { GitPathStatus } from '@shared/types/ipc.js';
import { gitStatusNameClass } from '../../lib/dockGitTreeStyle.js';

export function splitRepoPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return { dir: '', base: path };
  return { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

export function SourceControlPathLabel({
  path,
  status,
  variant = 'full',
  colorizeStatus = false,
  className
}: {
  path: string;
  status: GitPathStatus;
  variant?: 'basename' | 'full';
  /** When false (default), filenames stay neutral — status badge carries color. */
  colorizeStatus?: boolean;
  className?: string;
}) {
  const { dir, base } = splitRepoPath(path);
  const nameClass = colorizeStatus ? gitStatusNameClass(status) : 'text-text-secondary';

  if (variant === 'basename') {
    return (
      <span className={cn('truncate font-medium', nameClass, className)} title={path}>
        {base}
      </span>
    );
  }

  return (
    <span className={cn('flex min-w-0 items-baseline gap-1.5 font-mono', className)} title={path}>
      {dir ? <span className="min-w-0 truncate text-meta text-text-faint">{dir}</span> : null}
      <span className={cn('truncate font-medium', nameClass)}>{base}</span>
    </span>
  );
}
