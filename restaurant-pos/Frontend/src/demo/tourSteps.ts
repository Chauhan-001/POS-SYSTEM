/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tour step definitions.
 * Each step has: 1-line title, 1-line instruction, 2-sentence detail max.
 * Text is simple, restaurant-owner friendly. No technical jargon.
 */

import React from 'react';
import type { TourStep } from './types';

const steps: TourStep[] = [
  // Step 0: Welcome (centered, no target)
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '👋'),
    title: 'Welcome!',
    instruction: 'Let\'s take a quick tour of your POS system.',
    detail: 'This is a practice run — nothing gets saved. You\'ll see the full flow: take an order, add items, check loyalty, send to kitchen, and accept payment.',
    color: '#2563eb',
    target: '',
    placement: 'bottom',
  },
  // Step 1: Pick a table
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '🪑'),
    title: 'Pick a Table',
    instruction: 'Start with a dine-in order.',
    detail: 'Your floor plan shows all tables. Green means available — tap one to begin. We\'ll seat a guest at Table 1.',
    color: '#059669',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.navigateTo('Orders');
    },
    target: '[data-tour="table-card"]',
    placement: 'bottom',
  },
  // Step 2: Add items
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '🛒'),
    title: 'Add Items',
    instruction: 'Tap any dish to add it to the bill.',
    detail: 'Menu items on the left. Just tap to add — the cart fills up on the right. Adjust quantities or remove items anytime.',
    color: '#7c3aed',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.createDineInOrder();
      await a.addFirstProducts();
    },
    target: '[data-tour="product-card"]',
    placement: 'right',
  },
  // Step 3: Find loyalty member
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '📱'),
    title: 'Find a Member',
    instruction: 'Type their phone number for instant rewards.',
    detail: 'Enter a 10-digit mobile — the system finds the customer, shows points, visits, and eligible rewards. Let\'s look up Aarav\'s profile.',
    color: '#0891b2',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.setCustomerPhone('9876543210');
    },
    target: '[data-tour="phone-input"]',
    placement: 'left',
  },
  // Step 4: Apply a reward
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '🎁'),
    title: 'Apply a Reward',
    instruction: 'Tap to apply the best reward for this customer.',
    detail: 'See available rewards? Points-based offers like Free Garlic Bread or ₹100 Off — tap to apply and the discount appears instantly.',
    color: '#d97706',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.openOffersPopup();
    },
    target: '[data-tour="offers-btn"]',
    placement: 'left',
  },
  // Step 5: Send to kitchen
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '👨‍🍳'),
    title: 'Send to Kitchen',
    instruction: 'Items go straight to the chef.',
    detail: 'A Kitchen Order Ticket (KOT) tells the chef what to cook. Preview the items, then confirm. No more handwritten chits!',
    color: '#ea580c',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.openKOTPreview();
      await a.confirmKOT();
      await a.closeKOTModal();
    },
    target: '[data-tour="kot-btn"]',
    placement: 'top',
  },
  // Step 6: Hold / pause an order
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '⏸️'),
    title: 'Pause an Order',
    instruction: 'Customer stepped away? Suspend the bill.',
    detail: 'Tap Hold to save everything — items, customer, and order type. Come back later and tap Recall to continue right where you left off.',
    color: '#9333ea',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.toggleMoreBilling();
    },
    target: '[data-tour="hold-btn"]',
    placement: 'left',
  },
  // Step 7: Complete payment
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '💳'),
    title: 'Complete Payment',
    instruction: 'Cash, UPI, Card, or Split — your choice.',
    detail: 'Select payment method, review the total, and tap Print & Pay. The receipt prints, loyalty points update, and today\'s sales refresh.',
    color: '#16a34a',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.holdOrder();
      await a.openHeldDrawer();
      await a.recallOrder();
      await a.openPayment();
    },
    target: '[data-tour="pay-btn"]',
    placement: 'top',
  },
  // Step 8: You're all set
  {
    icon: React.createElement('span', { style: { fontSize: 24 } }, '✅'),
    title: 'You\'re All Set!',
    instruction: 'That\'s the complete order flow in under a minute.',
    detail: 'Create Order → Add Items → Loyalty → Offers → Kitchen → Payment. You\'re ready to serve your first guest. All practice data has been cleaned up.',
    color: '#059669',
    autoAction: async (a) => {
      await a.closeAllModals();
      await a.navigateTo('Orders');
      await a.onTourEnd();
    },
    target: '',
    placement: 'bottom',
  },
];

export default steps;
