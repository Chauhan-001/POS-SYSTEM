/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DemoEngine — the main tour orchestrator.
 *
 * State machine for each step:
 *   IDLE → SCROLL → POINTER_MOVE → HIGHLIGHT → TOOLTIP → ARROW_DRAW → WAITING → CLICK → EXIT
 *
 * Every step sequence is:
 *   1. Run autoAction (if any)
 *   2. Smooth scroll to target
 *   3. Animate pointer to target center (bezier, overshoot, click)
 *   4. Show highlight glow
 *   5. Show tooltip
 *   6. Draw arrow from tooltip to target
 *   7. Wait for user input (Next / Prev / Close)
 *   8. Exit animation
 *   9. Move to next step
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import TourHighlight from './TourHighlight';
import TourArrow from './TourArrow';
import TourPointer from './TourPointer';
import TourTooltip from './TourTooltip';
import { computeTooltipPosition, computeArrowPath, smoothScrollToTarget } from './PositionEngine';
import { timing } from './AnimationManager';
import type { TourStep, TourActions, PositionResult } from './types';

interface DemoEngineProps {
  steps: TourStep[];
  isOpen: boolean;
  tourActions: TourActions;
  onClose: () => void;
  onComplete?: () => void;
}

/** Wait utility */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry finding a DOM element */
async function waitForTarget(
  selector: string,
  retries = timing.maxTargetRetries,
  interval = timing.targetRetryInterval,
): Promise<Element | null> {
  for (let i = 0; i < retries; i++) {
    const el = document.querySelector(selector);
    if (el) return el;
    await delay(interval);
  }
  return null;
}

const DemoEngine: React.FC<DemoEngineProps> = ({
  steps,
  isOpen,
  tourActions,
  onClose,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<PositionResult | null>(null);
  const [arrowPath, setArrowPath] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [uiReady, setUiReady] = useState(false);

  const cancelledRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  /** Guard against rapid-fire navigation clicks */
  const transitionLockRef = useRef(false);
  /** Pending timeout IDs for cleanup */
  const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const currentStep: TourStep = steps[currentStepIndex] || steps[0];
  const isCentered = !currentStep.target;
  const totalSteps = steps.length;

  // ─── Step execution ───

  useEffect(() => {
    if (!isOpen) return;

    // If index isn't 0 on open, it's stale from a prior tour session.
    // Reset and bail — the re-render will trigger the correct step.
    if (currentStepIndex !== 0) {
      setCurrentStepIndex(0);
      return;
    }

    cancelledRef.current = false;
    setIsRunning(true);
    setTargetRect(null);
    setTooltipPosition(null);
    setArrowPath('');
    setUiReady(false);

    const runStep = async () => {
      const step = currentStep;

      // 1. Run auto-action (navigate, create order, etc.)
      if (step.autoAction) {
        try {
          await step.autoAction(tourActions);
        } catch {
          // silent
        }
        if (cancelledRef.current) { setIsRunning(false); return; }
        await delay(timing.reactCommit);
      }

      // Centered step (welcome / done) — no target needed
      if (isCentered) {
        await delay(timing.domRender);
        setUiReady(true);
        setIsRunning(false);
        return;
      }

      // 2. Find target element
      const targetEl = await waitForTarget(step.target);
      if (cancelledRef.current) {
        setIsRunning(false);
        return;
      }
      if (!targetEl) {
        // Target not found — skip this step instead of showing empty state
        setIsRunning(false);
        return;
      }

      // 3. Smooth scroll to target (40% from top)
      await smoothScrollToTarget(targetEl);
      if (cancelledRef.current) { setIsRunning(false); return; }
      await delay(timing.domRender);

      // 4. Compute tooltip position using Floating UI
      const pos = await computeTooltipPosition(targetEl, step.placement);
      if (cancelledRef.current) { setIsRunning(false); return; }

      // 5. Set target rect + position (triggers pointer + highlight + tooltip)
      const rect = targetEl.getBoundingClientRect();
      setTargetRect(rect);
      setTooltipPosition(pos);

      // 6. Wait for pointer to travel
      await delay(timing.pointerTravel + timing.clickDuration);

      // 7. Compute and draw arrow
      if (pos && tooltipRef.current) {
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const arrow = computeArrowPath(
          {
            top: tooltipRect.top,
            left: tooltipRect.left,
            width: tooltipRect.width,
            height: tooltipRect.height,
          },
          rect,
          pos.arrowDir,
        );
        setArrowPath(arrow);
      }

      // 8. Step is ready for user interaction
      setIsRunning(false);
      setUiReady(true);
    };

    runStep();

    // Cleanup
    return () => {
      cancelledRef.current = true;
    };
  }, [currentStepIndex, isOpen]);

  // ─── Navigation (with rapid-click guard + timeout cleanup) ───

  const scheduleTransition = useCallback((direction: 1 | -1) => {
    // Rapid-click guard: skip if a transition is already scheduled
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;

    cancelledRef.current = true;
    setUiReady(false);

    const id = setTimeout(() => {
      transitionLockRef.current = false;
      setCurrentStepIndex((s) => s + direction);
    }, 150);
    pendingTimeoutsRef.current.push(id);
  }, []);

  const goNext = useCallback(() => {
    if (currentStepIndex >= totalSteps - 1) return;
    scheduleTransition(1);
  }, [currentStepIndex, totalSteps, scheduleTransition]);

  const goPrev = useCallback(() => {
    if (currentStepIndex <= 0) return;
    scheduleTransition(-1);
  }, [currentStepIndex, scheduleTransition]);

  const handleClose = useCallback(() => {
    cancelledRef.current = true;
    transitionLockRef.current = true;
    setUiReady(false);
    // Clear any pending transitions
    pendingTimeoutsRef.current.forEach(clearTimeout);
    pendingTimeoutsRef.current = [];
    tourActions.onTourEnd().then(() => onClose()).catch(() => onClose());
  }, [tourActions, onClose]);

  // ─── Keyboard shortcuts (debounced to prevent key-repeat floods) ───

  useEffect(() => {
    if (!isOpen) return;
    let lastKeyTime = 0;
    const KEY_DEBOUNCE_MS = 300;
    const handler = (e: KeyboardEvent) => {
      // Debounce: ignore key-repeat events within debounce window
      const now = Date.now();
      if (now - lastKeyTime < KEY_DEBOUNCE_MS) return;
      lastKeyTime = now;
      if (e.key === 'ArrowRight' || e.key === 'Enter') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, goNext, goPrev, handleClose]);

  // ─── Cleanup pending timeouts on unmount ───

  useEffect(() => {
    return () => {
      pendingTimeoutsRef.current.forEach(clearTimeout);
      pendingTimeoutsRef.current = [];
    };
  }, []);

  // ─── Recalculate on resize/scroll ───

  useEffect(() => {
    if (!isOpen || isCentered || !targetRect || !tooltipPosition) return;

    const recalculate = async () => {
      if (cancelledRef.current || transitionLockRef.current) return;
      const targetEl = document.querySelector(currentStep.target);
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      setTargetRect(rect);
      const pos = await computeTooltipPosition(targetEl, currentStep.placement);
      if (pos) {
        setTooltipPosition(pos);
        // Re-draw arrow
        if (tooltipRef.current) {
          const tRect = tooltipRef.current.getBoundingClientRect();
          setArrowPath(computeArrowPath(
            { top: tRect.top, left: tRect.left, width: tRect.width, height: tRect.height },
            rect,
            pos.arrowDir,
          ));
        }
      }
    };

    window.addEventListener('resize', recalculate);
    window.addEventListener('scroll', recalculate, true);
    return () => {
      window.removeEventListener('resize', recalculate);
      window.removeEventListener('scroll', recalculate, true);
    };
  }, [isOpen, isCentered, targetRect, tooltipPosition, currentStep.target, currentStep.placement]);

  // ─── Tooltip style ───

  const cardStyle: React.CSSProperties = isCentered
    ? { top: '50%', left: '50%', transform: 'translate(-50%, -55%)' }
    : tooltipPosition
      ? { top: tooltipPosition.top, left: tooltipPosition.left }
      : { opacity: 0, pointerEvents: 'none' };

  // ─── Render ───

  if (!isOpen) return null;

  return (
    <div
      data-testid="tour-container"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9890,
        pointerEvents: 'none',
      }}
    >
      {/* Backdrop click-to-close */}
      <div
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'auto',
          cursor: 'default',
        }}
      />

      {/* Pointer — visible as soon as targetRect is set, not when uiReady */}
      {!isCentered && (
        <TourPointer
          targetRect={targetRect}
          stepKey={currentStepIndex}
          color={currentStep.color}
          visible={!isCentered && !!targetRect}
        />
      )}

      {/* Highlight overlay */}
      <TourHighlight
        targetRect={!isCentered ? targetRect : null}
        color={currentStep.color}
        visible={!isCentered && !!targetRect && uiReady}
      />

      {/* Arrow */}
      <TourArrow
        path={arrowPath}
        color={currentStep.color}
        visible={!isCentered && !!arrowPath}
      />

      {/* Tooltip card */}
      <AnimatePresence mode="wait">
        {uiReady && (
          <div ref={tooltipRef} key={`tooltip-${currentStepIndex}`}>
            <TourTooltip
              step={currentStep}
              currentIndex={currentStepIndex}
              total={totalSteps}
              isRunning={isRunning}
              arrowDir={
                isCentered
                  ? 'top'
                  : ({
                      top: 'bottom',
                      bottom: 'top',
                      left: 'right',
                      right: 'left',
                    }[tooltipPosition?.arrowDir ?? 'top'] as 'top' | 'bottom' | 'left' | 'right')
              }
              style={cardStyle}
              onNext={goNext}
              onPrev={goPrev}
              onClose={handleClose}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DemoEngine;
