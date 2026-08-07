/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight clock hook — provides the current Date, updated every second.
 * Use this in individual components instead of plumbing currentTime through
 * global state, which causes the entire component tree to re-render every second.
 */

import { useState, useEffect } from 'react';

export function useCurrentTime(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}
