'use client';

import { useEffect, useRef, useState } from 'react';

export function usePausedGameClock(isPaused: boolean) {
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const secondsElapsedRef = useRef(0);

  useEffect(() => {
    if (isPaused) return;
    const timer = window.setTimeout(() => {
      secondsElapsedRef.current += 1;
      setSecondsElapsed(secondsElapsedRef.current);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isPaused, secondsElapsed]);

  return { secondsElapsed, secondsElapsedRef };
}
