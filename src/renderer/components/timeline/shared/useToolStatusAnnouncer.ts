/**
 * Screen-reader announcements for tool group status transitions.
 */

import { useEffect, useRef } from 'react';

export type ToolGroupStatus = 'running' | 'done' | 'failed';

export function useToolStatusAnnouncer(
  label: string,
  status: ToolGroupStatus,
  enabled = true
): void {
  const prev = useRef<ToolGroupStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (prev.current === status) return;
    prev.current = status;

    if (status === 'running') return;

    const el = document.getElementById('vyotiq-timeline-announcer');
    if (!el) return;
    const verb = status === 'failed' ? 'failed' : 'completed';
    el.textContent = `${label} ${verb}`;
  }, [enabled, label, status]);
}
