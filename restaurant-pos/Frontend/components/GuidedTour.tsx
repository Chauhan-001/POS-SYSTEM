/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GuidedTour — public wrapper component.
 * Same external API as the previous implementation (props, TourActions export)
 * so App.tsx requires no changes to imports or usage.
 *
 * Internally delegates to the new DemoEngine with the step definitions.
 */

import React from 'react';
import DemoEngine from '../src/demo/DemoEngine';
import steps from '../src/demo/tourSteps';
import type { TourActions } from '../src/demo/types';

export type { TourActions };

interface GuidedTourProps {
  isOpen: boolean;
  onClose: () => void;
  tourActions: TourActions;
}

const GuidedTour: React.FC<GuidedTourProps> = React.memo(({ isOpen, onClose, tourActions }) => {
  return (
    <DemoEngine
      steps={steps}
      isOpen={isOpen}
      tourActions={tourActions}
      onClose={onClose}
    />
  );
});

GuidedTour.displayName = 'GuidedTour';

export default GuidedTour;
