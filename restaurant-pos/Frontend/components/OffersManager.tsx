/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OffersManager — workspace entry for the Marketing module.
 *
 * The old 9-tab Offers/Marketing UI has been replaced by the redesigned
 * Marketing workspace (Home · Create · Recommendations · Offers · Promote ·
 * Analytics, with Automations/Segments/Loyalty moved to Settings).
 *
 * This component keeps the exact props App.tsx passes so the workspace
 * mount point is unchanged, and simply renders the new MarketingWorkspace.
 */

import React from 'react';
import type { LoyaltyReward, SystemSettings, Product } from '../src/types';
import MarketingWorkspace from './marketing/MarketingWorkspace';

interface OffersManagerProps {
  onBack?: () => void;
  rewards: LoyaltyReward[];
  onUpdateRewards: (updated: LoyaltyReward[]) => void;
  currencySymbol: string;
  settings?: SystemSettings;
  onUpdateSettings?: (updated: SystemSettings) => void;
  products?: Product[];
  branches?: { id: string; name: string; isActive?: boolean }[];
}

export default function OffersManager(props: OffersManagerProps) {
  return <MarketingWorkspace {...props} />;
}
