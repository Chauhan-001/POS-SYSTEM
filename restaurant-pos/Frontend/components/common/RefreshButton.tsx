/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RefreshButton — one consistent refresh control for every workspace.
 *
 * - Shows a small spin animation while refreshing. The spin lasts exactly as
 *   long as `onRefresh`'s promise — no fake minimum duration, so the button
 *   is honest about how long the work actually takes.
 * - Disabled while spinning, so rapid clicks can't fire duplicate refreshes.
 * - Promise contract: `onRefresh` MUST return a promise. In dev, a console
 *   warning is emitted when it doesn't, so callers that fire-and-forget
 *   (void handlers) surface immediately instead of silently faking a spin.
 * - Optional `busy` prop for callers that already track real loading state
 *   (e.g. an AI analysis that runs in an effect after a key bump) — the
 *   button stays spinning/disabled until that external flag clears.
 *
 * Accessibility:
 * - `aria-busy` is set while refreshing so screen readers announce activity.
 * - The spinner respects `prefers-reduced-motion` (motion-reduce:animate-none)
 *   — users who opt out of motion still get the disabled + dimmed affordance.
 *
 * Callers supply their own layout/color classes; the base keeps only the
 * pointer + disabled affordances so existing styles are preserved.
 */

import React, { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface RefreshButtonProps {
  /** Action to run on click. MUST return a promise — the spin lasts until it settles. */
  onRefresh?: () => void | Promise<unknown>;
  /** External loading state — forces the spin + disabled while true. */
  busy?: boolean;
  /** useAsyncData state — thin-shell integration: drives both busy and refresh
   *  from the hook, so the button owns no loading state of its own. */
  asyncData?: { refresh: () => Promise<unknown>; loading: boolean };
  /** Tooltip / aria-label when the button has no text label. */
  title?: string;
  /** Button classes (padding, colors, layout). Default: none. */
  className?: string;
  /** Icon size class. */
  iconClassName?: string;
  /** Optional label rendered after the icon. */
  children?: React.ReactNode;
  disabled?: boolean;
}

export default function RefreshButton({
  onRefresh,
  busy = false,
  asyncData,
  title = 'Refresh',
  className = '',
  iconClassName = 'w-3.5 h-3.5',
  children,
  disabled = false,
}: RefreshButtonProps) {
  const [spinning, setSpinning] = useState(false);

  // Thin-shell integration: when the caller supplies useAsyncData state, the
  // button is driven entirely by the hook (loading → busy, refresh → action).
  const handle = asyncData ? asyncData.refresh : onRefresh;
  const active = (asyncData ? asyncData.loading : busy) || spinning;

  const handleClick = useCallback(() => {
    if (!handle || active) return;
    setSpinning(true);
    let result: unknown;
    try {
      result = handle();
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[RefreshButton] onRefresh threw synchronously:', err);
      setSpinning(false);
      return;
    }
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') {
      // Contract violation: the handler fired-and-forgot, so the button can't
      // track completion. Surface it in dev instead of silently faking a spin.
      if (import.meta.env.DEV) {
        console.warn(
          '[RefreshButton] onRefresh must return a Promise so the button can track completion:',
          handle,
        );
      }
      setSpinning(false);
      return;
    }
    Promise.resolve(result)
      .then(() => setSpinning(false))
      .catch(() => setSpinning(false));
  }, [handle, active]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || active}
      title={title}
      aria-label={typeof children === 'string' && children.trim() ? undefined : title}
      aria-busy={active}
      className={`cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-all ${className}`}
    >
      <RefreshCw className={`${iconClassName} ${active ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      {children}
    </button>
  );
}
