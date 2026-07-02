/**
 * Poll enabled scheduled-run count for the dock toolbar badge.
 */

import { useEffect, useState } from 'react';
import { vyotiq } from '../lib/ipc.js';

export function useEnabledScheduleCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const runs = await vyotiq.scheduledRuns.list();
        if (!cancelled) {
          setCount(runs.filter((run) => run.enabled).length);
        }
      } catch {
        if (!cancelled) setCount(0);
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    const unsub = vyotiq.scheduledRuns.onUpdated((runs) => {
      if (!cancelled) {
        setCount(runs.filter((run) => run.enabled).length);
      }
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsub();
    };
  }, []);

  return count;
}
