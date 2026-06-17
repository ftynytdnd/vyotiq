/**
 * Shared GFM table shell for streaming and settled markdown paths.
 */

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

interface MdTableShellProps {
  children: ReactNode;
  className?: string;
  busy?: boolean;
}

function MdTableShell({ children, className, busy }: MdTableShellProps) {
  return (
    <div
      className={cn(
        'vx-timeline-md-table-wrap',
        busy && 'vx-timeline-md-table-preview',
        className
      )}
      aria-busy={busy || undefined}
    >
      {children}
    </div>
  );
}

interface MdTableProps {
  head: ReactNode;
  body: ReactNode;
  busy?: boolean;
}

export function MdTable({ head, body, busy }: MdTableProps) {
  return (
    <MdTableShell busy={busy}>
      <table className="vx-timeline-md-table">
        <thead>{head}</thead>
        <tbody>{body}</tbody>
      </table>
    </MdTableShell>
  );
}

export function MdTableFromMarkdown({
  children,
  ...rest
}: ComponentProps<'table'>) {
  return (
    <MdTableShell>
      <table className="vx-timeline-md-table" {...rest}>
        {children}
      </table>
    </MdTableShell>
  );
}
