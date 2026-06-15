/**
 * Hook: rolling completion tok/s for live composer + timeline surfaces.
 *
 * Samples on an interval while `active` and whenever the completion
 * count changes. Clears state when the run ends or tokens regress
 * (new turn boundary).
 */

import { useEffect, useRef, useState } from 'react';
import {
  LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS,
  appendTokenRateSample,
  computeRollingTokenRate,
  type TokenRateSample
} from './liveTokenRate.js';

export function useLiveTokenRate(
  active: boolean,
  completionTokens: number
): number | null {
  const samplesRef = useRef<TokenRateSample[]>([]);
  const lastTokensRef = useRef(completionTokens);
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      samplesRef.current = [];
      lastTokensRef.current = 0;
      setRate(null);
      return;
    }

    if (completionTokens < lastTokensRef.current) {
      samplesRef.current = [];
    }
    lastTokensRef.current = completionTokens;

    const record = (ts: number): void => {
      samplesRef.current = appendTokenRateSample(
        samplesRef.current,
        ts,
        completionTokens
      );
      const next = computeRollingTokenRate(samplesRef.current, ts);
      setRate((prev) => (prev === next ? prev : next));
    };

    record(Date.now());
    const id = window.setInterval(() => record(Date.now()), LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, completionTokens]);

  return rate;
}
