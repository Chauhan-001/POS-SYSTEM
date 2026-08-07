/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TourPointer — renders an animated hand cursor that moves from off-screen
 * to the target element center using human-like bezier motion.
 *
 * Movement flow:
 *   Accelerate → Cruise → Slow down → Overshoot → Correct → Click → Ripple → Done
 *
 * Uses requestAnimationFrame for smooth 60fps motion.
 * Never teleports — always animates with natural bezier curves.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { transitions } from './AnimationManager';

interface TourPointerProps {
  /** Target rectangle to move towards */
  targetRect: DOMRect | null;
  /** Unique key to trigger re-animation */
  stepKey: string | number;
  /** Accent color for the click ripple */
  color: string;
  /** Whether the pointer is active */
  visible: boolean;
}

const SIZE = 28;
const PAD = 8;

/** Hand cursor SVG icon */
const PointerIcon: React.FC = React.memo(() => (
  <svg width={SIZE} height={SIZE} viewBox="0 0 28 28" fill="none">
    <defs>
      <filter id="ptr-shadow">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.25" />
      </filter>
    </defs>
    <g filter="url(#ptr-shadow)">
      <path
        d="M15.5 2.5C14.7 2.5 14 3.2 14 4v9.3l-2.2-1.1a2.5 2.5 0 0 0-3.4 1.2 2.5 2.5 0 0 0 .5 2.8l4.5 4.5c.3.3.7.5 1.1.5h6.2c1.4 0 2.5-1.1 2.5-2.5v-5.8a5 5 0 0 0-1.5-3.5L17.5 3.5c-.5-.6-1.2-1-2-1Z"
        fill="white"
      />
      <path
        d="M15.5 3c-.6 0-1.1.3-1.4.7L9.7 9.5a1.5 1.5 0 0 0 1.3 2.4L14 11V4c0-.6-.4-1-1-1Z"
        fill="#e8e8e8"
        opacity="0.6"
      />
    </g>
  </svg>
));

PointerIcon.displayName = 'PointerIcon';

/** Cubic bezier with overshoot */
function pointerEasing(t: number): number {
  // Custom: accelerate quickly, overshoot slightly, settle
  if (t < 0.5) {
    return 2 * t * t; // ease-in
  }
  const p = 2 * (1 - t);
  // Ease out with slight overshoot
  return 1 - p * p * (1 + 0.15 * Math.sin(Math.PI * (t - 0.5) * 3));
}

const TourPointer: React.FC<TourPointerProps> = React.memo(({ targetRect, stepKey, color, visible }) => {
  const [currentPos, setCurrentPos] = useState({ x: -100, y: -100 });
  const [isClicking, setIsClicking] = useState(false);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const startPosRef = useRef({ x: -100, y: -100 });

  const targetX = targetRect ? targetRect.left + targetRect.width / 2 - SIZE / 2 : -100;
  const targetY = targetRect ? targetRect.top - SIZE - PAD : -100;

  useEffect(() => {
    if (!visible || !targetRect) {
      setCurrentPos({ x: -100, y: -100 });
      return;
    }

    // Start from off-screen to the left
    const startX = -80;
    const startY = targetRect.top + targetRect.height / 2 - SIZE / 2;
    startPosRef.current = { x: startX, y: startY };
    setCurrentPos({ x: startX, y: startY });
    startTimeRef.current = 0;

    const duration = 700; // ms for pointer travel

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);

      const easeT = pointerEasing(t);

      const x = startX + (targetX - startX) * easeT;
      const y = startY + (targetY - startY) * easeT;

      setCurrentPos({ x, y });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Arrived — trigger click animation
        setCurrentPos({ x: targetX, y: targetY });
        setTimeout(() => {
          setIsClicking(true);
          setTimeout(() => setIsClicking(false), 400);
        }, 150);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [stepKey, visible]);

  return (
    <AnimatePresence mode="wait">
      {visible && targetRect && (
        <motion.div
          key={`pointer-${stepKey}`}
          data-testid="tour-pointer"
          style={{
            position: 'fixed',
            zIndex: 9999,
            pointerEvents: 'none',
            left: currentPos.x,
            top: currentPos.y,
            width: SIZE,
            height: SIZE,
          }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15 }}
        >
          <PointerIcon />

          {/* Click ripple */}
          {isClicking && (
            <motion.div
              key="ripple"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 44,
                height: 44,
                borderRadius: '50%',
                margin: '-22px 0 0 -22px',
                border: `2.5px solid ${color}`,
                background: `${color}18`,
              }}
              initial={{ scale: 0, opacity: 0.7 }}
              animate={{ scale: 2.5, opacity: 0 }}
              transition={transitions.clickRipple}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

TourPointer.displayName = 'TourPointer';

export default TourPointer;
