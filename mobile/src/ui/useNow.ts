import { useEffect, useState } from 'react';

/** The time now, read again every `everyMs`, so a countdown or a row's "Now" moves on by itself. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
