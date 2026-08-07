/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Loyalty hook — customer lookup, rewards, OTP, reward redemption
 * Data flow: local array search first (fast), then sync via API.
 *
 * Phase 1.6: Large-reward redemption now uses a REAL server-generated OTP
 * (POST /api/otp/request → /api/otp/verify). The server hashes the code,
 * enforces expiry/attempts/rate limits, and verifies single-use. The shared
 * otpVerificationState lives in usePOSState so the modal (rendered in App.tsx)
 * and this hook always read the same instance. When offline, the hook falls
 * back to a local simulated code so the POS never blocks at the till.
 */

import { useCallback } from 'react';
import type { Customer, LoyaltyReward, SystemSettings, Product, CartItem } from '../types';
import * as api from '../api/client';
import { debugWarn } from '../utils/debugLog';

interface OtpVerificationState {
  isOpen: boolean;
  code: string;
  typedCode: string;
  reward: LoyaltyReward | null;
  /** Phone the OTP was issued for (used for server-side verify). */
  phone?: string;
  /** Whether this OTP came from the server (verify against /api/otp). */
  isServerOtp?: boolean;
}

interface LoyaltyConfig {
  customers: Customer[];
  setCustomers: (c: Customer[]) => void;
  products: Product[];
  cartItems: CartItem[];
  setCartItems: (items: CartItem[]) => void;
  searchedCustomer: Customer | null;
  setSearchedCustomer: (c: Customer | null) => void;
  customerPhone: string;
  setCustomerPhone: (p: string) => void;
  appliedReward: LoyaltyReward | null;
  setAppliedReward: (r: LoyaltyReward | null) => void;
  rewards: LoyaltyReward[];
  settings: SystemSettings;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  /** Shared OTP modal state (owned by usePOSState — single source of truth). */
  otpVerificationState: OtpVerificationState;
  setOtpVerificationState: React.Dispatch<React.SetStateAction<OtpVerificationState>>;
}

export function useLoyalty(config: LoyaltyConfig) {
  const {
    customers, setCustomers,
    products, cartItems, setCartItems,
    searchedCustomer, setSearchedCustomer,
    customerPhone, setCustomerPhone,
    appliedReward, setAppliedReward,
    rewards, settings,
    showToast,
    otpVerificationState, setOtpVerificationState,
  } = config;

  const isProductMatchingReward = useCallback((productName: string, productId: string, rewardItemName?: string, rewardItemId?: string): boolean => {
    if (!rewardItemName && !rewardItemId) return false;
    if (rewardItemId && productId === rewardItemId) return true;
    if (rewardItemName) {
      const pName = productName.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      const rName = rewardItemName.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      if (pName === rName || pName.includes(rName) || rName.includes(pName)) return true;
    }
    return false;
  }, []);

  const findCustomerByPhone = useCallback((phone: string): { customer: Customer | null; isBlocked: boolean } => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) return { customer: null, isBlocked: false };
    const found = customers.find(c => c.phone === cleaned);
    if (found?.isBlocked) return { customer: found, isBlocked: true };
    return { customer: found || null, isBlocked: false };
  }, [customers]);

  const handleCustomerPhoneChange = useCallback((phoneVal: string) => {
    const cleaned = phoneVal.replace(/\D/g, '');
    setCustomerPhone(cleaned);
    if (cleaned.length === 10) {
      // 1. Search locally first for instant feedback
      const found = customers.find((c) => c.phone === cleaned);
      if (found) {
        if (found.isBlocked) {
          showToast(`⚠ Member ${found.name} is BLOCKED. Cannot apply loyalty or rewards.`, 'warning');
          setSearchedCustomer(null);
          setAppliedReward(null);
        } else {
          setSearchedCustomer(found);
          showToast(`Loyalty matched: ${found.name}`, 'success');
          const sortedRewards = [...rewards].sort((a, b) => b.pointsRequired - a.pointsRequired);
          const autoRecommend = sortedRewards.find(r => r.pointsRequired <= found.points);
          if (autoRecommend && !appliedReward) {
            showToast(`Recommended reward available: ${autoRecommend.title}`, 'info');
          }
        }
      } else {
        setSearchedCustomer(null);
        showToast('New guest detected. Tap Enroll in sidebar or proceed as guest.', 'info');
      }

      // 2. BACKEND CALLED — also search API for this phone (may have fresher data)
      api.fetchCustomers({ phone: cleaned }).then(apiCustomers => {
        if (apiCustomers && Array.isArray(apiCustomers) && apiCustomers.length > 0) {
          const apiFound = apiCustomers[0] as Customer;
          // Only update if local didn't find or if API data differs
          const localFound = customers.find(c => c.phone === cleaned);
          if (!localFound || localFound.points !== apiFound.points || localFound.visits !== apiFound.visits) {
            setSearchedCustomer(apiFound);
            // Update local customers array with API data
            setCustomers([apiFound, ...customers.filter(c => c.phone !== cleaned)]);
          }
        }
      }).catch(err => debugWarn('useLoyalty', 'fetchCustomers failed:', err));
    } else {
      setSearchedCustomer(null);
      setAppliedReward(null);
    }
  }, [customers, rewards, appliedReward, setSearchedCustomer, setAppliedReward, setCustomerPhone, showToast, setCustomers]);

  // Internal: apply a reward and handle free item auto-add
  const applyRewardStateAndCheckCart = useCallback((reward: LoyaltyReward | null, isFromOtp = false) => {
    if (!reward) {
      setAppliedReward(null);
      setCartItems(cartItems.map((item: any) => {
        if (item.isFree && item.originalPrice !== undefined) {
          return { ...item, price: item.originalPrice, isFree: false };
        }
        return item;
      }).filter((item: any) => item.notes !== 'Loyalty Free Reward Item'));
      return;
    }
    setAppliedReward(reward);
    const rewardItemName = reward.rewardItemName || (
      (reward.type === 'item' || reward.title.toLowerCase().includes('free '))
        ? reward.title.replace(/free\s*/gi, '').replace(/🎉\s*/gi, '').replace(/redeem\s*/gi, '').trim()
        : null
    );
    if (rewardItemName) {
      const existingIdx = cartItems.findIndex((item: any) =>
        isProductMatchingReward(item.product.name, item.product.id, rewardItemName, reward.rewardItemId)
      );
      if (existingIdx === -1) {
        let prod = products.find(p => isProductMatchingReward(p.name, p.id, rewardItemName, reward.rewardItemId));
        if (!prod) {
          prod = {
            id: reward.rewardItemId || `prod_${Date.now()}`,
            name: rewardItemName,
            price: reward.value > 0 ? reward.value : 8.50,
            category: 'Offers',
            image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=300&q=80',
            gstPercent: settings.defaultTaxRate,
            availability: true,
            code: 'OFFER',
          } as Product;
        }
        setCartItems([...cartItems, {
          id: `${prod.id}_default`,
          product: prod,
          quantity: 1,
          price: 0,
          originalPrice: prod.price,
          notes: 'Loyalty Free Reward Item',
          isFree: true,
        } as any]);
        showToast(`${isFromOtp ? 'SMS Verification passed. ' : ''}Added free ${prod.name} to checkout cart!`, 'success');
      } else {
        setCartItems(cartItems.map((item: any, idx: number) =>
          idx === existingIdx ? { ...item, price: 0, originalPrice: item.originalPrice ?? item.price, isFree: true } : item
        ));
        showToast(`${isFromOtp ? 'SMS Verification passed. ' : ''}Reward applied! ${rewardItemName} in cart is now FREE.`, 'success');
      }
    } else {
      showToast(`${isFromOtp ? 'SMS Verification passed. ' : ''}Voucher Applied: ${reward.title}`, 'success');
    }
  }, [cartItems, products, settings, isProductMatchingReward, setAppliedReward, setCartItems, showToast]);

  /**
   * Redeem a reward tier. Large rewards trigger a REAL server OTP flow:
   * POST /api/otp/request (rate-limited, hashed, expiring). In demo mode the
   * server echoes the code so the POS can display it; verification still
   * happens server-side in App.tsx via /api/otp/verify.
   * When the backend is unreachable (offline POS), falls back to a local
   * simulated code so checkout never blocks.
   */
  const handleRedeemRewardTier = useCallback((reward: LoyaltyReward) => {
    if (!searchedCustomer) {
      showToast('Search phone to verify loyalty member profile first.', 'warning');
      return;
    }
    if (appliedReward?.id === reward.id) {
      applyRewardStateAndCheckCart(null);
      showToast(`Voucher removed: ${reward.title}`, 'info');
      return;
    }
    if (searchedCustomer.points < reward.pointsRequired) {
      showToast(`Insufficient loyalty balance! Member needs ${reward.pointsRequired} pts.`, 'warning');
      return;
    }
    if (reward.isLargeReward && settings.otpSimulationEnabled) {
      const phone = searchedCustomer.phone;
      // BACKEND CALLED — request a server-issued OTP (rate-limited).
      api.requestOtp(phone, 'reward_redemption').then(result => {
        const simulatedCode = result?.simulatedCode || (result?.data?.simulatedCode);
        const code = typeof simulatedCode === 'string' ? simulatedCode : '';
        setOtpVerificationState({
          isOpen: true,
          code,                    // server-echoed code (demo mode) or '' (real SMS)
          typedCode: '',
          reward,
          phone,
          isServerOtp: true,
        });
        showToast(
          code
            ? `SMS Security Code sent to customer: ${code}`
            : `OTP sent to ${phone}. Ask the customer for the code.`,
          'info'
        );
      }).catch((err) => {
        // Offline / backend unreachable — local simulated fallback so the till
        // never blocks. Verification then happens locally in App.tsx.
        debugWarn('useLoyalty', 'requestOtp failed, using local simulation:', err);
        const generatedOTP = Math.floor(1000 + Math.random() * 9000).toString();
        setOtpVerificationState({
          isOpen: true,
          code: generatedOTP,
          typedCode: '',
          reward,
          phone: searchedCustomer.phone,
          isServerOtp: false,
        });
        showToast(`Offline mode — SMS Security Code (local): ${generatedOTP}`, 'info');
      });
    } else {
      applyRewardStateAndCheckCart(reward);
    }
  }, [searchedCustomer, appliedReward, settings, applyRewardStateAndCheckCart, showToast, setOtpVerificationState]);

  return {
    otpVerificationState, setOtpVerificationState,
    findCustomerByPhone,
    isProductMatchingReward,
    handleCustomerPhoneChange,
    handleRedeemRewardTier,
    applyRewardStateAndCheckCart,
  };
}
