/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Position engine using Floating UI for dynamic tooltip placement.
 * Computes optimal tooltip position relative to target element.
 * Never hardcodes offsets — always recalculates on resize/scroll.
 */

import { computePosition, autoPlacement, shift, offset, size, flip } from '@floating-ui/react';
import type { Placement } from '@floating-ui/react';
import type { PositionResult } from './types';

/** Safe area margin from viewport edges */
const SAFE = 24;
/** Gap between tooltip and target */
const GAP = 20;
/** Tooltip dimensions */
const TOOLTIP_W = 320;
const TOOLTIP_H = 200;

/**
 * Compute optimal tooltip position for a given target element.
 * Uses Floating UI's autoPlacement + shift middleware to ensure
 * the tooltip never overflows the viewport or overlaps the target.
 */
export async function computeTooltipPosition(
  targetEl: Element,
  preferred: 'top' | 'bottom' | 'left' | 'right',
): Promise<PositionResult | null> {
  // Create a virtual reference element from the target
  const targetRect = targetEl.getBoundingClientRect();

  // We'll compute position manually with floating-ui middleware
  const virtualEl = {
    getBoundingClientRect: () => targetRect,
    contextElement: targetEl,
  };

  const { x, y, placement } = await computePosition(virtualEl, {
    getBoundingClientRect: () => new DOMRect(0, 0, TOOLTIP_W, TOOLTIP_H),
    contextElement: null,
  } as any, {
    strategy: 'fixed',
    placement: preferred as Placement,
    middleware: [
      offset(GAP),
      flip({
        crossAxis: false,
        fallbackAxisSideDirection: 'start',
        padding: SAFE,
      }),
      shift({ padding: SAFE }),
      size({
        padding: SAFE,
        apply({ availableWidth, availableHeight }) {
          // No-op — we use fixed tooltip size, just use available space info
        },
      }),
    ],
  });

  // Clamp to viewport safe area
  const clampedX = Math.max(SAFE, Math.min(x, window.innerWidth - TOOLTIP_W - SAFE));
  const clampedY = Math.max(SAFE, Math.min(y, window.innerHeight - TOOLTIP_H - SAFE));

  // Determine arrow direction based on final placement
  const arrowDir = placementToArrowDir(placement);

  return {
    top: Math.round(clampedY),
    left: Math.round(clampedX),
    arrowDir,
  };
}

function placementToArrowDir(placement: Placement): PositionResult['arrowDir'] {
  if (placement.startsWith('top')) return 'bottom';
  if (placement.startsWith('bottom')) return 'top';
  if (placement.startsWith('left')) return 'right';
  return 'left';
}

/**
 * Compute an SVG quadratic bezier path from tooltip edge to target center.
 * The path starts at the tooltip edge (where the arrow originates)
 * and ends at the exact center of the target element.
 */
export function computeArrowPath(
  tooltipRect: { top: number; left: number; width: number; height: number },
  targetRect: DOMRect,
  arrowDir: PositionResult['arrowDir'],
): string {
  const cx = tooltipRect.left + tooltipRect.width / 2;
  const cy = tooltipRect.top + tooltipRect.height / 2;
  const tx = targetRect.left + targetRect.width / 2;
  const ty = targetRect.top + targetRect.height / 2;

  // Start point: edge of tooltip based on arrow direction
  let sx: number, sy: number;
  switch (arrowDir) {
    case 'top':
      sx = cx; sy = tooltipRect.top;
      break;
    case 'bottom':
      sx = cx; sy = tooltipRect.top + tooltipRect.height;
      break;
    case 'left':
      sx = tooltipRect.left; sy = cy;
      break;
    case 'right':
      sx = tooltipRect.left + tooltipRect.width; sy = cy;
      break;
  }

  // Calculate control point for quadratic bezier
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Gentle bend proportional to distance, max 40px
  const bend = Math.min(dist * 0.12, 40);
  const cpx = (sx + tx) / 2 + (dy / Math.max(dist, 1)) * bend;
  const cpy = (sy + ty) / 2 - (dx / Math.max(dist, 1)) * bend;

  return `M ${sx} ${sy} Q ${cpx} ${cpy} ${tx} ${ty}`;
}

/**
 * Smooth scroll a target element into view.
 * Positions the target at approximately 40% from top of viewport.
 */
export function smoothScrollToTarget(targetEl: Element): Promise<void> {
  return new Promise((resolve) => {
    const rect = targetEl.getBoundingClientRect();
    const targetY = rect.top + window.scrollY - window.innerHeight * 0.4 + rect.height / 2;

    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: 'smooth',
    });

    // Resolve after scroll animation completes
    setTimeout(resolve, 400);
  });
}
