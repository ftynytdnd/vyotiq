import { useEffect, useState } from 'react';

/** Wall-clock elapsed ms from `startedAt`, refreshed while `active`. */
export function useLiveElapsedMs(startedAt: number | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startedAt === undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  if (startedAt === undefined) return 0;
  return Math.max(0, now - startedAt);
}

export function formatLiveElapsedMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
