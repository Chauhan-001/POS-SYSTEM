/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TourHighlight — renders a semi-transparent overlay over the entire viewport
 * with a "cutout" highlight around the target element. The target receives
 * a soft glow ring with a subtle breathing animation.
 *
 * Only uses transform, opacity, and scale — never layout-triggering props.
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { transitions } from './AnimationManager';

interface TourHighlightProps {
  /** Bounding rect of the target element */
  targetRect: DOMRect | null;
  /** Accent color for the glow ring */
  color: string;
  /** Whether the highlight is visible */
  visible: boolean;
}

/** Extra padding around the target for the highlight ring */
const PAD = 10;

const TourHighlight: React.FC<TourHighlightProps> = React.memo(({ targetRect, color, visible }) => {
  return (
    <AnimatePresence>
      {visible && targetRect && (
        <motion.div
          key="tour-backdrop"
          data-testid="tour-highlight"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9990,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.06)', // subtle 6% dim — not heavy blur
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transitions.overlay}
        >
          {/* Cutout — creates clear area around target using box-shadow trick */}
          <motion.div
            key="tour-cutout"
            style={{
              position: 'absolute',
              top: targetRect.top - PAD,
              left: targetRect.left - PAD,
              width: targetRect.width + PAD * 2,
              height: targetRect.height + PAD * 2,
              borderRadius: 16,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.06)',
            }}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={transitions.tooltipEnter}
          >
            {/* Inner glow ring */}
            <motion.div
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: 18,
                border: '2.5px solid',
                borderColor: color,
                boxShadow: `0 0 0 4px ${color}18, 0 0 24px ${color}15`,
              }}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
            >
              {/* Outer breathing ring */}
              <motion.div
                style={{
                  position: 'absolute',
                  inset: -5,
                  borderRadius: 22,
                  border: '1.5px solid',
                  borderColor: color,
                  opacity: 0.35,
                }}
                animate={{ scale: [1, 1.04, 1], opacity: [0.35, 0.1, 0.35] }}
                transition={transitions.highlightPulse}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

TourHighlight.displayName = 'TourHighlight';

export default TourHighlight;
