/**
 * Returns `value` at most once per `ms` while `value` changes rapidly
 * (streaming markdown / highlight passes). Pass `ms={0}` to disable.
 */

import { useEffect, useRef, useState } from 'react';

export function useThrottledValue<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const latestRef = useRef(value);

  useEffect(() => {
    latestRef.current = value;
    if (ms <= 0) {
      setThrottled(value);
      return;
    }
    const timer = setTimeout(() => {
      setThrottled(latestRef.current);
    }, ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  if (ms <= 0) return value;
  return throttled;
}
