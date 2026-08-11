import { useEffect, useRef } from 'react';

/**
 * useAutoLock — locks the POS terminal after a configurable period of idle
 * activity. Any pointer/keyboard interaction resets the idle timer. On timeout
 * `onLock()` is invoked so the UI can require the configured sign-in method to
 * resume. Set `minutes` to 0 (or a falsy value) to disable auto-lock entirely.
 */
export function useAutoLock(minutes: number | null | undefined, onLock: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minutesRef = useRef(minutes);
  const onLockRef = useRef(onLock);
  minutesRef.current = minutes;
  onLockRef.current = onLock;

  useEffect(() => {
    const enabledMinutes = minutesRef.current;
    if (!enabledMinutes || enabledMinutes <= 0) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onLockRef.current(), enabledMinutes * 60 * 1000);
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();

    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}