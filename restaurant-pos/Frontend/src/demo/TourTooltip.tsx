/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TourTooltip — the step card shown to the user.
 * - Fixed size: 260-340px wide, auto height
 * - 24px padding inside
 * - 18px rounded corners
 * - Soft shadow
 * - Progress bar at bottom
 * - Navigation: Back / Next (or Done)
 * - Close button (X) top right
 * - CSS arrow pointing to target
 *
 * Animation: entrance (scale + opacity), exit (scale + opacity)
 * Only uses transform and opacity.
 */

import React from 'react';
import { motion } from 'motion/react';
import type { TourStep } from './types';

interface TourTooltipProps {
  step: TourStep;
  currentIndex: number;
  total: number;
  isRunning: boolean;
  arrowDir: 'top' | 'bottom' | 'left' | 'right';
  style: React.CSSProperties;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/** CSS triangle arrow */
const ArrowTriangle: React.FC<{ dir: 'top' | 'bottom' | 'left' | 'right' }> = React.memo(({ dir }) => {
  const size = 10;
  const positions: Record<string, React.CSSProperties> = {
    top: {
      bottom: -size + 1,
      left: '50%',
      marginLeft: -size,
      borderLeft: `${size}px solid transparent`,
      borderRight: `${size}px solid transparent`,
      borderTop: `${size}px solid white`,
    },
    bottom: {
      top: -size + 1,
      left: '50%',
      marginLeft: -size,
      borderLeft: `${size}px solid transparent`,
      borderRight: `${size}px solid transparent`,
      borderBottom: `${size}px solid white`,
    },
    left: {
      right: -size + 1,
      top: '50%',
      marginTop: -size,
      borderTop: `${size}px solid transparent`,
      borderBottom: `${size}px solid transparent`,
      borderLeft: `${size}px solid white`,
    },
    right: {
      left: -size + 1,
      top: '50%',
      marginTop: -size,
      borderTop: `${size}px solid transparent`,
      borderBottom: `${size}px solid transparent`,
      borderRight: `${size}px solid white`,
    },
  };

  return (
    <div
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))',
        ...positions[dir],
      }}
    />
  );
});

ArrowTriangle.displayName = 'ArrowTriangle';

const TourTooltip: React.FC<TourTooltipProps> = React.memo(({
  step, currentIndex, total, isRunning,
  arrowDir, style, onNext, onPrev, onClose,
}) => {
  const progress = total > 1 ? (currentIndex / (total - 1)) * 100 : 0;
  const isLast = currentIndex >= total - 1;

  return (
    <motion.div
      data-testid="tour-tooltip"
      style={{
        position: 'fixed',
        zIndex: 9999,
        width: 320,
        background: 'white',
        borderRadius: 20,
        boxShadow: '0 4px 12px -2px rgba(0,0,0,0.08), 0 12px 32px -8px rgba(0,0,0,0.12), 0 32px 64px -12px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        pointerEvents: 'auto',
        ...style,
      }}
      initial={{ opacity: 0, scale: 0.92, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -6 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Pointer arrow */}
      <ArrowTriangle dir={arrowDir} />

      {/* Content */}
      <div style={{ padding: 24 }}>
        {/* Header row: icon + step indicator + close */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Icon container */}
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `${step.color}14`,
              }}
            >
              <span style={{ fontSize: 17, lineHeight: 1 }}>{step.icon}</span>
            </div>
            {/* Step counter */}
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#999',
              letterSpacing: '0.04em',
            }}>
              {currentIndex + 1} / {total}
            </span>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#b0b0b0',
              fontSize: 15,
              lineHeight: 1,
              transition: 'all 0.15s ease',
            }}
            className="tour-close-btn"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#f2f2f2';
              (e.currentTarget as HTMLButtonElement).style.color = '#666';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = '#b0b0b0';
            }}
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <h3 style={{
          fontSize: 20,
          fontWeight: 650,
          lineHeight: 1.3,
          color: '#18181b',
          margin: '0 0 4px',
          letterSpacing: '-0.01em',
        }}>
          {step.title}
        </h3>

        {/* Instruction (bold, colored) */}
        <p style={{
          fontSize: 13.5,
          fontWeight: 600,
          lineHeight: 1.5,
          color: step.color,
          margin: '0 0 8px',
        }}>
          {step.instruction}
        </p>

        {/* Detail */}
        <p style={{
          fontSize: 13.5,
          lineHeight: 1.6,
          color: '#5a5a5e',
          margin: 0,
        }}>
          {step.detail}
        </p>

        {/* Footer: nav buttons */}
        <div style={{
          marginTop: 20,
          paddingTop: 14,
          borderTop: '1px solid #eeeef0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* Back */}
          <button
            onClick={onPrev}
            disabled={currentIndex === 0}
            style={{
              padding: '9px 14px',
              borderRadius: 11,
              border: '1px solid',
              borderColor: currentIndex === 0 ? '#eee' : '#e4e4e7',
              background: currentIndex === 0 ? '#f8f8f8' : 'white',
              color: currentIndex === 0 ? '#ccc' : '#444',
              fontSize: 12.5,
              fontWeight: 550,
              cursor: currentIndex === 0 ? 'default' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Back
          </button>

          {/* Next / Done */}
          {!isLast ? (
            <button
              onClick={onNext}
              disabled={isRunning}
              style={{
                padding: '9px 20px',
                borderRadius: 11,
                border: 'none',
                background: step.color,
                color: 'white',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: isRunning ? 'default' : 'pointer',
                opacity: isRunning ? 0.65 : 1,
                transition: 'opacity 0.15s ease',
              }}
            >
              {isRunning ? 'Processing...' : 'Next'}
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{
                padding: '9px 22px',
                borderRadius: 11,
                border: 'none',
                background: step.color,
                color: 'white',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
            >
              Done
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#f0f0f2' }}>
        <motion.div
          style={{
            height: '100%',
            background: step.color,
            borderRadius: '0 2px 2px 0',
          }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </motion.div>
  );
});

TourTooltip.displayName = 'TourTooltip';

export default TourTooltip;
