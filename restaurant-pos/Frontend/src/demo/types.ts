/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared types for the guided tour system.
 */

import type React from 'react';

export interface TourActions {
  navigateTo: (ws: string) => Promise<void>;
  createDineInOrder: () => Promise<void>;
  addProductById: (id: string) => Promise<void>;
  addFirstProducts: () => Promise<void>;
  setCustomerPhone: (phone: string) => Promise<void>;
  openOffersPopup: () => Promise<void>;
  closeOffersPopup: () => Promise<void>;
  openKOTPreview: () => Promise<void>;
  confirmKOT: () => Promise<void>;
  closeKOTModal: () => Promise<void>;
  holdOrder: () => Promise<void>;
  recallOrder: () => Promise<void>;
  openPayment: () => Promise<void>;
  closePayment: () => Promise<void>;
  closeAllModals: () => Promise<void>;
  toggleMoreBilling: () => Promise<void>;
  openHeldDrawer: () => Promise<void>;
  closeHeldDrawer: () => Promise<void>;
  onTourEnd: () => Promise<void>;
}

export interface TourStep {
  /** Step icon */
  icon: React.ReactNode;
  /** Step title (max 2 words) */
  title: string;
  /** Short 1-line instruction */
  instruction: string;
  /** Detail explanation (1-2 sentences) */
  detail: string;
  /** Accent color */
  color: string;
  /** Auto-actions to run before showing tooltip */
  autoAction?: (actions: TourActions) => Promise<void>;
  /** CSS selector to highlight */
  target: string;
  /** Preferred placement hint */
  placement: 'top' | 'bottom' | 'left' | 'right';
}

export interface PositionResult {
  /** Tooltip position */
  top: number;
  left: number;
  /** Arrow direction (which side of tooltip the arrow comes from) */
  arrowDir: 'top' | 'bottom' | 'left' | 'right';
}

export interface PointerPath {
  /** Start X */
  sx: number;
  /** Start Y */
  sy: number;
  /** End X (target center) */
  ex: number;
  /** End Y (target center) */
  ey: number;
}
