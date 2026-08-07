/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TourArrow — renders an animated SVG bezier curve from the tooltip edge
 * to the exact center of the highlighted target element.
 *
 * Arrow:
 * - 2px stroke, rounded cap
 * - Animated draw-in (pathLength)
 * - Subtle glow filter
 * - Arrowhead marker at target end
 * - Redraws whenever tooltip/target position changes
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { transitions } from './AnimationManager';

interface TourArrowProps {
  /** SVG path string (M... Q... ...) */
  path: string;
  /** Accent color */
  color: string;
  /** Whether the arrow is visible */
  visible: boolean;
}

const TourArrow: React.FC<TourArrowProps> = React.memo(({ path, color, visible }) => {
  const pathRef = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);

  useEffect(() => {
    if (pathRef.current) {
      setLength(pathRef.current.getTotalLength());
    }
  }, [path]);

  if (!visible || !path || !length) return null;

  const markerId = `tour-arrowhead-${color.replace('#', '')}`;
  const glowId = `tour-glow-${color.replace('#', '')}`;

  return (
    <svg
      data-testid="tour-arrow"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9995,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <defs>
        <filter id={glowId}>
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 Z" fill={color} />
        </marker>
      </defs>
      <motion.path
        ref={pathRef}
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
        filter={`url(#${glowId})`}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={transitions.arrowDraw}
        style={{ opacity: 0.75 }}
      />
    </svg>
  );
});

TourArrow.displayName = 'TourArrow';

export default TourArrow;
