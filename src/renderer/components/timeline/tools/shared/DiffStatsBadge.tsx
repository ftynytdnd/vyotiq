/**
 * Tiny +N / -M badges used by the edit invocation and the file-edit row.
 *
 * `pending` enables polite live region updates while stats tick during
 * a streaming edit. Announcements are throttled so fast streams do not
 * flood screen readers.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../../lib/cn.js';

type DiffStatsBadgeMinWidth = 'auto' | 'badge';

interface DiffStatsBadgeProps {
  additions: number;
  deletions: number;
  className?: string;
  /** When true, announce stat updates via aria-live while streaming. */
  pending?: boolean;
  minWidth?: DiffStatsBadgeMinWidth;
}

const LIVE_THROTTLE_MS = 750;

export function DiffStatsBadge({
  additions,
  deletions,
  className,
  pending,
  minWidth = 'auto'
}: DiffStatsBadgeProps) {
  const [ariaLive, setAriaLive] = useState(false);
  const lastAnnounceRef = useRef(0);

  useEffect(() => {
    if (!pending) {
      setAriaLive(false);
      return;
    }
    const now = Date.now();
    if (now - lastAnnounceRef.current >= LIVE_THROTTLE_MS) {
      lastAnnounceRef.current = now;
      setAriaLive(true);
    }
  }, [pending, additions, deletions]);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        minWidth === 'badge' && 'w-16 shrink-0 justify-end',
        className
      )}
      {...(ariaLive
        ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': true }
        : {})}
    >
      {additions > 0 && (
        <span className="font-mono text-row text-success">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="font-mono text-row text-danger">−{deletions}</span>
      )}
      {additions === 0 && deletions === 0 && (
        <span className="font-mono text-row text-text-faint">0</span>
      )}
    </span>
  );
}
